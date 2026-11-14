import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { BUILT_IN_LINES, taxYearBlockers, taxYearInUse } from './payroll-tax-setup.service';
import {
  approveDated,
  DATED,
  deleteDraft,
  endDated,
  loadDated,
  mustOwnDraft,
  withUsage,
} from './payroll-dated';
import {
  CONFIG_SCHEMAS,
  PAYROLL,
  type ConfigKind,
  type ConfigListDto,
  type EndRowDto,
  type PayrollSettingsDto,
  type TaxQueryDto,
  type TaxYearDto,
} from './payroll.dto';

/** camelCase field → column, per kind of dated set-up row (besides the dates, reference and reason). */
const FIELDS: Record<ConfigKind, Record<string, string>> = {
  rates: {
    rateCode: 'rate_code',
    rateValue: 'rate_value',
    notifiedOn: 'notified_on',
    source: 'source',
  },
  pf: {
    eeRate: 'ee_rate',
    erRate: 'er_rate',
    epsRate: 'eps_rate',
    epsWageCeiling: 'eps_wage_ceiling',
    edliRate: 'edli_rate',
    edliWageCeiling: 'edli_wage_ceiling',
    edliMin: 'edli_min',
    adminRate: 'admin_rate',
    adminMin: 'admin_min',
  },
  esi: {
    eeRate: 'ee_rate',
    erRate: 'er_rate',
    wageLimit: 'wage_limit',
    wageLimitPwd: 'wage_limit_pwd',
  },
  pt: {
    stateCode: 'state_code',
    gender: 'gender',
    wageFrom: 'wage_from',
    wageTo: 'wage_to',
    monthlyAmount: 'monthly_amount',
    monthOverrides: 'month_overrides',
  },
  lwf: {
    stateCode: 'state_code',
    eeRate: 'ee_rate',
    eeCap: 'ee_cap',
    eeFlat: 'ee_flat',
    erFlat: 'er_flat',
    erMultiplier: 'er_multiplier',
    frequency: 'frequency',
    months: 'months',
  },
  ot: { employeeType: 'employee_type', dailyAmount: 'daily_amount', hourlyAmount: 'hourly_amount' },
};
const COMMON = {
  effectiveFrom: 'effective_from',
  referenceNo: 'reference_no',
  changeReason: 'change_reason',
};
/** the order rows are listed in */
const ORDER: Record<ConfigKind, string> = {
  rates: 'r.rate_code, r.effective_from DESC',
  pf: 'r.effective_from DESC',
  esi: 'r.effective_from DESC',
  pt: 'r.state_code, r.gender, r.wage_from, r.effective_from DESC',
  lwf: 'r.state_code, r.effective_from DESC',
  ot: 'r.employee_type, r.effective_from DESC',
};

const camel = (col: string) => col.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());

