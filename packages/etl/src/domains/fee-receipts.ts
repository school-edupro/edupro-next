import type { PoolClient } from 'pg';
import type { Loader, ReconcileMeasure, Step, Transformed } from '../pipeline';
import { reject, type Reject } from '../reject';
import { normaliseDate, normaliseYearCode, text, toMoney } from '../transforms';

type Rejects = Array<Reject & { column?: string; legacyKey?: string }>;

// ---- Sprint 13: legacy fees (receipt header) + fees_transaction (lines) → fee_payments -------------

/** The legacy `fees` header: one row per receipt with the student and the collection detail. */
export interface RawFeeReceipt {
  receipt?: unknown;
  sadmission?: unknown;
  sname?: unknown;
  sclass?: unknown;
  srollno?: unknown;
  fees_amount?: unknown;
  ReceiptDate?: unknown;
  datetime?: unknown;
  PaymentMode?: unknown;
  ChequeNo?: unknown;
  BankName?: unknown;
  ChequeDate?: unknown;
  TransactionId?: unknown;
  FinancialYear?: unknown;
  status?: unknown;
}

/** The legacy `fees_transaction` line: the heads and the late fee columns of one receipt. */
export interface RawFeeReceiptLine {
  ReceiptNo?: unknown;
  PBalanceReceiptNo?: unknown;
  TutionFee?: unknown;
  TransportFee?: unknown;
  AnnualCharges?: unknown;
  ActualLateFee?: unknown;
  AdjustedLateFee?: unknown;
  PreviousBalance?: unknown;
  PaidBalanceAmt?: unknown;
  CurrentBalance?: unknown;
  Discount?: unknown;
  ReceiptDate?: unknown;
}

export interface FeeReceiptRecord {
  receiptNo: string;
  admissionNo: string;
  receivedOn: string;
  amount: string;
  /** online, cash, cheque, dd, upi, bank, card */
  mode: string;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  reference: string | null;
  cancelled: boolean;
  legacyYear: string | null;
}

export interface FeeReceiptLineRecord {
  receiptNo: string;
  tuition: string;
  transport: string;
  annual: string;
  /** what the rule computed and what the desk actually charged (ActualLateFee, AdjustedLateFee) */
  lateFeeComputed: string;
  lateFee: string;
  previousBalance: string;
  paidBalance: string;
  currentBalance: string;
  discount: string;
  /** the sum of the head columns plus the late fee charged; the header amount must equal it */
  total: string;
}

const money2 = (v: string | null | undefined) => Number(v ?? 0).toFixed(2);

const MODES: Record<string, string> = {
  cash: 'cash',
  cheque: 'cheque',
  chq: 'cheque',
  dd: 'dd',
  'demand draft': 'dd',
  upi: 'upi',
  neft: 'bank',
  rtgs: 'bank',
  imps: 'bank',
  bank: 'bank',
  'bank transfer': 'bank',
  online: 'online',
  payu: 'online',
  card: 'card',
  'debit card': 'card',
  'credit card': 'card',
  pos: 'card',
};

/** Legacy PaymentMode strings to the target modes; unknown strings are rejected (never guessed). */
export function normaliseMode(v: unknown): string | Reject {
  const s = (text(v) ?? 'cash').toLowerCase().replace(/\s+/g, ' ');
  return MODES[s] ?? reject('fee_receipt.mode_unknown', v, false);
}

