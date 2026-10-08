import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { UploadBankStatementDto } from './payments.dto';
import { parseCsv } from './settlements.service';

export interface BankStatementRow {
  id: string;
  bankName: string;
  accountRef: string | null;
  fromDate: string | null;
  toDate: string | null;
  fileName: string | null;
  rows: number;
  matched: number;
  unmatched: number;
  returned: number;
  credits: string;
  debits: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface BankLine {
  id: string;
  lineNo: number;
  txnDate: string;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  debit: string;
  credit: string;
  balance: string | null;
  status: 'matched' | 'unmatched' | 'ambiguous' | 'returned' | 'ignored';
  matchedBy: string | null;
  paymentId: string | null;
  miscReceiptId: string | null;
  receiptNo: string | null;
  note: string | null;
}

const ALIASES: Record<string, string[]> = {
  date: ['date', 'txn_date', 'transaction_date', 'tran_date', 'posting_date', 'book_date'],
  valueDate: ['value_date', 'value_dt', 'val_date'],
  narration: [
    'narration',
    'description',
    'particulars',
    'details',
    'remarks',
    'transaction_remarks',
  ],
  reference: [
    'ref',
    'reference',
    'ref_no',
    'cheque_no',
    'chq_no',
    'chq_ref_no',
    'cheque_number',
    'instrument_no',
    'utr',
    'utr_no',
    'transaction_id',
  ],
  debit: ['debit', 'withdrawal', 'withdrawal_amt', 'withdrawal_amount', 'dr', 'debit_amount'],
  credit: ['credit', 'deposit', 'deposit_amt', 'deposit_amount', 'cr', 'credit_amount'],
  balance: ['balance', 'closing_balance', 'running_balance', 'bal'],
  amount: ['amount', 'txn_amount', 'transaction_amount'],
  type: ['type', 'dr_cr', 'cr_dr', 'txn_type'],
};

const FUZZY: Record<string, RegExp> = {
  date: /^(txn|tran|transaction|posting|book)_?date$|^date$/,
  valueDate: /^value/,
  narration: /narration|description|particular|detail|remark/,
  reference: /chq|cheque|ref|utr|instrument/,
  debit: /debit|withdraw|^dr$/,
  credit: /credit|deposit|^cr$/,
  balance: /balance|^bal$/,
  amount: /^amount|amt$/,
  type: /dr_cr|cr_dr|type/,
};

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
const num = (s: string | undefined): number => {
  if (s === undefined) return 0;
  const v = Number(
    String(s)
      .replace(/[₹,\s]/g, '')
      .replace(/^\((.*)\)$/, '-$1'),
  );
  return Number.isFinite(v) ? v : 0;
};
/** dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, dd-Mon-yyyy */
export function parseBankDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[ /-]([A-Za-z]{3})[ /-](\d{2,4})/.exec(t);
  if (m) {
    const months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const mi = months.indexOf(m[2]!.toLowerCase());
    if (mi < 0) return null;
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(mi + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return null;
}

export interface ParsedBankLine {
  lineNo: number;
  txnDate: string;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

/** Reads a bank's CSV export; needs a date column and either debit/credit or amount(+type) columns. */
export function readBankCsv(csv: string): ParsedBankLine[] {
  const rows = parseCsv(csv);
  if (rows.length < 2)
    throw new DomainError('payments.csv_empty', 'The file has no lines', { status: 400 });
  // some banks put account details above the header: find the first row that has a date-ish header
  let headerAt = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const cols = rows[i]!.map(norm);
    if (cols.some((c) => ALIASES.date!.includes(c))) {
      headerAt = i;
      break;
    }
  }
  const header = rows[headerAt]!.map(norm);
  const col = (key: string) => {
    for (const alias of ALIASES[key]!) {
      const i = header.indexOf(alias);
      if (i >= 0) return i;
    }
    // banks label columns freely ("Ref No./Cheque No.", "Withdrawal Amt."): fall back to a pattern
    const pattern = FUZZY[key];
    return pattern ? header.findIndex((c) => pattern.test(c)) : -1;
  };
  const ix = {
    date: col('date'),
    valueDate: col('valueDate'),
    narration: col('narration'),
    reference: col('reference'),
    debit: col('debit'),
    credit: col('credit'),
    balance: col('balance'),
    amount: col('amount'),
    type: col('type'),
  };
  if (ix.date < 0 || (ix.debit < 0 && ix.credit < 0 && ix.amount < 0))
    throw new DomainError(
      'payments.csv_header',
      'The header needs a date column and debit/credit (or amount) columns',
      { status: 400, extra: { header } },
    );
  const out: ParsedBankLine[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const txnDate = parseBankDate(r[ix.date]);
    if (!txnDate) return; // footer / blank lines
    let debit = ix.debit >= 0 ? Math.abs(num(r[ix.debit])) : 0;
    let credit = ix.credit >= 0 ? Math.abs(num(r[ix.credit])) : 0;
    if (ix.debit < 0 && ix.credit < 0) {
      const amount = num(r[ix.amount]);
      const type = ix.type >= 0 ? (r[ix.type] ?? '').trim().toUpperCase() : '';
      if (type.startsWith('D') || amount < 0) debit = Math.abs(amount);
      else credit = Math.abs(amount);
    }
    out.push({
      lineNo: i + 1,
      txnDate,
      valueDate: ix.valueDate >= 0 ? parseBankDate(r[ix.valueDate]) : null,
      narration: ix.narration >= 0 ? (r[ix.narration] ?? '').trim() || null : null,
      reference: ix.reference >= 0 ? (r[ix.reference] ?? '').trim() || null : null,
      debit,
      credit,
      balance: ix.balance >= 0 && (r[ix.balance] ?? '').trim() !== '' ? num(r[ix.balance]) : null,
    });
  });
  return out;
}

const RETURN_WORDS = /\b(return|returned|bounce|bounced|dishonou?r|unpaid|reversal|rtn)\b/i;

/**
 * Sprint 15: bank upload reconciliation. Credits are matched to non-cash receipts (school, hostel, misc)
 * by instrument number or reference with the same amount, then by a unique amount within three days;
 * a match stamps cleared_on. Debits whose narration says the cheque came back are flagged for the desk
 * to raise a bounce adjustment — nothing is auto-posted.
 */
@Injectable()
export class BankStatementsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<BankStatementRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT b.id::text, b.bank_name, b.account_ref, b.from_date::text, b.to_date::text, b.file_name, b.rows, b.matched, b.unmatched, b.returned,
                b.credits::text, b.debits::text, u.display_name AS uploaded_by, b.created_at
           FROM bank_statements b LEFT JOIN users u ON u.id = b.uploaded_by
          WHERE $1::bigint IS NULL OR (COALESCE(b.to_date, b.created_at::date) >= (SELECT start_date FROM academic_years WHERE id = $1::bigint)
                                   AND COALESCE(b.from_date, b.created_at::date) <= (SELECT end_date FROM academic_years WHERE id = $1::bigint))
          ORDER BY b.created_at DESC LIMIT 200`,
        [requireTenant(ctx).academicYearId ?? null], // only statements that touch the working year
      );
      return r.rows.map(toStatement);
    });
  }

  async get(ctx: RequestContext, id: string): Promise<BankStatementRow & { lines: BankLine[] }> {
    return this.db.tenant(requireTenant(ctx), (c) => this.getWith(c, id));
  }

  /** Runs on the caller's open client (a nested db.tenant inside a transaction sees nothing). */
  private async getWith(
    c: PoolClient,
    id: string,
  ): Promise<BankStatementRow & { lines: BankLine[] }> {
    {
      const s = await c.query(
        `SELECT b.id::text, b.bank_name, b.account_ref, b.from_date::text, b.to_date::text, b.file_name, b.rows, b.matched, b.unmatched, b.returned,
                b.credits::text, b.debits::text, u.display_name AS uploaded_by, b.created_at
           FROM bank_statements b LEFT JOIN users u ON u.id = b.uploaded_by WHERE b.id = $1`,
        [id],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Statement not found', { status: 404 });
      const l = await c.query(
        `SELECT l.id::text, l.line_no, l.txn_date::text, l.value_date::text, l.narration, l.reference, l.debit::text, l.credit::text, l.balance::text,
                l.status, l.matched_by, l.payment_id::text, l.misc_receipt_id::text, COALESCE(p.receipt_no, m.receipt_no) AS receipt_no, l.note
           FROM bank_statement_lines l LEFT JOIN fee_payments p ON p.id = l.payment_id LEFT JOIN misc_receipts m ON m.id = l.misc_receipt_id
          WHERE l.statement_id = $1 ORDER BY l.line_no`,
        [id],
      );
      return {
        ...toStatement(s.rows[0]),
        lines: l.rows.map((x) => ({
          id: x.id,
          lineNo: x.line_no,
          txnDate: x.txn_date,
          valueDate: x.value_date,
          narration: x.narration,
          reference: x.reference,
          debit: x.debit,
          credit: x.credit,
          balance: x.balance,
          status: x.status,
          matchedBy: x.matched_by,
          paymentId: x.payment_id,
          miscReceiptId: x.misc_receipt_id,
          receiptNo: x.receipt_no,
          note: x.note,
        })),
      };
    }
  }

  async upload(ctx: RequestContext, dto: UploadBankStatementDto) {
    const tenant = requireTenant(ctx);
    const lines = readBankCsv(dto.csv);
    if (lines.length === 0)
      throw new DomainError('payments.csv_empty', 'No dated lines in the file', { status: 400 });
    return this.db.tenant(tenant, async (c) => {
      const dates = lines.map((l) => l.txnDate).sort();
      const s = await c.query<{ id: string }>(
        `INSERT INTO bank_statements (school_id, bank_name, account_ref, from_date, to_date, file_name, uploaded_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [
          dto.bankName,
          dto.accountRef ?? null,
          dates[0],
          dates[dates.length - 1],
          dto.fileName ?? null,
        ],
      );
      const statementId = s.rows[0]!.id;
      let matched = 0;
      let unmatched = 0;
      let returned = 0;
      let credits = 0;
      let debits = 0;
      for (const line of lines) {
        credits += line.credit;
        debits += line.debit;
        let status: BankLine['status'] = 'ignored';
        let matchedBy: string | null = null;
        let paymentId: string | null = null;
        let miscId: string | null = null;
        let note: string | null = null;
        if (line.credit > 0) {
          const hit = await this.matchCredit(c, line);
          status = hit.status;
          matchedBy = hit.matchedBy;
          paymentId = hit.paymentId;
          miscId = hit.miscId;
          note = hit.note;
          if (status === 'matched') matched += 1;
          else unmatched += 1;
        } else if (
          line.debit > 0 &&
          (RETURN_WORDS.test(line.narration ?? '') || RETURN_WORDS.test(line.reference ?? ''))
        ) {
          const back = await c.query<{ id: string; receipt_no: string }>(
            `SELECT id::text, receipt_no FROM fee_payments
              WHERE status NOT IN ('reversed', 'bounced') AND mode IN ('cheque', 'dd') AND abs(amount - $1::numeric) < 0.005
                AND (instrument_no = $2 OR ($3::text IS NOT NULL AND $3 ILIKE '%' || instrument_no || '%'))
              ORDER BY cleared_on DESC NULLS LAST, id DESC LIMIT 1`,
            [line.debit, line.reference, line.narration],
          );
          if (back.rows[0]) {
            status = 'returned';
            paymentId = back.rows[0].id;
            note = `Cheque of ${back.rows[0].receipt_no} returned by the bank: raise a bounce adjustment`;
            returned += 1;
          } else {
            status = 'ignored';
            note = 'Debit';
          }
        } else {
          note = 'Debit';
        }
        const ins = await c.query<{ id: string }>(
          `INSERT INTO bank_statement_lines (school_id, statement_id, line_no, txn_date, value_date, narration, reference, debit, credit, balance, status, matched_by, payment_id, misc_receipt_id, note)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id::text`,
          [
            statementId,
            line.lineNo,
            line.txnDate,
            line.valueDate,
            line.narration,
            line.reference,
            line.debit.toFixed(2),
            line.credit.toFixed(2),
            line.balance === null ? null : line.balance.toFixed(2),
            status,
            matchedBy,
            paymentId,
            miscId,
            note,
          ],
        );
        if (status === 'matched') {
          const cleared = line.valueDate ?? line.txnDate;
          if (paymentId)
            await c.query(
              `UPDATE fee_payments SET cleared_on = $2::date, bank_line_id = $3 WHERE id = $1`,
              [paymentId, cleared, ins.rows[0]!.id],
            );
          if (miscId)
            await c.query(
              `UPDATE misc_receipts SET cleared_on = $2::date, bank_line_id = $3 WHERE id = $1`,
              [miscId, cleared, ins.rows[0]!.id],
            );
        }
      }
      await c.query(
        `UPDATE bank_statements SET rows = $2, matched = $3, unmatched = $4, returned = $5, credits = $6, debits = $7 WHERE id = $1`,
        [
          statementId,
          lines.length,
          matched,
          unmatched,
          returned,
          credits.toFixed(2),
          debits.toFixed(2),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.bank_statement.upload',
        entityType: 'bank_statements',
        entityId: statementId,
        after: { bankName: dto.bankName, rows: lines.length, matched, unmatched, returned },
      });
      return this.getWith(c, statementId);
    });
  }

  private async matchCredit(
    c: PoolClient,
    line: ParsedBankLine,
  ): Promise<{
    status: BankLine['status'];
    matchedBy: string | null;
    paymentId: string | null;
    miscId: string | null;
    note: string | null;
  }> {
    const amount = line.credit.toFixed(2);
    const ref = line.reference?.trim() || null;
    const narration = line.narration ?? '';
    // 1. instrument number or reference (also inside the narration) with the same amount
    const byRef = await c.query<{ kind: string; id: string; receipt_no: string }>(
      `SELECT * FROM (
         SELECT 'payment' AS kind, p.id::text, p.receipt_no FROM fee_payments p
          WHERE p.status NOT IN ('reversed', 'bounced') AND p.mode <> 'cash' AND p.cleared_on IS NULL AND abs(p.amount - $1::numeric) < 0.005
            AND ((p.instrument_no IS NOT NULL AND (p.instrument_no = $2 OR $3 ILIKE '%' || p.instrument_no || '%'))
                 OR (p.reference IS NOT NULL AND length(p.reference) >= 6 AND (p.reference = $2 OR $3 ILIKE '%' || p.reference || '%')))
         UNION ALL
         SELECT 'misc', m.id::text, m.receipt_no FROM misc_receipts m
          WHERE m.status = 'posted' AND m.mode <> 'cash' AND m.cleared_on IS NULL AND abs(m.amount - $1::numeric) < 0.005
            AND ((m.instrument_no IS NOT NULL AND (m.instrument_no = $2 OR $3 ILIKE '%' || m.instrument_no || '%'))
                 OR (m.reference IS NOT NULL AND length(m.reference) >= 6 AND (m.reference = $2 OR $3 ILIKE '%' || m.reference || '%')))
       ) x LIMIT 2`,
      [amount, ref, narration],
    );
    if (byRef.rows.length === 1) {
      const r = byRef.rows[0]!;
      return {
        status: 'matched',
        matchedBy: 'reference',
        paymentId: r.kind === 'payment' ? r.id : null,
        miscId: r.kind === 'misc' ? r.id : null,
        note: r.receipt_no,
      };
    }
    if (byRef.rows.length > 1)
      return {
        status: 'ambiguous',
        matchedBy: null,
        paymentId: null,
        miscId: null,
        note: 'More than one receipt carries this reference',
      };
    // 2. a single uncleared non-cash receipt of the same amount within three days
    const byAmount = await c.query<{ kind: string; id: string; receipt_no: string }>(
      `SELECT * FROM (
         SELECT 'payment' AS kind, p.id::text, p.receipt_no FROM fee_payments p
          WHERE p.status NOT IN ('reversed', 'bounced') AND p.mode <> 'cash' AND p.cleared_on IS NULL AND abs(p.amount - $1::numeric) < 0.005
            AND p.received_on BETWEEN $2::date - 3 AND $2::date + 3
         UNION ALL
         SELECT 'misc', m.id::text, m.receipt_no FROM misc_receipts m
          WHERE m.status = 'posted' AND m.mode <> 'cash' AND m.cleared_on IS NULL AND abs(m.amount - $1::numeric) < 0.005
            AND m.received_on BETWEEN $2::date - 3 AND $2::date + 3
       ) x LIMIT 2`,
      [amount, line.txnDate],
    );
    if (byAmount.rows.length === 1) {
      const r = byAmount.rows[0]!;
      return {
        status: 'matched',
        matchedBy: 'amount_date',
        paymentId: r.kind === 'payment' ? r.id : null,
        miscId: r.kind === 'misc' ? r.id : null,
        note: r.receipt_no,
      };
    }
    if (byAmount.rows.length > 1)
      return {
        status: 'ambiguous',
        matchedBy: null,
        paymentId: null,
        miscId: null,
        note: 'Several receipts of this amount around the date',
      };
    return {
      status: 'unmatched',
      matchedBy: null,
      paymentId: null,
      miscId: null,
      note: 'No receipt found',
    };
  }
}

function toStatement(x: Record<string, unknown>): BankStatementRow {
  return {
    id: String(x.id),
    bankName: String(x.bank_name),
    accountRef: (x.account_ref as string | null) ?? null,
    fromDate: (x.from_date as string | null) ?? null,
    toDate: (x.to_date as string | null) ?? null,
    fileName: (x.file_name as string | null) ?? null,
    rows: Number(x.rows),
    matched: Number(x.matched),
    unmatched: Number(x.unmatched),
    returned: Number(x.returned),
    credits: String(x.credits),
    debits: String(x.debits),
    uploadedBy: (x.uploaded_by as string | null) ?? null,
    createdAt: (x.created_at as Date).toISOString(),
  };
}