/** The current financial year's label ('2026-27') for a date. */
export function fyOf(day: string): string {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/**
 * Payroll set-up (docs/design/86, phase A): the overview of what is set and what is missing, the settings,
 * the dated rate registry (rates, PF, ESI, PT, LWF, OT rates — made as drafts, approved by a checker who did
 * not make them) and income tax by financial year.
 */
@Injectable()
export class PayrollSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  static has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  static can(ctx: RequestContext) {
    return {
      manage: PayrollSetupService.has(ctx, PAYROLL.manage),
      approve: PayrollSetupService.has(ctx, PAYROLL.approve),
      admin: PayrollSetupService.has(ctx, PAYROLL.admin),
      reveal: PayrollSetupService.has(ctx, PAYROLL.reveal),
    };
  }
  static must(ctx: RequestContext, p: string, message: string) {
    if (!PayrollSetupService.has(ctx, p))
      throw new DomainError('permission-denied', message, { status: 403 });
  }

  /** A school's defaults, inserted when absent (the legacy seed). */
  static async seed(c: PoolClient) {
    await c.query(`SELECT app.payroll_seed(app.current_school_id())`);
    // phase D's sections (the shared 80C cap, more Chapter VI-A sections, the declaration forms)
    await c.query(`SELECT app.payroll_tax_sections_seed(app.current_school_id())`);
    // phase E's settlement heads (gratuity, leave encashment, recoveries)
    await c.query(`SELECT app.payroll_fnf_heads_seed(app.current_school_id())`);
  }

  // ---- overview ------------------------------------------------------------------------------------------
  async overview(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const today = istToday();
      const s = (
        await c.query<{
          state_code: string | null;
          tan: string | null;
          pf_establishment_code: string | null;
          matrix_code: string;
        }>(`SELECT state_code, tan, pf_establishment_code, matrix_code FROM payroll_settings`)
      ).rows[0]!;
      const n = async (sql: string, args: unknown[] = []) =>
        (await c.query<{ n: number }>(sql, args)).rows[0]!.n;
      const drafts = {
        rates: await n(`SELECT count(*)::int AS n FROM payroll_rates WHERE status = 'draft'`),
        statutory: await n(
          `SELECT ((SELECT count(*) FROM payroll_pf_settings WHERE status = 'draft')
                 + (SELECT count(*) FROM payroll_esi_settings WHERE status = 'draft')
                 + (SELECT count(*) FROM payroll_pt_slabs WHERE status = 'draft')
                 + (SELECT count(*) FROM payroll_lwf_settings WHERE status = 'draft')
                 + (SELECT count(*) FROM payroll_ot_rates WHERE status = 'draft'))::int AS n`,
        ),
        versions: await n(
          `SELECT count(*)::int AS n FROM payroll_pay_head_versions WHERE status = 'draft'`,
        ),
        structures: await n(
          `SELECT count(DISTINCT employee_id)::int AS n FROM payroll_structures WHERE status = 'draft'`,
        ),
      };
      const staff = await n(
        `SELECT count(*)::int AS n FROM employees WHERE status = 'active' AND deleted_at IS NULL`,
      );
      const profiles = await n(
        `SELECT count(*)::int AS n FROM payroll_profiles p JOIN employees e ON e.id = p.employee_id
          WHERE e.status = 'active' AND e.deleted_at IS NULL`,
      );
      const structured = await n(
        `SELECT count(DISTINCT s.employee_id)::int AS n FROM payroll_structures s JOIN employees e ON e.id = s.employee_id
          WHERE e.status = 'active' AND e.deleted_at IS NULL AND s.status = 'active' AND s.effective_from <= $1::date
            AND (s.effective_to IS NULL OR s.effective_to >= $1::date)`,
        [today],
      );
      const heads = await n(
        `SELECT count(*)::int AS n FROM payroll_pay_heads WHERE status = 'active'`,
      );
      const headsUnversioned = await n(
        `SELECT count(*)::int AS n FROM payroll_pay_heads h WHERE h.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM payroll_pay_head_versions v
                             WHERE v.pay_head_id = h.id AND v.status = 'active' AND v.effective_from <= $1::date
                               AND (v.effective_to IS NULL OR v.effective_to >= $1::date))`,
        [today],
      );
      const matrixCells = await n(
        `SELECT count(*)::int AS n FROM payroll_pay_matrix WHERE matrix_code = $1`,
        [s.matrix_code],
      );
      const fy = fyOf(today);
      const taxYear = await n(`SELECT count(*)::int AS n FROM payroll_tds_slabs WHERE fy = $1`, [
        fy,
      ]);
      // what is missing or would stop a run (the legacy "check before you continue")
      const checks: Array<{ level: 'red' | 'amber'; text: string; href: string }> = [];
      if (!s.state_code)
        checks.push({
          level: 'red',
          text: 'The state is not set: profession tax cannot be worked out',
          href: '/payroll/setup/settings',
        });
      if (!s.tan)
        checks.push({
          level: 'amber',
          text: 'The TAN is not set: the tax return and certificates need it',
          href: '/payroll/setup/settings',
        });
      if (!s.pf_establishment_code)
        checks.push({
          level: 'amber',
          text: 'The PF establishment code is not set: the ECR file needs it',
          href: '/payroll/setup/settings',
        });
      if (!taxYear)
        checks.push({
          level: 'red',
          text: `No income-tax slabs for ${fy}: a run is blocked until the year is added`,
          href: '/payroll/setup/tax',
        });
      if (headsUnversioned)
        checks.push({
          level: 'red',
          text: `${String(headsUnversioned)} active pay head(s) have no version in force today`,
          href: '/payroll/setup/heads',
        });
      if (staff > profiles)
        checks.push({
          level: 'amber',
          text: `${String(staff - profiles)} active staff have no payroll profile`,
          href: '/payroll/setup/profiles?profile=missing',
        });
      if (staff > structured)
        checks.push({
          level: 'amber',
          text: `${String(staff - structured)} active staff have no salary structure in force`,
          href: '/payroll/setup/structures',
        });
      const waiting = drafts.rates + drafts.statutory + drafts.versions + drafts.structures;
      if (waiting)
        checks.push({
          level: 'amber',
          text: `${String(waiting)} draft(s) wait for a checker`,
          href: '/payroll/setup/approvals',
        });
      // the statutory dues (phase C): the year's calendar set up, nothing overdue
      const fyStart =
        Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
      const due = (
        await c.query<{ seeded: number; overdue: number; soon: number }>(
          `SELECT count(*) FILTER (WHERE fy = $2)::int AS seeded,
                  count(*) FILTER (WHERE done_at IS NULL AND due_on < $1::date)::int AS overdue,
                  count(*) FILTER (WHERE done_at IS NULL AND due_on >= $1::date AND due_on <= $1::date + 7)::int AS soon
             FROM payroll_compliance`,
          [today, fyStart],
        )
      ).rows[0]!;
      if (due.overdue)
        checks.push({
          level: 'amber',
          text: `${String(due.overdue)} statutory due(s) overdue`,
          href: '/payroll/statutory?tab=calendar',
        });
      if (due.soon)
        checks.push({
          level: 'amber',
          text: `${String(due.soon)} statutory due(s) in the next 7 days`,
          href: '/payroll/statutory?tab=calendar',
        });
      if (!due.seeded)
        checks.push({
          level: 'amber',
          text: `The compliance calendar of ${String(fyStart)}-${String((fyStart + 1) % 100).padStart(2, '0')} is not set up`,
          href: '/payroll/statutory?tab=calendar',
        });
      return {
        today,
        fy,
        settings: {
          stateCode: s.state_code,
          tan: s.tan,
          pfEstablishmentCode: s.pf_establishment_code,
        },
        figures: { staff, profiles, structured, heads, headsUnversioned, matrixCells, drafts },
        checks,
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  // ---- settings ------------------------------------------------------------------------------------------
  async settings(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const s = (
        await c.query<Record<string, unknown>>(
          `SELECT state_code, pf_establishment_code, tan, ptrc_no, esi_code, lwf_enabled, eps_stop_age, pf_ceiling_prorate,
                  matrix_code, pay_cycle_from_day, ot_hours_limit::float8 AS ot_hours_limit, payslip_password,
                  bank_file_format, confidential_employee_ids::text[] AS confidential_employee_ids, formula_attributes,
                  regime_cutoff_month, ecr_arrear_mode, jv_ledgers, updated_at
             FROM payroll_settings`,
        )
      ).rows[0]!;
      const confidential = (s.confidential_employee_ids as string[]).length
        ? (
            await c.query<{ id: string; code: string; name: string }>(
              `SELECT id::text, employee_code AS code, display_name AS name FROM employees WHERE id = ANY($1::bigint[])
                ORDER BY employee_code`,
              [s.confidential_employee_ids],
            )
          ).rows
        : [];
      const matrices = (
        await c.query<{ code: string }>(
          `SELECT DISTINCT matrix_code AS code FROM payroll_pay_matrix ORDER BY 1`,
        )
      ).rows.map((r) => r.code);
      return {
        settings: Object.fromEntries(Object.entries(s).map(([k, v]) => [camel(k), v])),
        confidential,
        matrices,
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: PayrollSettingsDto) {
    PayrollSetupService.must(
      ctx,
      PAYROLL.admin,
      'Only a payroll admin changes the payroll settings',
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      if (dto.confidentialEmployeeIds.length) {
        const ok = await c.query(`SELECT 1 FROM employees WHERE id = ANY($1::bigint[])`, [
          dto.confidentialEmployeeIds,
        ]);
        if (ok.rowCount !== new Set(dto.confidentialEmployeeIds).size)
          throw new DomainError('validation-failed', 'Pick confidential staff from this school', {
            status: 400,
          });
      }
      const before = (await c.query(`SELECT * FROM payroll_settings`)).rows[0];
      await c.query(
        `UPDATE payroll_settings SET state_code = $1, pf_establishment_code = $2, tan = $3, ptrc_no = $4, esi_code = $5,
                lwf_enabled = $6, eps_stop_age = $7, pf_ceiling_prorate = $8, matrix_code = $9, pay_cycle_from_day = $10,
                ot_hours_limit = $11, payslip_password = $12, bank_file_format = $13,
                confidential_employee_ids = $14::bigint[], formula_attributes = $15::jsonb, regime_cutoff_month = $16,
                ecr_arrear_mode = COALESCE($17, ecr_arrear_mode), jv_ledgers = COALESCE($18::jsonb, jv_ledgers),
                updated_by = app.current_user_id(), updated_at = now()`,
        [
          dto.stateCode,
          dto.pfEstablishmentCode || null,
          dto.tan,
          dto.ptrcNo || null,
          dto.esiCode || null,
          dto.lwfEnabled,
          dto.epsStopAge,
          dto.pfCeilingProrate,
          dto.matrixCode,
          dto.payCycleFromDay,
          dto.otHoursLimit,
          dto.payslipPassword || null,
          dto.bankFileFormat,
          [...new Set(dto.confidentialEmployeeIds)],
          JSON.stringify(dto.formulaAttributes),
          dto.regimeCutoffMonth,
          dto.ecrArrearMode ?? null,
          dto.jvLedgers ? JSON.stringify(dto.jvLedgers) : null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.settings.update',
        entityType: 'payroll_settings',
        entityId: requireTenant(ctx).schoolId,
        before,
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  // ---- the dated rate registry ---------------------------------------------------------------------------
  async listConfig(ctx: RequestContext, kind: ConfigKind, q: ConfigListDto) {
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const cols = Object.values(FIELDS[kind]);
      const rows = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- table, columns and order come from the fixed maps above
          `SELECT r.id::text, ${cols.map((col) => `r.${col}`).join(', ')}, r.effective_from::text, r.effective_to::text,
                  r.status, r.reference_no, r.change_reason, r.withdraw_reason, r.created_by::text, r.created_at, r.approved_at,
                  (SELECT display_name FROM users u WHERE u.id = r.created_by) AS created_by_name,
                  (SELECT display_name FROM users u WHERE u.id = r.approved_by) AS approved_by_name
             FROM ${t.table} r
            WHERE ($1 = 'all' OR r.status = $1)
            ORDER BY ${ORDER[kind]}`,
          [q.status],
        )
      ).rows;
      return {
        kind,
        // each approved row says which runs read it: the screens offer Withdraw or Correct
        rows: await withUsage(
          c,
          t,
          rows.map((r) => {
            const out = Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));
            return {
              ...out,
              id: String(r.id),
              status: String(r.status),
              mine: r.created_by === requireTenant(ctx).userId,
            };
          }),
        ),
        // overtime rates are by the employee types of the staff master (what an employee's staff type says)
        ...(kind === 'ot' ? { employeeTypes: await PayrollSetupService.employeeTypes(c) } : {}),
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  /** The active employee types of the staff master, by name (an employee's staff type holds the name). */
  static async employeeTypes(c: PoolClient) {
    return (
      await c.query<{ name: string }>(
        `SELECT name FROM employee_types WHERE status = 'active' ORDER BY sort_order, name`,
      )
    ).rows.map((r) => r.name);
  }

  /** A new dated row, as a DRAFT. */
  async addConfig(ctx: RequestContext, kind: ConfigKind, body: unknown) {
    PayrollSetupService.must(ctx, PAYROLL.manage, 'Only payroll makers prepare set-up drafts');
    const dto = parse(kind, body);
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (kind === 'ot') {
        // an overtime rate is found by the employee's staff type: only a type of the staff master ever matches
        const typed = String((dto as { employeeType?: string }).employeeType ?? '').trim();
        const name = (await PayrollSetupService.employeeTypes(c)).find(
          (n) => n.toLowerCase() === typed.toLowerCase(),
        );
        if (!name)
          throw new DomainError(
            'validation-failed',
            `“${typed.slice(0, 60)}” is not an employee type of the staff master (Staff setup → Employee types): pick one from the list`,
            { status: 400 },
          );
        (dto as { employeeType?: string }).employeeType = name;
      }
      const { cols, vals, casts } = this.columns(kind, dto);
      try {
        const id = (
          await c.query<{ id: string }>(
            // eslint-disable-next-line no-restricted-syntax -- table and columns come from the fixed maps above
            `INSERT INTO ${t.table} (school_id, ${cols.join(', ')}, status, created_by, updated_by)
             VALUES (app.current_school_id(), ${vals.map((_, i) => `$${String(i + 1)}${casts[i]}`).join(', ')}, 'draft',
                     app.current_user_id(), app.current_user_id())
             RETURNING id::text`,
            vals,
          )
        ).rows[0]!.id;
        await this.audit.stage(ctx, c, {
          action: `payroll.${kind}.draft`,
          entityType: t.table,
          entityId: id,
          after: dto,
        });
        return { id, status: 'draft' };
      } catch (e) {
        throw this.duplicate(e);
      }
    });
  }

  /** Changes a DRAFT (its maker or a checker). */
  async editConfig(ctx: RequestContext, kind: ConfigKind, id: string, body: unknown) {
    PayrollSetupService.must(ctx, PAYROLL.manage, 'Only payroll makers change set-up drafts');
    const dto = parse(kind, body);
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await loadDated(c, t, id);
      mustOwnDraft(row, requireTenant(ctx).userId!, PayrollSetupService.has(ctx, PAYROLL.approve));
      const { cols, vals, casts } = this.columns(kind, dto);
      try {
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and columns come from the fixed maps above
          `UPDATE ${t.table} SET ${cols.map((col, i) => `${col} = $${String(i + 2)}${casts[i]}`).join(', ')},
                  updated_by = app.current_user_id(), updated_at = now()
            WHERE id = $1`,
          [id, ...vals],
        );
      } catch (e) {
        throw this.duplicate(e);
      }
      await this.audit.stage(ctx, c, {
        action: `payroll.${kind}.draft_edit`,
        entityType: t.table,
        entityId: id,
        before: row,
        after: dto,
      });
      return { id, status: 'draft' };
    });
  }

  async deleteConfig(ctx: RequestContext, kind: ConfigKind, id: string) {
    PayrollSetupService.must(ctx, PAYROLL.manage, 'Only payroll makers delete set-up drafts');
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await deleteDraft(
        c,
        t,
        id,
        requireTenant(ctx).userId!,
        PayrollSetupService.has(ctx, PAYROLL.approve),
      );
      await this.audit.stage(ctx, c, {
        action: `payroll.${kind}.draft_delete`,
        entityType: t.table,
        entityId: id,
      });
      return { deleted: true };
    });
  }

  async approveConfig(ctx: RequestContext, kind: ConfigKind, id: string) {
    PayrollSetupService.must(ctx, PAYROLL.approve, 'Only a payroll checker approves set-up');
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await approveDated(
        c,
        t,
        id,
        requireTenant(ctx).userId!,
        PayrollSetupService.has(ctx, PAYROLL.admin),
      );
      await this.audit.stage(ctx, c, {
        action: `payroll.${kind}.approve`,
        entityType: t.table,
        entityId: id,
        after: r,
      });
      return {
        approved: true,
        message: r.closed
          ? `Approved. The previous record now ends on ${r.closedTo!}.`
          : 'Approved.',
      };
    });
  }

  async endConfig(ctx: RequestContext, kind: ConfigKind, id: string, dto: EndRowDto) {
    PayrollSetupService.must(ctx, PAYROLL.approve, 'Only a payroll checker ends set-up');
    const t = DATED[kind]!;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await endDated(c, t, id, dto.effectiveTo);
      await this.audit.stage(ctx, c, {
        action: `payroll.${kind}.end`,
        entityType: t.table,
        entityId: id,
        after: { ...dto },
      });
      return { ended: true };
    });
  }

  private columns(kind: ConfigKind, dto: Record<string, unknown>) {
    const map = { ...FIELDS[kind], ...COMMON };
    const cols: string[] = [];
    const vals: unknown[] = [];
    const casts: string[] = [];
    for (const [key, col] of Object.entries(map)) {
      cols.push(col);
      const v = dto[key];
      if (col === 'month_overrides') {
        vals.push(v ? JSON.stringify(v) : null);
        casts.push('::jsonb');
      } else if (col === 'months') {
        vals.push(v ?? null);
        casts.push('::int[]');
      } else {
        vals.push(v === '' || v === undefined ? null : v);
        casts.push('');
      }
    }
    return { cols, vals, casts };
  }

  private duplicate(e: unknown) {
    if ((e as { code?: string }).code === '23505')
      return new DomainError(
        'conflict',
        'A record with the same key and date is already there: pick another date or change that one',
        { status: 409 },
      );
    return e;
  }

  // ---- income tax by financial year ----------------------------------------------------------------------
  async tax(ctx: RequestContext, q: TaxQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const years = (
        await c.query<{ fy: string }>(`SELECT DISTINCT fy FROM payroll_tds_slabs ORDER BY fy DESC`)
      ).rows.map((r) => r.fy);
      const fy =
        q.fy ??
        (years.includes(fyOf(istToday())) ? fyOf(istToday()) : (years[0] ?? fyOf(istToday())));
      const read = async (sql: string) =>
        (await c.query<Record<string, unknown>>(sql, [fy])).rows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])),
        );
      return {
        fy,
        years,
        slabs: await read(
          `SELECT regime, slab_from, slab_to, rate FROM payroll_tds_slabs WHERE fy = $1 ORDER BY regime, slab_from`,
        ),
        config: await read(
          `SELECT regime, standard_deduction, rebate_income_limit, rebate_max, cess_rate, pan_absent_rate, marginal_relief
             FROM payroll_tds_config WHERE fy = $1 ORDER BY regime`,
        ),
        surcharges: await read(
          `SELECT regime, income_from, rate FROM payroll_tds_surcharges WHERE fy = $1 ORDER BY regime, income_from`,
        ),
        labels: (
          await read(
            `SELECT l.line_code, l.label, l.applies_to, l.cap_amount, l.cap_group, l.declarable, l.sort_order,
                    (SELECT count(*)::int FROM payroll_declarations d WHERE d.fy = l.fy AND d.line_code = l.line_code) AS used
               FROM payroll_tax_labels l WHERE l.fy = $1 ORDER BY l.sort_order, l.line_code`,
          )
        ).map((l) => ({ ...l, builtIn: BUILT_IN_LINES.has(String(l.lineCode)) })),
        // the months an approved run used (a change needs a tick) and what ties the year down (it is not removed)
        inUse: years.includes(fy) ? await taxYearInUse(c, fy) : [],
        blockers: years.includes(fy)
          ? [
              ...(fy === fyOf(istToday()) ? ['the running year'] : []),
              ...(await taxYearBlockers(c, fy)),
            ]
          : [],
        can: PayrollSetupService.can(ctx),
      };
    });
  }

  /** A new financial year copied from an earlier one, all or nothing (the legacy "Create FY"). */
  async addTaxYear(ctx: RequestContext, dto: TaxYearDto) {
    PayrollSetupService.must(ctx, PAYROLL.admin, 'Only a payroll admin adds a tax year');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await c.query(`SELECT 1 FROM payroll_tds_slabs WHERE fy = $1`, [dto.fy])).rowCount)
        throw new DomainError('conflict', `${dto.fy} is already there: correct it instead`, {
          status: 409,
        });
      if (
        !(await c.query(`SELECT 1 FROM payroll_tds_slabs WHERE fy = $1`, [dto.copyFrom])).rowCount
      )
        throw new DomainError('validation-failed', `There is no ${dto.copyFrom} to copy`, {
          status: 400,
        });
      await c.query(
        `INSERT INTO payroll_tds_slabs (school_id, fy, regime, slab_from, slab_to, rate, created_by, updated_by)
         SELECT school_id, $1, regime, slab_from, slab_to, rate, app.current_user_id(), app.current_user_id() FROM payroll_tds_slabs WHERE fy = $2`,
        [dto.fy, dto.copyFrom],
      );
      await c.query(
        `INSERT INTO payroll_tds_config (school_id, fy, regime, standard_deduction, rebate_income_limit, rebate_max, cess_rate,
                                         pan_absent_rate, marginal_relief, created_by, updated_by)
         SELECT school_id, $1, regime, standard_deduction, rebate_income_limit, rebate_max, cess_rate, pan_absent_rate,
                marginal_relief, app.current_user_id(), app.current_user_id() FROM payroll_tds_config WHERE fy = $2`,
        [dto.fy, dto.copyFrom],
      );
      await c.query(
        `INSERT INTO payroll_tds_surcharges (school_id, fy, regime, income_from, rate, created_by, updated_by)
         SELECT school_id, $1, regime, income_from, rate, app.current_user_id(), app.current_user_id() FROM payroll_tds_surcharges WHERE fy = $2`,
        [dto.fy, dto.copyFrom],
      );
      await c.query(
        `INSERT INTO payroll_tax_labels (school_id, fy, line_code, label, applies_to, cap_amount, cap_group, declarable,
                                         sort_order, created_by, updated_by)
         SELECT school_id, $1, line_code, label, applies_to, cap_amount, cap_group, declarable, sort_order,
                app.current_user_id(), app.current_user_id()
           FROM payroll_tax_labels WHERE fy = $2`,
        [dto.fy, dto.copyFrom],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_year.add',
        entityType: 'payroll_tds_slabs',
        entityId: dto.fy,
        after: { ...dto },
      });
      return { added: dto.fy };
    });
  }
}

function parse(kind: ConfigKind, body: unknown): Record<string, unknown> {
  const r = CONFIG_SCHEMAS[kind].safeParse(body);
  if (!r.success)
    throw new DomainError('validation-failed', r.error.issues[0]?.message ?? 'Check the fields', {
      status: 400,
      extra: { issues: r.error.issues },
    });
  return r.data as Record<string, unknown>;
}