/** Receipt numbers are kept verbatim (upper case, trimmed); the sequences are set past the maximum later. */
export const feeReceiptStep: Step<RawFeeReceipt, FeeReceiptRecord> = {
  legacyTable: 'fees',
  transform(raw) {
    const rejects: Rejects = [];
    const receiptNo = text(raw.receipt)?.toUpperCase() ?? null;
    if (!receiptNo)
      rejects.push({
        ...reject('fee_receipt.number_missing', raw.receipt, true),
        column: 'receipt',
      });
    const admissionNo = text(raw.sadmission)?.toUpperCase() ?? null;
    if (!admissionNo)
      rejects.push({
        ...reject('fee_receipt.admission_missing', raw.sadmission, true),
        column: 'sadmission',
      });
    const on = normaliseDate(raw.ReceiptDate ?? raw.datetime);
    if (on.kind !== 'ok') rejects.push({ ...on, column: 'ReceiptDate' });
    else if (on.value === null)
      rejects.push({
        ...reject('fee_receipt.date_missing', raw.ReceiptDate, true),
        column: 'ReceiptDate',
      });
    const amount = toMoney(raw.fees_amount);
    if (amount.kind !== 'ok') rejects.push({ ...amount, column: 'fees_amount' });
    else if (amount.value === null || Number(amount.value) <= 0)
      rejects.push({
        ...reject('fee_receipt.amount_invalid', raw.fees_amount, true),
        column: 'fees_amount',
      });
    const mode = normaliseMode(raw.PaymentMode);
    if (typeof mode !== 'string') rejects.push({ ...mode, column: 'PaymentMode' });
    const instrumentDate = normaliseDate(raw.ChequeDate);
    if (instrumentDate.kind !== 'ok') rejects.push({ ...instrumentDate, column: 'ChequeDate' });
    const year =
      raw.FinancialYear === undefined || raw.FinancialYear === null || raw.FinancialYear === ''
        ? null
        : normaliseYearCode(raw.FinancialYear);
    if (year && year.kind !== 'ok') rejects.push({ ...year, column: 'FinancialYear' });
    if (
      rejects.length ||
      !receiptNo ||
      !admissionNo ||
      on.kind !== 'ok' ||
      amount.kind !== 'ok' ||
      typeof mode !== 'string'
    )
      return rejects;
    const status = (text(raw.status) ?? '').toLowerCase();
    return {
      legacyKey: receiptNo,
      legacyYear: year && year.kind === 'ok' ? year.value : (on.value!.slice(0, 4) ?? null),
      row: {
        receiptNo,
        admissionNo,
        receivedOn: on.value!,
        amount: money2(amount.value),
        mode,
        instrumentNo: text(raw.ChequeNo),
        instrumentDate: instrumentDate.kind === 'ok' ? instrumentDate.value : null,
        bankName: text(raw.BankName),
        reference: text(raw.TransactionId),
        cancelled: status === 'cancelled' || status === 'cancel' || status === 'bounced',
        legacyYear: year && year.kind === 'ok' ? year.value : null,
      },
    };
  },
};

/** One fees_transaction row per receipt; the late fee actually charged is AdjustedLateFee. */
export const feeReceiptLineStep: Step<RawFeeReceiptLine, FeeReceiptLineRecord> = {
  legacyTable: 'fees_transaction',
  transform(raw) {
    const rejects: Rejects = [];
    const receiptNo = text(raw.ReceiptNo)?.toUpperCase() ?? null;
    if (!receiptNo)
      rejects.push({
        ...reject('fee_receipt_line.number_missing', raw.ReceiptNo, true),
        column: 'ReceiptNo',
      });
    const cols = {
      tuition: toMoney(raw.TutionFee ?? '0'),
      transport: toMoney(raw.TransportFee ?? '0'),
      annual: toMoney(raw.AnnualCharges ?? '0'),
      lateFeeComputed: toMoney(raw.ActualLateFee ?? '0'),
      lateFee: toMoney(raw.AdjustedLateFee ?? raw.ActualLateFee ?? '0'),
      previousBalance: toMoney(raw.PreviousBalance ?? '0'),
      paidBalance: toMoney(raw.PaidBalanceAmt ?? '0'),
      currentBalance: toMoney(raw.CurrentBalance ?? '0'),
      discount: toMoney(raw.Discount ?? '0'),
    };
    for (const [k, r] of Object.entries(cols))
      if (r.kind !== 'ok') rejects.push({ ...r, column: k });
    if (rejects.length || !receiptNo) return rejects;
    const v = Object.fromEntries(
      Object.entries(cols).map(([k, r]) => [k, money2(r.kind === 'ok' ? r.value : '0')]),
    ) as Record<keyof typeof cols, string>;
    const total =
      Number(v.tuition) +
      Number(v.transport) +
      Number(v.annual) +
      Number(v.paidBalance) +
      Number(v.lateFee) -
      Number(v.discount);
    return {
      legacyKey: receiptNo,
      row: { receiptNo, ...v, total: money2(String(Math.max(total, 0))) },
    };
  },
};

export interface ReceiptYearTotals {
  legacyYear: string;
  receipts: number;
  students: number;
  amount: string;
  lateFee: string;
  byMode: Array<{ mode: string; receipts: number; amount: string }>;
  /** receipts whose header amount differs from the sum of their line, or that have no line at all */
  quarantined: string[];
}

