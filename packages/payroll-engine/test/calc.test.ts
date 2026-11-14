import { describe, expect, it } from 'vitest';
import {
  calculate,
  type CalcInput,
  type CalcResult,
  type Head,
  type HeadVersion,
} from '../src/calc';
import type { PfRates } from '../src/statutory';
import type { TaxRules } from '../src/tax';

const R = (rupees: number) => BigInt(Math.round(rupees * 100));
const V = (over: Partial<HeadVersion> = {}): HeadVersion => ({
  id: 'v',
  calcType: 'FIXED',
  formula: null,
  dependsOn: null,
  isTaxable: true,
  pfWage: false,
  esiWage: true,
  ptWage: true,
  prorateOnLop: true,
  rounding: 'NEAREST_1',
  slabs: [],
  ...over,
});
let seq = 0;
const H = (
  code: string,
  headType: 'EARNING' | 'DEDUCTION',
  version: HeadVersion | null,
  printOrder = 10,
): Head => ({
  id: String((seq += 1)),
  code,
  name: code === 'BASIC' ? 'Basic Pay' : code,
  headType,
  printOrder,
  showIfZero: false,
  version,
});
const HEADS: Record<string, Head> = Object.fromEntries(
  [
    H('BASIC', 'EARNING', V({ id: 'vb', pfWage: true })),
    H(
      'DA',
      'EARNING',
      V({ id: 'vd', calcType: 'FORMULA', formula: 'ROUND([BASIC]*DA_RATE)', pfWage: true }),
    ),
    H('HRA', 'EARNING', V({ id: 'vh', calcType: 'FORMULA', formula: 'ROUND([BASIC]*HRA_RATE)' })),
    H(
      'TA',
      'EARNING',
      V({ id: 'vt', calcType: 'FORMULA', formula: 'ROUND([TA_BASE]+[TA_BASE]*DA_RATE)' }),
    ),
    H(
      'OT',
      'EARNING',
      V({
        id: 'vo',
        calcType: 'FORMULA',
        formula: 'ROUND(OT_HOURS*([BASIC]+[DA])/26/8*2)',
        prorateOnLop: false,
        esiWage: false,
      }),
    ),
    H('MED', 'EARNING', V({ id: 'vm', prorateOnLop: false, esiWage: false, isTaxable: false })),
    H('BONUS', 'EARNING', V({ calcType: 'MANUAL', esiWage: true })),
    H('GIFT', 'EARNING', null),
    H('DA_ARR', 'EARNING', V()),
    ...['PF', 'VPF', 'NPS', 'ESI', 'PT', 'LWF', 'TDS', 'ADV', 'LIC', 'MISC_DED', 'WARDFEE'].map(
      (c, k) =>
        H(
          c,
          'DEDUCTION',
          c === 'ESI' ? V({ rounding: 'CEIL_1' }) : V({ prorateOnLop: false }),
          100 + k,
        ),
    ),
  ].map((h) => [h.code, h]),
);
const PF: PfRates = {
  eeRate: '0.12',
  erRate: '0.12',
  epsRate: '0.0833',
  epsCeiling: R(15000),
  edliRate: '0.005',
  edliCeiling: R(15000),
  adminRate: '0.005',
};
const NEW: TaxRules = {
  slabs: [
    { from: 0n, to: R(400000), rate: '0' },
    { from: R(400000), to: R(800000), rate: '0.05' },
    { from: R(800000), to: R(1200000), rate: '0.10' },
    { from: R(1200000), to: null, rate: '0.15' },
  ],
  standardDeduction: R(75000),
  rebateLimit: R(1200000),
  rebateMax: R(60000),
  marginalRelief: true,
  cessRate: '0.04',
  panAbsentRate: '0.20',
  surcharges: [],
};
const input = (over: Partial<CalcInput> = {}): CalcInput => ({
  month: '2026-06',
  topUp: null,
  attendance: {
    monthDays: '30',
    paidDays: '30',
    lopDays: '0',
    preJoinDays: '0',
    postLeaveDays: '0',
    otHours: '0',
  },
  employee: { dob: '1980-01-01', gender: 'M', panPresent: true, payLevel: '7' },
  profile: {
    pfApplicable: true,
    pfWageBasis: 'CEILING',
    epsApplicable: true,
    vpfType: 'NONE',
    vpfValue: '0',
    npsApplicable: false,
    npsEeRate: '0.10',
    npsErRate: '0.14',
    esiApplicable: true,
    pwd: false,
    ptApplicable: true,
    taxRegime: 'NEW',
    tdsMode: 'PROJECTION',
  },
  heads: HEADS,
  structure: [
    { code: 'BASIC', amount: R(56100), rowId: 's1' },
    { code: 'DA', amount: 0n, rowId: 's2' },
    { code: 'HRA', amount: 0n, rowId: 's3' },
    { code: 'TA', amount: R(3600), rowId: 's4' },
    { code: 'MED', amount: R(1250), rowId: 's5' },
  ],
  rates: { DA_RATE: { value: '0.55', id: 'r1' }, HRA_RATE: { value: '0.30', id: 'r2' } },
  attributes: {},
  arrears: [],
  adhoc: [],
  recurring: [],
  loans: [],
  rateBasedOt: false,
  statutory: {
    pfSegments: [{ days: 30, id: 'pf1', rates: PF }],
    pfCeilingProrate: true,
    epsStopAge: 58,
    esi: {
      id: 'esi1',
      eeRate: '0.0075',
      erRate: '0.0325',
      wageLimit: R(21000),
      pwdLimit: R(25000),
    },
    esiCovered: null,
    ptSlabs: [
      { gender: 'M', from: 0n, to: R(10000), amount: 0n },
      { gender: 'M', from: R(10000.01), to: null, amount: R(200), overrides: { '2': R(300) } },
    ],
    lwf: null,
    netRounding: 'NEAREST_1',
  },
  tax: { manual: null, rules: NEW, ytdTaxable: 0n, ytdPt: 0n, ytdTds: 0n, monthsLeft: 10 },
  ...over,
});
const ok = (r: ReturnType<typeof calculate>): CalcResult => {
  if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
  return r;
};
const line = (r: CalcResult, code: string) => r.lines.find((l) => l.code === code);
const refused = (over: Partial<CalcInput>) => {
  const r = calculate(input(over));
  if (r.ok) throw new Error('expected a refusal');
  return r;
};

