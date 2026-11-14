/**
 * An employee's year for the tax (docs/design/86, phase D step 2): what the run's projection takes besides the salary
 * — the declarations as they count (declared until the year's proof deadline, then only what a checker verified),
 * the HRA claim, a house's loss, other income, the earlier employer's salary and tax, perquisites, the employer's
 * NPS, the employee's own PF in 80C, the school's final figure. Read only; the engine does the arithmetic.
 */
import type { DeclaredLine, TaxExtras } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';

const P = (v: string | null | undefined) => {
  const [r, p = ''] = (v ?? '0').split('.');
  const neg = r!.startsWith('-');
  const abs = BigInt(r!.replace('-', '') || '0') * 100n + BigInt((p + '00').slice(0, 2));
  return neg ? -abs : abs;
};

/** The year's settings, with their defaults when the school has not set them. */
export async function taxYear(c: PoolClient, fy: string) {
  const y = Number(fy.slice(0, 4));
  const r = (
    await c.query<{
      declare_from: string;
      declare_to: string;
      proof_due: string;
      listed_cities: string[];
      frozen_at: string | null;
    }>(
      `SELECT declare_from::text, declare_to::text, proof_due::text, listed_cities, frozen_at FROM payroll_tax_years WHERE fy = $1`,
      [fy],
    )
  ).rows[0];
  const cities =
    y >= 2026
      ? ['Mumbai', 'Delhi', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad']
      : ['Mumbai', 'Delhi', 'Kolkata', 'Chennai'];
  return {
    fy,
    declareFrom: r?.declare_from ?? `${String(y)}-04-01`,
    declareTo: r?.declare_to ?? `${String(y + 1)}-01-31`,
    proofDue: r?.proof_due ?? `${String(y + 1)}-01-31`,
    listedCities: r?.listed_cities?.length ? r.listed_cities : cities,
    frozen: !!r?.frozen_at,
    set: !!r,
  };
}

/** How much of a declaration counts in a month's run: verified; else declared until the deadline; rejected none. */
export function counted(
  d: { status: string; declared: string; verified: string | null },
  monthStart: string,
  proofDue: string,
): bigint {
  if (d.status === 'VERIFIED') return P(d.verified);
  if (d.status === 'REJECTED') return 0n;
  return monthStart <= proofDue ? P(d.declared) : 0n;
}

export async function loadTaxExtras(
  c: PoolClient,
  q: {
    employeeId: string;
    fy: string;
    fyStart: string;
    monthStart: string;
    regime: 'NEW' | 'OLD';
    npsApplicable: boolean;
    /** a top-up counts the month's locked record among the earlier ones */
    includeMonth: boolean;
  },
): Promise<TaxExtras | undefined> {
  const year = await taxYear(c, q.fy);
  const labels = (
    await c.query<{
      line_code: string;
      applies_to: 'OLD' | 'NEW' | 'BOTH';
      cap_amount: string | null;
      cap_group: string | null;
      declarable: boolean;
    }>(
      `SELECT line_code, applies_to, cap_amount::text, cap_group, declarable FROM payroll_tax_labels WHERE fy = $1 ORDER BY sort_order`,
      [q.fy],
    )
  ).rows;
  const decl = (
    await c.query<{
      line_code: string;
      status: string;
      declared: string;
      verified: string | null;
      detail: { listedCity?: boolean };
    }>(
      `SELECT line_code, status, declared::text, verified::text, detail FROM payroll_declarations
        WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
      [q.employeeId, q.fy],
    )
  ).rows;
  const amount = new Map(decl.map((d) => [d.line_code, counted(d, q.monthStart, year.proofDue)]));
  const x: TaxExtras = {};
  // the HRA claim and the year's HRA, basic and DA paid so far
  const hraDecl = decl.find((d) => d.line_code === 'HRA_RENT');
  const before = (
    await c.query<{ hra: string; salary: string; nps_er: string; pf: string }>(
      `WITH recs AS (
         SELECT r.id FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
            AND r.month >= $2::date AND (r.month < $3::date OR ($4 AND r.month = $3::date)))
       SELECT (SELECT COALESCE(sum(amount), 0) FROM payroll_record_lines WHERE record_id IN (SELECT id FROM recs) AND code = 'HRA')::text AS hra,
              (SELECT COALESCE(sum(amount), 0) FROM payroll_record_lines WHERE record_id IN (SELECT id FROM recs) AND code IN ('BASIC', 'DA'))::text AS salary,
              (SELECT COALESCE(sum(nps_er), 0) FROM payroll_record_statutory WHERE record_id IN (SELECT id FROM recs))::text AS nps_er,
              (SELECT COALESCE(sum(ee_pf + vpf), 0) FROM payroll_record_statutory WHERE record_id IN (SELECT id FROM recs))::text AS pf`,
      [q.employeeId, q.fyStart, q.monthStart, q.includeMonth],
    )
  ).rows[0]!;
  if (hraDecl && (amount.get('HRA_RENT') ?? 0n) > 0n)
    x.hra = {
      rentPaid: amount.get('HRA_RENT')!,
      listedCity: !!hraDecl.detail.listedCity,
      ytdHra: P(before.hra),
      ytdSalary: P(before.salary),
    };
  // a house's loss (old regime, within its cap) and other income
  const homeCap = labels.find((l) => l.line_code === 'HOME_LOAN_INT')?.cap_amount;
  const interest = amount.get('HOME_LOAN_INT') ?? 0n;
  if (interest > 0n && q.regime === 'OLD')
    x.houseLoss = homeCap ? (interest > P(homeCap) ? P(homeCap) : interest) : interest;
  if ((amount.get('OTHER_INCOME') ?? 0n) > 0n) x.otherIncome = amount.get('OTHER_INCOME')!;
  // the earlier employer (Form 122 / 12B): counted like a declaration
  const prev = (
    await c.query<{
      status: string;
      gross: string;
      exempt: string;
      pf: string;
      pt: string;
      tds: string;
    }>(
      `SELECT status, gross::text, exempt::text, pf::text, pt::text, tds::text FROM payroll_prev_employment
        WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
      [q.employeeId, q.fy],
    )
  ).rows[0];
  const prevCounts =
    prev &&
    (prev.status === 'VERIFIED' || (prev.status === 'SUBMITTED' && q.monthStart <= year.proofDue));
  if (prevCounts) {
    x.prevSalary = P(prev.gross) - P(prev.exempt);
    x.prevTds = P(prev.tds);
    x.prevPt = P(prev.pt);
  }
  // the declared sections (not HRA, the house, other income or the employer's NPS: they are worked out apart)
  const apart = new Set(['HRA_RENT', 'HOME_LOAN_INT', 'OTHER_INCOME', 'NPS_ER']);
  const groupCaps: Record<string, bigint> = {};
  for (const l of labels)
    if (!l.declarable && l.cap_amount && labels.some((o) => o.cap_group === l.line_code))
      groupCaps[l.line_code] = P(l.cap_amount);
  const lines: DeclaredLine[] = labels
    .filter((l) => l.declarable && !apart.has(l.line_code))
    .map((l) => ({
      code: l.line_code,
      amount:
        (amount.get(l.line_code) ?? 0n) +
        (l.line_code === 'CHAPVIA_80C' && prevCounts && q.regime === 'OLD' ? P(prev.pf) : 0n),
      cap: l.cap_amount ? P(l.cap_amount) : null,
      appliesTo: l.applies_to,
      group: l.cap_group,
    }));
  const has80c = lines.some((l) => l.code === 'CHAPVIA_80C');
  if (lines.some((l) => l.amount > 0n) || (has80c && q.regime === 'OLD'))
    x.declared = {
      lines,
      groupCaps,
      ...(has80c ? { pf80c: { ytd: P(before.pf), code: 'CHAPVIA_80C' } } : {}),
    };
  // the employer's NPS: from payroll, within 14 % (new regime) or 10 % (old) of basic and DA
  if (q.npsApplicable)
    x.npsEr = { ytd: P(before.nps_er), capRate: q.regime === 'NEW' ? '0.14' : '0.10' };
  // perquisites a checker verified
  const perq = (
    await c.query<{ s: string }>(
      `SELECT COALESCE(sum(amount), 0)::text AS s FROM payroll_perquisites
        WHERE employee_id = $1 AND fy = $2 AND verified AND superseded_at IS NULL AND deleted_at IS NULL`,
      [q.employeeId, q.fy],
    )
  ).rows[0]!.s;
  if (P(perq) > 0n) x.perquisites = P(perq);
  // the school's final figure
  const fin = (
    await c.query<{ annual: string; spread_months: number | null }>(
      `SELECT annual::text, spread_months FROM payroll_tax_finals WHERE employee_id = $1 AND fy = $2 AND cleared_at IS NULL`,
      [q.employeeId, q.fy],
    )
  ).rows[0];
  if (fin) {
    const idx = ((Number(q.monthStart.slice(5, 7)) + 8) % 12) + 1; // April = 1
    x.final = {
      annual: P(fin.annual),
      ...(fin.spread_months !== null ? { spreadLeft: fin.spread_months - idx + 1 } : {}),
    };
  }
  return Object.keys(x).length ? x : undefined;
}