/** Joins headers to lines per receipt; a header without a line, or whose amount differs, is quarantined. */
export function feeReceiptTotalsByYear(
  headers: FeeReceiptRecord[],
  lines: FeeReceiptLineRecord[],
): ReceiptYearTotals[] {
  const byNo = new Map(lines.map((l) => [l.receiptNo, l]));
  const years = new Map<
    string,
    {
      receipts: number;
      students: Set<string>;
      amount: number;
      lateFee: number;
      modes: Map<string, { receipts: number; amount: number }>;
      quarantined: string[];
    }
  >();
  for (const h of headers) {
    if (h.cancelled) continue;
    const key = h.legacyYear ?? h.receivedOn.slice(0, 4);
    const y = years.get(key) ?? {
      receipts: 0,
      students: new Set<string>(),
      amount: 0,
      lateFee: 0,
      modes: new Map<string, { receipts: number; amount: number }>(),
      quarantined: [] as string[],
    };
    const line = byNo.get(h.receiptNo);
    if (!line || Math.abs(Number(line.total) - Number(h.amount)) > 0.01) {
      y.quarantined.push(h.receiptNo);
      years.set(key, y);
      continue;
    }
    y.receipts += 1;
    y.students.add(h.admissionNo);
    y.amount += Number(h.amount);
    y.lateFee += Number(line.lateFee);
    const m = y.modes.get(h.mode) ?? { receipts: 0, amount: 0 };
    m.receipts += 1;
    m.amount += Number(h.amount);
    y.modes.set(h.mode, m);
    years.set(key, y);
  }
  return [...years.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([legacyYear, y]) => ({
      legacyYear,
      receipts: y.receipts,
      students: y.students.size,
      amount: money2(String(y.amount)),
      lateFee: money2(String(y.lateFee)),
      byMode: [...y.modes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mode, m]) => ({ mode, receipts: m.receipts, amount: money2(String(m.amount)) })),
      quarantined: y.quarantined.sort(),
    }));
}

/** Reconcile measures for one year: the legacy SQL sums against the transformed receipts. */
export function reconcileFeeReceiptYear(
  legacy: { receipts: number; amount: number; lateFee: number },
  totals: ReceiptYearTotals,
): ReconcileMeasure[] {
  return [
    {
      measure: 'fee_receipt.receipts',
      legacyValue: legacy.receipts,
      targetValue: totals.receipts + totals.quarantined.length,
    },
    {
      measure: 'fee_receipt.amount',
      legacyValue: Number(legacy.amount.toFixed(2)),
      targetValue: Number(totals.amount),
    },
    {
      measure: 'fee_receipt.late_fee',
      legacyValue: Number(legacy.lateFee.toFixed(2)),
      targetValue: Number(totals.lateFee),
    },
    { measure: 'fee_receipt.quarantined', legacyValue: 0, targetValue: totals.quarantined.length },
  ];
}

/**
 * Loads receipts of one academic year: the header becomes a fee_payments row with its legacy number kept
 * verbatim, allocated to the student's demand by app.allocate_fee_payment; the late fee charged becomes a
 * posting against the earliest instalment the receipt settled. Cancelled receipts load as bounced.
 */
export function feeReceiptLoader(lookups: {
  academicYearId: string;
  financialYearId: string;
  studentIdByAdmissionNo: Map<string, string>;
  lineByReceiptNo: Map<string, FeeReceiptLineRecord>;
}): Loader<FeeReceiptRecord> {
  return {
    targetTable: 'fee_payments',
    async load(client: PoolClient, rows: Array<Transformed<FeeReceiptRecord>>): Promise<string[]> {
      const ids: string[] = [];
      for (const { row } of rows) {
        const studentId = lookups.studentIdByAdmissionNo.get(row.admissionNo);
        if (!studentId)
          throw new Error(`fee_receipt.student_unknown ${row.admissionNo} (${row.receiptNo})`);
        const line = lookups.lineByReceiptNo.get(row.receiptNo);
        const lateFee = line ? Number(line.lateFee) : 0;
        const r = await client.query<{ id: string }>(
          `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, reference, remarks, ledger, financial_year_id, receipt_no,
                                     instrument_no, instrument_date, bank_name, late_fee, status)
           VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5, $6, 'legacy import', 'school', $7, $8, $9, $10::date, $11, $12, $13)
           ON CONFLICT (school_id, receipt_no) WHERE receipt_no IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount, received_on = EXCLUDED.received_on, mode = EXCLUDED.mode
           RETURNING id::text`,
          [
            studentId,
            lookups.academicYearId,
            row.amount,
            row.receivedOn,
            row.mode,
            row.reference,
            lookups.financialYearId,
            row.receiptNo,
            row.instrumentNo,
            row.instrumentDate,
            row.bankName,
            lateFee.toFixed(2),
            row.cancelled ? 'bounced' : 'posted',
          ],
        );
        const id = r.rows[0]!.id;
        ids.push(id);
        if (row.cancelled) continue;
        await client.query(`DELETE FROM fee_payment_allocations WHERE payment_id = $1`, [id]);
        await client.query(`DELETE FROM fee_late_fee_postings WHERE payment_id = $1`, [id]);
        await client.query(`SELECT app.allocate_fee_payment($1)`, [id]);
        if (lateFee > 0)
          await client.query(
            `INSERT INTO fee_late_fee_postings (school_id, payment_id, student_id, academic_year_id, due_on, period_id, amount, mode, days)
             SELECT app.current_school_id(), $1, $2, $3, COALESCE(min(d.due_on), $4::date), NULL, $5, 'legacy', 0
               FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id WHERE a.payment_id = $1`,
            [id, studentId, lookups.academicYearId, row.receivedOn, lateFee.toFixed(2)],
          );
      }
      return ids;
    },
  };
}
