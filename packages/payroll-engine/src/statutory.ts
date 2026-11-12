/**
 * The statutory deductions of a month (`payroll_calc_lib.php` step 8, PAYROLL_RUN_SPEC.md §4.2): PF with its
 * pension (EPS), EDLI and admin shares and voluntary PF; NPS; ESI; profession tax; labour welfare fund. Money in
 * paise; a rate is a decimal string (0.12). Fixed from the legacy: on a top-up the PF wage is cut to what is
 * left of the ceiling only on the CEILING basis (it was cut on ACTUAL too), and the ESI limit for persons with
 * disability is used.
 */
import {
  daysToHundredths,
  decToScaled,
  divHalfUp,
  prorate,
  roundHead,
  type Rounding,
} from './money';

/** paise × a decimal rate, half-up to the paisa (`pr_money_mul`) */
export function mulRate(paise: bigint, rate: string): bigint {
  const r = decToScaled(rate, 6);
  if (r === null) throw new RangeError(`Not a rate: '${rate}'`);
  return divHalfUp(paise * r, 1_000_000n);
}
const R = (p: bigint) => roundHead(p, 'NEAREST_1');
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

// ---- PF -------------------------------------------------------------------------------------------------
export interface PfRates {
  eeRate: string;
  erRate: string;
  epsRate: string;
  /** the pension and PF wage ceiling (₹15,000) */
  epsCeiling: bigint;
  edliRate: string;
  edliCeiling: bigint;
  adminRate: string;
}
export interface PfInput {
  /** the earned PF-wage lines of the month (arrears with PF included) */
  basket: bigint;
  basis: 'ACTUAL' | 'CEILING';
  /** the ceiling shrinks with loss of pay (the CEILING basis) */
  prorateCeiling: boolean;
  paidDays: string;
  monthDays: string;
  /** the PF settings over the month: one, or a few when a setting changes inside it (days each) */
  segments: Array<{ days: number; rates: PfRates }>;
  /** the pension applies (the profile, and the employee under the stop age) */
  eps: boolean;
  vpf: { type: 'NONE' | 'FLAT' | 'PERCENT'; value: string };
  /** a top-up of a month already paid: the PF wage already used that month */
  topUpUsed?: bigint | null;
}
export interface PfResult {
  pfWage: bigint;
  epsWage: bigint;
  edliWage: bigint;
  eePf: bigint;
  vpf: bigint;
  erEps: bigint;
  erEpf: bigint;
  edli: bigint;
  admin: bigint;
  /** each segment's figures, for the trace */
  segments: Array<{ days: number; ceiling: bigint; wage: bigint }>;
  topUpHeadroom: bigint | null;
}

export function pf(i: PfInput): PfResult {
  const monthLimit = BigInt(Math.max(1, Math.round(Number(i.monthDays))));
  const segs = i.segments.map((s) => {
    const c = s.rates.epsCeiling;
    let w = i.basket;
    let cUse = c;
    if (i.basis === 'CEILING') {
      if (i.prorateCeiling) {
        const cp = R(prorate(c, i.paidDays, i.monthDays));
        w = min(i.basket, cp);
        cUse = min(c, cp);
      } else w = min(i.basket, c);
    }
    return { days: BigInt(s.days), rates: s.rates, w, cUse };
  });
  // a month across settings: each value shared by its days; the last absorbs the remainder when equal
  const share = (v: bigint, days: bigint) =>
    segs.length === 1 ? v : divHalfUp(v * days, monthLimit);
  const same = segs.every((s) => s.w === segs[0]!.w);
  let shares = segs.map((s) => ({ ...s, ws: share(s.w, s.days) }));
  if (segs.length > 1 && same) {
    const used = shares.slice(0, -1).reduce((n, s) => n + s.ws, 0n);
    shares = shares.map((s, k) => (k === shares.length - 1 ? { ...s, ws: segs[0]!.w - used } : s));
  }
  // a top-up: on the CEILING basis only what is left of the ceiling (the legacy cut ACTUAL too)
  let headroom: bigint | null = null;
  if (i.topUpUsed !== null && i.topUpUsed !== undefined && i.basis === 'CEILING') {
    headroom = max(0n, segs[0]!.rates.epsCeiling - i.topUpUsed);
    const total = shares.reduce((n, s) => n + s.ws, 0n);
    if (total > headroom)
      shares = shares.map((s) => ({ ...s, ws: divHalfUp(s.ws * headroom!, total) }));
  }
  const pfWage = shares.reduce((n, s) => n + s.ws, 0n);
  const epsW = shares.map((s) => min(s.ws, share(s.cUse, s.days)));
  const edliW = shares.map((s) => min(s.ws, share(s.rates.edliCeiling, s.days)));
  const sum = (f: (s: (typeof shares)[number], k: number) => bigint) =>
    shares.reduce((n, s, k) => n + f(s, k), 0n);
  const eePf = R(sum((s) => mulRate(s.ws, s.rates.eeRate)));
  const erEps = i.eps ? R(sum((s, k) => mulRate(epsW[k]!, s.rates.epsRate))) : 0n;
  const erEpf = R(sum((s) => mulRate(s.ws, s.rates.erRate))) - erEps;
  const edli = R(sum((s, k) => mulRate(edliW[k]!, s.rates.edliRate)));
  const admin = R(sum((s) => mulRate(s.ws, s.rates.adminRate)));
  const vpf =
    i.vpf.type === 'FLAT'
      ? (decToScaled(i.vpf.value, 2) ?? 0n)
      : i.vpf.type === 'PERCENT'
        ? R(divHalfUp(pfWage * (decToScaled(i.vpf.value, 2) ?? 0n), 10_000n))
        : 0n;
  return {
    pfWage,
    epsWage: i.eps ? epsW.reduce((n, v) => n + v, 0n) : 0n,
    edliWage: edliW.reduce((n, v) => n + v, 0n),
    eePf,
    vpf,
    erEps,
    erEpf,
    edli,
    admin,
    segments: shares.map((s) => ({ days: Number(s.days), ceiling: s.cUse, wage: s.ws })),
    topUpHeadroom: headroom,
  };
}

