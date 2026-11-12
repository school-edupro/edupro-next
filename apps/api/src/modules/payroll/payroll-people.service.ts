import { Injectable } from '@nestjs/common';
import { decryptField, maskValue, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { approveDated, DATED } from './payroll-dated';
import { istToday, PayrollSetupService } from './payroll-setup.service';
import {
  PAYROLL,
  type DraftsQueryDto,
  type EmployeesDto,
  type NomineesDto,
  type ProfileDto,
  type ProfileListDto,
  type RevealDto,
  type StructureDto,
  type StructureImportDto,
  type SyncDto,
  type TemplateDto,
} from './payroll.dto';

const bad = (message: string, status = 400): never => {
  throw new DomainError(status === 409 ? 'conflict' : 'validation-failed', message, { status });
};
const has = PayrollSetupService.has;
const must = PayrollSetupService.must;
/** the heads the engine computes itself: never in a structure (legacy: skipped with a note) */
const ENGINE_OWNED = ['PF', 'VPF', 'NPS', 'ESI', 'PT', 'LWF', 'TDS', 'ADV'];

/** the profile fields, as columns, and their defaults for a new profile */
const PROFILE_COLS: Record<keyof Omit<ProfileDto, 'changesFrom'>, string> = {
  pfApplicable: 'pf_applicable',
  pfWageBasis: 'pf_wage_basis',
  epsApplicable: 'eps_applicable',
  vpfType: 'vpf_type',
  vpfValue: 'vpf_value',
  npsApplicable: 'nps_applicable',
  npsEeRate: 'nps_ee_rate',
  npsErRate: 'nps_er_rate',
  esiApplicable: 'esi_applicable',
  pwd: 'pwd',
  ptApplicable: 'pt_applicable',
  ptExemptReason: 'pt_exempt_reason',
  taxRegime: 'tax_regime',
  tdsMode: 'tds_mode',
  category: 'category',
  payLevel: 'pay_level',
  payCell: 'pay_cell',
  contractStart: 'contract_start',
  contractEnd: 'contract_end',
  incrementMonth: 'increment_month',
  payrollStatus: 'payroll_status',
  payMode: 'pay_mode',
};
const camel = (col: string) => col.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
const camelRow = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));

/** the masked form of an encrypted employee-master value, or null */
function masked(stored: unknown, type?: string): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  const plain = decryptField(stored);
  return plain ? maskValue(plain, type) : null;
}

/**
 * The employee side of payroll set-up (docs/design/86, phase A): payroll profiles on the employee master
 * (its PAN, Aadhaar and bank are read from there, masked; a checker reveals one with a reason, logged),
 * nominees, salary structures (dated head amounts made as drafts, approved per employee all or nothing by a
 * checker who did not make them), templates and the structure sheet.
 */
