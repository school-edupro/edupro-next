/**
 * Everything the engine needs for an employee's month, loaded as of that month (PAYROLL_RUN_SPEC.md §0.2, §4.2):
 * the pay heads and their versions in force (the latest effective row inside the month), the salary structure,
 * the rate registry, the statutory settings (PF day by day, ESI, PT of the state, LWF), the tax rules of the year,
 * the month's attendance, pending arrears and one-off items, recurring deductions, loans, the year's tax so far.
 * What the whole batch shares is loaded once.
 */
import {
  datesBetween,
  esiPeriodStart,
  monthsLeftInYear,
  toPaise,
  type CalcInput,
  type Head,
  type HeadVersion,
  type LwfRule,
  type PfRates,
  type PtSlab,
  type Rounding,
  type TaxRules,
} from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { decryptField, maskValue } from '@edupro/db';
import { fyOf } from './payroll-setup.service';

const P = (v: string | number | null | undefined) => toPaise(String(v ?? '0')) ?? 0n;
const PN = (v: string | number | null | undefined) => (v === null || v === undefined ? null : P(v));

export interface MonthContext {
  month: string;
  start: string;
  end: string;
  fy: string;
  heads: Record<string, Head>;
  headIds: Record<string, string>;
  rates: CalcInput['rates'];
  settings: {
    stateCode: string | null;
    lwfEnabled: boolean;
    epsStopAge: number;
    pfCeilingProrate: boolean;
    netRounding: Rounding;
    attributes: Array<{ code: string; field: string; value: string }>;
  };
  pfSegments: CalcInput['statutory']['pfSegments'];
  esi: CalcInput['statutory']['esi'];
  ptSlabs: PtSlab[] | null;
  lwf: (LwfRule & { id: string }) | null;
  taxRules: Record<'NEW' | 'OLD', TaxRules | null>;
}

// "in force in the month": active and overlapping it ($1 its first day, $2 its last); the latest such row wins

