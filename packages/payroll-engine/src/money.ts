/**
 * Money in whole paise (and, inside formulas, micro-rupees), as the legacy payroll keeps it
 * (`payroll_lib.php`, "owner directive #1"): never floating point, every rounding half-up away from zero,
 * FLOOR / CEIL mathematical (toward −∞ / +∞, so CEIL on a negative amount moves toward zero).
 */

export const PAISE_PER_RUPEE = 100n;
export const MICRO_PER_RUPEE = 1_000_000n;
export const MICRO_PER_PAISE = 10_000n;
/** The engine's operand ceiling: ₹92,00,000 in micro-rupees (a number or a divisor beyond it is refused). */
export const MICRO_LIMIT = 9_200_000_000_000n;

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Integer division rounding half-up away from zero (125 / 10 → 13, −125 / 10 → −13, 124 / 10 → 12). */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('divHalfUp: the denominator must be positive');
  const q = num / den; // truncates toward zero
  const r = num % den;
  if (r === 0n) return q;
  return abs(r) * 2n >= den ? q + (num < 0n ? -1n : 1n) : q;
}

/** Floor toward −∞ to a multiple of `unit` (> 0). */
export function floorTo(n: bigint, unit: bigint): bigint {
  const q = n / unit;
  return (n % unit !== 0n && n < 0n ? q - 1n : q) * unit;
}

/** Ceil toward +∞ to a multiple of `unit` (> 0). */
export function ceilTo(n: bigint, unit: bigint): bigint {
  const q = n / unit;
  return (n % unit !== 0n && n > 0n ? q + 1n : q) * unit;
}

/**
 * A decimal string at a fixed scale ('0.58' at 6 → 580000n; '52000' at 2 → 5200000n). Null when malformed,
 * when digits beyond the scale are not zeros (real precision would be lost), or when the integer part is
 * longer than 18 − scale digits.
 */
export function decToScaled(dec: string, scale: number): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(dec.trim());
  if (!m) return null;
  let frac = m[3] ?? '';
  if (frac.length > scale) {
    if (/[^0]/.test(frac.slice(scale))) return null;
    frac = frac.slice(0, scale);
  }
  if (m[2]!.length > 18 - scale) return null;
  const val = BigInt(m[2]!) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, '0') || '0');
  return m[1] === '-' ? -val : val;
}

/** Rupees as a decimal string → paise ('1234.50' → 123450n); null when malformed or below a paisa. */
export const toPaise = (rupees: string) => decToScaled(rupees, 2);

/** Paise → a plain decimal string ('30160.00', '-99.05'). */
export function paiseToString(paise: bigint): string {
  const sign = paise < 0n ? '-' : '';
  const p = abs(paise);
  return `${sign}${(p / 100n).toString()}.${(p % 100n).toString().padStart(2, '0')}`;
}

/** The one paise rounding of a formula's result (micro-rupees → paise, half-up). */
export const microToPaise = (micro: bigint) => divHalfUp(micro, MICRO_PER_PAISE);

/** Paise → micro-rupees, exact. */
export const paiseToMicro = (paise: bigint) => paise * MICRO_PER_PAISE;

/** A pay head's rounding rule (`payroll_pay_head_version.Rounding`). */
export const ROUNDING = [
  'NONE',
  'NEAREST_1',
  'FLOOR_1',
  'CEIL_1',
  'NEAREST_10',
  'NEAREST_100',
  'CEIL_100',
] as const;
export type Rounding = (typeof ROUNDING)[number];

/**
 * A head's rounding, applied after the formula's single paise rounding (₹30160.50 NEAREST_1 → ₹30161;
 * ₹53560 CEIL_100 → ₹53600).
 */
export function roundHead(paise: bigint, rule: Rounding): bigint {
  switch (rule) {
    case 'NONE':
      return paise;
    case 'NEAREST_1':
      return divHalfUp(paise, 100n) * 100n;
    case 'FLOOR_1':
      return floorTo(paise, 100n);
    case 'CEIL_1':
      return ceilTo(paise, 100n);
    case 'NEAREST_10':
      return divHalfUp(paise, 1000n) * 1000n;
    case 'NEAREST_100':
      return divHalfUp(paise, 10_000n) * 10_000n;
    case 'CEIL_100':
      return ceilTo(paise, 10_000n);
  }
}

/**
 * Days in hundredths (29.5 → 2950n): the legacy rounds a day count to two places before proration.
 * A string keeps it exact; a number is rounded half-up to the hundredth.
 */
export function daysToHundredths(days: string | number): bigint {
  if (typeof days === 'number') return BigInt(Math.round(days * 100));
  const scaled = decToScaled(days, 2);
  if (scaled === null) throw new RangeError(`Not a number of days: '${days}'`);
  return scaled;
}

/**
 * Pay for the days paid (`pr_prorate_paise`): rate × paid days ÷ month days, half-up, exact; zero when
 * either count is zero or less.
 */
export function prorate(
  ratePaise: bigint,
  paidDays: string | number,
  monthDays: string | number,
): bigint {
  const paid = daysToHundredths(paidDays);
  const month = daysToHundredths(monthDays);
  if (month <= 0n || paid <= 0n) return 0n;
  return divHalfUp(ratePaise * paid, month);
}