describe('a full month', () => {
  const r = ok(calculate(input({ tax: { ...input().tax, ytdTaxable: R(500000) } })));
  it('the earnings in order: DA and HRA from basic, TA from its base', () => {
    expect(r.lines.filter((l) => l.headType === 'EARNING').map((l) => [l.code, l.earned])).toEqual([
      ['BASIC', R(56100)],
      ['DA', R(30855)],
      ['HRA', R(16830)],
      ['TA', R(5580)],
      ['MED', R(1250)],
    ]);
    expect(r.grossEarned).toBe(R(110615));
    expect(r.grossFixed).toBe(R(110615));
    expect(r.lopAmount).toBe(0n);
    expect(line(r, 'BASIC')!.name).toBe('Basic Pay');
  });
  it('PF on the ceiling, no ESI above the limit, PT, the month’s tax', () => {
    expect(r.pfWage).toBe(R(15000));
    expect(line(r, 'PF')!.earned).toBe(R(1800));
    expect(r.esi).toMatchObject({ covered: false, ee: 0n });
    expect(line(r, 'ESI')).toBeUndefined();
    expect(r.esiWage).toBe(0n);
    expect(r.ptAmount).toBe(R(200));
    expect(r.itAmount + r.cessAmount).toBe(line(r, 'TDS')!.earned);
    expect(r.tds).toMatchObject({ monthsLeft: 10 });
    expect(r.netPay).toBe(r.grossEarned - r.totalDeductions);
    expect(r.trace).toMatchObject({
      rates: { DA_RATE: { id: 'r1' } },
      versions: { DA: 'vd' },
      structure: { BASIC: 's1' },
    });
    expect(r.ncpDays).toBe(0n);
  });
});

describe('loss of pay', () => {
  it('prorates what is prorated and leaves the rest', () => {
    const r = ok(
      calculate(
        input({
          attendance: {
            monthDays: '30',
            paidDays: '27',
            lopDays: '3',
            preJoinDays: '0',
            postLeaveDays: '0',
            otHours: '0',
          },
        }),
      ),
    );
    expect(line(r, 'BASIC')!.earned).toBe(R(50490));
    expect(line(r, 'BASIC')!.rate).toBe(R(56100));
    expect(line(r, 'MED')!.earned).toBe(R(1250));
    expect(r.lopAmount).toBe(r.grossFixed - (r.grossEarned - 0n));
    expect(r.ncpDays).toBe(300n);
    expect(r.pfWage).toBe(R(13500));
  });
});

