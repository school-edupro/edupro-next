/**
 * What an employee's declarations take off the year's income (docs/design/86, phase D): the HRA exemption (the least
 * of three), each section's deduction within its cap — and a cap several sections share —, only what the employee's
 * regime allows. Pure: the API reads the declared (or, after the proof window, the verified) amounts and the year's
 * section caps; this decides what counts. Money in paise.
 */
import { mulRate } from './statutory';

/**
 * HRA exempt for the year: the least of the HRA received, the rent paid less a tenth of the salary (basic and DA),
 * and half the salary in one of the listed cities (two fifths elsewhere). Nothing without rent.
 */
export function hraExemption(p: {
  hraReceived: bigint;
  /** basic and DA of the same months */
  salary: bigint;
  rentPaid: bigint;
  /** the rent is paid in one of the year's listed cities (the 50 % rate) */
  listedCity: boolean;
}): bigint {
  if (p.rentPaid <= 0n || p.hraReceived <= 0n) return 0n;
  const overTenth = p.rentPaid - mulRate(p.salary, '0.10');
  const share = mulRate(p.salary, p.listedCity ? '0.50' : '0.40');
  const least = [p.hraReceived, overTenth, share].reduce((a, b) => (b < a ? b : a));
  return least > 0n ? least : 0n;
}

export interface DeclaredLine {
  /** the section's line code (CHAPVIA_80C, HOME_LOAN_INT …) */
  code: string;
  amount: bigint;
  /** the section's own cap (none: the whole amount) */
  cap: bigint | null;
  appliesTo: 'OLD' | 'NEW' | 'BOTH';
  /** sections that share one cap (80C, 80CCC and 80CCD(1) share ₹1.5 lakh): the group's code */
  group?: string | null;
}
export interface AllowedLine {
  code: string;
  declared: bigint;
  allowed: bigint;
  /** why less than declared: 'cap', 'group' (the shared cap) or 'regime' */
  cut: 'cap' | 'group' | 'regime' | null;
}

/**
 * Each line within its cap and its regime, then each shared cap across its lines (in the order given: the first
 * lines keep theirs). Negative amounts count as nothing.
 */
export function allowedDeductions(
  regime: 'OLD' | 'NEW',
  lines: readonly DeclaredLine[],
  groupCaps: Readonly<Record<string, bigint>> = {},
): { lines: AllowedLine[]; total: bigint } {
  const used: Record<string, bigint> = {};
  const out: AllowedLine[] = [];
  for (const l of lines) {
    const declared = l.amount > 0n ? l.amount : 0n;
    if (l.appliesTo !== 'BOTH' && l.appliesTo !== regime) {
      out.push({ code: l.code, declared, allowed: 0n, cut: declared ? 'regime' : null });
      continue;
    }
    let allowed = l.cap !== null && declared > l.cap ? l.cap : declared;
    let cut: AllowedLine['cut'] = allowed < declared ? 'cap' : null;
    const g = l.group ?? null;
    if (g && groupCaps[g] !== undefined) {
      const room = groupCaps[g] - (used[g] ?? 0n);
      if (allowed > room) {
        allowed = room > 0n ? room : 0n;
        cut = 'group';
      }
      used[g] = (used[g] ?? 0n) + allowed;
    }
    out.push({ code: l.code, declared, allowed, cut });
  }
  return { lines: out, total: out.reduce((s, l) => s + l.allowed, 0n) };
}

/**
 * The loss from a self-occupied house (housing-loan interest) set against salary: the old regime only, within its
 * cap; the new regime allows none.
 */
export function houseLoss(regime: 'OLD' | 'NEW', interest: bigint, cap: bigint): bigint {
  if (regime === 'NEW' || interest <= 0n) return 0n;
  return interest > cap ? cap : interest;
}
