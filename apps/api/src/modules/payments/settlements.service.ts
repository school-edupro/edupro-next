import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { UploadSettlementDto } from './payments.dto';

export interface SettlementRow {
  id: string;
  provider: string;
  settlementRef: string;
  settledOn: string;
  utr: string | null;
  gross: string;
  charges: string;
  tax: string;
  net: string;
  rows: number;
  matched: number;
  unmatched: number;
  mismatched: number;
  fileName: string | null;
  uploadedBy: string | null;
  createdAt: string;
  lines?: SettlementLine[];
}

export interface SettlementLine {
  id: string;
  lineNo: number;
  providerRef: string | null;
  txnId: string | null;
  amount: string;
  charges: string;
  tax: string;
  net: string | null;
  status: 'matched' | 'unmatched' | 'amount_mismatch' | 'duplicate' | 'refund';
  intentId: string | null;
  paymentId: string | null;
  receiptNo: string | null;
  studentName: string | null;
  note: string | null;
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  providerRef: [
    'provider_ref',
    'payment_id',
    'mihpayid',
    'tracking_id',
    'txn_ref',
    'transaction_id',
    'razorpay_payment_id',
    'entity_id',
    'bank_ref_no',
  ],
  txnId: [
    'txn_id',
    'txnid',
    'order_id',
    'receipt',
    'merchant_txn_id',
    'merchant_order_id',
    'order_receipt',
  ],
  amount: ['amount', 'gross', 'gross_amount', 'transaction_amount', 'txn_amount'],
  charges: ['fee', 'fees', 'charges', 'mdr', 'commission'],
  tax: ['tax', 'gst', 'service_tax'],
  net: ['net', 'net_amount', 'settled_amount', 'credit'],
  type: ['type', 'entity', 'transaction_type', 'txn_type'],
};

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = Number(String(s).replace(/[₹,\s]/g, ''));
  return Number.isFinite(v) ? v : null;
};

export interface ParsedLine {
  lineNo: number;
  providerRef: string | null;
  txnId: string | null;
  amount: number;
  charges: number;
  tax: number;
  net: number | null;
  refund: boolean;
}

/** Reads the provider's CSV into lines; throws when the header has no reference or amount column. */
export function readSettlementCsv(csv: string): ParsedLine[] {
  const rows = parseCsv(csv);
  if (rows.length < 2)
    throw new DomainError('payments.settlement_empty', 'The file has a header but no lines', {
      status: 400,
    });
  const header = rows[0]!.map(norm);
  const col = (key: string): number => header.findIndex((h) => ALIASES[key]!.includes(h));
  const ix = {
    providerRef: col('providerRef'),
    txnId: col('txnId'),
    amount: col('amount'),
    charges: col('charges'),
    tax: col('tax'),
    net: col('net'),
    type: col('type'),
  };
  if (ix.amount < 0 || (ix.providerRef < 0 && ix.txnId < 0))
    throw new DomainError(
      'payments.settlement_columns',
      'The file needs an amount column and a payment id or order id column',
      { status: 400, extra: { header: rows[0] } },
    );
  const out: ParsedLine[] = [];
  rows.slice(1).forEach((r, i) => {
    const amount = num(r[ix.amount]);
    if (amount === null) return;
    const type = ix.type >= 0 ? String(r[ix.type] ?? '').toLowerCase() : '';
    out.push({
      lineNo: i + 1,
      providerRef: ix.providerRef >= 0 ? r[ix.providerRef]?.trim() || null : null,
      txnId: ix.txnId >= 0 ? r[ix.txnId]?.trim() || null : null,
      amount: Math.abs(amount),
      charges: Math.abs(num(r[ix.charges]) ?? 0),
      tax: Math.abs(num(r[ix.tax]) ?? 0),
      net: ix.net >= 0 ? num(r[ix.net]) : null,
      refund: type.includes('refund') || amount < 0,
    });
  });
  return out;
}

const money = (n: number) => n.toFixed(2);

