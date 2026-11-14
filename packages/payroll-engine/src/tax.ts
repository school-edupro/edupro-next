/**
 * Income tax on salary (`payroll_tax_lib.php: pr_tds_project`, PAYROLL_RUN_SPEC.md §4.2 step 8, the plan §1A):
 * the year's tax from the slabs of the regime — the rebate with marginal relief, the surcharge with marginal
 * relief, cess, the higher rate without a PAN — and the month's deduction from the year's projection. Money in
 * paise. Declarations, previous-employer income and perquisites come in phase D; here the projection is the
 * salary itself, the standard deduction and (old regime) profession tax.
 */
import { divHalfUp, roundHead } from './money';
import type { DeclaredLine } from './declare';
import { mulRate } from './statutory';

export interface TaxSlab {
  from: bigint;
  to: bigint | null;
  rate: string;
}
export interface TaxRules {
  slabs: TaxSlab[];
  standardDeduction: bigint;
  rebateLimit: bigint;
  rebateMax: bigint;
  /** relief just above the rebate limit (the new regime) */
  marginalRelief: boolean;
  cessRate: string;
  /** without a PAN, at least this share of the taxable income (section 206AA) */
  panAbsentRate: string;
  surcharges: Array<{ from: bigint; rate: string }>;
}
export interface AnnualTax {
  taxable: bigint;
  slabTax: bigint;
  rebate: bigint;
  surcharge: bigint;
  cess: bigint;
  /** tax + surcharge + cess, rounded to ₹10 */
  total: bigint;
  /** the higher rate without a PAN was applied */
  panAbsent: boolean;
}

/** The tax on income by the slabs (each slab taxes the income between its two bounds). */
export function slabTax(income: bigint, slabs: readonly TaxSlab[]): bigint {
  let tax = 0n;
  for (const s of slabs) {
    const top = s.to === null || income < s.to ? income : s.to;
    if (top > s.from) tax += mulRate(top - s.from, s.rate);
  }
  return tax;
}

/** The year's tax on a taxable income (after deductions), in a regime's rules. */
export function annualTax(taxable: bigint, rules: TaxRules, panPresent: boolean): AnnualTax {
  const income = taxable < 0n ? 0n : taxable;
  const base = slabTax(income, rules.slabs);
  let rebate = 0n;
  if (income <= rules.rebateLimit) rebate = base < rules.rebateMax ? base : rules.rebateMax;
  else if (rules.marginalRelief && base > income - rules.rebateLimit)
    // just above the limit no more tax than the income above it
    rebate = base - (income - rules.rebateLimit);
  const tax = base - rebate;
  // the surcharge of the band, with marginal relief at its start
  const band = [...rules.surcharges]
    .sort((a, b) => Number(b.from - a.from))
    .find((s) => income > s.from);
  let surcharge = 0n;
  if (band) {
    surcharge = mulRate(tax, band.rate);
    const lower = [...rules.surcharges]
      .filter((s) => s.from < band.from)
      .sort((a, b) => Number(b.from - a.from))[0];
    const atThreshold = slabTax(band.from, rules.slabs);
    const atThresholdTotal = atThreshold + (lower ? mulRate(atThreshold, lower.rate) : 0n);
    const cap = atThresholdTotal + (income - band.from);
    // a slab rate is below 100 %, so the tax alone never passes the cap
    if (tax + surcharge > cap) surcharge = cap - tax;
  }
  const cess = mulRate(tax + surcharge, rules.cessRate);
  let total = roundHead(tax + surcharge + cess, 'NEAREST_10');
  let panAbsent = false;
  if (!panPresent) {
    const floor = roundHead(mulRate(income, rules.panAbsentRate), 'NEAREST_10');
    if (floor > total) {
      total = floor;
      panAbsent = true;
    }
  }
  return { taxable: income, slabTax: base, rebate, surcharge, cess, total, panAbsent };
}

export interface ProjectionInput {
  regime: 'NEW' | 'OLD';
  /** taxable salary of the year's earlier paid months */
  ytdTaxable: bigint;
  /** this month's taxable earnings */
  thisTaxable: bigint;
  /** a month's taxable salary at full attendance, for the months after this one */
  monthlyRate: bigint;
  /** the months of the year from this one to March (or to the leaving month), this one included */
  monthsLeft: number;
  /** profession tax of the year (deducted in the old regime) */
  ytdPt: bigint;
  thisPt: bigint;
  monthlyPt: bigint;
  /** tax deducted in the year's earlier months */
  ytdTds: bigint;
  /** deductions of the old regime only (phase B's slot; phase D passes `extras.deductions`) */
  otherDeductions?: bigint;
  /** what declarations and the year's other facts bring (phase D) */
  extras?: TaxExtras;
  panPresent: boolean;
  rules: TaxRules;
}
/**
 * The year's other facts (phase D), each already decided for the regime by the caller (`allowedDeductions`,
 * `hraExemption`, `houseLoss`): salary and tax from earlier employers this year, perquisites, exemptions from salary,
 * income from other sources, a house's loss, the deductions allowed.
 */
