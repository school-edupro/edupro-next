import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { addMonths, bad, firstOf, has, must } from './payroll-month';

export interface Packet {
  version: number;
  transferId: string;
  onDate: string;
  source: { school: string; tan: string | null; code: string; lastLocked: string | null };
  profile: Record<string, unknown> | null;
  structures: Array<{ code: string; amount: string }>;
  loans: Array<{
    id: string;
    type: string;
    balance: string;
    emi: string;
    method: string;
    rate: string | null;
  }>;
  tax: {
    fy: string;
    from: string | null;
    to: string;
    months: number;
    taxable: string;
    pf: string;
    pt: string;
    tds: string;
  };
}
/** the profile fields carried (the school's own choices — status, the record's audit — are not) */
const PROFILE = [
  'pf_applicable',
  'pf_wage_basis',
  'eps_applicable',
  'vpf_type',
  'vpf_value',
  'nps_applicable',
  'nps_ee_rate',
  'nps_er_rate',
  'esi_applicable',
  'pwd',
  'pt_applicable',
  'pt_exempt_reason',
  'tax_regime',
  'tds_mode',
  'category',
  'pay_level',
  'pay_cell',
  'contract_start',
  'contract_end',
  'increment_month',
  'pay_mode',
  'last_increment_on',
] as const;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

/**
 * Payroll's part of a transfer within the group (docs/design/86, phase E step 5; PAYROLL_PEOPLE_SPEC.md §6). Once the
 * sister school has taken the employee (the people module's transfer), its payroll checker brings the payroll part
 * across: the earlier-employer record of the tax year — verified, so the TDS here counts the months at the source —
 * the payroll profile, the pay structure as drafts for another checker to approve, and the loans still owed (closed at
 * the source). The service stays continuous: the date of joining comes across with the employee, and with it the
 * gratuity years.
 */