describe('other earnings and deductions', () => {
  it('arrears, one-off earnings and deductions, recurring, loans; rounding as a line', () => {
    const r = ok(
      calculate(
        input({
          arrears: [
            { id: 'a1', code: 'DA_ARR', amount: R(1200.4), pf: true, taxable: true },
            { id: 'a2', code: 'OLD_HEAD', amount: R(100), pf: false, taxable: false },
          ],
          adhoc: [
            { id: 'x1', code: 'BONUS', amount: R(5000), refModule: null },
            { id: 'x2', code: 'GIFT', amount: R(500), refModule: null },
            { id: 'x3', code: 'WARDFEE', amount: R(3500), refModule: 'FEE' },
            { id: 'x4', code: 'TDS', amount: R(100), refModule: null },
          ],
          recurring: [
            { id: 'r1', code: 'LIC', amount: R(1200) },
            { id: 'r2', code: 'PF', amount: R(10) },
          ],
          loans: [
            {
              id: 'l1',
              terms: { principal: R(10000), emi: R(1500), rate: '12', method: 'REDUCING' },
              balance: R(10000),
            },
          ],
        }),
      ),
    );
    expect(line(r, 'DA_ARR')).toMatchObject({ isArrear: true, name: 'DA_ARR (arrear)' });
    expect(line(r, 'OLD_HEAD')).toMatchObject({ name: 'OLD_HEAD (arrear)', printOrder: 900 });
    expect(line(r, 'GIFT')).toMatchObject({ isStructure: false, earned: R(500) });
    expect(line(r, 'ADV')).toMatchObject({ earned: R(1500), source: { kind: 'loan', id: 'l1' } });
    expect(r.loans).toEqual([
      { id: 'l1', interest: R(100), emi: R(1500), principal: R(1400), closing: R(8600) },
    ]);
    expect(r.used).toEqual({
      arrears: ['a1', 'a2'],
      adhoc: ['x1', 'x2', 'x3', 'x4'],
      recurring: ['r1'],
    });
    expect((r.trace.skipped as string[]).join(' | ')).toContain(
      'A one-off TDS is worked out by payroll',
    );
    expect((r.trace.skipped as string[]).join(' | ')).toContain(
      'A recurring PF is worked out by payroll',
    );
    // the arrear's 40 paise rounds the net
    expect(line(r, 'ROUND_ADJ')).toMatchObject({ earned: R(0.4), printOrder: 999 });
    expect(r.netPay % 100n).toBe(0n);
  });

  it('net not rounded keeps the paise', () => {
    const r = ok(
      calculate(
        input({
          arrears: [{ id: 'a1', code: 'DA_ARR', amount: R(0.4), pf: false, taxable: false }],
          statutory: { ...input().statutory, netRounding: 'NONE' },
        }),
      ),
    );
    expect(line(r, 'ROUND_ADJ')).toBeUndefined();
  });

  it('the structure’s deductions: fixed, formula on the gross, prorated, or skipped for a one-off of the head', () => {
    const heads = {
      ...HEADS,
      SOC: H(
        'SOC',
        'DEDUCTION',
        V({
          calcType: 'FORMULA',
          formula: 'ROUND(GROSS_EARNED*0.01)+ROUND(BASIC_DA*0)+ROUND(PF_WAGE*0)+[BASIC]*0',
          prorateOnLop: false,
        }),
      ),
      CLUB: H('CLUB', 'DEDUCTION', V({ calcType: 'FIXED', prorateOnLop: true })),
      MISC_DED: H('MISC_DED', 'DEDUCTION', V({ calcType: 'FIXED' })),
    };
    const r = ok(
      calculate(
        input({
          heads,
          attendance: {
            monthDays: '30',
            paidDays: '15',
            lopDays: '15',
            preJoinDays: '0',
            postLeaveDays: '0',
            otHours: '0',
          },
          structure: [
            ...input().structure,
            { code: 'SOC', amount: 0n, rowId: 's9' },
            { code: 'CLUB', amount: R(300), rowId: 's10' },
            { code: 'MISC_DED', amount: R(50), rowId: 's11' },
            { code: 'PF', amount: R(999), rowId: 's12' },
          ],
          adhoc: [{ id: 'x1', code: 'MISC_DED', amount: R(25), refModule: null }],
        }),
      ),
    );
    expect(line(r, 'SOC')!.earned).toBe(R(559));
    expect(line(r, 'CLUB')).toMatchObject({ rate: R(300), earned: R(150) });
    expect(r.lines.filter((l) => l.code === 'MISC_DED')).toHaveLength(1);
    const skipped = (r.trace.skipped as string[]).join(' | ');
    expect(skipped).toContain('MISC_DED on the structure is not deducted');
    expect(skipped).toContain('PF on the structure is worked out by payroll');
  });
});