/** Days PF counts as not contributory: loss of pay and the days before joining and after leaving. */
export function ncpDays(
  monthDays: string,
  lop: string,
  preJoin: string,
  postLeave: string,
): bigint {
  const m = daysToHundredths(monthDays);
  const n = daysToHundredths(lop) + daysToHundredths(preJoin) + daysToHundredths(postLeave);
  return min(m, n);
}

/** Age in whole years on a day (the EPS stop age is reached in the month of the birthday). */
export function ageOn(dob: string, day: string): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const [Y, M, D] = day.split('-').map(Number) as [number, number, number];
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

// ---- NPS ----------------------------------------------------------------------------------------------
export function nps(
  wage: bigint,
  eeRate: string,
  erRate: string,
  rounding: Rounding = 'NEAREST_1',
) {
  return {
    wage,
    ee: roundHead(mulRate(wage, eeRate), rounding),
    er: roundHead(mulRate(wage, erRate), rounding),
  };
}

// ---- ESI ----------------------------------------------------------------------------------------------
/** The contribution period a month is in: April–September from 1 April, October–March from 1 October. */
export function esiPeriodStart(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m >= 4 && m <= 9) return `${String(y)}-04-01`;
  return `${String(m >= 10 ? y : y - 1)}-10-01`;
}
/** Covered for the whole period when the first month's ESI wage is within the limit (the higher one for PwD). */
export function esiCoveredAt(
  wage: bigint,
  limit: bigint,
  pwdLimit: bigint | null,
  pwd: boolean,
): boolean {
  const lim = pwd && pwdLimit !== null && pwdLimit > limit ? pwdLimit : limit;
  return lim > 0n && wage > 0n && wage <= lim;
}
export function esi(wage: bigint, eeRate: string, erRate: string, rounding: Rounding = 'CEIL_1') {
  return {
    wage,
    ee: roundHead(mulRate(wage, eeRate), rounding),
    // the employer's share, for the ESI statement (always up to the rupee)
    er: roundHead(mulRate(wage, erRate), 'CEIL_1'),
  };
}

// ---- profession tax ------------------------------------------------------------------------------------
export interface PtSlab {
  gender: 'M' | 'F' | 'ANY';
  from: bigint;
  to: bigint | null;
  amount: bigint;
  /** a month's own amount: { "2": 30000 } (February) */
  overrides?: Record<string, bigint> | null;
}
/** The month's profession tax on the PT wage: the slab of the gender (an exact gender before ANY), inclusive. */
export function professionTax(
  wage: bigint,
  gender: 'M' | 'F',
  month: string,
  slabs: readonly PtSlab[],
) {
  const fits = (s: PtSlab) => s.from <= wage && (s.to === null || wage <= s.to);
  const slab =
    slabs.find((s) => s.gender === gender && fits(s)) ??
    slabs.find((s) => s.gender === 'ANY' && fits(s));
  if (!slab) return { amount: 0n, slab: null };
  const m = String(Number(month.slice(5, 7)));
  const over = slab.overrides?.[m];
  return { amount: over ?? slab.amount, slab };
}

// ---- labour welfare fund -------------------------------------------------------------------------------
export interface LwfRule {
  eeRate: string | null;
  eeCap: bigint | null;
  eeFlat: bigint | null;
  erFlat: bigint | null;
  erMultiplier: string | null;
  frequency: 'monthly' | 'half_yearly';
  months: number[];
}
/** The month's LWF: nothing when not due; a flat amount, or a rate of gross capped; the employer's share. */
export function lwf(gross: bigint, month: string, rule: LwfRule) {
  const m = Number(month.slice(5, 7));
  if (rule.frequency !== 'monthly' && !rule.months.includes(m))
    return { due: false, ee: 0n, er: 0n };
  let ee = rule.eeFlat ?? (rule.eeRate ? R(mulRate(gross, rule.eeRate)) : 0n);
  if (rule.eeFlat === null && rule.eeCap !== null && ee > rule.eeCap) ee = rule.eeCap;
  const er = rule.erFlat ?? (ee > 0n && rule.erMultiplier ? R(mulRate(ee, rule.erMultiplier)) : 0n);
  return { due: true, ee, er };
}