export async function monthContext(c: PoolClient, month: string): Promise<MonthContext> {
  const start = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  const range = [start, end];
  const fy = fyOf(start);
  const s = (
    await c.query<{
      state_code: string | null;
      lwf_enabled: boolean;
      eps_stop_age: number;
      pf_ceiling_prorate: boolean;
      net_rounding: Rounding;
      formula_attributes: Array<{ code: string; field: string; value: string }>;
    }>(
      `SELECT state_code, lwf_enabled, eps_stop_age, pf_ceiling_prorate, net_rounding, formula_attributes FROM payroll_settings`,
    )
  ).rows[0];
  // pay heads with the version in force (the latest effective inside the month) and its slabs
  const heads: Record<string, Head> = {};
  const headIds: Record<string, string> = {};
  const hv = await c.query<{
    id: string;
    code: string;
    name: string;
    head_type: 'EARNING' | 'DEDUCTION';
    print_order: number;
    show_if_zero: boolean;
    vid: string | null;
    calc_type: HeadVersion['calcType'] | null;
    formula: string | null;
    depends_on: string | null;
    is_taxable: boolean | null;
    pf_wage: boolean | null;
    esi_wage: boolean | null;
    pt_wage: boolean | null;
    prorate_on_lop: boolean | null;
    rounding: Rounding | null;
  }>(
    `SELECT h.id::text, h.code, h.name, h.head_type, h.print_order, h.show_if_zero, v.id::text AS vid, v.calc_type, v.formula,
            v.depends_on, v.is_taxable, v.pf_wage, v.esi_wage, v.pt_wage, v.prorate_on_lop, v.rounding
       FROM payroll_pay_heads h
       LEFT JOIN LATERAL (
         SELECT * FROM payroll_pay_head_versions x
          WHERE x.pay_head_id = h.id AND x.status = 'active' AND x.effective_from <= $2::date
            AND (x.effective_to IS NULL OR x.effective_to >= $1::date)
          ORDER BY x.effective_from DESC LIMIT 1) v ON true
      WHERE h.status = 'active'`,
    range,
  );
  const slabs = await c.query<{
    version_id: string;
    basis: HeadVersion['slabs'][number]['basis'];
    range_from: string;
    range_to: string | null;
    flat_amount: string | null;
    percent: string | null;
  }>(
    `SELECT version_id::text, basis, range_from::text, range_to::text, flat_amount::text, percent::text
       FROM payroll_pay_head_slabs WHERE version_id::text = ANY($1::text[]) ORDER BY version_id, seq, range_from`,
    [hv.rows.map((r) => r.vid).filter(Boolean)],
  );
  for (const r of hv.rows) {
    headIds[r.code] = r.id;
    heads[r.code] = {
      id: r.id,
      code: r.code,
      name: r.name,
      headType: r.head_type,
      printOrder: r.print_order,
      showIfZero: r.show_if_zero,
      version: r.vid
        ? {
            id: r.vid,
            calcType: r.calc_type!,
            formula: r.formula,
            dependsOn: r.depends_on,
            isTaxable: r.is_taxable!,
            pfWage: r.pf_wage!,
            esiWage: r.esi_wage!,
            ptWage: r.pt_wage!,
            prorateOnLop: r.prorate_on_lop!,
            rounding: r.rounding!,
            slabs: slabs.rows
              .filter((x) => x.version_id === r.vid)
              .map((x) => ({
                basis: x.basis,
                from: P(x.range_from),
                to: PN(x.range_to),
                flat: PN(x.flat_amount),
                percent: x.percent,
              })),
          }
        : null,
    };
  }
  // the rate registry: the latest row of each code inside the month
  const rates: Record<string, { value: string; id: string }> = {};
  for (const r of (
    await c.query<{ id: string; rate_code: string; rate_value: string }>(
      `SELECT DISTINCT ON (rate_code) id::text, rate_code, rate_value::text FROM payroll_rates WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY rate_code, effective_from DESC`,
      range,
    )
  ).rows)
    rates[r.rate_code] = { value: r.rate_value, id: r.id };
  // PF: each day of the month to the setting in force that day; consecutive days of one setting a segment
  const pfRows = (
    await c.query<{
      id: string;
      from: string;
      to: string | null;
      ee_rate: string;
      er_rate: string;
      eps_rate: string;
      eps_wage_ceiling: string;
      edli_rate: string;
      edli_wage_ceiling: string;
      admin_rate: string;
    }>(
      `SELECT id::text, effective_from::text AS from, effective_to::text AS to, ee_rate::text, er_rate::text, eps_rate::text,
              eps_wage_ceiling::text, edli_rate::text, edli_wage_ceiling::text, admin_rate::text
         FROM payroll_pf_settings WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date) ORDER BY effective_from DESC`,
      range,
    )
  ).rows;
  const segments: Array<{ days: number; id: string; rates: PfRates }> = [];
  for (const day of datesBetween(start, end)) {
    const row = pfRows.find((r) => r.from <= day && (!r.to || r.to >= day));
    if (!row) continue;
    const last = segments[segments.length - 1];
    if (last?.id === row.id) last.days += 1;
    else
      segments.push({
        days: 1,
        id: row.id,
        rates: {
          eeRate: row.ee_rate,
          erRate: row.er_rate,
          epsRate: row.eps_rate,
          epsCeiling: P(row.eps_wage_ceiling),
          edliRate: row.edli_rate,
          edliCeiling: P(row.edli_wage_ceiling),
          adminRate: row.admin_rate,
        },
      });
  }
  const esiRow = (
    await c.query<{
      id: string;
      ee_rate: string;
      er_rate: string;
      wage_limit: string;
      wage_limit_pwd: string | null;
    }>(
      `SELECT id::text, ee_rate::text, er_rate::text, wage_limit::text, wage_limit_pwd::text FROM payroll_esi_settings
        WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date) ORDER BY effective_from DESC LIMIT 1`,
      range,
    )
  ).rows[0];
  const state = s?.state_code ?? null;
  let ptSlabs: PtSlab[] | null = null;
  if (state) {
    ptSlabs = (
      await c.query<{
        gender: 'M' | 'F' | 'ANY';
        wage_from: string;
        wage_to: string | null;
        monthly_amount: string;
        month_overrides: Record<string, string> | null;
      }>(
        `SELECT DISTINCT ON (gender, wage_from) gender, wage_from::text, wage_to::text, monthly_amount::text, month_overrides
           FROM payroll_pt_slabs WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date) AND state_code = $3 ORDER BY gender, wage_from, effective_from DESC`,
        [...range, state],
      )
    ).rows.map((r) => ({
      gender: r.gender,
      from: P(r.wage_from),
      to: PN(r.wage_to),
      amount: P(r.monthly_amount),
      overrides: r.month_overrides
        ? Object.fromEntries(Object.entries(r.month_overrides).map(([k, v]) => [k, P(v)]))
        : null,
    }));
  }
  let lwf: MonthContext['lwf'] = null;
  if (state && s?.lwf_enabled) {
    const r = (
      await c.query<{
        id: string;
        ee_rate: string | null;
        ee_cap: string | null;
        ee_flat: string | null;
        er_flat: string | null;
        er_multiplier: string | null;
        frequency: 'monthly' | 'half_yearly';
        months: number[] | null;
      }>(
        `SELECT id::text, ee_rate::text, ee_cap::text, ee_flat::text, er_flat::text, er_multiplier::text, frequency, months
           FROM payroll_lwf_settings WHERE status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date) AND state_code = $3 ORDER BY effective_from DESC LIMIT 1`,
        [...range, state],
      )
    ).rows[0];
    if (r)
      lwf = {
        id: r.id,
        eeRate: r.ee_rate,
        eeCap: PN(r.ee_cap),
        eeFlat: PN(r.ee_flat),
        erFlat: PN(r.er_flat),
        erMultiplier: r.er_multiplier,
        frequency: r.frequency,
        months: r.months ?? [],
      };
  }
  const taxRules: MonthContext['taxRules'] = { NEW: null, OLD: null };
  for (const regime of ['NEW', 'OLD'] as const) {
    const cfg = (
      await c.query<{
        standard_deduction: string;
        rebate_income_limit: string;
        rebate_max: string;
        cess_rate: string;
        pan_absent_rate: string;
        marginal_relief: boolean;
      }>(
        `SELECT standard_deduction::text, rebate_income_limit::text, rebate_max::text, cess_rate::text, pan_absent_rate::text,
                marginal_relief FROM payroll_tds_config WHERE fy = $1 AND regime = $2`,
        [fy, regime],
      )
    ).rows[0];
    const sl = (
      await c.query<{ slab_from: string; slab_to: string | null; rate: string }>(
        `SELECT slab_from::text, slab_to::text, rate::text FROM payroll_tds_slabs WHERE fy = $1 AND regime = $2 ORDER BY slab_from`,
        [fy, regime],
      )
    ).rows;
    if (!cfg || !sl.length) continue;
    const sur = (
      await c.query<{ income_from: string; rate: string }>(
        `SELECT income_from::text, rate::text FROM payroll_tds_surcharges WHERE fy = $1 AND regime = $2 ORDER BY income_from`,
        [fy, regime],
      )
    ).rows;
    taxRules[regime] = {
      slabs: sl.map((x) => ({ from: P(x.slab_from), to: PN(x.slab_to), rate: x.rate })),
      standardDeduction: P(cfg.standard_deduction),
      rebateLimit: P(cfg.rebate_income_limit),
      rebateMax: P(cfg.rebate_max),
      // the old regime has no marginal relief at the rebate limit
      marginalRelief: regime === 'NEW' && cfg.marginal_relief,
      cessRate: cfg.cess_rate,
      panAbsentRate: cfg.pan_absent_rate,
      surcharges: sur.map((x) => ({ from: P(x.income_from), rate: x.rate })),
    };
  }
  return {
    month,
    start,
    end,
    fy,
    heads,
    headIds,
    rates,
    settings: {
      stateCode: state,
      lwfEnabled: s?.lwf_enabled ?? false,
      epsStopAge: s?.eps_stop_age ?? 58,
      pfCeilingProrate: s?.pf_ceiling_prorate ?? true,
      netRounding: s?.net_rounding ?? 'NEAREST_1',
      attributes: s?.formula_attributes ?? [],
    },
    pfSegments: segments.length ? segments : null,
    esi: esiRow
      ? {
          id: esiRow.id,
          eeRate: esiRow.ee_rate,
          erRate: esiRow.er_rate,
          wageLimit: P(esiRow.wage_limit),
          pwdLimit: PN(esiRow.wage_limit_pwd),
        }
      : null,
    ptSlabs,
    lwf,
    taxRules,
  };
}