describe('formulas, slabs and the rate-based overtime', () => {
  it('overtime hours, a pay level, attributes; OT left out when there is a rate-based entry', () => {
    const heads = {
      ...HEADS,
      LVL: H(
        'LVL',
        'EARNING',
        V({ calcType: 'FORMULA', formula: 'PAY_LEVEL*100+IS_PERM*50', prorateOnLop: false }),
      ),
    };
    const structure = [
      ...input().structure,
      { code: 'OT', amount: 0n, rowId: 's6' },
      { code: 'LVL', amount: 0n, rowId: 's7' },
    ];
    const att = {
      monthDays: '30',
      paidDays: '30',
      lopDays: '0',
      preJoinDays: '0',
      postLeaveDays: '0',
      otHours: '8',
    };
    const r = ok(
      calculate(input({ heads, structure, attendance: att, attributes: { IS_PERM: 1 } })),
    );
    expect(line(r, 'OT')!.earned).toBe(R(6689));
    expect(line(r, 'LVL')!.earned).toBe(R(750));
    const withEntry = ok(
      calculate(
        input({ heads, structure, attendance: att, attributes: { IS_PERM: 1 }, rateBasedOt: true }),
      ),
    );
    expect(line(withEntry, 'OT')).toBeUndefined();
    expect((withEntry.trace.skipped as string[])[0]).toContain('rate-based overtime');
    const noLevel = refused({
      heads,
      structure,
      employee: { ...input().employee, payLevel: null },
      attributes: { IS_PERM: 1 },
    });
    expect(noLevel.reason).toContain("needs 'PAY_LEVEL'");
  });

  it('slabs by basic, basic + DA, gross and pay level', () => {
    const slab = (
      basis: 'BASIC' | 'BASIC_DA' | 'GROSS' | 'PAY_LEVEL',
      rows: HeadVersion['slabs'],
    ) => ({
      ...HEADS,
      SPL: H(
        'SPL',
        'EARNING',
        V({ calcType: 'SLAB', slabs: rows.map((x) => ({ ...x, basis })), prorateOnLop: false }),
      ),
    });
    const st = [...input().structure, { code: 'SPL', amount: 0n, rowId: 's8' }];
    const pct = [{ basis: 'BASIC' as const, from: 0n, to: null, flat: null, percent: '10' }];
    expect(
      line(ok(calculate(input({ heads: slab('BASIC', pct), structure: st }))), 'SPL')!.earned,
    ).toBe(R(5610));
    expect(
      line(ok(calculate(input({ heads: slab('BASIC_DA', pct), structure: st }))), 'SPL')!.earned,
    ).toBe(R(8696));
    // before DA, HRA and TA are worked out, the gross is basic and medical
    const g = ok(calculate(input({ heads: slab('GROSS', pct), structure: st })));
    expect(line(g, 'SPL')!.earned).toBeGreaterThan(0n);
    const lvl = [
      { basis: 'PAY_LEVEL' as const, from: 0n, to: R(5), flat: R(1000), percent: null },
      { basis: 'PAY_LEVEL' as const, from: R(5.01), to: null, flat: R(2000), percent: null },
    ];
    expect(
      line(ok(calculate(input({ heads: slab('PAY_LEVEL', lvl), structure: st }))), 'SPL')!.earned,
    ).toBe(R(2000));
    expect(
      line(
        ok(
          calculate(
            input({
              heads: slab('PAY_LEVEL', lvl),
              structure: st,
              employee: { ...input().employee, payLevel: 'x' },
            }),
          ),
        ),
        'SPL',
      )!.earned,
    ).toBe(R(1000));
    const none = [
      { basis: 'BASIC' as const, from: R(999999), to: null, flat: R(1), percent: null },
    ];
    expect(
      line(ok(calculate(input({ heads: slab('BASIC', none), structure: st }))), 'SPL')!.earned,
    ).toBe(0n);
    const badPct = [{ basis: 'BASIC' as const, from: 0n, to: null, flat: null, percent: 'x' }];
    expect(
      line(ok(calculate(input({ heads: slab('BASIC', badPct), structure: st }))), 'SPL')!.earned,
    ).toBe(0n);
    // no basic or DA on the structure: the basis is nothing
    const only = [{ code: 'SPL', amount: 0n, rowId: 's8' }];
    const flat0 = [{ basis: 'BASIC' as const, from: 0n, to: R(1), flat: R(700), percent: null }];
    expect(
      line(ok(calculate(input({ heads: slab('BASIC', flat0), structure: only }))), 'SPL')!.earned,
    ).toBe(R(700));
    expect(
      line(ok(calculate(input({ heads: slab('BASIC_DA', flat0), structure: only }))), 'SPL')!
        .earned,
    ).toBe(R(700));
    expect(
      line(
        ok(
          calculate(
            input({
              heads: slab('PAY_LEVEL', lvl),
              structure: st,
              employee: { ...input().employee, payLevel: null },
            }),
          ),
        ),
        'SPL',
      )!.earned,
    ).toBe(R(1000));
    const nullPct = [{ basis: 'BASIC' as const, from: 0n, to: null, flat: null, percent: null }];
    expect(
      line(ok(calculate(input({ heads: slab('BASIC', nullPct), structure: st }))), 'SPL')!.earned,
    ).toBe(0n);
  });
});

