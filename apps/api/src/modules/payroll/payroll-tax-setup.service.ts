import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { has } from './payroll-month';
import { PAYROLL } from './payroll.dto';

/**
 * Changing a financial year's income-tax set-up (docs/design/86, "Income tax set-up"): the payroll admin edits a
 * regime's slabs, rules and surcharges, adds, edits and removes the lines of the tax sheet, and removes a year added by
 * mistake — each with a reason, checked, and recorded in the payroll audit trail. A year an approved, locked or paid run
 * has already used may still change (a mid-year Budget change): the TDS already deducted stays, the remaining months
 * are projected on the new figures, and the admin ticks to confirm it.
 */

/** The lines EduPro's tax computation and papers name by their code: edited, never removed. */
export const BUILT_IN_LINES = new Set([
  'STD_DED',
  'PT_16III',
  'HRA_RENT',
  'G80C',
  'CHAPVIA_80C',
  'CHAPVIA_80CCC',
  'CHAPVIA_80CCD1',
  'CHAPVIA_80CCD1B',
  'CHAPVIA_80D',
  'CHAPVIA_80D_PARENTS',
  'CHAPVIA_80DD',
  'CHAPVIA_80E',
  'CHAPVIA_80G',
  'CHAPVIA_80TTA',
  'CHAPVIA_80U',
  'HOME_LOAN_INT',
  'NPS_ER',
  'OTHER_INCOME',
  'REBATE',
  'RELIEF_89',
  'CERT_FORM_TITLE',
  'RETURN_FORM_NAME',
  'YEAR_LABEL',
  'TDS_SECTION',
  'TDS_SECTION_DISPLAY',
  'REGIME_NEW',
  'REGIME_OLD',
  'DECL_FORM',
  'PREV_FORM',
]);

const Money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'an amount with up to 2 decimals');
const Rate = z
  .string()
  .trim()
  .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, 'a rate between 0 and 1 (0.05 for 5 %)');
const Reason = z.string().trim().min(10, 'Say why (at least 10 characters)').max(300);
const Code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'capital letters, digits and _ (CHAPVIA_80EEB)');

export const RegimeSchema = z.object({
  slabs: z
    .array(z.object({ from: Money, to: Money.nullable(), rate: Rate }))
    .min(1)
    .max(20),
  rules: z.object({
    standardDeduction: Money,
    rebateIncomeLimit: Money,
    rebateMax: Money,
    cessRate: Rate,
    panAbsentRate: Rate,
    marginalRelief: z.boolean(),
  }),
  surcharges: z.array(z.object({ incomeFrom: Money, rate: Rate })).max(10),
  reason: Reason,
  confirm: z.boolean().default(false),
});
export class RegimeDto extends createZodDto(RegimeSchema) {}

export const LineSchema = z.object({
  lineCode: Code.optional(),
  label: z.string().trim().min(1).max(150),
  appliesTo: z.enum(['OLD', 'NEW', 'BOTH']),
  capAmount: Money.nullable(),
  capGroup: Code.nullable(),
  declarable: z.boolean(),
  reason: Reason,
  confirm: z.boolean().default(false),
});
export class LineDto extends createZodDto(LineSchema) {}

export const ReasonSchema = z.object({ reason: Reason, confirm: z.boolean().default(false) });
export class TaxReasonDto extends createZodDto(ReasonSchema) {}

const fail = (message: string, status = 400): never => {
  throw new DomainError(status === 409 ? 'conflict' : 'validation-failed', message, { status });
};
/** paise of a decimal string, to compare amounts exactly */
const P = (v: string) => {
  const [r, f = ''] = v.split('.');
  return BigInt(r || '0') * 100n + BigInt((f + '00').slice(0, 2));
};
/** 2026-27 → its first and last day */
export const fyBounds = (fy: string): [string, string] => {
  const y = Number(fy.slice(0, 4));
  return [`${String(y)}-04-01`, `${String(y + 1)}-03-31`];
};
const words = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The months of the year an approved, locked or paid run has used (their TDS stands). */
export async function taxYearInUse(c: PoolClient, fy: string) {
  const [from, to] = fyBounds(fy);
  return (
    await c.query<{ m: string }>(
      `SELECT DISTINCT to_char(month, 'YYYY-MM') AS m FROM payroll_runs
        WHERE deleted_at IS NULL AND stage IN ('APPROVED', 'LOCKED', 'PAID') AND month BETWEEN $1::date AND $2::date
        ORDER BY 1`,
      [from, to],
    )
  ).rows.map((r) => r.m);
}

