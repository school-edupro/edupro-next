import { Injectable } from '@nestjs/common';
import { calculate } from '@edupro/payroll-engine';
import { decryptField, encryptField, maskValue, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { loadEmployee, monthContext } from './payroll-calc-input';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, has, hiddenFor, must } from './payroll-month';
import { fyOf, istToday } from './payroll-setup.service';
import { loadTaxExtras, taxYear } from './payroll-tax-extras';
import type {
  ChallanDto,
  DecideDto,
  DeclareDto,
  FinalDto,
  PerqDto,
  PrevDto,
  RegimeDto,
  TaxYearDto,
} from './payroll-tax.dto';
import { PAYROLL } from './payroll.dto';

export const OWN = 'payroll.own.view';
const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const QUARTER: Record<number, number[]> = {
  1: [4, 5, 6],
  2: [7, 8, 9],
  3: [10, 11, 12],
  4: [1, 2, 3],
};
/** April = 1 … March = 12 */
const idxOf = (calendarMonth: number) => ((calendarMonth + 8) % 12) + 1;
const fyMonths = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, k) => {
    const m = ((k + 3) % 12) + 1;
    return `${String(k < 9 ? y : y + 1)}-${String(m).padStart(2, '0')}`;
  });
};
const toPaise = (v: string | null | undefined) => {
  const [r, p = ''] = (v ?? '0').split('.');
  return BigInt(r || '0') * 100n + BigInt((p + '00').slice(0, 2));
};
const rupees = (p: bigint) => {
  const neg = p < 0n;
  const s = (neg ? -p : p).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};

/**
 * Income tax (docs/design/86, phase D step 3; PAYROLL_TAX_SPEC.md): My tax for every employee — declarations with
 * proofs (HRA by month with the landlord), the earlier employer, the regime until the cut-off, the year's tax worked
 * out live (never stored by looking); and the tax centre for payroll staff — declarations made for staff without a
 * sign-in, verified or rejected by a checker who is not the employee, the earlier employers, perquisites, the school's
 * final figure, TDS challans, the PAN check, the year's settings and its freeze.
 */