describe('statutory switches', () => {
  it('ESI covered on a low wage; decided earlier in the period', () => {
    const low = [{ code: 'BASIC', amount: R(15000), rowId: 's1' }];
    const r = ok(calculate(input({ structure: low })));
    expect(r.esi).toMatchObject({ covered: true, ee: R(113) });
    expect(r.esiWage).toBe(R(15000));
    expect(r.trace.esi).toMatchObject({ decided: 'this month' });
    const was = ok(
      calculate(input({ structure: low, statutory: { ...input().statutory, esiCovered: false } })),
    );
    expect(was.esi).toMatchObject({ covered: false });
    expect(was.trace.esi).toMatchObject({ decided: 'earlier in the period' });
    // the ESI head's own rounding, or up to the rupee without one
    const heads = { ...HEADS, ESI: { ...HEADS.ESI!, version: null } };
    expect(ok(calculate(input({ structure: low, heads }))).esi!.ee).toBe(R(113));
  });

  it('no ESI, PF, PT or tax when switched off; nothing without settings', () => {
    const r = ok(
      calculate(
        input({
          profile: {
            ...input().profile,
            esiApplicable: false,
            pfApplicable: false,
            ptApplicable: false,
            tdsMode: 'MANUAL',
          },
        }),
      ),
    );
    expect(r).toMatchObject({ pf: null, esi: null, ptAmount: 0n, itAmount: 0n });
    expect(r.warnings[0]).toContain('typed by hand');
    const none = ok(
      calculate(
        input({ statutory: { ...input().statutory, pfSegments: [], esi: null, ptSlabs: null } }),
      ),
    );
    expect(none).toMatchObject({ pf: null, esi: null, ptAmount: 0n });
    expect(
      ok(calculate(input({ statutory: { ...input().statutory, pfSegments: null } }))).trace
        .pfSegments,
    ).toEqual([]);
    // a slab with an upper bound, in the trace
    const low = ok(
      calculate(input({ structure: [{ code: 'BASIC', amount: R(8000), rowId: 's1' }] })),
    );
    expect(low.trace.ptSlab).toEqual({ gender: 'M', from: '0', to: R(10000).toString() });
    // a formula deduction on the PF wage and basic + DA when PF is off and there is no DA
    const soc = {
      ...HEADS,
      SOC: H(
        'SOC',
        'DEDUCTION',
        V({
          calcType: 'FORMULA',
          formula: 'ROUND(PF_WAGE*0.01)+ROUND(BASIC_DA*0.01)',
          prorateOnLop: false,
        }),
      ),
    };
    const off = ok(
      calculate(
        input({
          heads: soc,
          structure: [
            { code: 'BASIC', amount: R(20000), rowId: 's1' },
            { code: 'SOC', amount: 0n, rowId: 's2' },
          ],
          profile: { ...input().profile, pfApplicable: false },
        }),
      ),
    );
    expect(line(off, 'SOC')!.earned).toBe(R(400));
  });

  it('the pension stops at the age; no date of birth keeps it', () => {
    const old = ok(calculate(input({ employee: { ...input().employee, dob: '1968-06-10' } })));
    expect(old.pf!.erEps).toBe(0n);
    expect(old.trace.eps).toContain('EPS stops');
    expect(ok(calculate(input({ employee: { ...input().employee, dob: null } }))).pf!.erEps).toBe(
      R(1250),
    );
    expect(
      ok(calculate(input({ profile: { ...input().profile, epsApplicable: false } }))).pf!.erEps,
    ).toBe(0n);
  });

  it('NPS on the PF basket with its head’s rounding', () => {
    const r = ok(calculate(input({ profile: { ...input().profile, npsApplicable: true } })));
    expect(r.nps).toMatchObject({ wage: R(86955), ee: R(8696), er: R(12174) });
    const heads = { ...HEADS, NPS: { ...HEADS.NPS!, version: null } };
    expect(
      ok(calculate(input({ heads, profile: { ...input().profile, npsApplicable: true } }))).nps!.ee,
    ).toBe(R(8696));
    const noBasket = {
      ...HEADS,
      BASIC: { ...HEADS.BASIC!, version: V({ pfWage: false }) },
      DA: {
        ...HEADS.DA!,
        version: V({ calcType: 'FORMULA', formula: 'ROUND([BASIC]*DA_RATE)', pfWage: false }),
      },
    };
    expect(
      ok(
        calculate(input({ heads: noBasket, profile: { ...input().profile, npsApplicable: true } })),
      ).nps,
    ).toBeNull();
  });

  it('LWF in its month; a flat one not again on a top-up', () => {
    const lwf = {
      id: 'lw1',
      eeRate: null,
      eeCap: null,
      eeFlat: R(25),
      erFlat: R(75),
      erMultiplier: null,
      frequency: 'half_yearly' as const,
      months: [6, 12],
    };
    const r = ok(calculate(input({ statutory: { ...input().statutory, lwf } })));
    expect(r.lwf).toEqual({ ee: R(25), er: R(75) });
    expect(r.trace.lwf).toBe('lw1');
    expect(
      ok(calculate(input({ month: '2026-07', statutory: { ...input().statutory, lwf } }))).lwf,
    ).toBeNull();
    const top = ok(
      calculate(
        input({ topUp: { pfWageUsed: R(15000) }, statutory: { ...input().statutory, lwf } }),
      ),
    );
    expect(top.lwf).toBeNull();
    const zero = { ...lwf, eeFlat: null, erFlat: null, eeRate: null };
    expect(ok(calculate(input({ statutory: { ...input().statutory, lwf: zero } }))).lwf).toBeNull();
  });

  it('a typed month’s tax wins', () => {
    const r = ok(
      calculate(input({ tax: { ...input().tax, manual: { it: R(2500), cess: R(100) } } })),
    );
    expect(r.tds).toEqual({ manual: true, it: R(2500), cess: R(100) });
    expect(line(r, 'TDS')!.earned).toBe(R(2600));
  });

  it('the year’s declarations and earlier employers change the month’s tax', () => {
    const plain = ok(calculate(input()));
    const declared = ok(
      calculate(
        input({ tax: { ...input().tax, extras: { prevSalary: R(300000), prevTds: R(5000) } } }),
      ),
    );
    expect(declared.tds).toMatchObject({ prevSalary: R(300000) });
    expect(declared.itAmount + declared.cessAmount).not.toBe(plain.itAmount + plain.cessAmount);
  });

  it('the HRA exemption from the year’s HRA, basic and DA, the old regime only', () => {
    const extras = { hra: { rentPaid: R(300000), listedCity: true, ytdHra: 0n, ytdSalary: 0n } };
    const old = ok(
      calculate(
        input({
          profile: { ...input().profile, taxRegime: 'OLD' },
          tax: { ...input().tax, extras },
        }),
      ),
    );
    const hra = line(old, 'HRA')!.earned;
    const salary = line(old, 'BASIC')!.earned + line(old, 'DA')!.earned;
    // the least of HRA received (the year), rent − 10 % and 50 % of the salary: the HRA received here
    expect(old.taxWorking!.hra).toMatchObject({
      received: hra * 10n,
      salary: salary * 10n,
      exempt: hra * 10n,
    });
    expect(old.tds).toMatchObject({ exemptions: hra * 10n });
    const neu = ok(calculate(input({ tax: { ...input().tax, extras } })));
    expect(neu.taxWorking!.hra!.exempt).toBe(0n);
    expect(neu.taxWorking!.npsEr).toBeNull();
    // no HRA head: nothing received, nothing exempt
    const noHra = ok(
      calculate(
        input({
          structure: input().structure.filter((x) => x.code !== 'HRA'),
          profile: { ...input().profile, taxRegime: 'OLD' },
          tax: { ...input().tax, extras },
        }),
      ),
    );
    expect(noHra.taxWorking!.hra!.exempt).toBe(0n);
  });

  it('the employer’s NPS: added to the income, deducted within its cap', () => {
    const r = ok(
      calculate(
        input({
          profile: { ...input().profile, npsApplicable: true },
          tax: { ...input().tax, extras: { npsEr: { ytd: R(1000), capRate: '0.14' } } },
        }),
      ),
    );
    const annual = R(1000) + r.nps!.er * 10n;
    const salary = (line(r, 'BASIC')!.earned + line(r, 'DA')!.earned) * 10n;
    const cap = (salary * 14n + 50n) / 100n;
    expect(r.taxWorking!.npsEr).toEqual({ annual, allowed: annual < cap ? annual : cap });
    expect(r.taxWorking!.hra).toBeNull();
    const wide = ok(
      calculate(
        input({
          profile: { ...input().profile, npsApplicable: true },
          tax: { ...input().tax, extras: { npsEr: { ytd: 0n, capRate: '0.90' } } },
        }),
      ),
    );
    expect(wide.taxWorking!.npsEr!.allowed).toBe(wide.taxWorking!.npsEr!.annual);
    // no NPS this month: what the earlier months paid
    const none = ok(
      calculate(
        input({ tax: { ...input().tax, extras: { npsEr: { ytd: R(500), capRate: '0.14' } } } }),
      ),
    );
    expect(none.taxWorking!.npsEr!.annual).toBe(R(500));
  });

  it('declared sections with the year’s own PF in 80C, within the shared cap', () => {
    const declared = {
      lines: [
        {
          code: 'CHAPVIA_80C',
          amount: R(50000),
          cap: R(150000),
          appliesTo: 'OLD' as const,
          group: 'G80C',
        },
        { code: 'CHAPVIA_80D', amount: R(30000), cap: R(25000), appliesTo: 'OLD' as const },
      ],
      groupCaps: { G80C: R(150000) },
      pf80c: { ytd: R(10000), code: 'CHAPVIA_80C' },
    };
    const r = ok(
      calculate(
        input({
          profile: { ...input().profile, taxRegime: 'OLD' },
          tax: { ...input().tax, extras: { declared } },
        }),
      ),
    );
    const pf = line(r, 'PF')!.earned;
    const c80 = r.taxWorking!.deductions!.find((l) => l.code === 'CHAPVIA_80C')!;
    expect(c80.declared).toBe(R(50000) + R(10000) + pf * 10n);
    // PF at the ceiling (₹1,800 a month): 50,000 + 10,000 + 18,000 = 78,000, within the shared cap
    expect(c80.allowed).toBe(c80.declared);
    expect(r.taxWorking!.deductions!.find((l) => l.code === 'CHAPVIA_80D')!.allowed).toBe(R(25000));
    expect(r.tds).toMatchObject({ otherDeductions: c80.allowed + R(25000) });
    // without PF in 80C: as declared
    const plain = ok(
      calculate(
        input({
          profile: { ...input().profile, taxRegime: 'OLD' },
          tax: { ...input().tax, extras: { declared: { ...declared, pf80c: undefined } } },
        }),
      ),
    );
    expect(plain.taxWorking!.deductions![0]!.declared).toBe(R(50000));
  });

  it('the school’s final figure for the year wins, over the months it sets', () => {
    const r = ok(
      calculate(input({ tax: { ...input().tax, extras: { final: { annual: R(60000) } } } })),
    );
    expect(r.tds).toMatchObject({ monthsLeft: 10, monthly: R(6000) });
    expect((r.tds as { warnings: string[] }).warnings[0]).toContain('final figure');
    const quick = ok(
      calculate(
        input({ tax: { ...input().tax, extras: { final: { annual: R(60000), spreadLeft: 3 } } } }),
      ),
    );
    expect(quick.tds).toMatchObject({ monthsLeft: 3, monthly: R(20000) });
    const now = ok(
      calculate(
        input({ tax: { ...input().tax, extras: { final: { annual: R(60000), spreadLeft: 0 } } } }),
      ),
    );
    expect(now.tds).toMatchObject({ monthsLeft: 1, monthly: R(60000) });
  });

  it('the last month: tax beyond what was due warns', () => {
    const r = ok(calculate(input({ tax: { ...input().tax, monthsLeft: 1, ytdTds: R(999999) } })));
    expect(r.warnings[0]).toContain('More tax was deducted');
  });
});

