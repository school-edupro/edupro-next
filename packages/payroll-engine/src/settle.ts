/**
 * Settlements and revisions (docs/design/86, phase E): the length of service, gratuity (the Payment of Gratuity Act
 * and the Code on Social Security, 2020 — 15 days' wages a year of service, a part year above six months counted;
 * eligible after five years, a fixed-term employee after one, on death or disablement at once; capped), its tax-free
 * part, leave encashed at exit and its tax-free part, the notice-period shortfall, and a revision's arrears for a
 * month. Money in paise; every limit comes from the caller (the school's dated rates), none is fixed here.
 */
import { divHalfUp } from './money';

/** Completed years, months and days of service from the first day to the last (both counted). */
export function serviceLength(
  from: string,
  to: string,
): { years: number; months: number; days: number; totalDays: number } {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  b.setUTCDate(b.getUTCDate() + 1); // the last day counts
  if (b <= a) return { years: 0, months: 0, days: 0, totalDays: 0 };
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  let months = b.getUTCMonth() - a.getUTCMonth();
  let days = b.getUTCDate() - a.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalDays = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return { years, months, days, totalDays };
}

export interface GratuityRule {
  /** years of service before gratuity is due (5; a fixed-term employee 1) */
  minYears: number;
  /** days' wages for a year of service (15) and the month's working days they are counted on (26) */
  daysPerYear: number;
  divisor: number;
  /** the most gratuity paid (₹20 lakh), and the most of it free of tax */
  cap: bigint;
  taxFreeCap: bigint;
}
export interface Gratuity {
  eligible: boolean;
  why: string | null;
  /** years counted: completed years, and the part year when above six months */
  years: number;
  amount: bigint;
  capped: boolean;
  taxFree: bigint;
  taxable: bigint;
}

/**
 * Gratuity on leaving: the last month's wages (basic and DA, or the labour-code wages) × days a year ÷ the divisor ×
 * the years counted; nothing before the minimum service unless the employee died or was disabled.
 */
export function gratuity(p: {
  monthlyWage: bigint;
  from: string;
  to: string;
  rule: GratuityRule;
  /** death or disablement: due whatever the service */
  anyService?: boolean;
}): Gratuity {
  const s = serviceLength(p.from, p.to);
  const part = s.months > 6 || (s.months === 6 && s.days > 0) ? 1 : 0;
  const years = s.years + part;
  const eligible = !!p.anyService || s.years >= p.rule.minYears;
  if (!eligible)
    return {
      eligible,
      why: `${String(s.years)} year(s) of service, below ${String(p.rule.minYears)}`,
      years,
      amount: 0n,
      capped: false,
      taxFree: 0n,
      taxable: 0n,
    };
  const raw = divHalfUp(
    p.monthlyWage * BigInt(p.rule.daysPerYear) * BigInt(years),
    BigInt(p.rule.divisor),
  );
  const amount = raw > p.rule.cap ? p.rule.cap : raw;
  const taxFree = amount < p.rule.taxFreeCap ? amount : p.rule.taxFreeCap;
  return {
    eligible,
    why: null,
    years,
    amount,
    capped: raw > p.rule.cap,
    taxFree,
    taxable: amount - taxFree,
  };
}

/** Leave encashed at exit: the days at the day's wage (the month's wages ÷ the divisor, 30 by default). */
export function leaveEncashment(days: number, monthlyWage: bigint, divisor = 30): bigint {
  if (days <= 0) return 0n;
  // days may be halves: work in half-days
  const halves = BigInt(Math.round(days * 2));
  return divHalfUp(monthlyWage * halves, BigInt(divisor) * 2n);
}

/**
 * The tax-free part of leave encashed at retirement or resignation (non-government): the least of the amount, the
 * limit left (the cap less what earlier years exempted), ten months' average salary, and the leave at credit (at most
 * 30 days a completed year of service) at the average salary.
 */
export function leaveEncashmentTaxFree(p: {
  amount: bigint;
  /** the average monthly salary of the last ten months */
  averageMonthly: bigint;
  leaveDays: number;
  completedYears: number;
  cap: bigint;
  earlierExempt?: bigint;
}): bigint {
  const limitLeft = p.cap - (p.earlierExempt ?? 0n);
  const days = Math.min(p.leaveDays, 30 * p.completedYears);
  const credit = divHalfUp(p.averageMonthly * BigInt(Math.round(days * 2)), 60n);
  const least = [p.amount, limitLeft, p.averageMonthly * 10n, credit].reduce((a, b) =>
    b < a ? b : a,
  );
  return least > 0n ? least : 0n;
}

/** What a short notice costs the employee: the days short at the day's wage. */
export function noticeShortfall(p: {
  noticeDays: number;
  servedDays: number;
  monthlyWage: bigint;
  divisor?: number;
}): { days: number; amount: bigint } {
  const days = Math.max(0, p.noticeDays - p.servedDays);
  return {
    days,
    amount: days ? divHalfUp(p.monthlyWage * BigInt(days), BigInt(p.divisor ?? 30)) : 0n,
  };
}

/**
 * A revision's arrear for one past month: each head's new month less what was paid, the new month prorated by the paid
 * days as the old one was. Heads only in one side count from nothing.
 */
export function monthArrears(p: {
  paid: Readonly<Record<string, bigint>>;
  /** the head's month at full attendance after the revision */
  revisedRates: Readonly<Record<string, bigint>>;
  paidDays: number;
  monthDays: number;
}): Array<{ code: string; paid: bigint; due: bigint; arrear: bigint }> {
  const codes = [...new Set([...Object.keys(p.paid), ...Object.keys(p.revisedRates)])].sort();
  const half = BigInt(Math.round(p.paidDays * 2));
  const out: Array<{ code: string; paid: bigint; due: bigint; arrear: bigint }> = [];
  for (const code of codes) {
    const rate = p.revisedRates[code] ?? 0n;
    const due = p.monthDays > 0 ? divHalfUp(rate * half, BigInt(p.monthDays) * 2n) : 0n;
    const paid = p.paid[code] ?? 0n;
    if (due !== paid) out.push({ code, paid, due, arrear: due - paid });
  }
  return out;
}