export interface TaxExtras {
  prevSalary?: bigint;
  prevTds?: bigint;
  /** profession tax an earlier employer deducted (counts in the old regime) */
  prevPt?: bigint;
  perquisites?: bigint;
  exemptions?: bigint;
  otherIncome?: bigint;
  houseLoss?: bigint;
  deductions?: bigint;
  /**
   * the HRA exemption, worked out by the month's calculation (old regime): the year's rent and whether it is paid in
   * one of the year's listed cities, HRA and basic + DA paid in the year's earlier months
   */
  hra?: { rentPaid: bigint; listedCity: boolean; ytdHra: bigint; ytdSalary: bigint };
  /** the employer's NPS: paid in the earlier months, and its deduction's cap as a share of basic + DA */
  npsEr?: { ytd: bigint; capRate: string };
  /**
   * the declared sections (as counted: declared until the proof deadline, then verified), worked out by the month's
   * calculation with the employee's own PF and VPF of the year added to `pf80c.code` (80C)
   */
  declared?: {
    lines: DeclaredLine[];
    groupCaps: Record<string, bigint>;
    pf80c?: { ytd: bigint; code: string };
  };
  /** the school's final figure for the year, collected over the months left of `spreadLeft` (from this month) */
  final?: { annual: bigint; spreadLeft?: number };
}
export interface Projection {
  /** the year's salary: this employer's (projected), perquisites and earlier employers' */
  gross: bigint;
  standardDeduction: bigint;
  ptDeduction: bigint;
  /** every deduction from the gross total income (the old regime's slot and the allowed deductions) */
  otherDeductions: bigint;
  exemptions: bigint;
  perquisites: bigint;
  prevSalary: bigint;
  otherIncome: bigint;
  houseLoss: bigint;
  tax: AnnualTax;
  ytdTds: bigint;
  monthsLeft: number;
  /** this month's deduction: income tax and cess */
  monthly: bigint;
  it: bigint;
  cess: bigint;
  warnings: string[];
}

/** The year's projected tax and this month's share of what is still to deduct. */
export function projectTax(p: ProjectionInput): Projection {
  const future = BigInt(Math.max(1, p.monthsLeft) - 1);
  const x = p.extras ?? {};
  const perqs = x.perquisites ?? 0n;
  const prev = x.prevSalary ?? 0n;
  const gross = p.ytdTaxable + p.thisTaxable + p.monthlyRate * future + perqs + prev;
  const exempt = x.exemptions ?? 0n;
  const afterExempt = gross - exempt;
  const sd =
    afterExempt < p.rules.standardDeduction
      ? afterExempt > 0n
        ? afterExempt
        : 0n
      : p.rules.standardDeduction;
  const pt = p.regime === 'OLD' ? p.ytdPt + p.thisPt + p.monthlyPt * future + (x.prevPt ?? 0n) : 0n;
  const other = (p.regime === 'OLD' ? (p.otherDeductions ?? 0n) : 0n) + (x.deductions ?? 0n);
  const otherIncome = x.otherIncome ?? 0n;
  const house = x.houseLoss ?? 0n;
  const tax = annualTax(afterExempt - sd - pt + otherIncome - house - other, p.rules, p.panPresent);
  const ytdTds = p.ytdTds + (x.prevTds ?? 0n);
  const warnings: string[] = [];
  let left = Math.max(1, p.monthsLeft);
  if (x.final) {
    warnings.push(
      `The school's final figure for the year is used (${String(x.final.annual / 100n)}; worked out: ${String(tax.total / 100n)})`,
    );
    tax.total = x.final.annual;
    if (x.final.spreadLeft !== undefined) left = Math.min(left, Math.max(1, x.final.spreadLeft));
  }
  const remaining = tax.total - ytdTds;
  let monthly: bigint;
  if (left === 1) {
    monthly = remaining > 0n ? remaining : 0n;
    if (remaining < 0n)
      warnings.push(
        'More tax was deducted earlier in the year than the year’s tax: nothing this month',
      );
  } else {
    monthly = remaining > 0n ? roundHead(divHalfUp(remaining, BigInt(left)), 'NEAREST_1') : 0n;
  }
  const cess = cessPart(tax, monthly);
  return {
    gross,
    standardDeduction: sd,
    ptDeduction: pt,
    otherDeductions: other,
    exemptions: exempt,
    perquisites: perqs,
    prevSalary: prev,
    otherIncome,
    houseLoss: house,
    tax,
    ytdTds,
    monthsLeft: left,
    monthly,
    it: monthly - cess,
    cess,
    warnings,
  };
}

/** The months from a pay month to March (or to the leaving month, when earlier), the pay month included. */
export function monthsLeftInYear(month: string, leftOn?: string | null): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const fyEnd = m >= 4 ? (y + 1) * 12 + 3 : y * 12 + 3;
  let end = fyEnd;
  if (leftOn) {
    const ly = Number(leftOn.slice(0, 4));
    const lm = Number(leftOn.slice(5, 7));
    end = Math.min(end, ly * 12 + lm);
  }
  return Math.max(1, end - (y * 12 + m) + 1);
}

/** A month's deduction split: the cess part in the year's proportion (none on the no-PAN rate). */
export function cessPart(tax: AnnualTax, monthly: bigint): bigint {
  const taxPart = tax.slabTax - tax.rebate + tax.surcharge;
  if (tax.panAbsent || taxPart + tax.cess === 0n) return 0n;
  const c = roundHead(divHalfUp(monthly * tax.cess, taxPart + tax.cess), 'NEAREST_1');
  return c < monthly ? c : monthly;
}

/**
 * A top-up's tax (a month already paid): only what its payment adds to the year's tax, deducted now — the month's
 * own share was deducted by the run that paid it (the legacy deducted a month's share again).
 */
export function topUpTax(p: ProjectionInput): Projection {
  const withIt = projectTax(p);
  const without = projectTax({ ...p, thisTaxable: 0n, thisPt: 0n });
  const extra = withIt.tax.total - without.tax.total;
  const monthly = extra > 0n ? extra : 0n;
  const cess = cessPart(withIt.tax, monthly);
  return { ...withIt, monthly, it: monthly - cess, cess, warnings: [] };
}
