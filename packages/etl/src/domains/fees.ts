/**
 * Domain 5 (Sprint 8): fee masters for the pilot. Legacy Fees_Head, fees_master (class x head x month x
 * StudentType x fee type), Fees_MonthQuaterMapping (instalment months with due dates) and
 * fees_discountmaster (percent or fixed per head) become fee_heads, fee_structures, fee_periods and
 * fee_discounts. Transforms only here; the loader lands with the fee module ETL rehearsal.
 */
import type { Step } from '../pipeline';
import { reject, type Reject } from '../reject';
import {
  normaliseCode,
  normaliseDate,
  normaliseMonth,
  normaliseYearCode,
  repairMojibake,
  text,
  toMoney,
} from '../transforms';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

export interface RawFeeHead {
  FeeHeadId?: unknown;
  FeeHead?: unknown;
  HeadType?: unknown;
  Optional?: unknown;
  SortOrder?: unknown;
}
export interface FeeHeadRecord {
  code: string;
  name: string;
  kind: 'regular' | 'transport' | 'opening_balance' | 'late_fee' | 'misc';
  isOptional: boolean;
  sortOrder: number;
  legacyRef: string;
}

const yes = (v: unknown) =>
  ['y', 'yes', '1', 'true'].includes(
    String(v ?? '')
      .trim()
      .toLowerCase(),
  );

export const feeHeadStep: Step<RawFeeHead, FeeHeadRecord> = {
  legacyTable: 'Fees_Head',
  transform(raw) {
    const rejects: Rejects = [];
    const name = text(repairMojibake(raw.FeeHead));
    if (!name)
      rejects.push({ ...reject('fee_head.name_missing', raw.FeeHead, true), column: 'FeeHead' });
    const codeRes = normaliseCode(raw.FeeHeadId ?? name);
    if (codeRes.kind !== 'ok') rejects.push({ ...codeRes, column: 'FeeHeadId' });
    if (rejects.length || !name || codeRes.kind !== 'ok') return rejects;
    const type = String(raw.HeadType ?? '').toLowerCase();
    const kind: FeeHeadRecord['kind'] =
      type.includes('transport') || /transport|bus/i.test(name)
        ? 'transport'
        : type.includes('late')
          ? 'late_fee'
          : type.includes('open') || /opening|previous balance/i.test(name)
            ? 'opening_balance'
            : type.includes('misc')
              ? 'misc'
              : 'regular';
    return {
      legacyKey: codeRes.value,
      row: {
        code: codeRes.value,
        name,
        kind,
        isOptional: yes(raw.Optional),
        sortOrder: Number(raw.SortOrder ?? 0) || 0,
        legacyRef: String(raw.FeeHeadId ?? name),
      },
    };
  },
};

export interface RawFeeStructure {
  class?: unknown;
  feeshead?: unknown;
  amount?: unknown;
  Month?: unknown;
  Quarter?: unknown;
  StudentType?: unknown;
  FeesType?: unknown;
  FinancialYear?: unknown;
}
export interface FeeStructureRecord {
  classCode: string;
  headCode: string;
  amount: string;
  month: number | null;
  studentType: 'all' | 'new' | 'old';
  feeGroup: string;
  legacyYear: string | null;
}

