/**
 * Loans and advances (`pr_loan_schedule`, the run's loan step): a month's interest — none, flat on the
 * principal, or reducing on what is owed (a year's per cent ÷ 1200) — the instalment capped at what is owed
 * plus interest, interest first, the rest off the balance. Money in paise. The balance is the principal still
 * owed; the interest is never added to it.
 */
import { decToScaled, divHalfUp } from './money';

export type InterestMethod = 'NONE' | 'FLAT' | 'REDUCING';

export interface LoanTerms {
  principal: bigint;
  /** the monthly instalment */
  emi: bigint;
  /** a year's per cent as a decimal string ('9.5') */
  rate: string;
  method: InterestMethod;
}

export interface LoanMonth {
  opening: bigint;
  interest: bigint;
  /** what is deducted this month */
  emi: bigint;
  principalPart: bigint;
  closing: bigint;
}

/** The longest schedule the legacy allows (50 years of months). */
export const LOAN_MAX_MONTHS = 600;

/** A month's interest on a loan (paise, half-up). */
export function loanInterest(t: LoanTerms, balance: bigint): bigint {
  if (t.method === 'NONE') return 0n;
  const rate = decToScaled(t.rate, 6);
  if (rate === null || rate <= 0n) throw new RangeError(`Not an interest rate: '${t.rate}'`);
  const base = t.method === 'FLAT' ? t.principal : balance;
  return divHalfUp(base * rate, 1200n * 1_000_000n);
}

/** One month of a loan from its balance: interest first, the instalment capped at what is owed. */
export function loanMonth(t: LoanTerms, balance: bigint): LoanMonth {
  const interest = loanInterest(t, balance);
  const emi = t.emi < balance + interest ? t.emi : balance + interest;
  const principalPart = emi - interest;
  return { opening: balance, interest, emi, principalPart, closing: balance - principalPart };
}

export type ScheduleResult =
  { ok: true; months: LoanMonth[]; totalInterest: bigint } | { ok: false; error: string };

/** The whole schedule from a balance (the principal for a new loan); refused when it never ends. */
export function loanSchedule(t: LoanTerms, balance: bigint = t.principal): ScheduleResult {
  if (t.principal <= 0n || t.emi <= 0n)
    return { ok: false, error: 'The amount and the instalment must be more than 0' };
  const first = loanInterest(t, balance);
  if (t.emi <= first)
    return {
      ok: false,
      error: 'The instalment does not cover the month’s interest: the loan would never be repaid',
    };
  const months: LoanMonth[] = [];
  let total = 0n;
  let bal = balance;
  while (bal > 0n) {
    if (months.length >= LOAN_MAX_MONTHS)
      return { ok: false, error: `It would take more than ${String(LOAN_MAX_MONTHS)} months` };
    const m = loanMonth(t, bal);
    months.push(m);
    total += m.interest;
    bal = m.closing;
  }
  return { ok: true, months, totalInterest: total };
}