describe('a top-up of a month already paid', () => {
  it('pays only what is pending: no structure, loans, recurring or PT; PF on what is left of the ceiling', () => {
    const r = ok(
      calculate(
        input({
          topUp: { pfWageUsed: R(12000) },
          arrears: [{ id: 'a1', code: 'DA_ARR', amount: R(6000), pf: true, taxable: true }],
          recurring: [{ id: 'r1', code: 'LIC', amount: R(1200) }],
          loans: [
            {
              id: 'l1',
              terms: { principal: R(1000), emi: R(100), rate: '0', method: 'NONE' },
              balance: R(1000),
            },
          ],
          structure: [...input().structure, { code: 'MISC_DED', amount: R(10), rowId: 'sd' }],
        }),
      ),
    );
    expect(r.lines.filter((l) => l.headType === 'EARNING').map((l) => l.code)).toEqual(['DA_ARR']);
    expect(r.pfWage).toBe(R(3000));
    expect(r.ptAmount).toBe(0n);
    expect(r.loans).toEqual([]);
    expect(r.used.recurring).toEqual([]);
    expect(line(r, 'MISC_DED')).toBeUndefined();
    expect(r.ncpDays).toBe(0n);
    expect(r.trace.topUp).toEqual({
      pfWageUsed: R(12000).toString(),
      headroom: R(3000).toString(),
    });
    // the projection still sees the structure (the legacy missed it)
    expect((r.tds as { gross: bigint }).gross).toBeGreaterThan(R(6000));
    const noPf = ok(
      calculate(
        input({ topUp: { pfWageUsed: 0n }, profile: { ...input().profile, pfApplicable: false } }),
      ),
    );
    expect(noPf.trace.topUp).toEqual({ pfWageUsed: '0', headroom: null });
    const actual = ok(
      calculate(
        input({
          topUp: { pfWageUsed: 0n },
          profile: { ...input().profile, pfWageBasis: 'ACTUAL' },
        }),
      ),
    );
    expect(actual.trace.topUp).toEqual({ pfWageUsed: '0', headroom: null });
    // a top-up needs no structure
    expect(calculate(input({ topUp: { pfWageUsed: 0n }, structure: [] })).ok).toBe(true);
  });
});

