/**
 * One employee's pay for a month (`payroll_calc_lib.php: pr_calc_employee`, PAYROLL_RUN_SPEC.md §4.2): the
 * structure's earning heads in dependency order, each rate (fixed, formula, slab) and its full-attendance
 * projection rate, prorated for loss of pay; arrears and one-off earnings; gross; PF, NPS, ESI, LWF, PT and the
 * month's income tax; loans, recurring and one-off deductions and the structure's own deductions; net, its
 * rounding as a line. Pure: the API loads everything as of the month, this computes, the API writes. Fixed from
 * the legacy: a top-up deducts no loan instalment, recurring deduction or flat LWF again; a missing income-tax
 * rule fails the employee instead of silently deducting nothing.
 */
import { compile, evaluate } from './formula';
import { loanMonth, type LoanTerms } from './loans';
import {
  daysToHundredths,
  decToScaled,
  divHalfUp,
  paiseToMicro,
  prorate,
  roundHead,
  type Rounding,
} from './money';
import { calcOrder } from './order';
import {
  ageOn,
  esi as esiOf,
  esiCoveredAt,
  lwf as lwfOf,
  ncpDays,
  nps as npsOf,
  pf as pfOf,
  professionTax,
  type LwfRule,
  type PfRates,
  type PtSlab,
} from './statutory';
import { projectTax, topUpTax, type TaxRules } from './tax';

/** the heads payroll works out itself */
export const ENGINE_HEADS = ['PF', 'VPF', 'NPS', 'ESI', 'PT', 'LWF', 'TDS', 'ADV'] as const;
const ENGINE = new Set<string>(ENGINE_HEADS);