@Injectable()
export class PayrollTransferService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async packetOf(c: PoolClient, id: string): Promise<Packet> {
    try {
      return (await c.query<{ p: Packet }>(`SELECT app.payroll_transfer_packet($1) AS p`, [id]))
        .rows[0]!.p;
    } catch (e) {
      if ((e as { message?: string }).message === 'transfer.not_accepted')
        bad('Transfer not found', 404);
      throw e;
    }
  }

  /** The staff who came from a sister school: brought across or still to bring. */
  async list(ctx: RequestContext) {
    must(ctx, RUN.view, 'Only payroll staff see the transfers');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT t.id::text, t.on_date::text AS "onDate", t.snapshot->>'fromSchool' AS "fromSchool", t.to_employee_id::text AS "employeeId",
                  e.employee_code AS code, e.display_name AS name, i.created_at AS "importedAt", u.display_name AS "importedBy"
             FROM employee_school_transfers t JOIN employees e ON e.id = t.to_employee_id
             LEFT JOIN payroll_transfer_imports i ON i.transfer_id = t.id LEFT JOIN users u ON u.id = i.created_by
            WHERE t.to_school_id = app.current_school_id() AND t.status = 'accepted'
            ORDER BY (i.id IS NOT NULL), t.on_date DESC LIMIT 200`,
        )
      ).rows;
      return { rows, can: { bring: has(ctx, RUN.approve) } };
    });
  }

  /** What would come across, read live from the source: the figures, and what this school cannot take. */
  async preview(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker brings a transfer’s payroll');
    return this.db.tenant(requireTenant(ctx), async (c) => this.plan(c, id));
  }

  private async plan(c: PoolClient, id: string) {
    const t = (
      await c.query<{ to_employee_id: string | null; imported: boolean }>(
        `SELECT t.to_employee_id::text, EXISTS (SELECT 1 FROM payroll_transfer_imports i WHERE i.transfer_id = t.id) AS imported
           FROM employee_school_transfers t WHERE t.id = $1 AND t.to_school_id = app.current_school_id() AND t.status = 'accepted'`,
        [id],
      )
    ).rows[0];
    if (!t?.to_employee_id) bad('Transfer not found', 404);
    const p = await this.packetOf(c, id);
    const heads = new Set(
      (
        await c.query<{ code: string }>(
          `SELECT code FROM payroll_pay_heads WHERE code = ANY($1::text[])`,
          [p.structures.map((s) => s.code)],
        )
      ).rows.map((r) => r.code),
    );
    const prev = (
      await c.query<{ employer_name: string; status: string }>(
        `SELECT employer_name, status FROM payroll_prev_employment WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
        [t!.to_employee_id, p.tax.fy],
      )
    ).rows[0];
    const profile = (
      await c.query(`SELECT 1 FROM payroll_profiles WHERE employee_id = $1`, [t!.to_employee_id])
    ).rowCount;
    const onMonth = p.onDate.slice(0, 7);
    const notices: string[] = [];
    if (
      !p.source.lastLocked ||
      p.source.lastLocked < addMonths(onMonth, p.onDate.endsWith('-01') ? -1 : 0)
    )
      notices.push(
        `The source has locked up to ${p.source.lastLocked ?? 'no month'}: its last month's salary is not in the tax figures yet.`,
      );
    if (prev)
      notices.push(
        `An earlier-employer record of ${p.tax.fy} (${prev.employer_name}) is already here: the source's figures are not added to it.`,
      );
    if (profile) notices.push('A payroll profile is already here: it is kept as it is.');
    const dropped = p.structures.filter((s) => !heads.has(s.code)).map((s) => s.code);
    if (dropped.length)
      notices.push(`Pay heads this school does not have: ${dropped.join(', ')} (left out).`);
    return {
      employeeId: t!.to_employee_id!,
      imported: t!.imported,
      packet: p,
      structures: p.structures.filter((s) => heads.has(s.code)),
      dropped,
      writesPrev: !prev && p.tax.months > 0,
      writesProfile: !profile && !!p.profile,
      notices,
    };
  }

  /** Brought across: the earlier-employer record, the profile, the draft structure, the loans (closed at the source). */
  async bring(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker brings a transfer’s payroll');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('payroll.transfer.' || $1))`, [id]);
      const plan = await this.plan(c, id);
      if (plan.imported) bad('Already brought across', 409);
      if (!(await c.query(`SELECT 1 FROM payroll_settings`)).rowCount)
        bad('Open Payroll set-up first', 409);
      const p = plan.packet;
      const emp = plan.employeeId;
      const written: Record<string, unknown> = {};
      // the profile
      if (plan.writesProfile) {
        const cols = PROFILE.filter((k) => p.profile![k] !== undefined && p.profile![k] !== null);
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- the column names are the fixed list above; values are bound
          `INSERT INTO payroll_profiles (employee_id, school_id, ${cols.join(', ')}, created_by, updated_by)
           VALUES ($1, app.current_school_id(), ${cols.map((_, i) => `$${String(i + 2)}`).join(', ')}, app.current_user_id(), app.current_user_id())`,
          [emp, ...cols.map((k) => p.profile![k])],
        );
        written.profile = true;
      }
      // the pay structure, as drafts from the transfer date (another checker approves them)
      const sids: string[] = [];
      for (const s of plan.structures)
        sids.push(
          (
            await c.query<{ id: string }>(
              `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status, change_reason,
                                               created_by, updated_by)
               SELECT app.current_school_id(), $1, h.id, $2, $3::date, 'draft', $4, app.current_user_id(), app.current_user_id()
                 FROM payroll_pay_heads h WHERE h.code = $5 RETURNING id::text`,
              [emp, s.amount, p.onDate, `Transfer from ${p.source.school}`.slice(0, 200), s.code],
            )
          ).rows[0]!.id,
        );
      written.structures = sids;
      // the earlier-employer record of the tax year, verified now (the figures are the source payroll's own)
      if (plan.writesPrev) {
        written.prevEmployment = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_prev_employment (school_id, employee_id, fy, employer_name, employer_tan, period_from, period_to, gross,
                                                  pf, pt, tds, status, entered_for, created_by, decided_by, decided_at)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, 'VERIFIED', true,
                     app.current_user_id(), app.current_user_id(), now()) RETURNING id::text`,
            [
              emp,
              p.tax.fy,
              p.source.school.slice(0, 150),
              p.source.tan && TAN_RE.test(p.source.tan) ? p.source.tan : null,
              p.tax.from,
              p.tax.to,
              p.tax.taxable,
              p.tax.pf,
              p.tax.pt,
              p.tax.tds,
            ],
          )
        ).rows[0]!.id;
      }
      // the loans still owed: here from the transfer month (the next when it starts after the 1st)
      const start = p.onDate.endsWith('-01')
        ? firstOf(p.onDate.slice(0, 7))
        : firstOf(addMonths(p.onDate.slice(0, 7), 1));
      const loans: string[] = [];
      for (const l of p.loans)
        loans.push(
          (
            await c.query<{ id: string }>(
              `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, interest_rate, interest_method, balance,
                                          start_month, status, remarks, created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $3, $7::date, 'ACTIVE', $8, app.current_user_id(),
                       app.current_user_id()) RETURNING id::text`,
              [
                emp,
                l.type,
                l.balance,
                l.emi,
                l.rate,
                l.method,
                start,
                `TRANSFER/${p.source.school}/${p.source.code}`.slice(0, 1000),
              ],
            )
          ).rows[0]!.id,
        );
      written.loans = loans;
      await c.query(
        `INSERT INTO payroll_transfer_imports (school_id, transfer_id, employee_id, packet, written, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4::jsonb, app.current_user_id())`,
        [id, emp, JSON.stringify(p), JSON.stringify(written)],
      );
      const closed = p.loans.length
        ? (
            await c.query<{ n: number }>(
              `SELECT app.payroll_transfer_close_loans($1, $2::bigint[]) AS n`,
              [id, p.loans.map((l) => l.id)],
            )
          ).rows[0]!.n
        : 0;
      await this.audit.stage(ctx, c, {
        action: 'payroll.transfer.bring',
        entityType: 'employee_school_transfers',
        entityId: id,
        after: { ...written, closedAtSource: closed },
      });
      return {
        written,
        message: [
          written.profile ? 'the profile' : null,
          sids.length
            ? `${String(sids.length)} pay head(s) as drafts for another checker to approve`
            : null,
          written.prevEmployment ? `the earlier-employer record of ${p.tax.fy}` : null,
          loans.length ? `${String(loans.length)} loan(s), closed at the source` : null,
        ]
          .filter(Boolean)
          .join('; ')
          .replace(/^/, 'Brought across: ')
          .concat('.'),
      };
    });
  }
}