@Injectable()
export class PayrollTaxService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // ---- shared ---------------------------------------------------------------------------------------------------
  private async me(c: PoolClient) {
    const e = (
      await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      )
    ).rows[0];
    if (!e) bad('Your sign-in is not linked to an employee record', 403);
    return e!;
  }
  private async employee(c: PoolClient, ctx: RequestContext, id: string) {
    const e = (
      await c.query<{ id: string; code: string; name: string; user_id: string | null }>(
        `SELECT id::text, employee_code AS code, display_name AS name, user_id::text FROM employees
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!e || (await hiddenFor(c, ctx)).includes(id)) bad('Employee not found', 404);
    return e!;
  }
  private async open(c: PoolClient, fy: string) {
    const y = await taxYear(c, fy);
    if (y.frozen) bad(`${fy} is closed: nothing changes in it any more`, 409);
    return y;
  }
  private async labels(c: PoolClient, fy: string) {
    return (
      await c.query<{
        line_code: string;
        label: string;
        applies_to: string;
        cap_amount: string | null;
        cap_group: string | null;
        declarable: boolean;
        sort_order: number;
      }>(
        `SELECT line_code, label, applies_to, cap_amount::text, cap_group, declarable, sort_order
           FROM payroll_tax_labels WHERE fy = $1 ORDER BY sort_order, line_code`,
        [fy],
      )
    ).rows;
  }
  /** Proof files: uploaded by the person sending them, ready, a PDF or a picture, 10 MB at most. */
  private async proofs(c: PoolClient, ids: string[]) {
    if (!ids.length) return;
    const rows = (
      await c.query<{
        id: string;
        content_type: string;
        size_bytes: string;
        status: string;
        mine: boolean;
      }>(
        `SELECT id::text, content_type, size_bytes::text, status, (created_by = app.current_user_id()) AS mine
           FROM files WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [ids],
      )
    ).rows;
    if (rows.length !== new Set(ids).size) bad('A proof file is not found');
    for (const f of rows) {
      if (!f.mine) bad('A proof must be a file you uploaded', 403);
      if (f.status !== 'ready') bad('A proof file is not uploaded completely', 409);
      if (!PROOF_TYPES.includes(f.content_type)) bad('A proof must be a PDF, JPG or PNG');
      if (Number(f.size_bytes) > 10 * 1024 * 1024) bad('A proof file is above 10 MB');
    }
  }
  private async ownProofs(c: PoolClient, ids: string[], type: string, id: string) {
    if (ids.length)
      await c.query(
        `UPDATE files SET owner_entity_type = $2, owner_entity_id = $3, classification = 'sensitive'
          WHERE id = ANY($1::bigint[])`,
        [ids, type, id],
      );
  }
  private currentFy() {
    return fyOf(istToday());
  }

  // ---- declarations ---------------------------------------------------------------------------------------------
  /** A declaration: made by the employee in the year's window, or by payroll staff for one without a sign-in. */
  async declare(ctx: RequestContext, dto: DeclareDto) {
    const staff = !!dto.employeeId;
    if (staff) must(ctx, RUN.manage, 'Only a payroll maker declares for an employee');
    else must(ctx, OWN, 'Only an employee declares for themselves');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = staff ? await this.employee(c, ctx, dto.employeeId!) : await this.me(c);
      const year = await this.open(c, dto.fy);
      const today = istToday();
      if (!staff && (today < year.declareFrom || today > year.declareTo))
        bad(
          `Declarations for ${dto.fy} are taken from ${year.declareFrom} to ${year.declareTo}: ask the payroll office`,
          409,
        );
      const label = (await this.labels(c, dto.fy)).find((l) => l.line_code === dto.lineCode);
      if (!label?.declarable) bad('Not a section declared for this year');
      let amount: string;
      let detail: Record<string, unknown> = {};
      if (dto.lineCode === 'HRA_RENT') {
        if (!dto.hra) bad('Give the rent by month, the city and the landlord');
        const h = dto.hra!;
        const months = new Set(fyMonths(dto.fy));
        if (h.months.some((x) => !months.has(x.month))) bad(`A rent month is outside ${dto.fy}`);
        if (new Set(h.months.map((x) => x.month)).size !== h.months.length)
          bad('A month is given twice');
        const total = h.months.reduce((s, x) => s + toPaise(x.rent), 0n);
        if (total <= 0n) bad('No rent');
        // the landlord's PAN above ₹1 lakh of rent a year
        if (total > 10_000_000n && !h.landlord.pan)
          bad('The rent is above ₹1,00,000 a year: give the landlord’s PAN');
        amount = rupees(total);
        const listed = year.listedCities.some((x) => x.toLowerCase() === h.city.toLowerCase());
        detail = {
          months: h.months,
          city: h.city,
          listedCity: listed,
          landlord: {
            name: h.landlord.name,
            address: h.landlord.address,
            relation: h.landlord.relation,
            panMasked: h.landlord.pan ? maskValue(h.landlord.pan) : null,
            panEnc: h.landlord.pan ? encryptField(h.landlord.pan) : null,
          },
        };
      } else {
        if (!dto.amount || Number(dto.amount) <= 0) bad('Give the amount');
        amount = dto.amount!;
      }
      await this.proofs(c, dto.proofFileIds);
      const old = (
        await c.query<{ id: string; status: string; proof_file_ids: string[] }>(
          `SELECT id::text, status, proof_file_ids::text[] AS proof_file_ids FROM payroll_declarations
            WHERE employee_id = $1 AND fy = $2 AND line_code = $3 AND deleted_at IS NULL FOR UPDATE`,
          [e.id, dto.fy, dto.lineCode],
        )
      ).rows[0];
      if (old?.status === 'VERIFIED')
        bad('This section is verified: a payroll checker reopens it before it is changed', 409);
      if (old)
        await c.query(`UPDATE payroll_declarations SET deleted_at = now() WHERE id = $1`, [old.id]);
      const proofs = dto.proofFileIds.length ? dto.proofFileIds : (old?.proof_file_ids ?? []);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_declarations (school_id, employee_id, fy, line_code, declared, detail, proof_file_ids,
                                             entered_for, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6::bigint[], $7, app.current_user_id())
           RETURNING id::text`,
          [e.id, dto.fy, dto.lineCode, amount, JSON.stringify(detail), proofs, staff],
        )
      ).rows[0]!.id;
      await this.ownProofs(c, dto.proofFileIds, 'payroll_declaration', id);
      await this.audit.stage(ctx, c, {
        action: 'payroll.declaration.submit',
        entityType: 'payroll_declarations',
        entityId: id,
        after: { employee: e.code, fy: dto.fy, section: dto.lineCode, amount, forEmployee: staff },
      });
      return {
        id,
        amount,
        message: `Declared ₹${amount}. It counts in the monthly tax until ${year.proofDue}; after that, only once a checker verifies it.`,
      };
    });
  }

  async withdraw(ctx: RequestContext, id: string) {
    must(ctx, OWN, 'Only the employee withdraws their declaration');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.me(c);
      const r = (
        await c.query<{ fy: string; status: string }>(
          `SELECT fy, status FROM payroll_declarations WHERE id = $1 AND employee_id = $2 AND deleted_at IS NULL`,
          [id, e.id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      await this.open(c, r!.fy);
      if (r!.status === 'VERIFIED') bad('A verified section stays: ask a payroll checker', 409);
      await c.query(`UPDATE payroll_declarations SET deleted_at = now() WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.declaration.withdraw',
        entityType: 'payroll_declarations',
        entityId: id,
      });
      return { ok: true };
    });
  }

  async declarations(ctx: RequestContext, q: { fy?: string; status: string; q?: string }) {
    must(ctx, RUN.view, 'Only payroll staff see the declarations');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const fy = q.fy ?? this.currentFy();
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query(
          `SELECT d.id::text, d.employee_id::text, e.employee_code AS code, e.display_name AS name, d.line_code,
                  l.label, d.declared::text, d.verified::text, d.status, d.reject_reason, d.detail, d.entered_for,
                  cardinality(d.proof_file_ids) AS proofs, d.proof_file_ids::text[] AS proof_file_ids, d.created_at,
                  d.decided_at, u.display_name AS decided_by_name, (e.user_id = app.current_user_id()) AS own
             FROM payroll_declarations d
             JOIN employees e ON e.id = d.employee_id
             LEFT JOIN payroll_tax_labels l ON l.fy = d.fy AND l.line_code = d.line_code
             LEFT JOIN users u ON u.id = d.decided_by
            WHERE d.fy = $1 AND d.deleted_at IS NULL AND ($2 = 'ALL' OR d.status = $2)
              AND NOT (d.employee_id::text = ANY($3::text[]))
              AND ($4::text IS NULL OR e.display_name ILIKE '%' || $4 || '%' OR e.employee_code ILIKE $4 || '%')
            ORDER BY e.display_name, l.sort_order NULLS LAST
            LIMIT 500`,
          [fy, q.status, hidden, q.q ?? null],
        )
      ).rows.map((r) => {
        const x = camelRow(r) as Record<string, unknown> & { detail: Record<string, unknown> };
        const ll = x.detail.landlord as Record<string, unknown> | undefined;
        if (ll) delete ll.panEnc;
        return x;
      });
      const counts = (
        await c.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM payroll_declarations WHERE fy = $1 AND deleted_at IS NULL GROUP BY 1`,
          [fy],
        )
      ).rows;
      return {
        fy,
        year: await taxYear(c, fy),
        rows,
        counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
        can: { manage: has(ctx, RUN.manage), decide: has(ctx, RUN.approve) },
      };
    });
  }

  /** A checker verifies (all or part of it) or rejects with a reason, or reopens — never their own. */
  async decide(ctx: RequestContext, id: string, dto: DecideDto) {
    must(ctx, RUN.approve, 'Only a payroll checker verifies declarations');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const d = (
        await c.query<{
          fy: string;
          status: string;
          declared: string;
          own: boolean;
          employee_id: string;
        }>(
          `SELECT d.fy, d.status, d.declared::text, (e.user_id = app.current_user_id()) AS own, d.employee_id::text
             FROM payroll_declarations d JOIN employees e ON e.id = d.employee_id
            WHERE d.id = $1 AND d.deleted_at IS NULL FOR UPDATE OF d`,
          [id],
        )
      ).rows[0];
      if (!d || (await hiddenFor(c, ctx)).includes(d.employee_id)) bad('Not found', 404);
      if (d!.own) bad('Your own declaration is verified by another checker', 403);
      await this.open(c, d!.fy);
      if (dto.action === 'reopen') {
        if (d!.status === 'SUBMITTED') bad('It is waiting already', 409);
        await c.query(
          `UPDATE payroll_declarations SET status = 'SUBMITTED', verified = NULL, reject_reason = NULL, decided_by = NULL,
                  decided_at = NULL, updated_at = now() WHERE id = $1`,
          [id],
        );
      } else {
        if (d!.status !== 'SUBMITTED')
          bad('Only a declaration waiting is decided: reopen it first', 409);
        if (dto.action === 'verify') {
          const v = dto.verified ?? d!.declared;
          if (Number(v) <= 0) bad('Nothing verified: reject it instead');
          if (Number(v) > Number(d!.declared)) bad('More than declared');
          await c.query(
            `UPDATE payroll_declarations SET status = 'VERIFIED', verified = $2, decided_by = app.current_user_id(),
                    decided_at = now(), updated_at = now() WHERE id = $1`,
            [id, v],
          );
        } else
          await c.query(
            `UPDATE payroll_declarations SET status = 'REJECTED', verified = NULL, reject_reason = $2,
                    decided_by = app.current_user_id(), decided_at = now(), updated_at = now() WHERE id = $1`,
            [id, dto.reason],
          );
      }
      await this.audit.stage(ctx, c, {
        action: `payroll.declaration.${dto.action}`,
        entityType: 'payroll_declarations',
        entityId: id,
        after: dto,
      });
      return { ok: true };
    });
  }

  /** A proof's file, for payroll staff (a maker never sees a confidential employee's). */
  async proofUrl(ctx: RequestContext, fileId: string) {
    must(ctx, RUN.view, 'Only payroll staff open a proof');
    const owner = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ employee_id: string }>(
          `SELECT employee_id::text FROM payroll_declarations WHERE $1::bigint = ANY(proof_file_ids)
           UNION ALL SELECT employee_id::text FROM payroll_prev_employment WHERE $1::bigint = ANY(proof_file_ids)
           LIMIT 1`,
          [fileId],
        )
      ).rows[0];
      if (!r || (await hiddenFor(c, ctx)).includes(r.employee_id)) bad('Not found', 404);
      return r!;
    });
    void owner;
    return this.files.downloadUrl(ctx, fileId);
  }

  // ---- the earlier employer (Form 122 / 12B) ---------------------------------------------------------------------
  async savePrev(ctx: RequestContext, dto: PrevDto) {
    const staff = !!dto.employeeId;
    if (staff) must(ctx, RUN.manage, 'Only a payroll maker enters this for an employee');
    else must(ctx, OWN, 'Only an employee enters their earlier employer');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = staff ? await this.employee(c, ctx, dto.employeeId!) : await this.me(c);
      await this.open(c, dto.fy);
      await this.proofs(c, dto.proofFileIds);
      const old = (
        await c.query<{ id: string; status: string }>(
          `SELECT id::text, status FROM payroll_prev_employment WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL FOR UPDATE`,
          [e.id, dto.fy],
        )
      ).rows[0];
      if (old?.status === 'VERIFIED')
        bad('It is verified: a payroll checker reopens it before it is changed', 409);
      if (old)
        await c.query(`UPDATE payroll_prev_employment SET deleted_at = now() WHERE id = $1`, [
          old.id,
        ]);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_prev_employment (school_id, employee_id, fy, employer_name, employer_tan, period_from, period_to,
                                                gross, exempt, pf, pt, tds, proof_file_ids, entered_for, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12::bigint[], $13,
                   app.current_user_id())
           RETURNING id::text`,
          [
            e.id,
            dto.fy,
            dto.employerName,
            dto.employerTan ?? null,
            dto.periodFrom ?? null,
            dto.periodTo ?? null,
            dto.gross,
            dto.exempt,
            dto.pf,
            dto.pt,
            dto.tds,
            dto.proofFileIds,
            staff,
          ],
        )
      ).rows[0]!.id;
      await this.ownProofs(c, dto.proofFileIds, 'payroll_prev_employment', id);
      await this.audit.stage(ctx, c, {
        action: 'payroll.prev_employment.submit',
        entityType: 'payroll_prev_employment',
        entityId: id,
        after: { employee: e.code, fy: dto.fy, gross: dto.gross, tds: dto.tds },
      });
      return { id };
    });
  }

  async prevList(ctx: RequestContext, fy?: string) {
    must(ctx, RUN.view, 'Only payroll staff see the earlier employers');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = fy ?? this.currentFy();
      const hidden = await hiddenFor(c, ctx);
      return {
        fy: y,
        rows: (
          await c.query(
            `SELECT p.id::text, p.employee_id::text, e.employee_code AS code, e.display_name AS name, p.employer_name,
                    p.employer_tan, p.period_from::text, p.period_to::text, p.gross::text, p.exempt::text, p.pf::text,
                    p.pt::text, p.tds::text, p.status, p.reject_reason, cardinality(p.proof_file_ids) AS proofs,
                    p.proof_file_ids::text[] AS proof_file_ids, (e.user_id = app.current_user_id()) AS own
               FROM payroll_prev_employment p JOIN employees e ON e.id = p.employee_id
              WHERE p.fy = $1 AND p.deleted_at IS NULL AND NOT (p.employee_id::text = ANY($2::text[]))
              ORDER BY e.display_name`,
            [y, hidden],
          )
        ).rows.map(camelRow),
        can: { decide: has(ctx, RUN.approve) },
      };
    });
  }

  async prevDecide(ctx: RequestContext, id: string, dto: DecideDto) {
    must(ctx, RUN.approve, 'Only a payroll checker verifies an earlier employer');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = (
        await c.query<{ fy: string; status: string; own: boolean }>(
          `SELECT p.fy, p.status, (e.user_id = app.current_user_id()) AS own FROM payroll_prev_employment p
             JOIN employees e ON e.id = p.employee_id WHERE p.id = $1 AND p.deleted_at IS NULL FOR UPDATE OF p`,
          [id],
        )
      ).rows[0];
      if (!p) bad('Not found', 404);
      if (p!.own) bad('Your own is verified by another checker', 403);
      await this.open(c, p!.fy);
      const to =
        dto.action === 'verify' ? 'VERIFIED' : dto.action === 'reject' ? 'REJECTED' : 'SUBMITTED';
      if (dto.action !== 'reopen' && p!.status !== 'SUBMITTED') bad('Reopen it first', 409);
      if (dto.action === 'reopen' && p!.status === 'SUBMITTED') bad('It is waiting already', 409);
      await c.query(
        `UPDATE payroll_prev_employment SET status = $2, reject_reason = $3,
                decided_by = CASE WHEN $4 THEN NULL ELSE app.current_user_id() END,
                decided_at = CASE WHEN $4 THEN NULL ELSE now() END, updated_at = now()
          WHERE id = $1`,
        [id, to, dto.action === 'reject' ? dto.reason : null, dto.action === 'reopen'],
      );
      await this.audit.stage(ctx, c, {
        action: `payroll.prev_employment.${dto.action}`,
        entityType: 'payroll_prev_employment',
        entityId: id,
        after: dto,
      });
      return { ok: true };
    });
  }

  // ---- the regime -----------------------------------------------------------------------------------------------
  /** The employee until the cut-off month of the year; the payroll admin any time (a reason after the cut-off). */
  async regime(ctx: RequestContext, dto: RegimeDto) {
    const admin = !!dto.employeeId;
    if (admin) must(ctx, PAYROLL.admin, 'Only the payroll admin sets an employee’s regime');
    else must(ctx, OWN, 'Only the employee chooses their regime');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = admin ? await this.employee(c, ctx, dto.employeeId!) : await this.me(c);
      await this.open(c, dto.fy);
      if (dto.fy !== this.currentFy()) bad('The regime is chosen for the current year only', 409);
      const cutoff =
        (await c.query<{ m: number }>(`SELECT regime_cutoff_month AS m FROM payroll_settings`))
          .rows[0]?.m ?? 12;
      const inWindow = idxOf(Number(istToday().slice(5, 7))) <= idxOf(cutoff);
      if (!inWindow && !admin)
        bad('The regime can no longer be changed this year: ask the payroll office', 409);
      if (!inWindow && admin && !dto.reason) bad('After the cut-off, give a reason');
      await c.query(
        `INSERT INTO payroll_profiles (employee_id, school_id, tax_regime) VALUES ($1, app.current_school_id(), $2)
         ON CONFLICT (employee_id) DO UPDATE SET tax_regime = EXCLUDED.tax_regime`,
        [e.id, dto.regime],
      );
      await c.query(
        `INSERT INTO payroll_regime_events (school_id, employee_id, fy, regime, how, reason, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())`,
        [e.id, dto.fy, dto.regime, admin ? 'ADMIN' : 'IN_WINDOW', dto.reason ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.regime.set',
        entityType: 'payroll_profiles',
        entityId: e.id,
        after: {
          regime: dto.regime,
          fy: dto.fy,
          how: admin ? 'ADMIN' : 'IN_WINDOW',
          reason: dto.reason,
        },
      });
      return {
        ok: true,
        message: `The ${dto.regime === 'NEW' ? 'new' : 'old'} regime from the next pay run: the year is worked out again and the rest of the tax spread over the months left.`,
      };
    });
  }

  // ---- perquisites ------------------------------------------------------------------------------------------------
  async perquisites(ctx: RequestContext, fy?: string) {
    must(ctx, RUN.view, 'Only payroll staff see perquisites');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = fy ?? this.currentFy();
      const hidden = await hiddenFor(c, ctx);
      return {
        fy: y,
        rows: (
          await c.query(
            `SELECT p.id::text, p.employee_id::text, e.employee_code AS code, e.display_name AS name, p.perq_type,
                    p.amount::text, p.description, p.verified, p.created_at
               FROM payroll_perquisites p JOIN employees e ON e.id = p.employee_id
              WHERE p.fy = $1 AND p.superseded_at IS NULL AND p.deleted_at IS NULL AND NOT (p.employee_id::text = ANY($2::text[]))
              ORDER BY e.display_name, p.perq_type`,
            [y, hidden],
          )
        ).rows.map(camelRow),
        can: { manage: has(ctx, RUN.manage), verify: has(ctx, RUN.approve) },
      };
    });
  }

  async savePerq(ctx: RequestContext, dto: PerqDto) {
    must(ctx, RUN.manage, 'Only a payroll maker enters perquisites');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, dto.employeeId);
      await this.open(c, dto.fy);
      await c.query(
        `UPDATE payroll_perquisites SET superseded_at = now()
          WHERE employee_id = $1 AND fy = $2 AND perq_type = $3 AND superseded_at IS NULL AND deleted_at IS NULL`,
        [e.id, dto.fy, dto.perqType],
      );
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_perquisites (school_id, employee_id, fy, perq_type, amount, description, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
          [e.id, dto.fy, dto.perqType, dto.amount, dto.description ?? null],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.perquisite.save',
        entityType: 'payroll_perquisites',
        entityId: id,
        after: { employee: e.code, ...dto },
      });
      return { id, message: 'Saved. It counts in the tax once a checker verifies it.' };
    });
  }

  async perqAction(ctx: RequestContext, id: string, action: 'verify' | 'unverify' | 'delete') {
    if (action === 'delete') must(ctx, RUN.manage, 'Only a payroll maker removes a perquisite');
    else must(ctx, RUN.approve, 'Only a payroll checker verifies a perquisite');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = (
        await c.query<{ fy: string; employee_id: string; mine: boolean }>(
          `SELECT fy, employee_id::text, (created_by = app.current_user_id()) AS mine FROM payroll_perquisites
            WHERE id = $1 AND superseded_at IS NULL AND deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!p || (await hiddenFor(c, ctx)).includes(p.employee_id)) bad('Not found', 404);
      await this.open(c, p!.fy);
      if (action === 'verify' && p!.mine && !has(ctx, PAYROLL.admin))
        bad('You entered it: another checker verifies it', 403);
      await c.query(
        action === 'delete'
          ? `UPDATE payroll_perquisites SET deleted_at = now() WHERE id = $1`
          : `UPDATE payroll_perquisites SET verified = $2, verified_by = CASE WHEN $2 THEN app.current_user_id() END,
                    verified_at = CASE WHEN $2 THEN now() END WHERE id = $1`,
        action === 'delete' ? [id] : [id, action === 'verify'],
      );
      await this.audit.stage(ctx, c, {
        action: `payroll.perquisite.${action}`,
        entityType: 'payroll_perquisites',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- the school's final figure ---------------------------------------------------------------------------------
  async setFinal(ctx: RequestContext, dto: FinalDto) {
    must(ctx, RUN.approve, 'Only a payroll checker sets the final tax');
    const sheet = await this.sheet(ctx, dto.employeeId, dto.fy);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, dto.employeeId);
      await this.open(c, dto.fy);
      await c.query(
        `UPDATE payroll_tax_finals SET cleared_at = now(), cleared_by = app.current_user_id()
          WHERE employee_id = $1 AND fy = $2 AND cleared_at IS NULL`,
        [e.id, dto.fy],
      );
      const computed = 'annual' in sheet && sheet.annual ? sheet.annual.computed : null;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_tax_finals (school_id, employee_id, fy, annual, spread_months, reason, computed_annual, set_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
          [e.id, dto.fy, dto.annual, dto.spreadMonths ?? null, dto.reason, computed],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_final.set',
        entityType: 'payroll_tax_finals',
        entityId: id,
        after: { employee: e.code, ...dto, computed },
      });
      return {
        id,
        message: `The year's tax is set to ₹${dto.annual}${computed ? ` (worked out: ₹${computed})` : ''}; from the next run.`,
      };
    });
  }

  async clearFinal(ctx: RequestContext, employeeId: string, fy: string) {
    must(ctx, RUN.approve, 'Only a payroll checker clears the final tax');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, employeeId);
      await this.open(c, fy);
      const r = await c.query(
        `UPDATE payroll_tax_finals SET cleared_at = now(), cleared_by = app.current_user_id()
          WHERE employee_id = $1 AND fy = $2 AND cleared_at IS NULL`,
        [e.id, fy],
      );
      if (!r.rowCount) bad('No final figure is set', 409);
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_final.clear',
        entityType: 'payroll_tax_finals',
        entityId: e.id,
        after: { fy },
      });
      return { ok: true };
    });
  }

  // ---- TDS challans -----------------------------------------------------------------------------------------------
  async challans(ctx: RequestContext, fy?: string) {
    must(ctx, RUN.view, 'Only payroll staff see the challans');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = fy ?? this.currentFy();
      const deducted = await this.deductedByMonth(c, y);
      const rows = (
        await c.query<{
          id: string;
          quarter: number;
          bsr_code: string;
          challan_no: string;
          deposited_on: string;
          amount: string;
          interest: string;
          late_fee: string;
          months: number[];
        }>(
          `SELECT id::text, quarter, bsr_code, challan_no, deposited_on::text, amount::text, interest::text, late_fee::text, months
             FROM payroll_tds_challans WHERE fy = $1 AND deleted_at IS NULL ORDER BY quarter, deposited_on`,
          [y],
        )
      ).rows.map((r) => {
        const due = r.months.reduce((s, m) => s + (deducted.get(m) ?? 0n), 0n);
        return {
          ...camelRow(r),
          months: r.months,
          deducted: rupees(due),
          difference: rupees(toPaise(r.amount) - due),
        };
      });
      const covered = new Set(rows.flatMap((r) => r.months));
      return {
        fy: y,
        rows,
        months: [...deducted.entries()].map(([m, v]) => ({
          month: m,
          deducted: rupees(v),
          covered: covered.has(m),
        })),
        can: { manage: has(ctx, RUN.manage), remove: has(ctx, RUN.approve) },
      };
    });
  }

  /** The TDS deducted in each pay month (1–12) of the year's locked runs. */
  private async deductedByMonth(c: PoolClient, fy: string) {
    const rows = (
      await c.query<{ m: number; s: string }>(
        `SELECT extract(month FROM r.month)::int AS m, sum(r.it_amount + r.cess_amount)::text AS s
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.month BETWEEN $1::date AND $2::date AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
            AND r.status <> 'FAILED'
          GROUP BY 1`,
        [`${fy.slice(0, 4)}-04-01`, `${String(Number(fy.slice(0, 4)) + 1)}-03-01`],
      )
    ).rows;
    return new Map(rows.map((r) => [r.m, toPaise(r.s)]));
  }

  async addChallan(ctx: RequestContext, dto: ChallanDto) {
    must(ctx, RUN.manage, 'Only a payroll maker enters a challan');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, dto.fy);
      if (dto.months.some((m) => !QUARTER[dto.quarter]!.includes(m)))
        bad(`A month is not in quarter ${String(dto.quarter)}`);
      if (new Set(dto.months).size !== dto.months.length) bad('A month is given twice');
      const taken = (
        await c.query<{ months: number[] }>(
          `SELECT months FROM payroll_tds_challans WHERE fy = $1 AND deleted_at IS NULL AND months && $2::int[]`,
          [dto.fy, dto.months],
        )
      ).rows;
      if (taken.length) bad('A month is already paid by another challan', 409);
      const y = Number(dto.fy.slice(0, 4));
      if (dto.depositedOn < `${String(y)}-04-01` || dto.depositedOn > `${String(y + 1)}-05-31`)
        bad(`The deposit date is outside ${dto.fy}`);
      const deducted = await this.deductedByMonth(c, dto.fy);
      const due = dto.months.reduce((s, m) => s + (deducted.get(m) ?? 0n), 0n);
      try {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_tds_challans (school_id, fy, quarter, bsr_code, challan_no, deposited_on, amount, interest,
                                               late_fee, months, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8, $9::int[], app.current_user_id())
             RETURNING id::text`,
            [
              dto.fy,
              dto.quarter,
              dto.bsrCode,
              dto.challanNo,
              dto.depositedOn,
              dto.amount,
              dto.interest,
              dto.lateFee,
              dto.months,
            ],
          )
        ).rows[0]!.id;
        await this.audit.stage(ctx, c, {
          action: 'payroll.tds_challan.add',
          entityType: 'payroll_tds_challans',
          entityId: id,
          after: dto,
        });
        const diff = toPaise(dto.amount) - due;
        return {
          id,
          deducted: rupees(due),
          message: diff
            ? `Saved. It differs from the TDS deducted in those months (₹${rupees(due)}) by ₹${rupees(diff)}.`
            : 'Saved.',
        };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') bad('This challan is entered already', 409);
        throw e;
      }
    });
  }

  async removeChallan(ctx: RequestContext, id: string, reason: string) {
    must(ctx, RUN.approve, 'Only a payroll checker removes a challan');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ fy: string }>(
          `SELECT fy FROM payroll_tds_challans WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      await this.open(c, r!.fy);
      await c.query(
        `UPDATE payroll_tds_challans SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tds_challan.remove',
        entityType: 'payroll_tds_challans',
        entityId: id,
        after: { reason },
      });
      return { ok: true };
    });
  }

  // ---- the PAN check ---------------------------------------------------------------------------------------------
  async panCheck(ctx: RequestContext) {
    must(ctx, RUN.approve, 'Only a payroll checker runs the PAN check');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<{ id: string; code: string; name: string; pan: string | null }>(
          `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.secure->>'pan' AS pan
             FROM employees e
            WHERE e.deleted_at IS NULL AND (e.left_on IS NULL OR e.left_on >= (current_date - interval '1 year'))
              AND EXISTS (SELECT 1 FROM payroll_records r WHERE r.employee_id = e.id)
            ORDER BY e.display_name`,
        )
      ).rows;
      const out: Array<{
        id: string;
        code: string;
        name: string;
        status: string;
        masked: string | null;
      }> = [];
      for (const r of rows) {
        let plain: string | null = null;
        let status = 'OK';
        if (!r.pan) status = 'MISSING';
        else
          try {
            plain = decryptField(r.pan);
            if (!plain || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(plain)) status = 'INVALID';
          } catch {
            status = 'UNREADABLE';
          }
        if (status !== 'OK')
          out.push({
            id: r.id,
            code: r.code,
            name: r.name,
            status,
            masked: plain ? maskValue(plain) : null,
          });
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.pan.check',
        entityType: 'employees',
        after: { checked: rows.length, attention: out.length },
      });
      return {
        checked: rows.length,
        rows: out,
        message: `${String(out.length)} employee(s) need their PAN looked at (checked ${String(rows.length)}). Without a PAN, tax is at least 20 %.`,
      };
    });
  }

  // ---- the year's settings -------------------------------------------------------------------------------------
  async year(ctx: RequestContext, fy: string) {
    must(ctx, RUN.view, 'Only payroll staff see the tax year');
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      ...(await taxYear(c, fy)),
      can: { manage: has(ctx, PAYROLL.admin) },
    }));
  }

  async saveYear(ctx: RequestContext, fy: string, dto: TaxYearDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin sets the tax year');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, fy);
      await c.query(
        `INSERT INTO payroll_tax_years (school_id, fy, declare_from, declare_to, proof_due, listed_cities, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3::date, $4::date, $5::text[], app.current_user_id())
         ON CONFLICT (school_id, fy) DO UPDATE SET declare_from = EXCLUDED.declare_from, declare_to = EXCLUDED.declare_to,
           proof_due = EXCLUDED.proof_due, listed_cities = EXCLUDED.listed_cities, updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [fy, dto.declareFrom, dto.declareTo, dto.proofDue, dto.listedCities],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_year.save',
        entityType: 'payroll_tax_years',
        entityId: fy,
        after: dto,
      });
      return { ok: true };
    });
  }

  async freeze(ctx: RequestContext, fy: string) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin closes a tax year');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.open(c, fy);
      await c.query(
        `INSERT INTO payroll_tax_years (school_id, fy, declare_from, declare_to, proof_due, listed_cities, frozen_at, frozen_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3::date, $4::date, $5::text[], now(), app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, fy) DO UPDATE SET frozen_at = now(), frozen_by = app.current_user_id(), updated_at = now()`,
        [fy, y.declareFrom, y.declareTo, y.proofDue, y.listedCities],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_year.freeze',
        entityType: 'payroll_tax_years',
        entityId: fy,
      });
      return { ok: true };
    });
  }

  // ---- the year's tax, worked out live (nothing stored by looking) ---------------------------------------------------
  /**
   * The year's tax as the next run would work it out: the month after the year's last locked one (this month in the
   * current year), a full month when its attendance is not in yet; the other regime beside it; the months' plan.
   */
  async sheet(ctx: RequestContext, employeeId: string, fy: string, self = false) {
    if (!self) must(ctx, RUN.view, 'Only payroll staff see an employee’s tax');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!self) await this.employee(c, ctx, employeeId);
      return this.sheetIn(c, employeeId, fy);
    });
  }

  private async sheetIn(c: PoolClient, employeeId: string, fy: string) {
    const months = fyMonths(fy);
    const today = istToday().slice(0, 7);
    const last = (
      await c.query<{ m: string | null }>(
        `SELECT to_char(max(r.month), 'YYYY-MM') AS m FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
            AND NOT r.is_top_up AND r.month BETWEEN $2::date AND $3::date`,
        [employeeId, `${months[0]!}-01`, `${months[11]!}-01`],
      )
    ).rows[0]?.m;
    let month = today < months[0]! ? months[0]! : today > months[11]! ? months[11]! : today;
    if (last && last >= month) month = months[Math.min(11, months.indexOf(last) + 1)]!;
    const done = !!last && last === months[11];
    const m = await monthContext(c, month);
    const run = async (regime?: 'NEW' | 'OLD') => {
      const l = await loadEmployee(c, m, employeeId, { topUp: null, needAttendance: false });
      if (!l.ok) return { error: l.reason };
      const input = l.input;
      if (input.attendance.monthDays === '0') {
        const days = String(
          new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate(),
        );
        input.attendance = { ...input.attendance, monthDays: days, paidDays: days };
      }
      if (regime && regime !== input.profile.taxRegime) {
        input.profile = { ...input.profile, taxRegime: regime };
        input.tax = {
          ...input.tax,
          rules: m.taxRules[regime],
          extras: await loadTaxExtras(c, {
            employeeId,
            fy,
            fyStart: `${fy.slice(0, 4)}-04-01`,
            monthStart: m.start,
            regime,
            npsApplicable: input.profile.npsApplicable,
            includeMonth: false,
          }),
        };
      }
      if (!input.tax.rules) return { error: `No income-tax slabs for ${fy} in this regime` };
      const r = calculate({ ...input, tax: { ...input.tax, manual: null } });
      if (!r.ok) return { error: r.reason };
      return { r, regime: input.profile.taxRegime };
    };
    const now = await run();
    if ('error' in now) return { fy, month, done, error: now.error };
    const other = await run(now.regime === 'NEW' ? 'OLD' : 'NEW');
    const t = now.r.tds;
    const proj = t && !('manual' in t) ? t : null;
    const S = (v: bigint | undefined | null) => (v === undefined || v === null ? null : rupees(v));
    const deducted = (
      await c.query<{ m: string; tds: string }>(
        `SELECT to_char(r.month, 'YYYY-MM') AS m, sum(r.it_amount + r.cess_amount)::text AS tds
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
            AND r.month BETWEEN $2::date AND $3::date GROUP BY 1`,
        [employeeId, `${months[0]!}-01`, `${months[11]!}-01`],
      )
    ).rows;
    const typed = (
      await c.query<{ m: string; v: string }>(
        `SELECT to_char(month, 'YYYY-MM') AS m, (it_amount + cess_amount)::text AS v FROM payroll_tds_manual
          WHERE employee_id = $1 AND month BETWEEN $2::date AND $3::date`,
        [employeeId, `${months[0]!}-01`, `${months[11]!}-01`],
      )
    ).rows;
    const final = (
      await c.query<{
        annual: string;
        reason: string;
        spread_months: number | null;
        computed_annual: string | null;
      }>(
        `SELECT annual::text, reason, spread_months, computed_annual::text FROM payroll_tax_finals
          WHERE employee_id = $1 AND fy = $2 AND cleared_at IS NULL`,
        [employeeId, fy],
      )
    ).rows[0];
    const plan = months.map((x) => {
      const d = deducted.find((r) => r.m === x);
      const ty = typed.find((r) => r.m === x);
      return {
        month: x,
        state: d
          ? 'deducted'
          : ty
            ? 'typed'
            : proj && x >= month && months.indexOf(x) < months.indexOf(month) + proj.monthsLeft
              ? 'planned'
              : 'none',
        amount: d
          ? d.tds
          : ty
            ? ty.v
            : proj && x >= month && months.indexOf(x) < months.indexOf(month) + proj.monthsLeft
              ? S(proj.monthly)
              : null,
      };
    });
    return {
      fy,
      month,
      done,
      regime: now.regime,
      annual: proj
        ? {
            computed: final ? (final.computed_annual ?? null) : S(proj.tax.total),
            inUse: S(proj.tax.total),
            final: final
              ? { annual: final.annual, reason: final.reason, spreadMonths: final.spread_months }
              : null,
          }
        : null,
      sheet: proj
        ? {
            gross: S(proj.gross),
            perquisites: S(proj.perquisites),
            prevSalary: S(proj.prevSalary),
            exemptions: S(proj.exemptions),
            standardDeduction: S(proj.standardDeduction),
            pt: S(proj.ptDeduction),
            otherIncome: S(proj.otherIncome),
            houseLoss: S(proj.houseLoss),
            deductions: S(proj.otherDeductions),
            taxable: S(proj.tax.taxable),
            slabTax: S(proj.tax.slabTax),
            rebate: S(proj.tax.rebate),
            surcharge: S(proj.tax.surcharge),
            cess: S(proj.tax.cess),
            total: S(proj.tax.total),
            panAbsent: proj.tax.panAbsent,
            ytdTds: S(proj.ytdTds),
            monthsLeft: proj.monthsLeft,
            monthly: S(proj.monthly),
            warnings: proj.warnings,
          }
        : null,
      working: now.r.taxWorking
        ? {
            hra: now.r.taxWorking.hra
              ? Object.fromEntries(Object.entries(now.r.taxWorking.hra).map(([k, v]) => [k, S(v)]))
              : null,
            npsEr: now.r.taxWorking.npsEr
              ? Object.fromEntries(
                  Object.entries(now.r.taxWorking.npsEr).map(([k, v]) => [k, S(v)]),
                )
              : null,
            deductions: (now.r.taxWorking.deductions ?? [])
              .filter((d) => d.declared > 0n)
              .map((d) => ({
                code: d.code,
                declared: S(d.declared),
                allowed: S(d.allowed),
                cut: d.cut,
              })),
          }
        : null,
      otherRegime: (() => {
        if (!('r' in other) || !other.r) return null;
        const o = other.r.tds;
        return o && !('manual' in o)
          ? { regime: other.regime, total: S(o.tax.total), monthly: S(o.monthly) }
          : null;
      })(),
      plan,
    };
  }

  // ---- My tax ------------------------------------------------------------------------------------------------
  async mine(ctx: RequestContext, fy?: string) {
    must(ctx, OWN, 'My tax is for employees');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.me(c);
      const y = fy ?? this.currentFy();
      const year = await taxYear(c, y);
      const labels = (await this.labels(c, y)).filter(
        (l) => l.declarable && l.line_code !== 'NPS_ER',
      );
      const decl = (
        await c.query(
          `SELECT id::text, line_code, declared::text, verified::text, status, reject_reason, detail, entered_for,
                  proof_file_ids::text[] AS proof_file_ids, created_at, decided_at
             FROM payroll_declarations WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
          [e.id, y],
        )
      ).rows.map((r) => {
        const x = camelRow(r) as Record<string, unknown> & { detail: Record<string, unknown> };
        const ll = x.detail.landlord as Record<string, unknown> | undefined;
        if (ll) delete ll.panEnc;
        return x;
      });
      const prev = (
        await c.query(
          `SELECT id::text, employer_name, employer_tan, period_from::text, period_to::text, gross::text, exempt::text,
                  pf::text, pt::text, tds::text, status, reject_reason FROM payroll_prev_employment
            WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
          [e.id, y],
        )
      ).rows.map(camelRow)[0];
      const cutoff =
        (await c.query<{ m: number }>(`SELECT regime_cutoff_month AS m FROM payroll_settings`))
          .rows[0]?.m ?? 12;
      const cert = (
        await c.query<{ released_at: string | null }>(
          `SELECT released_at FROM payroll_certificates WHERE employee_id = $1 AND fy = $2 AND released_at IS NOT NULL`,
          [e.id, y],
        )
      ).rows[0];
      const today = istToday();
      const sheet = await this.sheetIn(c, e.id, y);
      return {
        employee: e,
        fy: y,
        years: [
          this.currentFy(),
          fyOf(`${String(Number(this.currentFy().slice(0, 4)) - 1)}-06-01`),
        ],
        year: {
          ...year,
          open: !year.frozen && today >= year.declareFrom && today <= year.declareTo,
        },
        labels: labels.map((l) => ({
          code: l.line_code,
          label: l.label,
          appliesTo: l.applies_to,
          cap: l.cap_amount,
        })),
        declarations: decl,
        prev: prev ?? null,
        regime: {
          current: sheet && 'regime' in sheet ? sheet.regime : null,
          cutoffMonth: cutoff,
          open:
            !year.frozen &&
            y === this.currentFy() &&
            idxOf(Number(today.slice(5, 7))) <= idxOf(cutoff),
        },
        tax: sheet,
        certificate: cert ? { released: true } : null,
      };
    });
  }
}
