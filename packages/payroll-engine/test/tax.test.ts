import { describe, expect, it } from 'vitest';
import {
  annualTax,
  monthsLeftInYear,
  projectTax,
  slabTax,
  topUpTax,
  type TaxRules,
} from '../src/tax';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));
const NEW: TaxRules = {
  slabs: [
    { from: 0n, to: R(400000), rate: '0' },
    { from: R(400000), to: R(800000), rate: '0.05' },
    { from: R(800000), to: R(1200000), rate: '0.10' },
    { from: R(1200000), to: R(1600000), rate: '0.15' },
    { from: R(1600000), to: R(2000000), rate: '0.20' },
    { from: R(2000000), to: R(2400000), rate: '0.25' },
    { from: R(2400000), to: null, rate: '0.30' },
  ],
  standardDeduction: R(75000),
  rebateLimit: R(1200000),
  rebateMax: R(60000),
  marginalRelief: true,
  cessRate: '0.04',
  panAbsentRate: '0.20',
  surcharges: [
    { from: R(5000000), rate: '0.10' },
    { from: R(10000000), rate: '0.15' },
    { from: R(20000000), rate: '0.25' },
  ],
};
const OLD: TaxRules = {
  ...NEW,
  slabs: [
    { from: 0n, to: R(250000), rate: '0' },
    { from: R(250000), to: R(500000), rate: '0.05' },
    { from: R(500000), to: R(1000000), rate: '0.20' },
    { from: R(1000000), to: null, rate: '0.30' },
  ],
  standardDeduction: R(50000),
  rebateLimit: R(500000),
  rebateMax: R(12500),
  marginalRelief: false,
};

describe('slabTax', () => {
  it('each slab taxes the income between its bounds', () => {
    expect(slabTax(R(300000), NEW.slabs)).toBe(0n);
    expect(slabTax(R(1000000), NEW.slabs)).toBe(R(40000));
    expect(slabTax(R(3000000), NEW.slabs)).toBe(R(480000));
  });
});

describe('annualTax', () => {
  it('nothing up to ₹12 lakh in the new regime (the rebate)', () => {
    expect(annualTax(R(1200000), NEW, true)).toMatchObject({
      slabTax: R(60000),
      rebate: R(60000),
      total: 0n,
    });
  });
  it('marginal relief just above the limit', () => {
    const t = annualTax(R(1210000), NEW, true);
    expect(t.slabTax).toBe(R(61500));
    expect(t.rebate).toBe(R(51500));
    // ₹10,000 above the limit: ₹10,000 tax + 4 % cess
    expect(t.total).toBe(R(10400));
  });
  it('no relief once the tax is below the income above the limit', () => {
    expect(annualTax(R(1500000), NEW, true)).toMatchObject({ rebate: 0n, total: R(109200) });
  });
  it('the old regime: rebate within ₹5 lakh, none beyond and no marginal relief', () => {
    expect(annualTax(R(500000), OLD, true).total).toBe(0n);
    expect(annualTax(R(510000), OLD, true)).toMatchObject({ rebate: 0n, total: R(15080) });
    // a rebate larger than the tax: the tax only
    expect(annualTax(R(300000), OLD, true)).toMatchObject({ slabTax: R(2500), rebate: R(2500) });
  });
  it('the surcharge, with marginal relief at its threshold', () => {
    const just = annualTax(R(5010000), NEW, true);
    // ₹10,000 above ₹50 lakh costs at most ₹10,000 more than the tax at ₹50 lakh
    expect(just.surcharge).toBe(R(10000) - (just.slabTax - slabTax(R(5000000), NEW.slabs)));
    const high = annualTax(R(6000000), NEW, true);
    expect(high.surcharge).toBe(R(138000));
    const higher = annualTax(R(10050000), NEW, true);
    // the next band's relief counts the lower band's surcharge at its threshold
    expect(higher.surcharge).toBe(R(293000));
  });
  it('without a PAN, at least 20 % of the income', () => {
    expect(annualTax(R(600000), NEW, false)).toMatchObject({ total: R(120000), panAbsent: true });
    expect(annualTax(R(30000000), NEW, false).panAbsent).toBe(false);
    expect(annualTax(R(-5), NEW, true)).toMatchObject({ taxable: 0n, total: 0n });
  });
});