/** What ties a year down (it is not removed then): runs, declarations, challans, certificates, finals … */
export async function taxYearBlockers(c: PoolClient, fy: string) {
  const [from, to] = fyBounds(fy);
  const checks: Array<[string, string, unknown[]]> = [
    [
      'pay runs',
      `SELECT count(*)::int AS n FROM payroll_runs WHERE deleted_at IS NULL AND month BETWEEN $1::date AND $2::date`,
      [from, to],
    ],
    ['declarations', `SELECT count(*)::int AS n FROM payroll_declarations WHERE fy = $1`, [fy]],
    ['TDS challans', `SELECT count(*)::int AS n FROM payroll_tds_challans WHERE fy = $1`, [fy]],
    ['certificates', `SELECT count(*)::int AS n FROM payroll_certificates WHERE fy = $1`, [fy]],
    [
      'earlier employers',
      `SELECT count(*)::int AS n FROM payroll_prev_employment WHERE fy = $1`,
      [fy],
    ],
    ['perquisites', `SELECT count(*)::int AS n FROM payroll_perquisites WHERE fy = $1`, [fy]],
    ['regime choices', `SELECT count(*)::int AS n FROM payroll_regime_events WHERE fy = $1`, [fy]],
    [
      'the year’s tax set by hand',
      `SELECT count(*)::int AS n FROM payroll_tax_finals WHERE fy = $1`,
      [fy],
    ],
    // the returns are kept by the year's first calendar year (2026 for 2026-27)
    [
      'returns',
      `SELECT count(*)::int AS n FROM payroll_compliance WHERE fy = $1`,
      [Number(fy.slice(0, 4))],
    ],
    ['bonus rules', `SELECT count(*)::int AS n FROM payroll_bonus_rules WHERE fy = $1`, [fy]],
  ];
  const out: string[] = [];
  for (const [what, sql, args] of checks) {
    const n = (await c.query<{ n: number }>(sql, args)).rows[0]!.n;
    if (n) out.push(`${String(n)} ${what}`);
  }
  return out;
}