/** the employee as paid (frozen on the record) */
export interface Snapshot {
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  panMasked: string | null;
  uan: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  payLevel: string | null;
  payMode: string;
  bankName: string | null;
  bankIfsc: string | null;
  bankMasked: string | null;
  bankEnc: string | null;
  taxRegime: string;
  holdProfile: boolean;
}
export type Loaded =
  | { ok: true; input: CalcInput; snapshot: Snapshot; esiPeriod: string; esiDecided: boolean }
  | { ok: false; code: string; reason: string; snapshot: Pick<Snapshot, 'code' | 'name'> };

const PROFILE_DEFAULTS = {
  pf_applicable: true,
  pf_wage_basis: 'ACTUAL',
  eps_applicable: true,
  vpf_type: 'NONE',
  vpf_value: '0',
  nps_applicable: false,
  nps_ee_rate: '0.10',
  nps_er_rate: '0.14',
  esi_applicable: true,
  pwd: false,
  pt_applicable: true,
  tax_regime: 'NEW',
  tds_mode: 'PROJECTION',
  pay_level: null,
  pay_mode: 'BANK',
  payroll_status: 'ACTIVE',
};

/** One employee's month: the engine input, or why it cannot be worked out. */
export async function loadEmployee(
  c: PoolClient,
  m: MonthContext,
  employeeId: string,
  opts: { topUp: { pfWageUsed: bigint } | null; needAttendance: boolean },
): Promise<Loaded> {
  const e = (
    await c.query<{
      code: string;
      name: string;
      designation: string | null;
      department: string | null;
      dob: string | null;
      gender: string;
      left_on: string | null;
      fields: Record<string, unknown>;
      pan: string | null;
      bank_account_no: string | null;
    }>(
      `SELECT e.employee_code AS code, e.display_name AS name, e.designation, e.department, e.dob::text, e.gender::text,
              e.left_on::text, ((to_jsonb(e) - 'secure' - 'profile') || e.profile) AS fields,
              e.secure->>'pan' AS pan, e.secure->>'bank_account_no' AS bank_account_no
         FROM employees e WHERE e.id = $1`,
      [employeeId],
    )
  ).rows[0];
  if (!e)
    return {
      ok: false,
      code: 'NO_EMPLOYEE',
      reason: 'Employee not found.',
      snapshot: { code: '?', name: '?' },
    };
  const who = { code: e.code, name: e.name };
  const prow = (
    await c.query<Record<string, unknown>>(
      `SELECT pf_applicable, pf_wage_basis, eps_applicable, vpf_type, vpf_value::text, nps_applicable, nps_ee_rate::text,
              nps_er_rate::text, esi_applicable, pwd, pt_applicable, tax_regime, tds_mode, pay_level, pay_mode, payroll_status
         FROM payroll_profiles WHERE employee_id = $1`,
      [employeeId],
    )
  ).rows[0];
  const p = { ...PROFILE_DEFAULTS, ...(prow ?? {}) } as typeof PROFILE_DEFAULTS &
    Record<string, unknown>;
  // attendance: required for a full month
  const a = (
    await c.query<{
      month_days: string;
      paid_days: string;
      lop_days: string;
      pre_join_days: string;
      post_leave_days: string;
      ot_hours: string;
      finalised: boolean;
    }>(
      `SELECT month_days::text, paid_days::text, lop_days::text, pre_join_days::text, post_leave_days::text, ot_hours::text, finalised
         FROM payroll_attendance WHERE employee_id = $1 AND month = $2::date`,
      [employeeId, m.start],
    )
  ).rows[0];
  if (opts.needAttendance && (!a || !a.finalised))
    return {
      ok: false,
      code: 'NO_ATTENDANCE',
      reason: 'No finalised attendance for this month.',
      snapshot: who,
    };
  const structure = (
    await c.query<{ id: string; code: string; amount: string }>(
      `SELECT DISTINCT ON (s.pay_head_id) s.id::text, h.code, s.amount::text
         FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
        WHERE s.employee_id = $3 AND s.status = 'active' AND s.effective_from <= $2::date
          AND (s.effective_to IS NULL OR s.effective_to >= $1::date)
        ORDER BY s.pay_head_id, s.effective_from DESC`,
      [m.start, m.end, employeeId],
    )
  ).rows;
  const code = (headId: string) =>
    Object.values(m.heads).find((h) => h.id === headId)?.code ?? `#${headId}`;
  const arrears = (
    await c.query<{ id: string; head: string; amount: string; pf: boolean; taxable: boolean }>(
      `SELECT id::text, pay_head_id::text AS head, amount::text, pf_applicable AS pf, taxable FROM payroll_arrears
        WHERE employee_id = $1 AND paid_in_record_id IS NULL AND cancelled_at IS NULL ORDER BY period_month, id`,
      [employeeId],
    )
  ).rows;
  const adhoc = (
    await c.query<{ id: string; head: string; amount: string; ref_module: string | null }>(
      `SELECT id::text, pay_head_id::text AS head, amount::text, ref_module FROM payroll_adhoc
        WHERE employee_id = $1 AND month = $2::date AND deleted_at IS NULL AND paid_in_record_id IS NULL ORDER BY id`,
      [employeeId, m.start],
    )
  ).rows;
  const recurring = (
    await c.query<{ id: string; head: string; amount: string }>(
      `SELECT id::text, pay_head_id::text AS head, amount::text FROM payroll_recurring
        WHERE employee_id = $1 AND status = 'ACTIVE' AND start_month <= $2::date AND (end_month IS NULL OR end_month >= $2::date)
        ORDER BY id`,
      [employeeId, m.start],
    )
  ).rows;
  const loans = (
    await c.query<{
      id: string;
      principal: string;
      emi: string;
      rate: string;
      method: 'NONE' | 'FLAT' | 'REDUCING';
      balance: string;
    }>(
      `SELECT id::text, principal::text, emi::text, interest_rate::text AS rate, interest_method AS method, balance::text
         FROM payroll_loans WHERE employee_id = $1 AND status = 'ACTIVE' AND start_month <= $2::date AND balance > 0 ORDER BY id`,
      [employeeId, m.start],
    )
  ).rows;
  const rateBasedOt = !!(
    await c.query(
      `SELECT 1 FROM payroll_ot_entries WHERE employee_id = $1 AND month = $2::date AND deleted_at IS NULL`,
      [employeeId, m.start],
    )
  ).rowCount;
  const esiPeriod = esiPeriodStart(m.month);
  const cov = (
    await c.query<{ covered: boolean }>(
      `SELECT covered FROM payroll_esi_coverage WHERE employee_id = $1 AND period_start = $2::date`,
      [employeeId, esiPeriod],
    )
  ).rows[0];
  const manual = (
    await c.query<{ it: string; cess: string }>(
      `SELECT it_amount::text AS it, cess_amount::text AS cess FROM payroll_tds_manual WHERE employee_id = $1 AND month = $2::date`,
      [employeeId, m.start],
    )
  ).rows[0];
  // the year's tax so far: earlier months of locked runs (and, for a top-up, this month's)
  const fyStart = `${m.fy.slice(0, 4)}-04-01`;
  const ytd = (
    await c.query<{ taxable: string; pt: string; tds: string }>(
      `WITH recs AS (
         SELECT r.id, r.pt_amount, r.it_amount, r.cess_amount FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
            AND r.month >= $2::date AND (r.month < $3::date OR ($4 AND r.month = $3::date)))
       SELECT (SELECT COALESCE(sum(l.amount), 0) FROM payroll_record_lines l
                WHERE l.record_id IN (SELECT id FROM recs) AND l.head_type = 'EARNING' AND l.is_taxable)::text AS taxable,
              (SELECT COALESCE(sum(pt_amount), 0) FROM recs)::text AS pt,
              (SELECT COALESCE(sum(it_amount + cess_amount), 0) FROM recs)::text AS tds`,
      [employeeId, fyStart, m.start, opts.topUp !== null],
    )
  ).rows[0]!;
  const fields = e.fields;
  const attributes = Object.fromEntries(
    m.settings.attributes.map((x) => [
      x.code,
      String(fields[x.field] ?? '')
        .trim()
        .toLowerCase() === String(x.value).trim().toLowerCase()
        ? 1
        : 0,
    ]),
  );
  const regime = (p.tax_regime === 'OLD' ? 'OLD' : 'NEW') as 'NEW' | 'OLD';
  const plain = (v: string | null) => (v ? decryptField(v) : null);
  const bank = plain(e.bank_account_no);
  const input: CalcInput = {
    month: m.month,
    topUp: opts.topUp,
    attendance: {
      monthDays: a?.month_days ?? '0',
      paidDays: a?.paid_days ?? '0',
      lopDays: a?.lop_days ?? '0',
      preJoinDays: a?.pre_join_days ?? '0',
      postLeaveDays: a?.post_leave_days ?? '0',
      otHours: a?.ot_hours ?? '0',
    },
    employee: {
      dob: e.dob,
      gender: e.gender === 'female' ? 'F' : 'M',
      panPresent: !!plain(e.pan),
      payLevel: (p.pay_level as string | null) ?? null,
    },
    profile: {
      pfApplicable: !!p.pf_applicable,
      pfWageBasis: p.pf_wage_basis as 'ACTUAL' | 'CEILING',
      epsApplicable: !!p.eps_applicable,
      vpfType: p.vpf_type as 'NONE' | 'FLAT' | 'PERCENT',
      vpfValue: String(p.vpf_value),
      npsApplicable: !!p.nps_applicable,
      npsEeRate: String(p.nps_ee_rate),
      npsErRate: String(p.nps_er_rate),
      esiApplicable: !!p.esi_applicable,
      pwd: !!p.pwd,
      ptApplicable: !!p.pt_applicable,
      taxRegime: regime,
      tdsMode: p.tds_mode === 'MANUAL' ? 'MANUAL' : 'PROJECTION',
    },
    heads: m.heads,
    structure: structure.map((s) => ({ code: s.code, amount: P(s.amount), rowId: s.id })),
    rates: m.rates,
    attributes,
    arrears: arrears.map((x) => ({
      id: x.id,
      code: code(x.head),
      amount: P(x.amount),
      pf: x.pf,
      taxable: x.taxable,
    })),
    adhoc: adhoc.map((x) => ({
      id: x.id,
      code: code(x.head),
      amount: P(x.amount),
      refModule: x.ref_module,
    })),
    recurring: recurring.map((x) => ({ id: x.id, code: code(x.head), amount: P(x.amount) })),
    loans: loans.map((l) => ({
      id: l.id,
      terms: { principal: P(l.principal), emi: P(l.emi), rate: l.rate, method: l.method },
      balance: P(l.balance),
    })),
    rateBasedOt,
    statutory: {
      pfSegments: m.pfSegments,
      pfCeilingProrate: m.settings.pfCeilingProrate,
      epsStopAge: m.settings.epsStopAge,
      esi: m.esi,
      esiCovered: cov ? cov.covered : null,
      ptSlabs: m.ptSlabs,
      lwf: m.lwf,
      netRounding: m.settings.netRounding,
    },
    tax: {
      manual: manual ? { it: P(manual.it), cess: P(manual.cess) } : null,
      rules: m.taxRules[regime],
      ytdTaxable: P(ytd.taxable),
      ytdPt: P(ytd.pt),
      ytdTds: P(ytd.tds),
      monthsLeft: monthsLeftInYear(m.month, e.left_on),
    },
  };
  return {
    ok: true,
    input,
    esiPeriod,
    esiDecided: !!cov,
    snapshot: {
      code: e.code,
      name: e.name,
      designation: e.designation,
      department: e.department,
      panMasked: (() => {
        const v = plain(e.pan);
        return v ? maskValue(v) : null;
      })(),
      uan: (fields.uan as string | undefined) ?? null,
      pfNumber: (fields.pf_no as string | undefined) ?? null,
      esiNumber: (fields.esi_no as string | undefined) ?? null,
      payLevel: (p.pay_level as string | null) ?? null,
      payMode: String(p.pay_mode ?? 'BANK'),
      bankName: (fields.bank_name as string | undefined) ?? null,
      bankIfsc: (fields.bank_ifsc as string | undefined) ?? null,
      bankMasked: bank ? maskValue(bank) : null,
      bankEnc: e.bank_account_no,
      taxRegime: regime,
      holdProfile: p.payroll_status === 'HOLD',
    },
  };
}