describe('refusals', () => {
  it('no structure, a head or version missing, a loop', () => {
    expect(refused({ structure: [] }).code).toBe('NO_STRUCTURE');
    expect(refused({ structure: [{ code: 'NOPE', amount: 1n, rowId: 'x' }] }).code).toBe('NO_HEAD');
    expect(refused({ structure: [{ code: 'GIFT', amount: 1n, rowId: 'x' }] }).code).toBe(
      'NO_VERSION',
    );
    const loop = {
      ...HEADS,
      DA: { ...HEADS.DA!, version: V({ calcType: 'FORMULA', formula: 'ROUND([HRA]*1)' }) },
      HRA: { ...HEADS.HRA!, version: V({ calcType: 'FORMULA', formula: 'ROUND([DA]*1)' }) },
    };
    expect(refused({ heads: loop }).code).toBe('CYCLE');
    const dloop = {
      ...HEADS,
      D1: H('D1', 'DEDUCTION', V({ calcType: 'FORMULA', formula: '[D2]*1' })),
      D2: H('D2', 'DEDUCTION', V({ calcType: 'FORMULA', formula: '[D1]*1' })),
    };
    expect(
      refused({
        heads: dloop,
        structure: [
          ...input().structure,
          { code: 'D1', amount: 0n, rowId: 'a' },
          { code: 'D2', amount: 0n, rowId: 'b' },
        ],
      }).code,
    ).toBe('CYCLE');
  });

  it('formulas that cannot be worked out', () => {
    const bad = (formula: string, structure = input().structure) =>
      refused({
        heads: { ...HEADS, HRA: { ...HEADS.HRA!, version: V({ calcType: 'FORMULA', formula }) } },
        structure,
      });
    expect(bad('ROUND([BASIC]*').reason).toContain('HRA formula');
    expect(bad('[BASIC]*NO_SUCH_RATE').reason).toContain("needs 'NO_SUCH_RATE'");
    expect(bad('[BASIC]*BAD_RATE').reason).toContain("needs 'BAD_RATE'");
    expect(bad('[LIC]*1').reason).toContain('refers to [LIC]');
    expect(bad('[NOPE_BASE]*1').reason).toContain('refers to [NOPE_BASE]');
    expect(bad('[BASIC]/0').reason).toContain('HRA:');
    const d = refused({
      heads: {
        ...HEADS,
        SOC: H('SOC', 'DEDUCTION', V({ calcType: 'FORMULA', formula: 'GROSS_EARNED/0' })),
      },
      structure: [...input().structure, { code: 'SOC', amount: 0n, rowId: 'z' }],
    });
    expect(d.code).toBe('FORMULA');
  });

  it('a malformed rate, a formula head without its formula', () => {
    const heads = {
      ...HEADS,
      HRA: { ...HEADS.HRA!, version: V({ calcType: 'FORMULA', formula: '[BASIC]*BAD_RATE' }) },
    };
    expect(
      refused({ heads, rates: { ...input().rates, BAD_RATE: { value: 'x', id: 'r9' } } }).reason,
    ).toContain("needs 'BAD_RATE'");
    const empty = {
      ...HEADS,
      HRA: { ...HEADS.HRA!, version: V({ calcType: 'FORMULA', formula: null }) },
    };
    expect(refused({ heads: empty }).code).toBe('FORMULA');
  });

  it('a slab head without slabs; a slab deduction', () => {
    const heads = { ...HEADS, SPL: H('SPL', 'EARNING', V({ calcType: 'SLAB', slabs: [] })) };
    expect(
      refused({ heads, structure: [...input().structure, { code: 'SPL', amount: 0n, rowId: 'x' }] })
        .code,
    ).toBe('SLAB');
    const dheads = { ...HEADS, FINE: H('FINE', 'DEDUCTION', V({ calcType: 'SLAB', slabs: [] })) };
    expect(
      refused({
        heads: dheads,
        structure: [...input().structure, { code: 'FINE', amount: 0n, rowId: 'x' }],
      }).code,
    ).toBe('CALC_TYPE');
  });

  it('a one-off or recurring line of a head not in use; an engine head missing', () => {
    expect(refused({ adhoc: [{ id: 'x', code: 'NOPE', amount: 1n, refModule: null }] }).code).toBe(
      'NO_HEAD',
    );
    expect(refused({ recurring: [{ id: 'r', code: 'NOPE', amount: 1n }] }).code).toBe('NO_HEAD');
    const { PT: _pt, ...withoutPt } = HEADS;
    expect(refused({ heads: withoutPt }).reason).toContain('no PT deduction head');
  });

  it('a negative net, and no tax rules', () => {
    expect(
      refused({ adhoc: [{ id: 'x', code: 'MISC_DED', amount: R(999999), refModule: null }] }).code,
    ).toBe('NEGATIVE_NET');
    expect(refused({ tax: { ...input().tax, rules: null } }).code).toBe('NO_TAX_RULES');
    expect(
      refused({
        tax: { ...input().tax, rules: null },
        profile: { ...input().profile, taxRegime: 'OLD' },
      }).reason,
    ).toContain('old regime');
  });
});