export const feeStructureStep: Step<RawFeeStructure, FeeStructureRecord> = {
  legacyTable: 'fees_master',
  transform(raw) {
    const rejects: Rejects = [];
    const classCode = text(raw.class)?.toUpperCase() ?? null;
    if (!classCode)
      rejects.push({ ...reject('fee_structure.class_missing', raw.class, true), column: 'class' });
    const head = normaliseCode(raw.feeshead);
    if (head.kind !== 'ok') rejects.push({ ...head, column: 'feeshead' });
    const amount = toMoney(raw.amount);
    if (amount.kind !== 'ok') rejects.push({ ...amount, column: 'amount' });
    else if (amount.value === null)
      rejects.push({
        ...reject('fee_structure.amount_missing', raw.amount, true),
        column: 'amount',
      });
    const month = normaliseMonth(raw.Month);
    if (month.kind !== 'ok') rejects.push({ ...month, column: 'Month' });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (
      rejects.length ||
      !classCode ||
      head.kind !== 'ok' ||
      amount.kind !== 'ok' ||
      month.kind !== 'ok'
    )
      return rejects;
    const st = String(raw.StudentType ?? 'all')
      .trim()
      .toLowerCase();
    return {
      legacyKey: `${classCode}|${head.value}|${raw.Month ?? ''}|${st}`,
      row: {
        classCode,
        headCode: head.value,
        amount: amount.value!,
        month: month.value,
        studentType: st === 'new' ? 'new' : st === 'old' ? 'old' : 'all',
        feeGroup:
          (text(raw.FeesType) ?? 'general')
            .toLowerCase()
            .replace(/[^a-z]+/g, '_')
            .replace(/^_|_$/g, '') || 'general',
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

/** Groups monthly legacy rows into one structure per class, head, type and group with the periods listed. */
export function collapseStructures(rows: FeeStructureRecord[]): Array<
  Omit<FeeStructureRecord, 'month'> & {
    periods: number[];
    frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'one_time' | 'custom';
  }
> {
  const map = new Map<string, Omit<FeeStructureRecord, 'month'> & { periods: number[] }>();
  for (const r of rows) {
    const key = `${r.classCode}|${r.headCode}|${r.studentType}|${r.feeGroup}|${r.amount}`;
    const cur = map.get(key) ?? {
      classCode: r.classCode,
      headCode: r.headCode,
      amount: r.amount,
      studentType: r.studentType,
      feeGroup: r.feeGroup,
      legacyYear: r.legacyYear,
      periods: [],
    };
    if (r.month !== null) {
      // academic sequence: April = 1 ... March = 12
      const seq = ((r.month + 8) % 12) + 1;
      if (!cur.periods.includes(seq)) cur.periods.push(seq);
    }
    map.set(key, cur);
  }
  return [...map.values()].map((s) => {
    const p = [...s.periods].sort((a, b) => a - b);
    const frequency =
      p.length === 12
        ? 'monthly'
        : p.join(',') === '1,4,7,10'
          ? 'quarterly'
          : p.join(',') === '1,7'
            ? 'half_yearly'
            : p.join(',') === '1'
              ? 'annual'
              : p.length === 0
                ? 'one_time'
                : 'custom';
    return { ...s, periods: p, frequency };
  });
}

export interface RawMonthQuarter {
  Month?: unknown;
  Quarter?: unknown;
  FeesSubmissionLastDate?: unknown;
  FinancialYear?: unknown;
}
export interface FeePeriodRecord {
  month: number;
  instalment: number;
  dueOn: string;
  legacyYear: string | null;
}

export const feePeriodStep: Step<RawMonthQuarter, FeePeriodRecord> = {
  legacyTable: 'Fees_MonthQuaterMapping',
  transform(raw) {
    const rejects: Rejects = [];
    const month = normaliseMonth(raw.Month);
    if (month.kind !== 'ok') rejects.push({ ...month, column: 'Month' });
    else if (month.value === null)
      rejects.push({ ...reject('fee_period.month_missing', raw.Month, true), column: 'Month' });
    const q = Number(String(raw.Quarter ?? '').replace(/\D/g, ''));
    if (!q || q < 1 || q > 12)
      rejects.push({
        ...reject('fee_period.quarter_invalid', raw.Quarter, true),
        column: 'Quarter',
      });
    const due = normaliseDate(raw.FeesSubmissionLastDate);
    if (due.kind !== 'ok') rejects.push({ ...due, column: 'FeesSubmissionLastDate' });
    else if (due.value === null)
      rejects.push({
        ...reject('fee_period.due_missing', raw.FeesSubmissionLastDate, true),
        column: 'FeesSubmissionLastDate',
      });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (rejects.length || month.kind !== 'ok' || due.kind !== 'ok') return rejects;
    return {
      legacyKey: `${month.value}|${q}`,
      row: {
        month: month.value!,
        instalment: q,
        dueOn: due.value!,
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

export interface RawDiscount {
  DiscountCode?: unknown;
  DiscountName?: unknown;
  feeshead?: unknown;
  DiscountType?: unknown; // 'Percent' | 'Fixed'
  DiscountValue?: unknown;
  ApplyOnTransport?: unknown;
}
export interface FeeDiscountRecord {
  code: string;
  name: string;
  headCode: string | null;
  percent: string | null;
  amount: string | null;
  appliesToTransport: boolean;
}

export const feeDiscountStep: Step<RawDiscount, FeeDiscountRecord> = {
  legacyTable: 'fees_discountmaster',
  transform(raw) {
    const rejects: Rejects = [];
    const code = normaliseCode(raw.DiscountCode ?? raw.DiscountName);
    if (code.kind !== 'ok') rejects.push({ ...code, column: 'DiscountCode' });
    const name = text(repairMojibake(raw.DiscountName)) ?? (code.kind === 'ok' ? code.value : null);
    const value = toMoney(raw.DiscountValue);
    if (value.kind !== 'ok') rejects.push({ ...value, column: 'DiscountValue' });
    else if (value.value === null)
      rejects.push({
        ...reject('discount.value_missing', raw.DiscountValue, true),
        column: 'DiscountValue',
      });
    const isPercent = /percent|%/i.test(String(raw.DiscountType ?? 'percent'));
    if (isPercent && value.kind === 'ok' && value.value !== null && Number(value.value) > 100)
      rejects.push({
        ...reject('discount.percent_out_of_range', raw.DiscountValue, true),
        column: 'DiscountValue',
      });
    if (rejects.length || code.kind !== 'ok' || value.kind !== 'ok' || !name) return rejects;
    const head = text(raw.feeshead);
    return {
      legacyKey: code.value,
      row: {
        code: code.value,
        name,
        headCode: head && head.toLowerCase() !== 'all' ? head.toUpperCase() : null,
        percent: isPercent ? value.value : null,
        amount: isPercent ? null : value.value,
        appliesToTransport: yes(raw.ApplyOnTransport),
      },
    };
  },
};