export type CalcType = 'FIXED' | 'FORMULA' | 'SLAB' | 'MANUAL' | 'SYSTEM';
export interface HeadVersion {
  id: string;
  calcType: CalcType;
  formula: string | null;
  dependsOn: string | null;
  isTaxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
  prorateOnLop: boolean;
  rounding: Rounding;
  slabs: Array<{
    basis: 'BASIC' | 'BASIC_DA' | 'GROSS' | 'PAY_LEVEL';
    from: bigint;
    to: bigint | null;
    flat: bigint | null;
    /** a per cent figure (12.5) */
    percent: string | null;
  }>;
}
export interface Head {
  id: string;
  code: string;
  name: string;
  headType: 'EARNING' | 'DEDUCTION';
  printOrder: number;
  showIfZero: boolean;
  /** the version in force in the month (null: none) */
  version: HeadVersion | null;
}
export interface Profile {
  pfApplicable: boolean;
  pfWageBasis: 'ACTUAL' | 'CEILING';
  epsApplicable: boolean;
  vpfType: 'NONE' | 'FLAT' | 'PERCENT';
  vpfValue: string;
  npsApplicable: boolean;
  npsEeRate: string;
  npsErRate: string;
  esiApplicable: boolean;
  pwd: boolean;
  ptApplicable: boolean;
  taxRegime: 'NEW' | 'OLD';
  tdsMode: 'PROJECTION' | 'MANUAL';
}
export interface CalcInput {
  /** YYYY-MM */
  month: string;
  /** this month is already paid by a locked run: only what is pending is paid (no structure) */
  topUp: { pfWageUsed: bigint } | null;
  attendance: {
    monthDays: string;
    paidDays: string;
    lopDays: string;
    preJoinDays: string;
    postLeaveDays: string;
    otHours: string;
  };
  employee: { dob: string | null; gender: 'M' | 'F'; panPresent: boolean; payLevel: string | null };
  profile: Profile;
  /** every head in use by its code, with the version in force in the month */
  heads: Readonly<Record<string, Head>>;
  /** the salary structure in force: a head's amount (its parameter for a formula head) */
  structure: Array<{ code: string; amount: bigint; rowId: string }>;
  /** the rate registry in force: code → a decimal value */
  rates: Readonly<Record<string, { value: string; id: string }>>;
  /** formula attributes (1 / 0 from employee fields) */
  attributes: Readonly<Record<string, number>>;
  arrears: Array<{ id: string; code: string; amount: bigint; pf: boolean; taxable: boolean }>;
  adhoc: Array<{ id: string; code: string; amount: bigint; refModule: string | null }>;
  recurring: Array<{ id: string; code: string; amount: bigint }>;
  loans: Array<{ id: string; terms: LoanTerms; balance: bigint }>;
  /** a rate-based overtime entry this month: the structure's OT head is not worked out */
  rateBasedOt: boolean;
  statutory: {
    /** the PF settings over the month (days each); null: none in force */
    pfSegments: Array<{ days: number; id: string; rates: PfRates }> | null;
    pfCeilingProrate: boolean;
    epsStopAge: number;
    esi: {
      id: string;
      eeRate: string;
      erRate: string;
      wageLimit: bigint;
      pwdLimit: bigint | null;
    } | null;
    /** the contribution period's coverage when an earlier month decided it */
    esiCovered: boolean | null;
    /** the state's profession-tax slabs; null: no state */
    ptSlabs: PtSlab[] | null;
    /** null: LWF off or no rule for the state */
    lwf: (LwfRule & { id: string }) | null;
    netRounding: Rounding;
  };
  tax: {
    /** a month's tax typed by hand */
    manual: { it: bigint; cess: bigint } | null;
    /** the regime's rules for the year; null: none */
    rules: TaxRules | null;
    ytdTaxable: bigint;
    ytdPt: bigint;
    ytdTds: bigint;
    monthsLeft: number;
  };
}
export interface Line {
  code: string;
  name: string;
  headType: 'EARNING' | 'DEDUCTION';
  /** the month's entitlement (structure) or the one-off amount */
  rate: bigint;
  earned: bigint;
  isArrear: boolean;
  isStructure: boolean;
  /** counts for income tax (earnings only) */
  taxable: boolean;
  calcOrder: number;
  printOrder: number;
  showIfZero: boolean;
  /** where it came from: structure row, arrear, one-off, recurring, loan, or worked out */
  source: {
    kind: 'structure' | 'arrear' | 'adhoc' | 'recurring' | 'loan' | 'engine' | 'rounding';
    id?: string;
  };
}
export interface CalcResult {
  ok: true;
  lines: Line[];
  grossFixed: bigint;
  grossEarned: bigint;
  lopAmount: bigint;
  pfWage: bigint;
  esiWage: bigint;
  ptWage: bigint;
  ptAmount: bigint;
  itAmount: bigint;
  cessAmount: bigint;
  totalDeductions: bigint;
  netPay: bigint;
  ncpDays: bigint;
  pf: ReturnType<typeof pfOf> | null;
  nps: { wage: bigint; ee: bigint; er: bigint; eeRate: string; erRate: string } | null;
  esi: { covered: boolean; wage: bigint; ee: bigint; er: bigint } | null;
  lwf: { ee: bigint; er: bigint } | null;
  loans: Array<{ id: string; interest: bigint; emi: bigint; principal: bigint; closing: bigint }>;
  used: { arrears: string[]; adhoc: string[]; recurring: string[] };
  tds: ReturnType<typeof projectTax> | { manual: true; it: bigint; cess: bigint } | null;
  trace: Record<string, unknown>;
  warnings: string[];
}
export type CalcOutcome = CalcResult | { ok: false; code: string; reason: string };

const fail = (code: string, reason: string): CalcOutcome => ({ ok: false, code, reason });
const DAY_MICRO = 10_000n; // a hundredth of a day → micro units

