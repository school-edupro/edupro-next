import { describe, expect, it } from 'vitest';
import {
  codeWages,
  gratuity,
  leaveEncashment,
  leaveEncashmentTaxFree,
  monthArrears,
  noticeShortfall,
  serviceLength,
} from '../src/settle';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));
const RULE = { minYears: 5, daysPerYear: 15, divisor: 26, cap: R(2000000), taxFreeCap: R(2000000) };

describe('serviceLength', () => {
  it('counts both days, borrowing days and months', () => {
    expect(serviceLength('2020-04-01', '2025-03-31')).toEqual({
      years: 5,
      months: 0,
      days: 0,
      totalDays: 1826,
    });
    expect(serviceLength('2020-04-15', '2025-03-10')).toMatchObject({
      years: 4,
      months: 10,
      days: 24,
    });
    expect(serviceLength('2020-06-01', '2020-06-30')).toMatchObject({
      years: 0,
      months: 1,
      days: 0,
    });
  });
  it('a last day before the first is no service', () => {
    expect(serviceLength('2025-01-10', '2025-01-01')).toEqual({
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
    });
  });
});

describe('gratuity', () => {
  it('15/26 of the last month’s wages a year; a part year above six months counts', () => {
    // 10 years 7 months: 11 years × 52,000 × 15 / 26 = 3,30,000
    const g = gratuity({ monthlyWage: R(52000), from: '2015-01-01', to: '2025-07-31', rule: RULE });
    expect(g).toMatchObject({
      eligible: true,
      years: 11,
      amount: R(330000),
      capped: false,
      taxable: 0n,
    });
    // exactly six months over is not counted; six months and a day is
    expect(
      gratuity({ monthlyWage: R(26000), from: '2015-01-01', to: '2020-06-30', rule: RULE }).years,
    ).toBe(5);
    expect(
      gratuity({ monthlyWage: R(26000), from: '2015-01-01', to: '2020-07-01', rule: RULE }).years,
    ).toBe(6);
  });
  it('nothing below the minimum service, unless the employee died or was disabled', () => {
    const short = gratuity({
      monthlyWage: R(26000),
      from: '2022-01-01',
      to: '2025-12-31',
      rule: RULE,
    });
    expect(short).toMatchObject({ eligible: false, amount: 0n });
    expect(short.why).toContain('below 5');
    expect(
      gratuity({
        monthlyWage: R(26000),
        from: '2022-01-01',
        to: '2025-12-31',
        rule: RULE,
        anyService: true,
      }).amount,
    ).toBe(R(60000));
    // a fixed-term employee after one year
    expect(
      gratuity({
        monthlyWage: R(26000),
        from: '2025-01-01',
        to: '2025-12-31',
        rule: { ...RULE, minYears: 1 },
      }).amount,
    ).toBe(R(15000));
  });
  it('the cap, and the taxable part above the tax-free limit', () => {
    const g = gratuity({
      monthlyWage: R(400000),
      from: '1995-01-01',
      to: '2025-12-31',
      rule: { ...RULE, taxFreeCap: R(1500000) },
    });
    expect(g).toMatchObject({
      capped: true,
      amount: R(2000000),
      taxFree: R(1500000),
      taxable: R(500000),
    });
  });
});

describe('leave encashment', () => {
  it('the days at the day’s wage, halves too', () => {
    expect(leaveEncashment(30, R(60000))).toBe(R(60000));
    expect(leaveEncashment(10.5, R(30000))).toBe(R(10500));
    expect(leaveEncashment(13, R(26000), 26)).toBe(R(13000));
    expect(leaveEncashment(0, R(30000))).toBe(0n);
  });
  it('the tax-free part is the least of four', () => {
    const base = { averageMonthly: R(60000), completedYears: 20, cap: R(2500000) };
    // the leave at credit at the average: 240 days → 4,80,000
    expect(leaveEncashmentTaxFree({ ...base, amount: R(600000), leaveDays: 240 })).toBe(R(480000));
    // the amount itself
    expect(leaveEncashmentTaxFree({ ...base, amount: R(100000), leaveDays: 240 })).toBe(R(100000));
    // ten months' average
    expect(leaveEncashmentTaxFree({ ...base, amount: R(900000), leaveDays: 400 })).toBe(R(600000));
    // 30 days a completed year at most
    expect(
      leaveEncashmentTaxFree({ ...base, completedYears: 3, amount: R(900000), leaveDays: 400 }),
    ).toBe(R(180000));
    // what is left of the cap after earlier years
    expect(
      leaveEncashmentTaxFree({
        ...base,
        amount: R(900000),
        leaveDays: 400,
        earlierExempt: R(2450000),
      }),
    ).toBe(R(50000));
    // nothing left
    expect(
      leaveEncashmentTaxFree({
        ...base,
        amount: R(900000),
        leaveDays: 400,
        earlierExempt: R(2600000),
      }),
    ).toBe(0n);
  });
});

describe('noticeShortfall', () => {
  it('the days short at the day’s wage', () => {
    expect(noticeShortfall({ noticeDays: 90, servedDays: 60, monthlyWage: R(30000) })).toEqual({
      days: 30,
      amount: R(30000),
    });
    expect(
      noticeShortfall({ noticeDays: 30, servedDays: 45, monthlyWage: R(30000), divisor: 26 }),
    ).toEqual({
      days: 0,
      amount: 0n,
    });
  });
});

describe('monthArrears', () => {
  it('each head’s new month less what was paid, prorated as paid', () => {
    const r = monthArrears({
      paid: { BASIC: R(50000), DA: R(25000), HRA: R(15000) },
      revisedRates: { BASIC: R(52000), DA: R(28600), TA: R(3600) },
      paidDays: 30,
      monthDays: 30,
    });
    expect(r).toEqual([
      { code: 'BASIC', paid: R(50000), due: R(52000), arrear: R(2000) },
      { code: 'DA', paid: R(25000), due: R(28600), arrear: R(3600) },
      { code: 'HRA', paid: R(15000), due: 0n, arrear: -R(15000) },
      { code: 'TA', paid: 0n, due: R(3600), arrear: R(3600) },
    ]);
    // half a month paid: half the new month is due
    expect(
      monthArrears({
        paid: { BASIC: R(25000) },
        revisedRates: { BASIC: R(52000) },
        paidDays: 15,
        monthDays: 30,
      }),
    ).toEqual([{ code: 'BASIC', paid: R(25000), due: R(26000), arrear: R(1000) }]);
    // nothing changed, or no days
    expect(
      monthArrears({
        paid: { BASIC: R(1) },
        revisedRates: { BASIC: R(1) },
        paidDays: 30,
        monthDays: 30,
      }),
    ).toEqual([]);
    expect(
      monthArrears({ paid: {}, revisedRates: { BASIC: R(1) }, paidDays: 0, monthDays: 0 }),
    ).toEqual([]);
  });
});

describe('codeWages', () => {
  it('the wage heads, or half of the pay when the allowances are more than half', () => {
    expect(codeWages(R(30000), R(50000))).toBe(R(30000));
    expect(codeWages(R(10000), R(50000))).toBe(R(25000));
    // the half rounded up to the paisa
    expect(codeWages(0n, 3n)).toBe(2n);
  });
});
