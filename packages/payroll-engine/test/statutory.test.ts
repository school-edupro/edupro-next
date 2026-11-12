import { describe, expect, it } from 'vitest';
import {
  ageOn,
  esi,
  esiCoveredAt,
  esiPeriodStart,
  lwf,
  mulRate,
  ncpDays,
  nps,
  pf,
  professionTax,
  type PfRates,
  type PtSlab,
} from '../src/statutory';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));
const RATES: PfRates = {
  eeRate: '0.12',
  erRate: '0.12',
  epsRate: '0.0833',
  epsCeiling: R(15000),
  edliRate: '0.005',
  edliCeiling: R(15000),
  adminRate: '0.005',
};
const base = {
  basket: R(40000),
  basis: 'CEILING' as const,
  prorateCeiling: true,
  paidDays: '30',
  monthDays: '30',
  segments: [{ days: 30, rates: RATES }],
  eps: true,
  vpf: { type: 'NONE' as const, value: '0' },
};

describe('mulRate', () => {
  it('multiplies to the paisa, half-up', () => {
    expect(mulRate(R(15000), '0.0833')).toBe(R(1249.5));
    expect(mulRate(333n, '0.5')).toBe(167n);
    expect(() => mulRate(1n, 'x')).toThrow("Not a rate: 'x'");
  });
});

describe('pf', () => {
  it('the ceiling basis: 12 % of ₹15,000; EPS 8.33 %; the employer the rest', () => {
    const r = pf(base);
    expect(r).toMatchObject({
      pfWage: R(15000),
      epsWage: R(15000),
      edliWage: R(15000),
      eePf: R(1800),
      erEps: R(1250),
      erEpf: R(550),
      edli: R(75),
      admin: R(75),
      vpf: 0n,
      topUpHeadroom: null,
    });
  });

  it('the ceiling shrinks with loss of pay, or not', () => {
    expect(pf({ ...base, paidDays: '15' }).pfWage).toBe(R(7500));
    expect(pf({ ...base, paidDays: '15', prorateCeiling: false }).pfWage).toBe(R(15000));
  });

  it('the whole wage on the ACTUAL basis; no pension past the age', () => {
    const r = pf({ ...base, basis: 'ACTUAL', eps: false });
    expect(r).toMatchObject({
      pfWage: R(40000),
      eePf: R(4800),
      erEps: 0n,
      erEpf: R(4800),
      epsWage: 0n,
    });
  });

  it('voluntary PF flat or a per cent', () => {
    expect(pf({ ...base, vpf: { type: 'FLAT', value: '1000' } }).vpf).toBe(R(1000));
    expect(pf({ ...base, vpf: { type: 'PERCENT', value: '12.5' } }).vpf).toBe(R(1875));
    expect(pf({ ...base, vpf: { type: 'FLAT', value: 'x' } }).vpf).toBe(0n);
    expect(pf({ ...base, vpf: { type: 'PERCENT', value: 'x' } }).vpf).toBe(0n);
  });

  it('a month across two settings: shared by days, the last taking the remainder', () => {
    const two = [
      { days: 10, rates: RATES },
      { days: 21, rates: { ...RATES, eeRate: '0.10' } },
    ];
    const r = pf({ ...base, monthDays: '31', paidDays: '31', segments: two });
    expect(r.segments.map((s) => s.wage)).toEqual([R(4838.71), R(10161.29)]);
    expect(r.pfWage).toBe(R(15000));
    expect(r.eePf).toBe(R(1597));
    // different wages per setting: each shared, no remainder
    const diff = pf({
      ...base,
      basis: 'ACTUAL',
      basket: R(20000),
      monthDays: '30',
      segments: [
        { days: 15, rates: RATES },
        { days: 15, rates: { ...RATES, epsCeiling: R(20000) } },
      ],
    });
    expect(diff.segments.map((s) => s.wage)).toEqual([R(10000), R(10000)]);
    const unequal = pf({
      ...base,
      basket: R(18000),
      monthDays: '30',
      segments: [
        { days: 15, rates: RATES },
        { days: 15, rates: { ...RATES, epsCeiling: R(20000) } },
      ],
    });
    expect(unequal.segments.map((s) => s.wage)).toEqual([R(7500), R(9000)]);
  });

  it('a top-up: what is left of the ceiling on the CEILING basis only', () => {
    expect(pf({ ...base, topUpUsed: R(12000) })).toMatchObject({
      pfWage: R(3000),
      topUpHeadroom: R(3000),
    });
    expect(pf({ ...base, basket: R(2000), topUpUsed: R(12000) })).toMatchObject({
      pfWage: R(2000),
    });
    expect(pf({ ...base, basis: 'ACTUAL', topUpUsed: R(12000) })).toMatchObject({
      pfWage: R(40000),
      topUpHeadroom: null,
    });
    expect(pf({ ...base, topUpUsed: R(20000) }).pfWage).toBe(0n);
  });

  it('a month of no days counts as one', () => {
    expect(pf({ ...base, monthDays: '0', paidDays: '0', prorateCeiling: false }).pfWage).toBe(
      R(15000),
    );
  });
});

