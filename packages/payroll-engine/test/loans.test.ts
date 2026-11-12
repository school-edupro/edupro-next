import { describe, expect, it } from 'vitest';
import { LOAN_MAX_MONTHS, loanInterest, loanMonth, loanSchedule } from '../src/loans';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));

describe('loanInterest', () => {
  it('none, flat on the principal, reducing on the balance', () => {
    const t = { principal: R(12000), emi: R(1000), rate: '12', method: 'NONE' as const };
    expect(loanInterest(t, R(6000))).toBe(0n);
    expect(loanInterest({ ...t, method: 'FLAT' }, R(6000))).toBe(R(120));
    expect(loanInterest({ ...t, method: 'REDUCING' }, R(6000))).toBe(R(60));
    // half-up to the paisa: 10,000 × 9.5 % ÷ 12 = 79.1666…
    expect(loanInterest({ ...t, rate: '9.5', method: 'REDUCING' }, R(10000))).toBe(7917n);
  });

  it('refuses a rate that is not one', () => {
    const t = { principal: R(1000), emi: R(100), rate: 'x', method: 'FLAT' as const };
    expect(() => loanInterest(t, R(1000))).toThrow("Not an interest rate: 'x'");
    expect(() => loanInterest({ ...t, rate: '0' }, R(1000))).toThrow(RangeError);
  });
});

describe('loanMonth', () => {
  it('takes interest first and caps the instalment at what is owed', () => {
    const t = { principal: R(10000), emi: R(1500), rate: '12', method: 'REDUCING' as const };
    expect(loanMonth(t, R(10000))).toEqual({
      opening: R(10000),
      interest: R(100),
      emi: R(1500),
      principalPart: R(1400),
      closing: R(8600),
    });
    const last = loanMonth(t, R(500));
    expect(last).toEqual({
      opening: R(500),
      interest: R(5),
      emi: R(505),
      principalPart: R(500),
      closing: 0n,
    });
  });
});

describe('loanSchedule', () => {
  it('an advance without interest', () => {
    const s = loanSchedule({ principal: R(5000), emi: R(2000), rate: '0', method: 'NONE' });
    expect(s.ok && s.months.map((m) => m.emi)).toEqual([R(2000), R(2000), R(1000)]);
    expect(s.ok && s.totalInterest).toBe(0n);
  });

  it('a flat-interest loan from a balance part paid', () => {
    const s = loanSchedule(
      { principal: R(12000), emi: R(1120), rate: '12', method: 'FLAT' },
      R(3000),
    );
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.months).toHaveLength(3);
      expect(s.months[0]).toMatchObject({ interest: R(120), principalPart: R(1000) });
      expect(s.totalInterest).toBe(R(360));
    }
  });

  it('refuses what never ends', () => {
    expect(loanSchedule({ principal: 0n, emi: R(10), rate: '0', method: 'NONE' })).toEqual({
      ok: false,
      error: 'The amount and the instalment must be more than 0',
    });
    expect(loanSchedule({ principal: R(100), emi: 0n, rate: '0', method: 'NONE' }).ok).toBe(false);
    expect(
      loanSchedule({ principal: R(100000), emi: R(1000), rate: '12', method: 'FLAT' }),
    ).toEqual({
      ok: false,
      error: 'The instalment does not cover the month’s interest: the loan would never be repaid',
    });
    const long = loanSchedule({ principal: R(100000), emi: R(100), rate: '0', method: 'NONE' });
    expect(long).toEqual({
      ok: false,
      error: `It would take more than ${String(LOAN_MAX_MONTHS)} months`,
    });
  });
});
