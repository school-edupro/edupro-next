/**
 * Reading the numbers typed on the payroll rate forms (docs/design/86): what a person types — 62%, 60 %, .6, 1,50,000,
 * ₹1500 — as the decimal string the API takes, or a message naming the field when it is not a number.
 */

/** The labels the forms show, to name a field a value was refused for. */
export const FIELD_LABELS: Record<string, string> = {
  rateValue: 'Value',
  eeRate: 'Employee share (%)',
  erRate: 'Employer share (%)',
  epsRate: 'Pension (EPS) (%)',
  edliRate: 'EDLI (%)',
  adminRate: 'Admin charges (%)',
  epsWageCeiling: 'EPS wage ceiling (₹)',
  edliWageCeiling: 'EDLI wage ceiling (₹)',
  edliMin: 'EDLI at least (₹ a month)',
  adminMin: 'Admin at least (₹ a month)',
  wageLimit: 'Wage limit (₹ a month)',
  wageLimitPwd: 'Limit for persons with disability (₹)',
  wageFrom: 'Monthly wage from (₹)',
  wageTo: 'up to (₹)',
  monthlyAmount: 'Tax a month (₹)',
  eeCap: 'Employee at most (₹)',
  eeFlat: 'Or a flat employee amount (₹)',
  erFlat: 'Employer flat amount (₹)',
  erMultiplier: 'Or the employer pays (× the employee)',
  dailyAmount: 'A day (₹)',
  hourlyAmount: 'An hour (₹)',
};

const NUMERIC = /^\d+(\.\d+)?$/;
/** spaces, ₹ / Rs and the commas of 1,50,000 dropped; .5 read as 0.5 */
const plain = (v: string) => {
  const s = v.replace(/[\s,₹]/g, '').replace(/^rs\.?/i, '');
  return s.startsWith('.') ? `0${s}` : s;
};
/** a decimal string with at most 6 places and no trailing zeros (0.0325, not 0.032500000000000001) */
const six = (n: number) => String(Number(n.toFixed(6)));

export type ConfigValue = { ok: true; value: string } | { ok: false; message: string };

/**
 * One field of a rate form. A field named …Rate is typed as a per cent (12 → 0.12; a % sign may be typed). The rate
 * registry's Value is a decimal (0.62) or an amount (1500) as typed, or a per cent when it ends in % (62% → 0.62).
 * Codes are upper-cased; fields that are not numbers pass as typed.
 */
export function configValue(field: string, typed: string): ConfigValue {
  const v = typed.trim();
  if (field === 'stateCode' || field === 'rateCode') return { ok: true, value: v.toUpperCase() };
  if (!FIELD_LABELS[field]) return { ok: true, value: v };
  const no = (example: string): ConfigValue => ({
    ok: false,
    message: `${FIELD_LABELS[field]!}: “${v.slice(0, 30)}” is not a number — ${example}`,
  });
  const s = plain(v);
  if (field.endsWith('Rate')) {
    const n = s.replace(/%$/, '');
    return NUMERIC.test(n)
      ? { ok: true, value: six(Number(n) / 100) }
      : no('type a per cent such as 12 or 0.75');
  }
  if (field === 'rateValue') {
    const pct = s.endsWith('%');
    const n = pct ? s.slice(0, -1) : s;
    if (!NUMERIC.test(n)) return no('type a rate as 0.62 or 62%, or an amount such as 1500');
    return { ok: true, value: pct ? six(Number(n) / 100) : n.includes('.') ? six(Number(n)) : n };
  }
  return NUMERIC.test(s) ? { ok: true, value: s } : no('type an amount such as 15000');
}