@Injectable()
export class PayrollTaxSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private must(ctx: RequestContext) {
    if (!has(ctx, PAYROLL.admin))
      throw new DomainError('permission-denied', 'Only the payroll admin changes the tax set-up', {
        status: 403,
      });
  }

  private async year(c: PoolClient, fy: string) {
    if (!/^\d{4}-\d{2}$/.test(fy)) fail('Not a financial year');
    if (!(await c.query(`SELECT 1 FROM payroll_tds_slabs WHERE fy = $1`, [fy])).rowCount)
      fail(`There is no ${fy}: add the year first`, 404);
  }

  /** A year a run has used changes only when the admin confirms it. */
  private async confirmed(c: PoolClient, fy: string, confirm: boolean) {
    const used = await taxYearInUse(c, fy);
    if (used.length && !confirm)
      fail(
        `${fy} is in use: the runs of ${used.map(words).join(', ')} are approved. Their TDS stays as deducted; the remaining months are projected on the new figures — tick to confirm`,
        409,
      );
    return used;
  }

  /** A regime's slabs, rules and surcharges, saved together. */
  async saveRegime(ctx: RequestContext, fy: string, regime: string, dto: RegimeDto) {
    this.must(ctx);
    if (regime !== 'NEW' && regime !== 'OLD') fail('The regime is NEW or OLD');
    // the slabs: from nil, each from where the one before ends, only the last open
    const slabs = [...dto.slabs].sort((a, b) => (P(a.from) < P(b.from) ? -1 : 1));
    if (P(slabs[0]!.from) !== 0n) fail('The first slab starts at ₹0');
    slabs.forEach((s, i) => {
      const last = i === slabs.length - 1;
      if (!last && s.to === null) fail('Only the last slab is open (“and above”)');
      if (last && s.to !== null)
        fail('The last slab is open (“and above”): leave its “up to” empty');
      if (s.to !== null && P(s.to) <= P(s.from)) fail(`A slab ends before it starts (₹${s.from})`);
      if (i && P(slabs[i - 1]!.to ?? '0') !== P(s.from))
        fail(
          `The slabs must meet: one starts at ₹${s.from}, the one before ends at ₹${slabs[i - 1]!.to ?? ''}`,
        );
    });
    const sur = [...dto.surcharges].sort((a, b) => (P(a.incomeFrom) < P(b.incomeFrom) ? -1 : 1));
    sur.forEach((s, i) => {
      if (P(s.incomeFrom) <= 0n) fail('A surcharge starts above ₹0');
      if (i && P(sur[i - 1]!.incomeFrom) === P(s.incomeFrom))
        fail(`Two surcharges start at ₹${s.incomeFrom}`);
    });
    if (P(dto.rules.rebateMax) > P(dto.rules.rebateIncomeLimit))
      fail('The rebate cannot be more than the income it is given up to');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.year(c, fy);
      const used = await this.confirmed(c, fy, dto.confirm);
      const before = {
        slabs: (
          await c.query(
            `SELECT slab_from::text AS from, slab_to::text AS to, rate::text FROM payroll_tds_slabs WHERE fy = $1 AND regime = $2 ORDER BY slab_from`,
            [fy, regime],
          )
        ).rows,
        rules: (
          await c.query(
            `SELECT standard_deduction::text, rebate_income_limit::text, rebate_max::text, cess_rate::text, pan_absent_rate::text,
                    marginal_relief FROM payroll_tds_config WHERE fy = $1 AND regime = $2`,
            [fy, regime],
          )
        ).rows[0],
        surcharges: (
          await c.query(
            `SELECT income_from::text, rate::text FROM payroll_tds_surcharges WHERE fy = $1 AND regime = $2 ORDER BY income_from`,
            [fy, regime],
          )
        ).rows,
      };
      await c.query(`DELETE FROM payroll_tds_slabs WHERE fy = $1 AND regime = $2`, [fy, regime]);
      await c.query(
        `INSERT INTO payroll_tds_slabs (school_id, fy, regime, slab_from, slab_to, rate, created_by, updated_by)
         SELECT app.current_school_id(), $1, $2, x.f, x.t, x.r, app.current_user_id(), app.current_user_id()
           FROM jsonb_to_recordset($3::jsonb) AS x(f numeric, t numeric, r numeric)`,
        [fy, regime, JSON.stringify(slabs.map((s) => ({ f: s.from, t: s.to, r: s.rate })))],
      );
      await c.query(
        `INSERT INTO payroll_tds_config (school_id, fy, regime, standard_deduction, rebate_income_limit, rebate_max, cess_rate,
                                         pan_absent_rate, marginal_relief, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, fy, regime) DO UPDATE SET standard_deduction = EXCLUDED.standard_deduction,
           rebate_income_limit = EXCLUDED.rebate_income_limit, rebate_max = EXCLUDED.rebate_max, cess_rate = EXCLUDED.cess_rate,
           pan_absent_rate = EXCLUDED.pan_absent_rate, marginal_relief = EXCLUDED.marginal_relief,
           updated_by = app.current_user_id(), updated_at = now()`,
        [
          fy,
          regime,
          dto.rules.standardDeduction,
          dto.rules.rebateIncomeLimit,
          dto.rules.rebateMax,
          dto.rules.cessRate,
          dto.rules.panAbsentRate,
          dto.rules.marginalRelief,
        ],
      );
      await c.query(`DELETE FROM payroll_tds_surcharges WHERE fy = $1 AND regime = $2`, [
        fy,
        regime,
      ]);
      if (sur.length)
        await c.query(
          `INSERT INTO payroll_tds_surcharges (school_id, fy, regime, income_from, rate, created_by, updated_by)
           SELECT app.current_school_id(), $1, $2, x.f, x.r, app.current_user_id(), app.current_user_id()
             FROM jsonb_to_recordset($3::jsonb) AS x(f numeric, r numeric)`,
          [fy, regime, JSON.stringify(sur.map((s) => ({ f: s.incomeFrom, r: s.rate })))],
        );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax.regime',
        entityType: 'payroll_tds_slabs',
        entityId: `${fy}/${regime}`,
        before,
        after: { slabs, rules: dto.rules, surcharges: sur, reason: dto.reason, monthsInUse: used },
      });
      return {
        saved: true,
        message: `The ${regime === 'NEW' ? 'new' : 'old'} regime of ${fy} is saved.${
          used.length
            ? ' The months already approved keep their TDS; the rest follow the new figures.'
            : ''
        }`,
      };
    });
  }

  /** A line of the tax sheet added (a new code) or changed (its code given in the path). */
  async saveLine(ctx: RequestContext, fy: string, code: string | null, dto: LineDto) {
    this.must(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.year(c, fy);
      const used = await this.confirmed(c, fy, dto.confirm);
      const lineCode = code ?? dto.lineCode;
      if (!lineCode) fail('Give the line a code');
      if (dto.capGroup) {
        if (dto.capGroup === lineCode) fail('A line is not the limit of itself');
        const g = (
          await c.query<{ declarable: boolean; cap: string | null }>(
            `SELECT declarable, cap_amount::text AS cap FROM payroll_tax_labels WHERE fy = $1 AND line_code = $2`,
            [fy, dto.capGroup],
          )
        ).rows[0];
        if (!g || g.declarable || !g.cap)
          fail(
            `${dto.capGroup} is not a group limit (a line with a cap that staff do not declare)`,
          );
      }
      const before = (
        await c.query(`SELECT * FROM payroll_tax_labels WHERE fy = $1 AND line_code = $2`, [
          fy,
          lineCode,
        ])
      ).rows[0];
      if (code && !before) fail(`There is no line ${code} in ${fy}`, 404);
      if (!code && before) fail(`${lineCode!} is already a line of ${fy}: change it instead`, 409);
      if (code)
        await c.query(
          `UPDATE payroll_tax_labels SET label = $3, applies_to = $4, cap_amount = $5, cap_group = $6, declarable = $7,
                  updated_by = app.current_user_id(), updated_at = now()
            WHERE fy = $1 AND line_code = $2`,
          [fy, code, dto.label, dto.appliesTo, dto.capAmount, dto.capGroup, dto.declarable],
        );
      else
        await c.query(
          `INSERT INTO payroll_tax_labels (school_id, fy, line_code, label, applies_to, cap_amount, cap_group, declarable,
                                           sort_order, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7,
                   COALESCE((SELECT max(sort_order) FROM payroll_tax_labels WHERE fy = $1), 0) + 10,
                   app.current_user_id(), app.current_user_id())`,
          [fy, lineCode, dto.label, dto.appliesTo, dto.capAmount, dto.capGroup, dto.declarable],
        );
      await this.audit.stage(ctx, c, {
        action: code ? 'payroll.tax.line_change' : 'payroll.tax.line_add',
        entityType: 'payroll_tax_labels',
        entityId: `${fy}/${lineCode!}`,
        ...(before ? { before } : {}),
        after: { ...dto, lineCode, monthsInUse: used },
      });
      return { saved: true, message: `${lineCode!} is ${code ? 'changed' : 'added'}.` };
    });
  }

  /** A line removed: not one the computation names, and no declaration of the year uses it. */
  async removeLine(ctx: RequestContext, fy: string, code: string, dto: TaxReasonDto) {
    this.must(ctx);
    if (BUILT_IN_LINES.has(code))
      fail(
        `${code} is one the tax computation and the papers use: change it, it is not removed`,
        409,
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.year(c, fy);
      const used = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_declarations WHERE fy = $1 AND line_code = $2`,
          [fy, code],
        )
      ).rows[0]!.n;
      if (used) fail(`${String(used)} declaration(s) use ${code}: it is not removed`, 409);
      const grouped = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_tax_labels WHERE fy = $1 AND cap_group = $2`,
          [fy, code],
        )
      ).rows[0]!.n;
      if (grouped) fail(`${String(grouped)} line(s) count against ${code}: change them first`, 409);
      const before = (
        await c.query(
          `DELETE FROM payroll_tax_labels WHERE fy = $1 AND line_code = $2 RETURNING *`,
          [fy, code],
        )
      ).rows[0];
      if (!before) fail(`There is no line ${code} in ${fy}`, 404);
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax.line_remove',
        entityType: 'payroll_tax_labels',
        entityId: `${fy}/${code}`,
        before,
        after: { reason: dto.reason },
      });
      return { removed: true, message: `${code} is removed from ${fy}.` };
    });
  }

  /** A year added by mistake, removed while nothing belongs to it. */
  async removeYear(ctx: RequestContext, fy: string, dto: TaxReasonDto) {
    this.must(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.year(c, fy);
      // the running year's pay runs need it: correct its figures instead
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
        new Date(),
      );
      const [from, to] = fyBounds(fy);
      if (today >= from && today <= to)
        fail(`${fy} is the running year: correct its figures instead`, 409);
      const blockers = await taxYearBlockers(c, fy);
      if (blockers.length)
        fail(
          `${fy} is used (${blockers.join(', ')}): it is not removed — correct its figures instead`,
          409,
        );
      for (const t of [
        'payroll_tds_slabs',
        'payroll_tds_config',
        'payroll_tds_surcharges',
        'payroll_tax_labels',
        'payroll_tax_years',
      ])
        // eslint-disable-next-line no-restricted-syntax -- the table names are the fixed list above
        await c.query(`DELETE FROM ${t} WHERE fy = $1`, [fy]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.tax_year.remove',
        entityType: 'payroll_tds_slabs',
        entityId: fy,
        after: { reason: dto.reason },
      });
      return { removed: true, message: `${fy} is removed.` };
    });
  }
}