describe('days and ages', () => {
  it('NCP days are loss of pay and days not employed, at most the month', () => {
    expect(ncpDays('30', '2', '3', '0')).toBe(500n);
    expect(ncpDays('30', '20', '10', '5')).toBe(3000n);
  });
  it('age on a day', () => {
    expect(ageOn('1968-06-15', '2026-06-30')).toBe(58);
    expect(ageOn('1968-07-01', '2026-06-30')).toBe(57);
    expect(ageOn('1968-06-30', '2026-06-29')).toBe(57);
  });
});

describe('NPS and ESI', () => {
  it('NPS on the PF basket, no ceiling', () => {
    expect(nps(R(50000), '0.10', '0.14')).toEqual({ wage: R(50000), ee: R(5000), er: R(7000) });
    expect(nps(R(333.33), '0.10', '0.14', 'NONE')).toEqual({
      wage: R(333.33),
      ee: 3333n,
      er: 4667n,
    });
  });
  it('the contribution periods', () => {
    expect(esiPeriodStart('2026-04')).toBe('2026-04-01');
    expect(esiPeriodStart('2026-09')).toBe('2026-04-01');
    expect(esiPeriodStart('2026-10')).toBe('2026-10-01');
    expect(esiPeriodStart('2027-03')).toBe('2026-10-01');
  });
  it('covered within the limit; the higher limit for persons with disability', () => {
    expect(esiCoveredAt(R(21000), R(21000), R(25000), false)).toBe(true);
    expect(esiCoveredAt(R(24000), R(21000), R(25000), false)).toBe(false);
    expect(esiCoveredAt(R(24000), R(21000), R(25000), true)).toBe(true);
    expect(esiCoveredAt(R(24000), R(21000), null, true)).toBe(false);
    expect(esiCoveredAt(R(24000), R(21000), R(20000), true)).toBe(false);
    expect(esiCoveredAt(0n, R(21000), null, false)).toBe(false);
    expect(esiCoveredAt(R(100), 0n, null, false)).toBe(false);
  });
  it('the employee 0.75 % up to the rupee; the employer 3.25 %', () => {
    expect(esi(R(18001), '0.0075', '0.0325')).toEqual({ wage: R(18001), ee: R(136), er: R(586) });
    expect(esi(R(18001), '0.0075', '0.0325', 'NEAREST_1').ee).toBe(R(135));
  });
});

describe('profession tax', () => {
  const MH: PtSlab[] = [
    { gender: 'M', from: 0n, to: R(7500), amount: 0n },
    { gender: 'M', from: R(7500.01), to: R(10000), amount: R(175) },
    { gender: 'M', from: R(10000.01), to: null, amount: R(200), overrides: { '2': R(300) } },
    { gender: 'F', from: 0n, to: R(25000), amount: 0n, overrides: null },
    { gender: 'F', from: R(25000.01), to: null, amount: R(200) },
  ];
  it('the slab of the gender, inclusive; February differs', () => {
    expect(professionTax(R(10000), 'M', '2026-06', MH).amount).toBe(R(175));
    expect(professionTax(R(30000), 'M', '2026-06', MH).amount).toBe(R(200));
    expect(professionTax(R(30000), 'M', '2027-02', MH).amount).toBe(R(300));
    expect(professionTax(R(20000), 'F', '2027-02', MH).amount).toBe(0n);
    expect(professionTax(R(30000), 'F', '2027-02', MH).amount).toBe(R(200));
  });
  it('ANY when no slab of the gender fits; nothing when none fits', () => {
    const any: PtSlab[] = [{ gender: 'ANY', from: 0n, to: null, amount: R(150) }];
    expect(professionTax(R(5000), 'F', '2026-06', any).amount).toBe(R(150));
    expect(professionTax(R(5000), 'F', '2026-06', [])).toEqual({ amount: 0n, slab: null });
  });
});

describe('labour welfare fund', () => {
  const MH = {
    eeRate: null,
    eeCap: null,
    eeFlat: R(25),
    erFlat: R(75),
    erMultiplier: null,
    frequency: 'half_yearly' as const,
    months: [6, 12],
  };
  const HR = {
    eeRate: '0.002',
    eeCap: R(35),
    eeFlat: null,
    erFlat: null,
    erMultiplier: '2',
    frequency: 'monthly' as const,
    months: [],
  };
  it('flat in its months, nothing in others', () => {
    expect(lwf(R(30000), '2026-06', MH)).toEqual({ due: true, ee: R(25), er: R(75) });
    expect(lwf(R(30000), '2026-07', MH)).toEqual({ due: false, ee: 0n, er: 0n });
  });
  it('a rate of gross capped, the employer twice', () => {
    expect(lwf(R(10000), '2026-07', HR)).toEqual({ due: true, ee: R(20), er: R(40) });
    expect(lwf(R(30000), '2026-07', HR)).toEqual({ due: true, ee: R(35), er: R(70) });
    expect(lwf(R(30000), '2026-07', { ...HR, eeCap: null })).toEqual({
      due: true,
      ee: R(60),
      er: R(120),
    });
  });
  it('nothing from the employee, nothing from the employer by multiple', () => {
    expect(lwf(R(30000), '2026-07', { ...HR, eeRate: null })).toEqual({
      due: true,
      ee: 0n,
      er: 0n,
    });
    expect(lwf(R(30000), '2026-07', { ...HR, erMultiplier: null })).toEqual({
      due: true,
      ee: R(35),
      er: 0n,
    });
  });
});