@Injectable()
export class PayrollPeopleService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** makers do not see confidential staff (the legacy rule); checkers and admins do */
  private async hidden(c: PoolClient, ctx: RequestContext): Promise<string[]> {
    if (has(ctx, PAYROLL.approve) || has(ctx, PAYROLL.admin)) return [];
    return (
      (
        await c.query<{ ids: string[] }>(
          `SELECT confidential_employee_ids::text[] AS ids FROM payroll_settings`,
        )
      ).rows[0]?.ids ?? []
    );
  }

  private async employee(c: PoolClient, ctx: RequestContext, employeeId: string) {
    const e = (
      await c.query<Record<string, unknown>>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation, e.status,
                e.profile->>'staff_type' AS staff_type, e.joined_on::text, e.left_on::text, e.dob::text, e.gender::text,
                e.profile->>'pf_no' AS pf_no, e.profile->>'uan' AS uan, e.profile->>'esi_no' AS esi_no,
                e.profile->>'nps_no' AS nps_no, e.profile->>'bank_name' AS bank_name, e.profile->>'bank_ifsc' AS bank_ifsc,
                e.secure->>'pan' AS pan, e.secure->>'aadhaar' AS aadhaar, e.secure->>'bank_account_no' AS bank_account_no
           FROM employees e WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [employeeId],
      )
    ).rows[0];
    if (!e || (await this.hidden(c, ctx)).includes(employeeId))
      throw new DomainError('not-found', 'Employee not found', { status: 404 });
    return e;
  }

  // ---- profiles -------------------------------------------------------------------------------------------
  async profiles(ctx: RequestContext, q: ProfileListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const hidden = await this.hidden(c, ctx);
      const where = `WHERE e.status = 'active' AND e.deleted_at IS NULL AND NOT (e.id::text = ANY($1::text[]))
          AND ($2::text IS NULL OR e.employee_code ILIKE '%' || $2 || '%' OR e.display_name ILIKE '%' || $2 || '%')
          AND ($3 = 'all' OR ($3 = 'missing') = (p.employee_id IS NULL))
          AND ($4::text IS NULL OR p.payroll_status = $4)`;
      const args = [hidden, q.q ?? null, q.profile, q.status ?? null];
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- `where` is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.id ${where}`,
          args,
        )
      ).rows[0]!.n;
      const rows = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- `where` is a fixed fragment; values are bound
          `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation,
                  e.profile->>'staff_type' AS staff_type, e.profile->>'uan' AS uan,
                  e.secure->>'pan' AS pan, e.secure->>'bank_account_no' AS bank_account_no,
                  p.employee_id IS NOT NULL AS has_profile, p.pay_level, p.pay_cell, p.tax_regime, p.payroll_status,
                  p.pay_mode, p.contract_end::text, e.left_on::text,
                  EXISTS (SELECT 1 FROM payroll_structures s WHERE s.employee_id = e.id AND s.status = 'active'
                             AND s.effective_from <= $5::date AND (s.effective_to IS NULL OR s.effective_to >= $5::date)) AS structured
             FROM employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.id ${where}
            ORDER BY e.employee_code LIMIT $6 OFFSET $7`,
          [...args, istToday(), q.size, (q.page - 1) * q.size],
        )
      ).rows;
      const figures = (
        await c.query<Record<string, number>>(
          `SELECT count(*)::int AS staff, count(p.employee_id)::int AS profiles,
                  count(*) FILTER (WHERE p.employee_id IS NULL)::int AS missing,
                  count(*) FILTER (WHERE p.payroll_status = 'HOLD')::int AS hold
             FROM employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.id
            WHERE e.status = 'active' AND e.deleted_at IS NULL AND NOT (e.id::text = ANY($1::text[]))`,
          [hidden],
        )
      ).rows[0]!;
      return {
        rows: rows.map((r) => {
          const { pan, bank_account_no: bank, ...rest } = r;
          return { ...camelRow(rest), panMasked: masked(pan), bankMasked: masked(bank) };
        }),
        total,
        page: q.page,
        size: q.size,
        figures,
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  async profile(ctx: RequestContext, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const e = await this.employee(c, ctx, employeeId);
      const p = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- the columns come from the fixed PROFILE_COLS map; values are bound
          `SELECT ${Object.values(PROFILE_COLS).join(', ')}, contract_start::text AS contract_start,
                  contract_end::text AS contract_end, updated_at FROM payroll_profiles WHERE employee_id = $1`,
          [employeeId],
        )
      ).rows[0];
      const { pan, aadhaar, bank_account_no: bank, ...identity } = e;
      return {
        employee: camelRow(identity),
        statutory: {
          panMasked: masked(pan),
          aadhaarMasked: masked(aadhaar, 'digits12'),
          bankMasked: masked(bank),
        },
        exists: !!p,
        profile: p ? camelRow(p) : null,
        nominees: (
          await c.query<Record<string, unknown>>(
            `SELECT id::text, name, relation, dob::text, share_percent::text, purpose, guardian_name, address
               FROM payroll_nominees WHERE employee_id = $1 ORDER BY purpose, id`,
            [employeeId],
          )
        ).rows.map(camelRow),
        changes: (
          await c.query<Record<string, unknown>>(
            `SELECT g.field, g.old_value, g.new_value, g.effective_from::text, g.changed_at,
                    (SELECT display_name FROM users u WHERE u.id = g.changed_by) AS changed_by
               FROM payroll_profile_changes g WHERE g.employee_id = $1 ORDER BY g.changed_at DESC, g.id DESC LIMIT 50`,
            [employeeId],
          )
        ).rows.map(camelRow),
        matrix: (
          await c.query<{ level: string; cells: number }>(
            `SELECT pay_level AS level, max(cell_no)::int AS cells FROM payroll_pay_matrix
              WHERE matrix_code = (SELECT matrix_code FROM payroll_settings) GROUP BY pay_level, level_order ORDER BY level_order`,
          )
        ).rows,
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  /** Makes or changes a profile; each changed field is kept in its history with the date it takes effect. */
  async saveProfile(ctx: RequestContext, employeeId: string, dto: ProfileDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers change payroll profiles');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      await this.employee(c, ctx, employeeId);
      if (dto.payLevel) {
        const cell = await c.query(
          `SELECT 1 FROM payroll_pay_matrix WHERE matrix_code = (SELECT matrix_code FROM payroll_settings)
              AND pay_level = $1 AND cell_no = $2`,
          [dto.payLevel, dto.payCell],
        );
        if (!cell.rowCount)
          bad(`Level ${dto.payLevel}, cell ${String(dto.payCell)} is not in the pay matrix`);
      }
      if (
        dto.npsApplicable &&
        !(await c.query(`SELECT 1 FROM payroll_pay_heads WHERE code = 'NPS' AND status = 'active'`))
          .rowCount
      )
        bad('NPS is on but the NPS pay head is missing or inactive: add it first');
      const before = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- the columns come from the fixed PROFILE_COLS map; values are bound
          `SELECT ${Object.values(PROFILE_COLS).join(', ')}, contract_start::text AS contract_start, contract_end::text AS contract_end
             FROM payroll_profiles WHERE employee_id = $1 FOR UPDATE`,
          [employeeId],
        )
      ).rows[0];
      const cols = Object.values(PROFILE_COLS);
      const vals = (Object.keys(PROFILE_COLS) as Array<keyof typeof PROFILE_COLS>).map(
        (k) => dto[k] ?? null,
      );
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the columns come from the fixed PROFILE_COLS map; values are bound
        `INSERT INTO payroll_profiles (employee_id, school_id, ${cols.join(', ')}, created_by, updated_by)
         VALUES ($1, app.current_school_id(), ${cols.map((_, i) => `$${String(i + 2)}`).join(', ')},
                 app.current_user_id(), app.current_user_id())
         ON CONFLICT (employee_id) DO UPDATE SET ${cols.map((col) => `${col} = EXCLUDED.${col}`).join(', ')},
                 updated_by = app.current_user_id(), updated_at = now()`,
        [employeeId, ...vals],
      );
      const changed: Array<[string, string | null, string | null]> = [];
      for (const [key, col] of Object.entries(PROFILE_COLS)) {
        const now = dto[key as keyof typeof PROFILE_COLS];
        const was = before?.[col];
        const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
        const a = norm(was);
        const b = norm(now);
        const same =
          a === b ||
          (a !== null && b !== null && !Number.isNaN(Number(a)) && Number(a) === Number(b));
        if (before && !same) changed.push([key, a, b]);
      }
      for (const [field, oldValue, newValue] of changed)
        await c.query(
          `INSERT INTO payroll_profile_changes (school_id, employee_id, field, old_value, new_value, effective_from, changed_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())`,
          [employeeId, field, oldValue, newValue, dto.changesFrom],
        );
      await this.audit.stage(ctx, c, {
        action: before ? 'payroll.profile.update' : 'payroll.profile.add',
        entityType: 'payroll_profiles',
        entityId: employeeId,
        before,
        after: { ...dto },
      });
      return { saved: true, created: !before, changed: changed.length };
    });
  }

  /** A full PAN, Aadhaar or bank account, for a checker, with a reason — logged (the value never is). */
  async reveal(ctx: RequestContext, employeeId: string, dto: RevealDto) {
    must(ctx, PAYROLL.reveal, 'Only a payroll checker reveals PAN, Aadhaar and bank details');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, employeeId);
      const stored = e[dto.field];
      const value = typeof stored === 'string' && stored ? decryptField(stored) : null;
      await this.audit.stage(ctx, c, {
        action: 'payroll.profile.reveal',
        entityType: 'employees',
        entityId: employeeId,
        after: { field: dto.field, reason: dto.reason, found: value !== null },
      });
      return { field: dto.field, value };
    });
  }

  async saveNominees(ctx: RequestContext, employeeId: string, dto: NomineesDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers change nominees');
    const totals = new Map<string, number>();
    for (const n of dto.nominees)
      totals.set(
        n.purpose,
        (totals.get(n.purpose) ?? 0) + Math.round(Number(n.sharePercent) * 100),
      );
    for (const [purpose, total] of totals)
      if (total !== 10_000)
        bad(
          `The ${purpose.toLowerCase()} nominees' shares come to ${(total / 100).toFixed(2)} %: they must make 100 %`,
        );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.employee(c, ctx, employeeId);
      await c.query(`DELETE FROM payroll_nominees WHERE employee_id = $1`, [employeeId]);
      for (const n of dto.nominees)
        await c.query(
          `INSERT INTO payroll_nominees (school_id, employee_id, name, relation, dob, share_percent, purpose, guardian_name,
                                         address, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id(), app.current_user_id())`,
          [
            employeeId,
            n.name,
            n.relation,
            n.dob ?? null,
            n.sharePercent,
            n.purpose,
            n.guardianName ?? null,
            n.address ?? null,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'payroll.nominees.save',
        entityType: 'payroll_nominees',
        entityId: employeeId,
        after: { count: dto.nominees.length },
      });
      return { saved: dto.nominees.length };
    });
  }

  /**
   * Profiles for the active staff who have none, with the defaults (the legacy "Sync from HRM": it only adds,
   * never overwrites). With dryRun, the staff it would add.
   */
  async sync(ctx: RequestContext, dto: SyncDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers add payroll profiles');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const hidden = await this.hidden(c, ctx);
      const candidates = (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT e.id::text, e.employee_code AS code, e.display_name AS name FROM employees e
            WHERE e.status = 'active' AND e.deleted_at IS NULL AND NOT (e.id::text = ANY($1::text[]))
              AND NOT EXISTS (SELECT 1 FROM payroll_profiles p WHERE p.employee_id = e.id)
              AND ($2::text[] IS NULL OR e.id::text = ANY($2::text[]))
            ORDER BY e.employee_code`,
          [hidden, dto.employeeIds ?? null],
        )
      ).rows;
      if (dto.dryRun) return { candidates, added: 0 };
      for (const e of candidates)
        await c.query(
          `INSERT INTO payroll_profiles (employee_id, school_id, created_by, updated_by)
           VALUES ($1, app.current_school_id(), app.current_user_id(), app.current_user_id()) ON CONFLICT DO NOTHING`,
          [e.id],
        );
      await this.audit.stage(ctx, c, {
        action: 'payroll.profile.sync',
        entityType: 'payroll_profiles',
        entityId: 'many',
        after: { added: candidates.length },
      });
      return { candidates, added: candidates.length };
    });
  }

  // ---- salary structures ------------------------------------------------------------------------------------
  /** One employee's structure: each head with the amount in force (on a date) and its draft, and the timeline. */
  async structure(ctx: RequestContext, employeeId: string, asOf?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const e = await this.employee(c, ctx, employeeId);
      const day = asOf ?? istToday();
      const heads = (
        await c.query<Record<string, unknown>>(
          `SELECT h.id::text, h.code, h.name, h.head_type, h.category,
                  v.calc_type, v.formula,
                  live.id::text AS live_id, live.amount::text AS live_amount, live.effective_from::text AS live_from,
                  draft.id::text AS draft_id, draft.amount::text AS draft_amount, draft.effective_from::text AS draft_from,
                  (SELECT display_name FROM users u WHERE u.id = draft.created_by) AS draft_by
             FROM payroll_pay_heads h
             LEFT JOIN LATERAL (SELECT * FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id AND v.status = 'active'
                                  AND v.effective_from <= $2::date AND (v.effective_to IS NULL OR v.effective_to >= $2::date)
                                ORDER BY v.effective_from DESC LIMIT 1) v ON true
             LEFT JOIN LATERAL (SELECT * FROM payroll_structures s WHERE s.employee_id = $1 AND s.pay_head_id = h.id
                                  AND s.status = 'active' AND s.effective_from <= $2::date
                                  AND (s.effective_to IS NULL OR s.effective_to >= $2::date)
                                ORDER BY s.effective_from DESC LIMIT 1) live ON true
             LEFT JOIN LATERAL (SELECT * FROM payroll_structures s WHERE s.employee_id = $1 AND s.pay_head_id = h.id
                                  AND s.status = 'draft' ORDER BY s.effective_from DESC LIMIT 1) draft ON true
            WHERE h.status = 'active' AND NOT (h.code = ANY($3::text[]))
            ORDER BY h.head_type DESC, h.print_order, h.code`,
          [employeeId, day, ENGINE_OWNED],
        )
      ).rows.map(camelRow);
      const timeline = (
        await c.query<Record<string, unknown>>(
          `SELECT s.id::text, h.code, h.name, s.amount::text, s.effective_from::text, s.effective_to::text, s.status,
                  s.change_reason, (SELECT display_name FROM users u WHERE u.id = s.created_by) AS made_by,
                  (SELECT display_name FROM users u WHERE u.id = s.approved_by) AS approved_by
             FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
            WHERE s.employee_id = $1 ORDER BY s.effective_from DESC, h.print_order`,
          [employeeId],
        )
      ).rows.map(camelRow);
      const templates = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, name, description, staff_types, lines FROM payroll_structure_templates ORDER BY name`,
        )
      ).rows.map(camelRow);
      return {
        employee: {
          id: e.id,
          code: e.code,
          name: e.name,
          department: e.department,
          designation: e.designation,
          staffType: e.staff_type,
        },
        asOf: day,
        heads,
        timeline,
        templates,
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  /** Saves the grid as DRAFT rows from a date (an existing draft of a head from that date is changed). */
  async saveStructure(ctx: RequestContext, employeeId: string, dto: StructureDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers prepare salary structures');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.employee(c, ctx, employeeId);
      const n = await this.writeDrafts(
        c,
        employeeId,
        dto.effectiveFrom,
        dto.changeReason,
        dto.lines,
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.structure.draft',
        entityType: 'payroll_structures',
        entityId: employeeId,
        after: { ...dto },
      });
      return { saved: n };
    });
  }

  private async writeDrafts(
    c: PoolClient,
    employeeId: string,
    from: string,
    reason: string,
    lines: Array<{ payHeadId: string; amount: string }>,
  ) {
    const heads = new Map(
      (
        await c.query<{ id: string; code: string; status: string }>(
          `SELECT id::text, code, status FROM payroll_pay_heads WHERE id = ANY($1::bigint[])`,
          [lines.map((l) => l.payHeadId)],
        )
      ).rows.map((h) => [h.id, h]),
    );
    let n = 0;
    for (const l of lines) {
      const h = heads.get(l.payHeadId);
      if (!h || h.status !== 'active') bad('Pick active pay heads only');
      if (ENGINE_OWNED.includes(h!.code))
        bad(`${h!.code} is worked out by payroll itself: it is not part of a structure`);
      const existing = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM payroll_structures WHERE employee_id = $1 AND pay_head_id = $2 AND effective_from = $3
              AND status = 'draft' FOR UPDATE`,
          [employeeId, l.payHeadId, from],
        )
      ).rows[0];
      if (existing)
        await c.query(
          `UPDATE payroll_structures SET amount = $2, change_reason = $3, updated_by = app.current_user_id(), updated_at = now()
            WHERE id = $1`,
          [existing.id, l.amount, reason],
        );
      else
        await c.query(
          `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, change_reason, status,
                                           created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'draft', app.current_user_id(), app.current_user_id())`,
          [employeeId, l.payHeadId, l.amount, from, reason],
        );
      n += 1;
    }
    return n;
  }

  /** The staff with drafts waiting, for a checker. */
  async drafts(ctx: RequestContext, q: DraftsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await this.hidden(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department,
                  count(*)::int AS lines, min(s.effective_from)::text AS effective_from, max(s.updated_at) AS made_at,
                  string_agg(DISTINCT (SELECT display_name FROM users u WHERE u.id = s.created_by), ', ') AS made_by,
                  bool_and(s.created_by = app.current_user_id()) AS mine
             FROM payroll_structures s JOIN employees e ON e.id = s.employee_id
            WHERE s.status = 'draft' AND NOT (e.id::text = ANY($1::text[]))
              AND ($2::text IS NULL OR e.employee_code ILIKE '%' || $2 || '%' OR e.display_name ILIKE '%' || $2 || '%')
            GROUP BY e.id ORDER BY e.employee_code`,
          [hidden, q.q ?? null],
        )
      ).rows.map(camelRow);
      return { rows, can: PayrollSetupService.can(ctx) };
    });
  }

  /**
   * Approves the drafts of each employee named, all or nothing per employee (one failing row leaves that
   * employee's drafts as they were and is reported).
   */
  async approveStructures(ctx: RequestContext, dto: EmployeesDto) {
    must(ctx, PAYROLL.approve, 'Only a payroll checker approves salary structures');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const approver = requireTenant(ctx).userId!;
      const admin = has(ctx, PAYROLL.admin);
      const done: string[] = [];
      const refused: Array<{ employeeId: string; reason: string }> = [];
      for (const employeeId of dto.employeeIds) {
        const rows = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM payroll_structures WHERE employee_id = $1 AND status = 'draft' ORDER BY effective_from, id`,
            [employeeId],
          )
        ).rows;
        if (!rows.length) continue;
        await c.query('SAVEPOINT emp');
        try {
          for (const r of rows) await approveDated(c, DATED.structures!, r.id, approver, admin);
          await c.query('RELEASE SAVEPOINT emp');
          done.push(employeeId);
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT emp');
          if (!(e instanceof DomainError)) throw e;
          refused.push({ employeeId, reason: e.message });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.structure.approve',
        entityType: 'payroll_structures',
        entityId: 'many',
        after: { approved: done, refused },
      });
      return { approved: done.length, refused };
    });
  }

  async deleteStructureDrafts(ctx: RequestContext, dto: EmployeesDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers delete structure drafts');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const checker = has(ctx, PAYROLL.approve);
      const r = await c.query(
        `DELETE FROM payroll_structures WHERE status = 'draft' AND employee_id = ANY($1::bigint[])
            AND ($2 OR created_by = app.current_user_id())`,
        [dto.employeeIds, checker],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.structure.draft_delete',
        entityType: 'payroll_structures',
        entityId: 'many',
        after: { employees: dto.employeeIds.length, rows: r.rowCount },
      });
      return { deleted: r.rowCount };
    });
  }

  // ---- templates (a payroll admin keeps them) ------------------------------------------------------------------
  /** The structure templates: a name, the staff types it suits and the amount of each head. */
  async templates(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, name, description, staff_types, lines, updated_at FROM payroll_structure_templates ORDER BY name`,
        )
      ).rows.map(camelRow);
      return { templates: rows, can: PayrollSetupService.can(ctx) };
    });
  }

  async saveTemplate(ctx: RequestContext, id: string | null, dto: TemplateDto) {
    must(ctx, PAYROLL.admin, 'Only a payroll admin keeps structure templates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const codes = new Set(
        (
          await c.query<{ code: string }>(
            `SELECT code FROM payroll_pay_heads WHERE status = 'active'`,
          )
        ).rows.map((r) => r.code),
      );
      const wrong = Object.keys(dto.lines).filter((k) => !codes.has(k) || ENGINE_OWNED.includes(k));
      if (wrong.length) bad(`Not heads a structure takes: ${wrong.join(', ')}`);
      try {
        const vals = [dto.name, dto.description, dto.staffTypes, JSON.stringify(dto.lines)];
        const out = id
          ? await c.query<{ id: string }>(
              `UPDATE payroll_structure_templates SET name = $2, description = $3, staff_types = $4, lines = $5::jsonb,
                      updated_by = app.current_user_id(), updated_at = now() WHERE id = $1 RETURNING id::text`,
              [id, ...vals],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO payroll_structure_templates (school_id, name, description, staff_types, lines, created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id(), app.current_user_id())
               RETURNING id::text`,
              vals,
            );
        if (!out.rows[0]) throw new DomainError('not-found', 'Template not found', { status: 404 });
        await this.audit.stage(ctx, c, {
          action: id ? 'payroll.template.update' : 'payroll.template.add',
          entityType: 'payroll_structure_templates',
          entityId: out.rows[0].id,
          after: { ...dto },
        });
        return { id: out.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          bad('A template of that name is already there', 409);
        throw e;
      }
    });
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    must(ctx, PAYROLL.admin, 'Only a payroll admin keeps structure templates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM payroll_structure_templates WHERE id = $1`, [id]);
      if (!r.rowCount) throw new DomainError('not-found', 'Template not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'payroll.template.delete',
        entityType: 'payroll_structure_templates',
        entityId: id,
      });
      return { deleted: true };
    });
  }

  // ---- the structure sheet ------------------------------------------------------------------------------------
  private static readonly SHEET = ['Employee code', 'Head code', 'Amount', 'Effective from'];

  /** The sheet to fill: a row per employee and head, with the amounts in force today. */
  async structureFormat(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const hidden = await this.hidden(c, ctx);
      const heads = (
        await c.query<{ code: string; name: string }>(
          `SELECT code, name FROM payroll_pay_heads WHERE status = 'active' AND NOT (code = ANY($1::text[])) ORDER BY print_order`,
          [ENGINE_OWNED],
        )
      ).rows;
      const rows = (
        await c.query<{ code: string; head: string; amount: string }>(
          `SELECT e.employee_code AS code, h.code AS head, s.amount::text AS amount
             FROM payroll_structures s JOIN employees e ON e.id = s.employee_id JOIN payroll_pay_heads h ON h.id = s.pay_head_id
            WHERE s.status = 'active' AND s.effective_from <= $2::date AND (s.effective_to IS NULL OR s.effective_to >= $2::date)
              AND e.status = 'active' AND NOT (e.id::text = ANY($1::text[]))
            ORDER BY e.employee_code, h.print_order`,
          [hidden, istToday()],
        )
      ).rows;
      const buffer = await templateSheet({
        sheet: 'Salary structures',
        columns: [
          { header: 'Employee code', width: 16, required: true, format: 'text' },
          { header: 'Head code', width: 14, required: true, options: heads.map((h) => h.code) },
          { header: 'Amount', width: 14, required: true, format: 'money', check: true },
          { header: 'Effective from', width: 16, required: true, format: 'date', check: true },
        ],
        guide: [
          'One row per employee and pay head: the amount from the date given.',
          'A FORMULA head takes its own parameter here (TA takes its base, TA_BASE); a FIXED head its amount.',
          'Every row becomes a DRAFT; a payroll checker approves each employee’s drafts together.',
          'PF, VPF, NPS, ESI, PT, LWF, TDS and loan recovery are worked out by payroll and are not in a structure.',
        ],
        rows: rows.map((r) => [r.code, r.head, Number(r.amount), null]),
        hideLists: true,
      });
      return { filename: 'salary-structures.xlsx', base64: buffer.toString('base64') };
    });
  }

  /** The filled sheet: checked row by row (dryRun), then the good rows saved as drafts. */
  async importStructures(ctx: RequestContext, dto: StructureImportDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers prepare salary structures');
    const sheet = await readSheet(dto.file, PayrollPeopleService.SHEET);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = new Set(await this.hidden(c, ctx));
      const staff = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, employee_code AS code FROM employees WHERE status = 'active' AND deleted_at IS NULL`,
          )
        ).rows
          .filter((e) => !hidden.has(e.id))
          .map((e) => [e.code.toUpperCase(), e.id]),
      );
      const heads = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, code FROM payroll_pay_heads WHERE status = 'active'`,
          )
        ).rows.map((h) => [h.code, h.id]),
      );
      const day = (v: string) => {
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? v
          : /^(\d{2})-(\d{2})-(\d{4})$/.exec(v)?.slice(1).reverse().join('-');
        return iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? iso : null;
      };
      const rows = sheet.map(({ row, cells }) => {
        const code = cells['Employee code']!.toUpperCase();
        const head = cells['Head code']!.toUpperCase();
        const amount = cells.Amount!.replace(/,/g, '');
        const from = day(cells['Effective from']!);
        const employeeId = staff.get(code);
        const payHeadId = heads.get(head);
        const error = !employeeId
          ? `${code} is not on the active staff list`
          : !payHeadId
            ? `${head} is not an active pay head`
            : ENGINE_OWNED.includes(head)
              ? `${head} is worked out by payroll itself`
              : !/^\d{1,10}(\.\d{1,2})?$/.test(amount)
                ? `The amount '${cells.Amount!}' is not a number`
                : !from
                  ? 'The date is not a date'
                  : null;
        return {
          row,
          code,
          head,
          amount,
          from,
          employeeId,
          payHeadId,
          status: error ? 'error' : 'ok',
          error,
        };
      });
      const ok = rows.filter((r) => r.status === 'ok');
      if (!dto.dryRun && ok.length) {
        const byEmployee = new Map<string, typeof ok>();
        for (const r of ok)
          byEmployee.set(`${r.employeeId!}|${r.from!}`, [
            ...(byEmployee.get(`${r.employeeId!}|${r.from!}`) ?? []),
            r,
          ]);
        for (const [key, list] of byEmployee) {
          const [employeeId, from] = key.split('|') as [string, string];
          await this.writeDrafts(
            c,
            employeeId,
            from,
            dto.changeReason,
            list.map((r) => ({ payHeadId: r.payHeadId!, amount: r.amount })),
          );
        }
        await this.audit.stage(ctx, c, {
          action: 'payroll.structure.import',
          entityType: 'payroll_structures',
          entityId: 'many',
          after: { rows: ok.length },
        });
      }
      return {
        rows: rows.map((r) => ({
          row: r.row,
          code: r.code,
          head: r.head,
          amount: r.amount,
          from: r.from,
          status: r.status,
          error: r.error,
        })),
        counts: { ok: ok.length, error: rows.length - ok.length },
        saved: dto.dryRun ? 0 : ok.length,
      };
    });
  }
}