describe('projectTax', () => {
  const base = {
    regime: 'NEW' as const,
    ytdTaxable: R(400000),
    thisTaxable: R(100000),
    monthlyRate: R(100000),
    monthsLeft: 9,
    ytdPt: R(600),
    thisPt: R(200),
    monthlyPt: R(200),
    ytdTds: 0n,
    panPresent: true,
    rules: NEW,
  };
  it('the year projected; this month’s share, income tax and cess', () => {
    const p = projectTax(base);
    expect(p.gross).toBe(R(1300000));
    expect(p.standardDeduction).toBe(R(75000));
    expect(p.ptDeduction).toBe(0n);
    // ₹12.25 lakh taxable: marginal relief leaves ₹25,000 + cess = ₹26,000
    expect(p.tax.total).toBe(R(26000));
    expect(p.monthly).toBe(R(2889));
    expect(p.cess).toBe(R(111));
    expect(p.it).toBe(R(2778));
  });
  it('the old regime deducts profession tax and the other deductions', () => {
    const p = projectTax({ ...base, regime: 'OLD', rules: OLD, otherDeductions: R(150000) });
    expect(p.ptDeduction).toBe(R(2400));
    expect(p.otherDeductions).toBe(R(150000));
    expect(projectTax({ ...base, regime: 'OLD', rules: OLD }).otherDeductions).toBe(0n);
  });
  it('the year’s other facts: earlier employers, perquisites, exemptions, other income, a house’s loss', () => {
    const p = projectTax({
      ...base,
      regime: 'OLD',
      rules: OLD,
      extras: {
        prevSalary: R(200000),
        prevTds: R(10000),
        prevPt: R(1000),
        perquisites: R(50000),
        exemptions: R(120000),
        otherIncome: R(30000),
        houseLoss: R(200000),
        deductions: R(150000),
      },
    });
    // 13,00,000 + 50,000 + 2,00,000 = 15,50,000; less HRA 1,20,000, standard 50,000 (old), PT 2,400 + 1,000;
    // plus other income 30,000; less house 2,00,000 and deductions 1,50,000 → 10,56,600
    expect(p.gross).toBe(R(1550000));
    expect(p.exemptions).toBe(R(120000));
    expect(p.ptDeduction).toBe(R(3400));
    expect(p.tax.taxable).toBe(R(1056600));
    expect(p.otherDeductions).toBe(R(150000));
    expect([p.perquisites, p.prevSalary, p.otherIncome, p.houseLoss]).toEqual([
      R(50000),
      R(200000),
      R(30000),
      R(200000),
    ]);
    expect(p.ytdTds).toBe(R(10000));
    // the new regime: earlier PT does not count; the allowed deductions do
    const n = projectTax({ ...base, extras: { prevPt: R(1000), deductions: R(30000) } });
    expect(n.ptDeduction).toBe(0n);
    expect(n.otherDeductions).toBe(R(30000));
    // exemptions that leave less than the standard deduction, or nothing
    const small = projectTax({
      ...base,
      ytdTaxable: 0n,
      thisTaxable: R(50000),
      monthlyRate: 0n,
      extras: { exemptions: R(10000) },
    });
    expect(small.standardDeduction).toBe(R(40000));
    const none = projectTax({
      ...base,
      ytdTaxable: 0n,
      thisTaxable: R(5000),
      monthlyRate: 0n,
      extras: { exemptions: R(10000) },
    });
    expect(none.standardDeduction).toBe(0n);
  });
  it('the last month takes the rest; more deducted than due gives nothing', () => {
    expect(projectTax({ ...base, monthsLeft: 1, ytdTds: R(20000) }).monthly).toBe(R(0));
    const last = projectTax({ ...base, monthsLeft: 1, ytdTaxable: R(1300000), ytdTds: R(65100) });
    expect(last.monthly).toBe(R(16800));
    const over = projectTax({ ...base, monthsLeft: 1, ytdTds: R(900000) });
    expect(over.monthly).toBe(0n);
    expect(over.warnings).toHaveLength(1);
    expect(projectTax({ ...base, ytdTds: R(900000) }).monthly).toBe(0n);
    expect(projectTax({ ...base, monthsLeft: 0 }).monthsLeft).toBe(1);
  });
  it('no cess part on the no-PAN rate, and none when there is no tax', () => {
    const noPan = projectTax({
      ...base,
      ytdTaxable: 0n,
      thisTaxable: R(50000),
      monthlyRate: R(50000),
      monthsLeft: 12,
      panPresent: false,
    });
    expect(noPan.tax.panAbsent).toBe(true);
    expect(noPan.cess).toBe(0n);
    const none = projectTax({
      ...base,
      ytdTaxable: 0n,
      thisTaxable: R(20000),
      monthlyRate: R(20000),
      monthsLeft: 12,
    });
    expect(none.monthly).toBe(0n);
    expect(none.cess).toBe(0n);
    expect(
      projectTax({ ...base, ytdTaxable: 0n, thisTaxable: 0n, monthlyRate: 0n }).standardDeduction,
    ).toBe(0n);
  });
});

describe('monthsLeftInYear', () => {
  it('to March, or to the leaving month', () => {
    expect(monthsLeftInYear('2026-04')).toBe(12);
    expect(monthsLeftInYear('2026-12')).toBe(4);
    expect(monthsLeftInYear('2027-03')).toBe(1);
    expect(monthsLeftInYear('2026-06', '2026-09-15')).toBe(4);
    expect(monthsLeftInYear('2026-06', '2028-01-01')).toBe(10);
    expect(monthsLeftInYear('2026-06', '2026-01-01')).toBe(1);
  });
});

describe('topUpTax', () => {
  const base = {
    regime: 'NEW' as const,
    ytdTaxable: R(1200000),
    thisTaxable: R(100000),
    monthlyRate: R(100000),
    monthsLeft: 4,
    ytdPt: 0n,
    thisPt: 0n,
    monthlyPt: 0n,
    ytdTds: R(50000),
    panPresent: true,
    rules: NEW,
  };
  it('only the tax the payment adds, now', () => {
    const t = topUpTax(base);
    // ₹1 lakh more in the ₹12–16 lakh slab: 15 % and 4 % cess
    expect(t.monthly).toBe(R(15600));
    expect(t.cess).toBe(R(600));
    expect(t.it).toBe(R(15000));
  });
  it('nothing when the payment adds no tax', () => {
    expect(
      topUpTax({ ...base, ytdTaxable: 0n, thisTaxable: R(1000), monthlyRate: R(10000) }).monthly,
    ).toBe(0n);
  });
});
