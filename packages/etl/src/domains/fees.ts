/**
 * Domain 5 (Sprint 8): fee masters for the pilot. Legacy Fees_Head, fees_master (class x head x month x
 * StudentType x fee type), Fees_MonthQuaterMapping (instalment months with due dates) and
 * fees_discountmaster (percent or fixed per head) become fee_heads, fee_structures, fee_periods and
 * fee_discounts. Transforms only here; the loader lands with the fee module ETL rehearsal.
 */
import type { PoolClient } from 'pg';
import type { Loader, ReconcileMeasure, Step, Transformed } from '../pipeline';
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

// ---- Sprint 12: fees_student (the legacy demand) → fee_demands for every year ----------------------

export interface RawFeeStudentDemand {
  sadmission?: unknown;
  feeshead?: unknown;
  head_original_amount?: unknown;
  head_concession_amount?: unknown;
  amount?: unknown;
  quarter?: unknown;
  Month?: unknown;
  StudentType?: unknown;
  FeesType?: unknown;
  InputSource?: unknown;
  FinancialYear?: unknown;
}

export interface FeeDemandRecord {
  admissionNo: string;
  headCode: string;
  gross: string;
  discount: string;
  net: string;
  /** academic period sequence: April = 1 ... March = 12 */
  sequence: number;
  instalment: number | null;
  studentType: 'new' | 'old' | null;
  feeGroup: string;
  source: string;
  legacyYear: string;
}

const money2 = (v: string) => Number(v).toFixed(2);

/**
 * One legacy `fees_student` row is one demand row: admission number, head, original amount, concession and
 * net per month. The net is recomputed from gross minus concession and the legacy `amount` is checked
 * against it (a mismatch is a blocking reject: the legacy ledger disagrees with itself).
 */