export function calculate(i: CalcInput): CalcOutcome {
  const warnings: string[] = [];
  const skipped: string[] = [];
  const top = i.topUp !== null;
  const att = top
    ? {
        monthDays: '0',
        paidDays: '0',
        lopDays: '0',
        preJoinDays: '0',
        postLeaveDays: '0',
        otHours: i.attendance.otHours,
      }
    : i.attendance;
  const lines: Line[] = [];
  let order = 0;
  const versionsUsed: Record<string, string> = {};
  const structureUsed: Record<string, string> = {};
  const ratesUsed: Record<string, { id: string; value: string }> = {};

  // ---- the structure's earning heads, in dependency order ---------------------------------------------------
  // a top-up pays no structure line, but its rates still project the year's tax (the legacy missed them)
  const enrolled = i.structure;
  if (!top && !enrolled.length)
    return fail('NO_STRUCTURE', 'No salary structure in force this month.');
  const param = new Map(enrolled.map((s) => [s.code, s]));
  const earningHeads: Head[] = [];
  const deductionHeads: Head[] = [];
  for (const s of enrolled) {
    const h = i.heads[s.code];
    if (!h)
      return fail('NO_HEAD', `The structure names ${s.code}, which is not a pay head in use.`);
    if (ENGINE.has(h.code)) {
      skipped.push(
        `${h.code} on the structure is worked out by payroll: the amount there is not used`,
      );
      continue;
    }
    if (!h.version) return fail('NO_VERSION', `${h.code} has no version in force this month.`);
    (h.headType === 'EARNING' ? earningHeads : deductionHeads).push(h);
  }
  const ordered = calcOrder(
    earningHeads.map((h) => ({
      code: h.code,
      calcType: h.version!.calcType,
      formula: h.version!.formula,
      dependsOn: h.version!.dependsOn,
    })),
    'earning',
  );
  if (!ordered.ok) return fail('CYCLE', ordered.error);

  const paidH = daysToHundredths(att.paidDays);
  const monthH = daysToHundredths(att.monthDays);
  const fullVars = (paid: bigint, ot: bigint): Record<string, bigint> => {
    const v: Record<string, bigint> = {
      PAID_DAYS: paid * DAY_MICRO,
      MONTH_DAYS: monthH * DAY_MICRO,
      OT_HOURS: ot * DAY_MICRO,
    };
    const level = /^(\d+)/.exec(i.employee.payLevel ?? '');
    if (level) v.PAY_LEVEL = BigInt(level[1]!) * 1_000_000n;
    for (const [k, n] of Object.entries(i.attributes)) v[k] = BigInt(Math.round(n)) * 1_000_000n;
    return v;
  };
  const rateMicro = (code: string): bigint | null => {
    const r = i.rates[code];
    if (!r) return null;
    const m = decToScaled(r.value, 6);
    if (m === null) return null;
    ratesUsed[code] = { id: r.id, value: r.value };
    return m;
  };

  const rates = new Map<string, bigint>();
  const projections = new Map<string, bigint>();
  /** a formula's value in the month and at full attendance, or why it cannot be worked out */
  const formulaValue = (
    h: Head,
    pass: 1 | 2,
    bags: Array<{ heads: Record<string, bigint>; vars: Record<string, bigint> }>,
  ) => {
    const compiled = compile(h.version!.formula ?? '', pass);
    if (!compiled.ok) return { error: `${h.code} formula: ${compiled.errors.join('; ')}` };
    const out: bigint[] = [];
    for (const bag of bags) {
      const vars = { ...bag.vars };
      for (const name of compiled.varsUsed) {
        if (name in vars) continue;
        const m = rateMicro(name);
        if (m === null)
          return {
            error: `${h.code} needs '${name}': no rate of that name is in force this month.`,
          };
        vars[name] = m;
      }
      for (const ref of compiled.headsUsed) {
        if (ref in bag.heads) continue;
        if (ref.endsWith('_BASE')) {
          const base = param.get(ref.slice(0, -5));
          if (base) {
            bag.heads[ref] = paiseToMicro(base.amount);
            continue;
          }
        }
        return {
          error: `${h.code} refers to [${ref}], which is not on this employee's structure (or not worked out first).`,
        };
      }
      const r = evaluate(compiled, bag.heads, vars);
      if (!r.ok) return { error: `${h.code}: ${r.errors.join('; ')}` };
      out.push(r.paise);
    }
    return { values: out };
  };

  const otH = daysToHundredths(att.otHours);
  for (const code of ordered.order) {
    const h = i.heads[code]!;
    const v = h.version!;
    const s = param.get(code)!;
    structureUsed[code] = s.rowId;
    versionsUsed[code] = v.id;
    let rate: bigint;
    let projection: bigint;
    switch (v.calcType) {
      case 'FIXED':
      case 'MANUAL':
      case 'SYSTEM':
        rate = s.amount;
        projection = s.amount;
        break;
      case 'FORMULA': {
        const bagNow = {
          heads: Object.fromEntries([...rates].map(([k, x]) => [k, paiseToMicro(x)])),
          vars: fullVars(paidH, otH),
        };
        const bagFull = {
          heads: Object.fromEntries([...projections].map(([k, x]) => [k, paiseToMicro(x)])),
          vars: fullVars(monthH, 0n),
        };
        const r = formulaValue(h, 1, [bagNow, bagFull]);
        if ('error' in r) return fail('FORMULA', r.error!);
        rate = r.values![0]!;
        projection = r.values![1]!;
        break;
      }
      case 'SLAB': {
        if (!v.slabs.length) return fail('SLAB', `${code} is a slab head without slabs.`);
        const basisOf = (src: Map<string, bigint>) => {
          switch (v.slabs[0]!.basis) {
            case 'BASIC':
              return src.get('BASIC') ?? 0n;
            case 'BASIC_DA':
              return (src.get('BASIC') ?? 0n) + (src.get('DA') ?? 0n);
            case 'GROSS':
              return [...src.values()].reduce((n, x) => n + x, 0n);
            case 'PAY_LEVEL': {
              const m = /^(\d+)/.exec(i.employee.payLevel ?? '');
              return m ? BigInt(m[1]!) * 100n : 0n;
            }
          }
        };
        const slabValue = (basis: bigint) => {
          const sl = v.slabs.find((x) => x.from <= basis && (x.to === null || basis <= x.to));
          if (!sl) return 0n;
          return (
            sl.flat ?? divHalfUp(basis * (decToScaled(sl.percent ?? '0', 4) ?? 0n), 1_000_000n)
          );
        };
        rate = slabValue(basisOf(rates));
        projection = slabValue(basisOf(projections));
        break;
      }
    }
    rates.set(code, roundHead(rate, v.rounding));
    projections.set(code, roundHead(projection, v.rounding));
  }

  // ---- earnings: prorated for loss of pay ------------------------------------------------------------------
  let grossFixed = 0n;
  let structureEarned = 0n;
  const flags = new Map<Line, { pf: boolean; esi: boolean; pt: boolean; taxable: boolean }>();
  for (const code of top ? [] : ordered.order) {
    const h = i.heads[code]!;
    const v = h.version!;
    if (code === 'OT' && i.rateBasedOt) {
      skipped.push(
        'OT on the structure is not worked out: this month has a rate-based overtime entry',
      );
      continue;
    }
    const rate = rates.get(code)!;
    const earned = v.prorateOnLop
      ? roundHead(prorate(rate, att.paidDays, att.monthDays), v.rounding)
      : rate;
    grossFixed += rate;
    structureEarned += earned;
    const line: Line = {
      code,
      name: h.name,
      headType: 'EARNING',
      rate,
      earned,
      isArrear: false,
      isStructure: true,
      taxable: v.isTaxable,
      calcOrder: (order += 1),
      printOrder: h.printOrder,
      showIfZero: h.showIfZero,
      source: { kind: 'structure', id: param.get(code)!.rowId },
    };
    lines.push(line);
    flags.set(line, { pf: v.pfWage, esi: v.esiWage, pt: v.ptWage, taxable: v.isTaxable });
  }
  // arrears (owed for an earlier month)
  for (const a of i.arrears) {
    const h = i.heads[a.code];
    const line: Line = {
      code: a.code,
      name: `${h?.name ?? a.code} (arrear)`,
      headType: 'EARNING',
      rate: a.amount,
      earned: a.amount,
      isArrear: true,
      isStructure: false,
      taxable: a.taxable,
      calcOrder: (order += 1),
      printOrder: h?.printOrder ?? 900,
      showIfZero: false,
      source: { kind: 'arrear', id: a.id },
    };
    lines.push(line);
    flags.set(line, { pf: a.pf, esi: false, pt: false, taxable: a.taxable });
  }
  // one-off earnings of the month
  const usedAdhoc: string[] = [];
  for (const a of i.adhoc) {
    const h = i.heads[a.code];
    if (!h)
      return fail('NO_HEAD', `A one-off line names ${a.code}, which is not a pay head in use.`);
    if (h.headType !== 'EARNING') continue;
    usedAdhoc.push(a.id);
    const v = h.version;
    const line: Line = {
      code: a.code,
      name: h.name,
      headType: 'EARNING',
      rate: a.amount,
      earned: a.amount,
      isArrear: false,
      isStructure: false,
      taxable: v?.isTaxable ?? true,
      calcOrder: (order += 1),
      printOrder: h.printOrder,
      showIfZero: h.showIfZero,
      source: { kind: 'adhoc', id: a.id },
    };
    lines.push(line);
    flags.set(line, {
      pf: v?.pfWage ?? false,
      esi: v?.esiWage ?? false,
      pt: v?.ptWage ?? false,
      taxable: v?.isTaxable ?? true,
    });
  }
  const earnings = lines.filter((l) => l.headType === 'EARNING');
  const grossEarned = earnings.reduce((n, l) => n + l.earned, 0n);
  const lopAmount = grossFixed - structureEarned;
  const sumIf = (k: 'pf' | 'esi' | 'pt' | 'taxable') =>
    earnings.reduce((n, l) => n + (flags.get(l)![k] ? l.earned : 0n), 0n);
  const pfBasket = sumIf('pf');
  const esiWage = sumIf('esi');
  const ptWage = sumIf('pt');
  const taxableNow = sumIf('taxable');
  const monthlyRate = ordered.order.reduce(
    (n, code) => n + (i.heads[code]!.version!.isTaxable ? projections.get(code)! : 0n),
    0n,
  );

  // ---- statutory --------------------------------------------------------------------------------------------
  const st = i.statutory;
  const p = i.profile;
  const engine: Array<{ code: string; amount: bigint; id?: string }> = [];
  const monthEnd = new Date(Date.UTC(Number(i.month.slice(0, 4)), Number(i.month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  let pfR: ReturnType<typeof pfOf> | null = null;
  let epsNote: string | null = null;
  if (p.pfApplicable && st.pfSegments?.length) {
    let eps = p.epsApplicable;
    if (eps && i.employee.dob && ageOn(i.employee.dob, monthEnd) >= st.epsStopAge) {
      eps = false;
      epsNote = `EPS stops: ${String(st.epsStopAge)} or over by the month's end`;
    }
    pfR = pfOf({
      basket: pfBasket,
      basis: p.pfWageBasis,
      prorateCeiling: st.pfCeilingProrate,
      paidDays: top ? '1' : att.paidDays,
      monthDays: top ? '1' : att.monthDays,
      segments: st.pfSegments,
      eps,
      vpf: { type: p.vpfType, value: p.vpfValue },
      topUpUsed: i.topUp?.pfWageUsed ?? null,
    });
    engine.push({ code: 'PF', amount: pfR.eePf }, { code: 'VPF', amount: pfR.vpf });
  }
  let npsR: CalcResult['nps'] = null;
  if (p.npsApplicable && pfBasket > 0n) {
    const r = npsOf(
      pfBasket,
      p.npsEeRate,
      p.npsErRate,
      i.heads.NPS?.version?.rounding ?? 'NEAREST_1',
    );
    npsR = { ...r, eeRate: p.npsEeRate, erRate: p.npsErRate };
    engine.push({ code: 'NPS', amount: r.ee });
  }
  let esiR: CalcResult['esi'] = null;
  if (p.esiApplicable && st.esi && esiWage > 0n) {
    const covered =
      st.esiCovered ?? esiCoveredAt(esiWage, st.esi.wageLimit, st.esi.pwdLimit, p.pwd);
    const r = esiOf(
      esiWage,
      st.esi.eeRate,
      st.esi.erRate,
      i.heads.ESI?.version?.rounding ?? 'CEIL_1',
    );
    esiR = covered ? { covered, ...r } : { covered, wage: esiWage, ee: 0n, er: 0n };
    if (covered) engine.push({ code: 'ESI', amount: r.ee });
  }
  let lwfR: CalcResult['lwf'] = null;
  if (st.lwf && !(top && st.lwf.eeFlat !== null)) {
    const r = lwfOf(grossEarned, i.month, st.lwf);
    if (r.due && (r.ee > 0n || r.er > 0n)) {
      lwfR = { ee: r.ee, er: r.er };
      engine.push({ code: 'LWF', amount: r.ee });
    }
  }
  let ptAmount = 0n;
  let ptSlab: PtSlab | null = null;
  if (!top && p.ptApplicable && st.ptSlabs) {
    const r = professionTax(ptWage, i.employee.gender, i.month, st.ptSlabs);
    ptAmount = r.amount;
    ptSlab = r.slab;
    engine.push({ code: 'PT', amount: ptAmount });
  }
  // ---- income tax ----------------------------------------------------------------------------------------
  let tds: CalcResult['tds'] = null;
  let it = 0n;
  let cess = 0n;
  if (i.tax.manual) {
    it = i.tax.manual.it;
    cess = i.tax.manual.cess;
    tds = { manual: true, it, cess };
  } else if (p.tdsMode === 'PROJECTION') {
    if (!i.tax.rules)
      return fail(
        'NO_TAX_RULES',
        `No income-tax slabs for the ${p.taxRegime === 'NEW' ? 'new' : 'old'} regime this year: add the year in Payroll set-up → Income tax.`,
      );
    const pr = (top ? topUpTax : projectTax)({
      regime: p.taxRegime,
      ytdTaxable: i.tax.ytdTaxable,
      thisTaxable: taxableNow,
      monthlyRate,
      monthsLeft: i.tax.monthsLeft,
      ytdPt: i.tax.ytdPt,
      thisPt: ptAmount,
      monthlyPt: ptAmount,
      ytdTds: i.tax.ytdTds,
      panPresent: i.employee.panPresent,
      rules: i.tax.rules,
    });
    it = pr.it;
    cess = pr.cess;
    tds = pr;
    warnings.push(...pr.warnings);
  } else
    warnings.push('Income tax is typed by hand for this employee and none is typed this month');
  engine.push({ code: 'TDS', amount: it + cess });

  // ---- deductions ---------------------------------------------------------------------------------------
  const deductionLine = (
    code: string,
    amount: bigint,
    source: Line['source'],
    rate = amount,
  ): Line | null => {
    const h = i.heads[code];
    if (!h) return null;
    return {
      code,
      name: h.name,
      headType: 'DEDUCTION',
      rate,
      earned: amount,
      isArrear: false,
      isStructure: source.kind === 'structure',
      taxable: false,
      calcOrder: (order += 1),
      printOrder: h.printOrder,
      showIfZero: h.showIfZero,
      source,
    };
  };
  const loansOut: CalcResult['loans'] = [];
  if (!top)
    for (const l of i.loans) {
      const m = loanMonth(l.terms, l.balance);
      loansOut.push({
        id: l.id,
        interest: m.interest,
        emi: m.emi,
        principal: m.principalPart,
        closing: m.closing,
      });
      engine.push({ code: 'ADV', amount: m.emi, id: l.id });
    }
  const usedRecurring: string[] = [];
  const deductedHeads = new Set<string>();
  if (!top)
    for (const r of i.recurring) {
      if (ENGINE.has(r.code)) {
        skipped.push(`A recurring ${r.code} is worked out by payroll: not deducted`);
        continue;
      }
      const l = deductionLine(r.code, r.amount, { kind: 'recurring', id: r.id });
      if (!l)
        return fail(
          'NO_HEAD',
          `A recurring deduction names ${r.code}, which is not a pay head in use.`,
        );
      lines.push(l);
      usedRecurring.push(r.id);
      deductedHeads.add(r.code);
    }
  for (const a of i.adhoc) {
    const h = i.heads[a.code]!;
    if (h.headType !== 'DEDUCTION') continue;
    usedAdhoc.push(a.id);
    if (ENGINE.has(a.code)) {
      skipped.push(`A one-off ${a.code} is worked out by payroll: not deducted`);
      continue;
    }
    lines.push(deductionLine(a.code, a.amount, { kind: 'adhoc', id: a.id })!);
    deductedHeads.add(a.code);
  }
  // the structure's own deductions (pass 2: they may use GROSS_EARNED, PF_WAGE, BASIC_DA)
  const dOrder = calcOrder(
    deductionHeads.map((h) => ({
      code: h.code,
      calcType: h.version!.calcType,
      formula: h.version!.formula,
      dependsOn: h.version!.dependsOn,
    })),
    'deduction',
  );
  if (!dOrder.ok) return fail('CYCLE', dOrder.error);
  const dValues: Record<string, bigint> = Object.fromEntries(
    earnings.filter((l) => !l.isArrear).map((l) => [l.code, paiseToMicro(l.earned)]),
  );
  for (const code of top ? [] : dOrder.order) {
    const h = i.heads[code]!;
    const v = h.version!;
    const s = param.get(code)!;
    structureUsed[code] = s.rowId;
    versionsUsed[code] = v.id;
    if (deductedHeads.has(code)) {
      skipped.push(
        `${code} on the structure is not deducted: a recurring or one-off ${code} is deducted this month`,
      );
      continue;
    }
    let amount: bigint;
    if (v.calcType === 'FORMULA') {
      const vars = {
        ...fullVars(paidH, otH),
        GROSS_EARNED: paiseToMicro(grossEarned),
        PF_WAGE: paiseToMicro(pfR?.pfWage ?? pfBasket),
        BASIC_DA: paiseToMicro(earnedOf('BASIC') + earnedOf('DA')),
      };
      const r = formulaValue(h, 2, [{ heads: { ...dValues }, vars }]);
      if ('error' in r) return fail('FORMULA', r.error!);
      amount = r.values![0]!;
    } else if (v.calcType === 'SLAB')
      return fail(
        'CALC_TYPE',
        `${code} is a slab deduction: only fixed and formula deductions are worked out.`,
      );
    else amount = s.amount;
    amount = roundHead(amount, v.rounding);
    const earned = v.prorateOnLop
      ? roundHead(prorate(amount, att.paidDays, att.monthDays), v.rounding)
      : amount;
    dValues[code] = paiseToMicro(earned);
    lines.push(deductionLine(code, earned, { kind: 'structure', id: s.rowId }, amount)!);
  }
  // what payroll works out, last
  for (const e of engine) {
    if (e.amount === 0n) continue;
    const l = deductionLine(
      e.code,
      e.amount,
      e.id ? { kind: 'loan', id: e.id } : { kind: 'engine' },
    );
    if (!l)
      return fail('NO_HEAD', `There is no ${e.code} deduction head in use: add it in Pay heads.`);
    lines.push(l);
  }

  // ---- net -----------------------------------------------------------------------------------------------
  const deductions = lines
    .filter((l) => l.headType === 'DEDUCTION')
    .reduce((n, l) => n + l.earned, 0n);
  const netRaw = grossEarned - deductions;
  if (netRaw < 0n)
    return fail(
      'NEGATIVE_NET',
      `NEGATIVE_NET: the net would be -${(Number(-netRaw) / 100).toFixed(2)} — recover it over the coming months, then process again.`,
    );
  const net = roundHead(netRaw, st.netRounding);
  let totalDeductions = deductions;
  if (net !== netRaw) {
    const adj = netRaw - net;
    lines.push({
      code: 'ROUND_ADJ',
      name: 'Rounding adjustment',
      headType: 'DEDUCTION',
      rate: adj,
      earned: adj,
      isArrear: false,
      isStructure: false,
      taxable: false,
      calcOrder: (order += 1),
      printOrder: 999,
      showIfZero: false,
      source: { kind: 'rounding' },
    });
    totalDeductions += adj;
  }
  return {
    ok: true,
    lines,
    grossFixed,
    grossEarned,
    lopAmount,
    pfWage: pfR?.pfWage ?? 0n,
    esiWage: esiR?.covered ? esiWage : 0n,
    ptWage,
    ptAmount,
    itAmount: it,
    cessAmount: cess,
    totalDeductions,
    netPay: net,
    ncpDays: top ? 0n : ncpDays(att.monthDays, att.lopDays, att.preJoinDays, att.postLeaveDays),
    pf: pfR,
    nps: npsR,
    esi: esiR,
    lwf: lwfR,
    loans: loansOut,
    used: { arrears: i.arrears.map((a) => a.id), adhoc: usedAdhoc, recurring: usedRecurring },
    tds,
    trace: {
      attendance: att,
      structure: structureUsed,
      versions: versionsUsed,
      rates: ratesUsed,
      attributes: i.attributes,
      pfSegments: st.pfSegments?.map((s) => s.id) ?? [],
      eps: epsNote,
      esi: esiR
        ? {
            covered: esiR.covered,
            decided: st.esiCovered === null ? 'this month' : 'earlier in the period',
            setting: st.esi!.id,
          }
        : null,
      lwf: lwfR ? st.lwf!.id : null,
      ptSlab: ptSlab
        ? {
            gender: ptSlab.gender,
            from: String(ptSlab.from),
            to: ptSlab.to === null ? null : String(ptSlab.to),
          }
        : null,
      topUp: top
        ? {
            pfWageUsed: String(i.topUp!.pfWageUsed),
            headroom: pfR?.topUpHeadroom === null || !pfR ? null : String(pfR.topUpHeadroom),
          }
        : null,
      skipped,
    },
    warnings,
  };

  function earnedOf(code: string) {
    return earnings.find((l) => l.code === code && l.isStructure)?.earned ?? 0n;
  }
}