/**
 * Sprint 13 settlement ingestion: the provider's payout file is stored line by line and every line is matched
 * to a succeeded intent by the provider's payment reference or by our transaction / order id. A line whose
 * amount differs from the intent is a mismatch; a payment settled by an earlier file is a duplicate; refund
 * lines are kept apart. Matched receipts carry the settlement line, so the ledger knows the money arrived.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<SettlementRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT s.id::text, s.provider, s.settlement_ref AS "settlementRef", s.settled_on::text AS "settledOn", s.utr, s.gross::text, s.charges::text, s.tax::text, s.net::text,
                s.rows, s.matched, s.unmatched, s.mismatched, s.file_name AS "fileName", u.display_name AS "uploadedBy", s.created_at AS "createdAt"
           FROM payment_settlements s LEFT JOIN users u ON u.id = s.uploaded_by
          WHERE $1::bigint IS NULL OR s.settled_on BETWEEN (SELECT start_date FROM academic_years WHERE id = $1::bigint) AND (SELECT end_date FROM academic_years WHERE id = $1::bigint)
          ORDER BY s.settled_on DESC, s.id DESC LIMIT 200`,
        [requireTenant(ctx).academicYearId ?? null], // only the working year's settlements
      );
      return r.rows.map(toRow);
    });
  }

  async get(ctx: RequestContext, id: string): Promise<SettlementRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
  }

  private async find(c: PoolClient, id: string): Promise<SettlementRow> {
    const r = await c.query<Record<string, unknown>>(
      `SELECT s.id::text, s.provider, s.settlement_ref AS "settlementRef", s.settled_on::text AS "settledOn", s.utr, s.gross::text, s.charges::text, s.tax::text, s.net::text,
              s.rows, s.matched, s.unmatched, s.mismatched, s.file_name AS "fileName", u.display_name AS "uploadedBy", s.created_at AS "createdAt"
         FROM payment_settlements s LEFT JOIN users u ON u.id = s.uploaded_by WHERE s.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Settlement not found', { status: 404 });
    const lines = await c.query<Record<string, unknown>>(
      `SELECT l.id::text, l.line_no AS "lineNo", l.provider_ref AS "providerRef", l.txn_id AS "txnId", l.amount::text, l.charges::text, l.tax::text, l.net::text, l.status,
              l.intent_id::text AS "intentId", l.payment_id::text AS "paymentId", p.receipt_no AS "receiptNo", st.display_name AS "studentName", l.note
         FROM payment_settlement_lines l LEFT JOIN fee_payments p ON p.id = l.payment_id LEFT JOIN students st ON st.id = p.student_id
        WHERE l.settlement_id = $1 ORDER BY l.line_no`,
      [id],
    );
    return { ...toRow(r.rows[0]), lines: lines.rows as unknown as SettlementLine[] };
  }

  async upload(ctx: RequestContext, dto: UploadSettlementDto): Promise<SettlementRow> {
    const tenant = requireTenant(ctx);
    const parsed = readSettlementCsv(dto.csv);
    return this.db.tenant(tenant, async (c) => {
      let settlementId: string;
      try {
        const s = await c.query<{ id: string }>(
          `INSERT INTO payment_settlements (school_id, provider, settlement_ref, settled_on, utr, file_name, uploaded_by, request_id)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
          [dto.provider, dto.settlementRef, dto.settledOn, dto.utr ?? null, dto.fileName ?? null],
        );
        settlementId = s.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'payments.settlement_exists',
            `Settlement ${dto.settlementRef} of ${dto.provider} was already uploaded`,
            { status: 409 },
          );
        throw error;
      }
      let gross = 0;
      let charges = 0;
      let tax = 0;
      let net = 0;
      let matched = 0;
      let unmatched = 0;
      let mismatched = 0;
      for (const line of parsed) {
        gross += line.refund ? 0 : line.amount;
        charges += line.charges;
        tax += line.tax;
        net += line.net ?? (line.refund ? -line.amount : line.amount - line.charges - line.tax);
        let status: SettlementLine['status'] = 'unmatched';
        let intentId: string | null = null;
        let paymentId: string | null = null;
        let note: string | null = null;
        if (line.refund) status = 'refund';
        else {
          const hit = await c.query<{
            id: string;
            amount: string;
            status: string;
            payment_id: string | null;
            settled: string | null;
          }>(
            `SELECT i.id::text, i.amount::text, i.status::text, p.id::text AS payment_id, p.settlement_line_id::text AS settled
               FROM payment_intents i LEFT JOIN fee_payments p ON p.intent_id = i.id
              WHERE i.provider = $1 AND (($2::text IS NOT NULL AND i.provider_ref = $2) OR ($3::text IS NOT NULL AND (i.txn_id = $3 OR i.provider_order_id = $3)))
              ORDER BY (i.provider_ref = $2) DESC NULLS LAST LIMIT 1`,
            [dto.provider === 'mock' ? 'mock' : dto.provider, line.providerRef, line.txnId],
          );
          const h = hit.rows[0];
          if (!h) {
            status = 'unmatched';
            note = 'No intent with this reference';
          } else if (h.status !== 'succeeded') {
            status = 'unmatched';
            intentId = h.id;
            note = `Intent is ${h.status}`;
          } else if (Math.abs(Number(h.amount) - line.amount) > 0.005) {
            status = 'amount_mismatch';
            intentId = h.id;
            paymentId = h.payment_id;
            note = `Intent amount ₹${h.amount}`;
          } else if (h.settled) {
            status = 'duplicate';
            intentId = h.id;
            paymentId = h.payment_id;
            note = 'Already settled by an earlier file';
          } else {
            status = 'matched';
            intentId = h.id;
            paymentId = h.payment_id;
          }
        }
        const l = await c.query<{ id: string }>(
          `INSERT INTO payment_settlement_lines (school_id, settlement_id, line_no, provider_ref, txn_id, amount, charges, tax, net, status, intent_id, payment_id, note)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id::text`,
          [
            settlementId,
            line.lineNo,
            line.providerRef,
            line.txnId,
            money(line.amount),
            money(line.charges),
            money(line.tax),
            line.net === null ? null : money(line.net),
            status,
            intentId,
            paymentId,
            note,
          ],
        );
        if (status === 'matched') {
          matched += 1;
          if (paymentId)
            await c.query(`UPDATE fee_payments SET settlement_line_id = $2 WHERE id = $1`, [
              paymentId,
              l.rows[0]!.id,
            ]);
        } else if (status === 'amount_mismatch' || status === 'duplicate') mismatched += 1;
        else if (status === 'unmatched') unmatched += 1;
      }
      await c.query(
        `UPDATE payment_settlements SET gross = $2, charges = $3, tax = $4, net = $5, rows = $6, matched = $7, unmatched = $8, mismatched = $9 WHERE id = $1`,
        [
          settlementId,
          money(gross),
          money(charges),
          money(tax),
          money(net),
          parsed.length,
          matched,
          unmatched,
          mismatched,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.settlement.upload',
        entityType: 'payment_settlements',
        entityId: settlementId,
        after: {
          provider: dto.provider,
          settlementRef: dto.settlementRef,
          rows: parsed.length,
          matched,
          unmatched,
          mismatched,
        },
      });
      return this.find(c, settlementId);
    });
  }
}

const toRow = (x: Record<string, unknown>): SettlementRow =>
  ({ ...x, createdAt: (x.createdAt as Date).toISOString() }) as SettlementRow;