export const feeDemandStep: Step<RawFeeStudentDemand, FeeDemandRecord> = {
  legacyTable: 'fees_student',
  transform(raw) {
    const rejects: Rejects = [];
    const admissionNo = text(raw.sadmission)?.toUpperCase() ?? null;
    if (!admissionNo)
      rejects.push({
        ...reject('fee_demand.admission_missing', raw.sadmission, true),
        column: 'sadmission',
      });
    const head = normaliseCode(raw.feeshead);
    if (head.kind !== 'ok') rejects.push({ ...head, column: 'feeshead' });
    const gross = toMoney(raw.head_original_amount ?? raw.amount);
    if (gross.kind !== 'ok') rejects.push({ ...gross, column: 'head_original_amount' });
    else if (gross.value === null)
      rejects.push({
        ...reject('fee_demand.amount_missing', raw.head_original_amount, true),
        column: 'head_original_amount',
      });
    const concession = toMoney(raw.head_concession_amount ?? '0');
    if (concession.kind !== 'ok') rejects.push({ ...concession, column: 'head_concession_amount' });
    const month = normaliseMonth(raw.Month);
    if (month.kind !== 'ok') rejects.push({ ...month, column: 'Month' });
    else if (month.value === null)
      rejects.push({ ...reject('fee_demand.month_missing', raw.Month, true), column: 'Month' });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (!year)
      rejects.push({
        ...reject('fee_demand.year_missing', raw.FinancialYear, true),
        column: 'FinancialYear',
      });
    else if (year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (
      rejects.length ||
      !admissionNo ||
      head.kind !== 'ok' ||
      gross.kind !== 'ok' ||
      concession.kind !== 'ok' ||
      month.kind !== 'ok' ||
      !year ||
      year.kind !== 'ok'
    )
      return rejects;
    const g = Number(gross.value);
    const d = Number(concession.value ?? '0');
    const net = Math.max(g - d, 0);
    const legacyNet = toMoney(raw.amount);
    if (
      legacyNet.kind === 'ok' &&
      legacyNet.value !== null &&
      raw.head_original_amount !== undefined &&
      Math.abs(Number(legacyNet.value) - net) > 0.01
    )
      return [
        {
          ...reject('fee_demand.net_mismatch', `${raw.amount} vs ${net.toFixed(2)}`, true),
          column: 'amount',
          legacyKey: `${admissionNo}|${head.value}|${raw.Month}|${year.value}`,
        },
      ];
    const st = String(raw.StudentType ?? '')
      .trim()
      .toLowerCase();
    const q = Number(String(raw.quarter ?? '').replace(/\D/g, ''));
    return {
      legacyKey: `${admissionNo}|${head.value}|${month.value}|${year.value}`,
      legacyYear: year.value,
      row: {
        admissionNo,
        headCode: head.value,
        gross: g.toFixed(2),
        discount: d.toFixed(2),
        net: net.toFixed(2),
        sequence: ((month.value! + 8) % 12) + 1,
        instalment: q >= 1 && q <= 12 ? q : null,
        studentType: st === 'new' ? 'new' : st === 'old' ? 'old' : null,
        feeGroup:
          (text(raw.FeesType) ?? 'general')
            .toLowerCase()
            .replace(/[^a-z]+/g, '_')
            .replace(/^_|_$/g, '') || 'general',
        source: text(raw.InputSource)?.toLowerCase() ?? 'legacy',
        legacyYear: year.value,
      },
    };
  },
};

export interface YearTotals {
  legacyYear: string;
  rows: number;
  students: number;
  gross: string;
  discount: string;
  net: string;
  byHead: Array<{ headCode: string; rows: number; net: string }>;
}

/** Per-year totals of the transformed demand, the figures the rehearsal compares with the legacy SQL sums. */
export function feeDemandTotalsByYear(rows: FeeDemandRecord[]): YearTotals[] {
  const years = new Map<
    string,
    {
      rows: number;
      students: Set<string>;
      gross: number;
      discount: number;
      net: number;
      heads: Map<string, { rows: number; net: number }>;
    }
  >();
  for (const r of rows) {
    const y = years.get(r.legacyYear) ?? {
      rows: 0,
      students: new Set<string>(),
      gross: 0,
      discount: 0,
      net: 0,
      heads: new Map(),
    };
    y.rows += 1;
    y.students.add(r.admissionNo);
    y.gross += Number(r.gross);
    y.discount += Number(r.discount);
    y.net += Number(r.net);
    const h = y.heads.get(r.headCode) ?? { rows: 0, net: 0 };
    h.rows += 1;
    h.net += Number(r.net);
    y.heads.set(r.headCode, h);
    years.set(r.legacyYear, y);
  }
  return [...years.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([legacyYear, y]) => ({
      legacyYear,
      rows: y.rows,
      students: y.students.size,
      gross: money2(String(y.gross)),
      discount: money2(String(y.discount)),
      net: money2(String(y.net)),
      byHead: [...y.heads.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([headCode, h]) => ({ headCode, rows: h.rows, net: money2(String(h.net)) })),
    }));
}

/** Reconcile measures for one year: legacy sums (from the source SQL) against the transformed rows. */
export function reconcileFeeDemandYear(
  legacy: { rows: number; net: number; students: number },
  totals: YearTotals,
): ReconcileMeasure[] {
  return [
    { measure: 'fee_demand.rows', legacyValue: legacy.rows, targetValue: totals.rows },
    {
      measure: 'fee_demand.net',
      legacyValue: Number(legacy.net.toFixed(2)),
      targetValue: Number(totals.net),
    },
    { measure: 'fee_demand.students', legacyValue: legacy.students, targetValue: totals.students },
  ];
}

/**
 * Loads demand rows for one academic year into fee_demands (upsert on student, year, period and head).
 * The caller resolves the target academic year and passes the lookups; unknown students, heads or periods
 * are reported as rejects by the pipeline through the thrown error, one batch at a time.
 */
export function feeDemandLoader(lookups: {
  academicYearId: string;
  studentIdByAdmissionNo: Map<string, string>;
  headIdByCode: Map<string, string>;
  periodIdBySequence: Map<number, string>;
  periodDueOnBySequence: Map<number, string>;
}): Loader<FeeDemandRecord> {
  return {
    targetTable: 'fee_demands',
    async load(client: PoolClient, rows: Array<Transformed<FeeDemandRecord>>): Promise<string[]> {
      const ids: string[] = [];
      for (const { row } of rows) {
        const studentId = lookups.studentIdByAdmissionNo.get(row.admissionNo);
        const headId = lookups.headIdByCode.get(row.headCode);
        const periodId = lookups.periodIdBySequence.get(row.sequence);
        const dueOn = lookups.periodDueOnBySequence.get(row.sequence);
        if (!studentId) throw new Error(`fee_demand.student_unknown:${row.admissionNo}`);
        if (!headId) throw new Error(`fee_demand.head_unknown:${row.headCode}`);
        if (!periodId || !dueOn) throw new Error(`fee_demand.period_unknown:${row.sequence}`);
        const r = await client.query<{ id: string }>(
          `INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::date, $9)
           ON CONFLICT (student_id, academic_year_id, period_id, head_id)
           DO UPDATE SET gross = EXCLUDED.gross, discount = EXCLUDED.discount, net = EXCLUDED.net, due_on = EXCLUDED.due_on, source = EXCLUDED.source, updated_at = now()
           RETURNING id::text`,
          [
            studentId,
            lookups.academicYearId,
            periodId,
            headId,
            row.gross,
            row.discount,
            row.net,
            dueOn,
            `legacy:${row.source}`,
          ],
        );
        ids.push(r.rows[0]!.id);
      }
      return ids;
    },
  };
}
