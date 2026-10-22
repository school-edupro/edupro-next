import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FeeAdjustmentsService } from '../fees/fee-adjustments.service';
import { FeeDocumentsService } from '../fees/fee-documents.service';
import { likeEscape } from './library-borrower-sql';
import { libraryFile, type FileCell } from './library-file';
import { announceMiscFee, LIBRARY_HEADS, libraryHead, libraryYear } from './library-misc';
import type { BookSaleDto, SalesExportDto, SalesQueryDto } from './library.dto';

type BuyerKind = 'student' | 'employee' | 'other';
type Mode = 'cash' | 'upi' | 'card' | 'bank';
/** A row of a sales file as read. */
type FileRow = {
  row: number;
  accessionNo: string;
  buyerType: string;
  ref: string;
  name: string;
  mobile: string;
  price: string;
  mode: string;
  reference: string;
  remark: string;
};
/** A row of a sales file as checked. */
type CheckedRow = {
  row: number;
  ok: boolean;
  error: string | null;
  accessionNo: string;
  title: string | null;
  buyerKind: BuyerKind | null;
  buyerId: string | null;
  buyer: string | null;
  mobile: string | null;
  price: number | null;
  mode: Mode | null;
  reference: string | null;
  remark: string | null;
  group: string | null;
};

const round = (n: number) => Math.round(n * 100) / 100;
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const MOBILE = /^[6-9]\d{9}$/;
const MODES: Mode[] = ['cash', 'upi', 'card', 'bank'];
const SELLABLE = ['available', 'damaged', 'withdrawn'];
/** A sale's payment: no price, a misc receipt (outside), a misc fee (pupil or staff) or an old sale. */
const STATE = `CASE WHEN o.total = 0 THEN 'free'
  WHEN o.misc_receipt_id IS NOT NULL THEN CASE WHEN mr.status = 'posted' THEN 'paid' ELSE 'cancelled' END
  WHEN o.misc_line_id IS NOT NULL THEN CASE
    WHEN ml.status = 'cancelled' OR mf.status = 'closed' THEN 'cancelled'
    WHEN ml.paid >= ml.amount THEN 'paid' ELSE 'due' END
  ELSE 'paid' END`;
const PAY_JOINS = `LEFT JOIN misc_receipts mr ON mr.id = o.misc_receipt_id
  LEFT JOIN misc_fee_students ml ON ml.id = o.misc_line_id
  LEFT JOIN misc_fees mf ON mf.id = o.misc_fee_id`;
const BUYER_REF = `CASE o.buyer_kind WHEN 'student' THEN (SELECT st.admission_no FROM students st WHERE st.id = o.buyer_id)
  WHEN 'employee' THEN (SELECT e.employee_code FROM employees e WHERE e.id = o.buyer_id) END`;
export const SALE_STATE_LABEL: Record<string, string> = {
  due: 'Due at the fees counter',
  paid: 'Paid',
  cancelled: 'Cancelled',
  free: 'No price',
};
const ALIAS: Record<keyof Omit<FileRow, 'row'>, string[]> = {
  accessionNo: [
    'accession no',
    'accession number',
    'accession',
    'acc no',
    'book no',
    'book number',
    'barcode',
  ],
  buyerType: ['buyer', 'buyer type', 'buyer is', 'sold to'],
  ref: [
    'adm no',
    'admission no',
    'admission number',
    'emp code',
    'employee code',
    'adm emp no',
    'admission or employee no',
    'buyer no',
  ],
  name: ['buyer name', 'name'],
  mobile: ['mobile', 'mobile no', 'phone', 'buyer mobile'],
  price: ['price', 'sale price', 'amount', 'rate'],
  mode: ['pay mode', 'mode', 'payment mode', 'paid by'],
  reference: ['reference', 'ref', 'txn no', 'transaction no'],
  remark: ['remarks', 'remark', 'note', 'notes'],
};
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
};
const kindOf = (s: string): BuyerKind | null => {
  const n = norm(s);
  if (['pupil', 'student'].includes(n)) return 'student';
  if (['staff', 'employee', 'teacher', 'staff member'].includes(n)) return 'employee';
  if (['outside', 'other', 'outsider', 'public', 'visitor', 'outside the school'].includes(n))
    return 'other';
  return null;
};

/**
 * Books sold (docs/design/36-library.md, "Library reports", part 4): one buyer and one or more books, the
 * copies marked sold; a pupil or staff member owes a misc fee announced at once (paid at the fees
 * counter), someone outside the school pays on a numbered misc receipt printed at the library; a file of
 * sales checked before it is applied; the sales between two days with what is paid, as Excel or PDF.
 */
@Injectable()
export class LibrarySalesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly receipts: FeeAdjustmentsService,
    private readonly papers: FeeDocumentsService,
  ) {}

  // ---- a book and a buyer ------------------------------------------------------------------------
  private async copyOf(c: PoolClient, no: string, lock = false) {
    const sql = `SELECT x.id::text, x.accession_no, t.title, t.author, x.status::text, COALESCE(x.price, t.price)::text AS price,
              l.name AS library
         FROM library_copies x JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_libraries l ON l.id = x.library_id
        WHERE x.id = app.library_copy_by_number($1)`;
    const r = await c.query<{
      id: string;
      accession_no: string;
      title: string;
      author: string | null;
      status: string;
      price: string | null;
      library: string | null;
    }>(lock ? sql + ' FOR UPDATE OF x' : sql, [no]);
    const x = r.rows[0];
    if (!x) return { no, copy: null, problem: 'No such book' };
    const problem = SELLABLE.includes(x.status)
      ? null
      : x.status === 'issued'
        ? 'It is on loan: return it first'
        : x.status === 'sold'
          ? 'It is sold already'
          : `It is ${x.status}`;
    return {
      no,
      copy: {
        id: x.id,
        accessionNo: x.accession_no,
        title: x.title,
        author: x.author,
        status: x.status,
        price: x.price === null ? null : Number(x.price),
        library: x.library,
      },
      problem,
    };
  }

  /** A book as the sale desk sees it: whether it can be sold, and its price as bought. */
  async book(ctx: RequestContext, accessionNo: string) {
    const no = (accessionNo ?? '').trim();
    if (!no || no.length > 40)
      throw new DomainError('validation-failed', 'Scan or type the book number', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.copyOf(c, no);
      return { ...b, canSell: !!b.copy && !b.problem };
    });
  }

  private async buyerOf(
    c: PoolClient,
    kind: BuyerKind,
    id?: string,
    name?: string,
    mobile?: string,
  ) {
    if (kind === 'other')
      return { kind, id: null, name: name!.trim(), ref: null, mobile: mobile ?? null };
    const r =
      kind === 'student'
        ? await c.query<{ name: string; ref: string; mobile: string | null }>(
            `SELECT s.display_name AS name, s.admission_no AS ref,
                    (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                      WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS mobile
               FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
            [id],
          )
        : await c.query<{ name: string; ref: string; mobile: string | null }>(
            `SELECT display_name AS name, employee_code AS ref, mobile FROM employees WHERE id = $1 AND deleted_at IS NULL`,
            [id],
          );
    const x = r.rows[0];
    if (!x)
      throw new DomainError(
        'not-found',
        kind === 'student' ? 'Pupil not found' : 'Staff member not found',
        { status: 404 },
      );
    return { kind, id: id!, name: x.name, ref: x.ref, mobile: x.mobile };
  }

  // ---- a sale ------------------------------------------------------------------------------------
  /** One buyer's books sold in the caller's transaction: copies sold, then the misc fee or the receipt. */
  private async sellIn(c: PoolClient, ctx: RequestContext, dto: BookSaleDto, uploadId?: string) {
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('library.sale.' || app.current_school_id()::text, 0))`,
    );
    const on = dto.soldOn ?? today();
    if (on > today())
      throw new DomainError('validation-failed', 'A sale cannot be dated after today', {
        status: 400,
      });
    const buyer = await this.buyerOf(c, dto.buyerKind, dto.buyerId, dto.buyerName, dto.buyerMobile);
    const books: Array<{
      copy: NonNullable<Awaited<ReturnType<LibrarySalesService['copyOf']>>['copy']>;
      price: number;
    }> = [];
    for (const b of dto.books) {
      const x = await this.copyOf(c, b.accessionNo, true);
      if (!x.copy || x.problem)
        throw new DomainError(
          'library.cannot_sell',
          `${b.accessionNo}: ${x.problem ?? 'No such book'}`,
          {
            status: 409,
          },
        );
      if (books.some((y) => y.copy.id === x.copy!.id))
        throw new DomainError('validation-failed', `${x.copy.accessionNo} is in the sale twice`, {
          status: 400,
        });
      books.push({ copy: x.copy, price: round(b.price) });
    }
    const total = round(books.reduce((n, b) => n + b.price, 0));
    if (buyer.kind === 'other' && total > 0 && !dto.mode)
      throw new DomainError('validation-failed', 'Say how the buyer paid', { status: 400 });
    const no = (
      await c.query<{ n: string }>(
        `SELECT 'LS-' || lpad((COALESCE(max(substring(sale_no FROM '^LS-([0-9]+)$')::int), 0) + 1)::text, 4, '0') AS n
           FROM library_sale_orders`,
      )
    ).rows[0]!.n;
    const order = await c.query<{ id: string }>(
      `INSERT INTO library_sale_orders (school_id, sale_no, sold_on, buyer_kind, buyer_id, buyer_name, buyer_mobile, books,
                                        total, mode, reference, note, upload_id, sold_by, sold_by_name)
       VALUES (app.current_school_id(), $1, $2::date, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12::bigint,
               app.current_user_id(), $13)
       RETURNING id::text`,
      [
        no,
        on,
        buyer.kind,
        buyer.id,
        buyer.name,
        buyer.mobile,
        books.length,
        total,
        buyer.kind === 'other' && total > 0 ? dto.mode : null,
        dto.reference ?? null,
        dto.note ?? null,
        uploadId ?? null,
        ctx.user.displayName,
      ],
    );
    const id = order.rows[0]!.id;
    const why = `Sold to ${buyer.name}${buyer.ref ? ` (${buyer.ref})` : ''}, ${no}`;
    for (const b of books) {
      await c.query(
        `INSERT INTO library_sales (school_id, copy_id, buyer_kind, buyer_id, buyer_name, price, receipt_ref, sold_on,
                                    sold_by, note, order_id, copy_price, from_status)
         VALUES (app.current_school_id(), $1, $2, $3::bigint, $4, $5, $6, $7::date, app.current_user_id(), $8, $9, $10, $11)`,
        [
          b.copy.id,
          buyer.kind,
          buyer.id,
          buyer.name,
          b.price,
          no,
          on,
          dto.note ?? null,
          id,
          b.copy.price,
          b.copy.status,
        ],
      );
      await c.query(
        `UPDATE library_copies SET status = 'sold', status_on = $2::date, status_reason = $3, updated_at = now() WHERE id = $1`,
        [b.copy.id, on, why],
      );
      await c.query(
        `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, on_date, reason, amount, by_user, by_name)
         VALUES (app.current_school_id(), $1, 'sold', $2, 'sold', $3::date, $4, $5, app.current_user_id(), $6)`,
        [b.copy.id, b.copy.status, on, why, b.price, ctx.user.displayName],
      );
    }
    if (total > 0) {
      const yearId = await libraryYear(c, ctx);
      const headId = await libraryHead(c, LIBRARY_HEADS.sale);
      const list = books.map((b) => b.copy.accessionNo).join(', ');
      if (buyer.kind === 'other') {
        const r = await this.receipts.postMiscReceiptIn(
          c,
          ctx,
          {
            payerKind: 'other',
            payerName: buyer.name,
            payerMobile: buyer.mobile ?? undefined,
            headId,
            amount: total,
            receivedOn: on,
            mode: dto.mode!,
            reference: dto.reference,
            remarks: `Library sale ${no}: ${list}`.slice(0, 300),
          },
          yearId,
        );
        await c.query(`UPDATE library_sale_orders SET misc_receipt_id = $2 WHERE id = $1`, [
          id,
          r.id,
        ]);
      } else {
        const made = await announceMiscFee(c, {
          yearId,
          headId,
          title:
            books.length === 1
              ? `Book bought: ${books[0]!.copy.title} (${books[0]!.copy.accessionNo})`
              : `Books bought: ${String(books.length)} books (${no})`,
          amount: total,
          remark: `Library sale ${no}: ${list}`,
          kind: buyer.kind,
          personId: buyer.id!,
        });
        await c.query(
          `UPDATE library_sale_orders SET misc_fee_id = $2, misc_line_id = $3 WHERE id = $1`,
          [id, made.miscFeeId, made.lineId],
        );
      }
    }
    await this.audit.stage(ctx, c, {
      action: 'library.sale',
      entityType: 'library_sale_orders',
      entityId: id,
      after: { saleNo: no, ...dto },
    });
    return id;
  }

  async sell(ctx: RequestContext, dto: BookSaleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.orderIn(c, await this.sellIn(c, ctx, dto)),
    );
  }

  private async orderIn(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Sale not found', { status: 404 });
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; the id is bound
      `SELECT o.id::text, o.sale_no, o.sold_on::text, o.buyer_kind, o.buyer_id::text, o.buyer_name, o.buyer_mobile,
              ${BUYER_REF} AS buyer_ref, o.books, o.total, o.mode, o.reference, o.note, o.sold_by_name, o.misc_fee_id::text,
              o.misc_receipt_id::text, mr.receipt_no, ml.amount AS line_amount, ml.paid AS line_paid, ${STATE} AS state,
              (SELECT jsonb_agg(jsonb_build_object('accessionNo', x.accession_no, 'titleId', t.id::text, 'title', t.title,
                        'price', s.price, 'copyPrice', s.copy_price, 'fromStatus', s.from_status) ORDER BY s.id)
                 FROM library_sales s JOIN library_copies x ON x.id = s.copy_id JOIN library_titles t ON t.id = x.title_id
                WHERE s.order_id = o.id) AS books_list
         FROM library_sale_orders o ${PAY_JOINS} WHERE o.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Sale not found', { status: 404 });
    const total = Number(x.total);
    const paid = x.state === 'paid' ? total : x.line_paid ? Number(x.line_paid) : 0;
    return {
      id: String(x.id),
      saleNo: String(x.sale_no),
      soldOn: String(x.sold_on),
      buyer: {
        kind: String(x.buyer_kind) as BuyerKind,
        id: x.buyer_id as string | null,
        name: String(x.buyer_name),
        ref: x.buyer_ref as string | null,
        mobile: x.buyer_mobile as string | null,
      },
      books: ((x.books_list as Array<Record<string, unknown>> | null) ?? []).map((b) => ({
        accessionNo: String(b.accessionNo),
        titleId: String(b.titleId),
        title: String(b.title),
        price: Number(b.price),
        copyPrice: b.copyPrice === null ? null : Number(b.copyPrice),
        fromStatus: b.fromStatus as string | null,
      })),
      total,
      state: String(x.state),
      paid: round(paid),
      due: x.state === 'due' ? round(Number(x.line_amount) - Number(x.line_paid)) : 0,
      mode: x.mode as string | null,
      reference: x.reference as string | null,
      note: x.note as string | null,
      soldBy: x.sold_by_name as string | null,
      miscFeeId: x.misc_fee_id as string | null,
      receipt: x.misc_receipt_id
        ? { id: String(x.misc_receipt_id), receiptNo: x.receipt_no as string | null }
        : null,
    };
  }

  async order(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.orderIn(c, id));
  }

  /** The misc receipt of a sale to someone outside, as it prints (the library prints it, not the fees office). */
  async receipt(ctx: RequestContext, id: string) {
    const o = await this.order(ctx, id);
    if (!o.receipt)
      throw new DomainError('not-found', 'This sale has no receipt: it is a misc fee or free', {
        status: 404,
      });
    return this.papers.miscReceiptView(ctx, o.receipt.id);
  }

  // ---- the report --------------------------------------------------------------------------------
  private async rows(c: PoolClient, q: SalesQueryDto, limit: number, offset = 0) {
    const args: unknown[] = [];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const where: string[] = [];
    if (q.from) where.push(`o.sold_on >= ${arg(q.from)}::date`);
    if (q.to) where.push(`o.sold_on <= ${arg(q.to)}::date`);
    if (q.buyer) where.push(`o.buyer_kind = ${arg(q.buyer)}`);
    if (q.state !== 'all') where.push(`(${STATE}) = ${arg(q.state)}`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(
        `(x.accession_no ILIKE ${p} OR t.title ILIKE ${p} OR o.buyer_name ILIKE ${p} OR o.sale_no ILIKE ${p} OR (${BUYER_REF}) ILIKE ${p})`,
      );
    }
    const n = args.length;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; values are bound
      `SELECT s.id::text, o.id::text AS order_id, o.sale_no, o.sold_on::text, o.buyer_kind, o.buyer_name, ${BUYER_REF} AS buyer_ref,
              x.accession_no, t.id::text AS title_id, t.title, t.author, s.price, s.copy_price, s.from_status, ${STATE} AS state,
              mr.receipt_no, COALESCE(mr.mode, o.mode) AS mode, o.sold_by_name,
              count(*) OVER () AS __total, sum(s.price) OVER () AS __amount,
              sum(s.price) FILTER (WHERE (${STATE}) = 'paid') OVER () AS __paid,
              sum(s.price) FILTER (WHERE (${STATE}) = 'due') OVER () AS __due
         FROM library_sales s JOIN library_sale_orders o ON o.id = s.order_id
         JOIN library_copies x ON x.id = s.copy_id JOIN library_titles t ON t.id = x.title_id
         ${PAY_JOINS}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY o.sold_on DESC, o.id DESC, s.id LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    const top = r.rows[0];
    return {
      rows: r.rows.map((x) => ({
        id: String(x.id),
        orderId: String(x.order_id),
        saleNo: String(x.sale_no),
        soldOn: String(x.sold_on),
        buyerKind: String(x.buyer_kind),
        buyer: String(x.buyer_name),
        buyerRef: x.buyer_ref as string | null,
        accessionNo: String(x.accession_no),
        titleId: String(x.title_id),
        title: String(x.title),
        author: x.author as string | null,
        price: Number(x.price),
        copyPrice: x.copy_price === null ? null : Number(x.copy_price),
        fromStatus: x.from_status as string | null,
        state: String(x.state),
        receiptNo: x.receipt_no as string | null,
        mode: x.mode as string | null,
        soldBy: x.sold_by_name as string | null,
      })),
      total: Number(top?.__total ?? 0),
      totals: {
        books: Number(top?.__total ?? 0),
        amount: round(Number(top?.__amount ?? 0)),
        paid: round(Number(top?.__paid ?? 0)),
        due: round(Number(top?.__due ?? 0)),
      },
    };
  }

  async report(ctx: RequestContext, q: SalesQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const page = await this.rows(c, q, q.size, (q.page - 1) * q.size);
      return { ...page, page: q.page, pages: Math.max(1, Math.ceil(page.total / q.size)) };
    });
  }

  async export(ctx: RequestContext, q: SalesExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, totals } = await this.rows(c, q, 50000);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const BUYER: Record<string, string> = {
        student: 'Pupil',
        employee: 'Staff',
        other: 'Outside',
      };
      const words =
        [
          q.from || q.to ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}` : null,
          q.buyer ? `${BUYER[q.buyer]} buyers` : null,
          q.state !== 'all' ? SALE_STATE_LABEL[q.state] : null,
          q.q ? `search "${q.q}"` : null,
        ]
          .filter(Boolean)
          .join('; ') || 'Every sale';
      await this.audit.stage(ctx, c, {
        action: 'library.sales.export',
        entityType: 'library_sale_orders',
        entityId: requireTenant(ctx).schoolId,
        after: { format: q.format, rows: rows.length, words },
      });
      return libraryFile({
        format: q.format,
        name: 'Library books sold',
        slug: 'Library-books-sold',
        school,
        by: ctx.user.displayName,
        words,
        columns: [
          { label: 'Sold on', type: 'date' },
          { label: 'Sale no.', width: 1.3 },
          { label: 'Book no.', width: 1.4 },
          { label: 'Book' },
          { label: 'Author', width: 2 },
          { label: 'Sold from', width: 1.3 },
          { label: 'Buyer' },
          { label: 'Buyer is', width: 1.1 },
          { label: 'Adm./emp. no.', width: 1.6 },
          { label: 'Price as bought (₹)', type: 'money' },
          { label: 'Sold for (₹)', type: 'money' },
          { label: 'Payment', width: 2 },
          { label: 'Receipt no.', width: 1.6 },
          { label: 'Mode', width: 1 },
          { label: 'Sold by', width: 1.6 },
        ],
        rows: rows.map((r): FileCell[] => [
          r.soldOn,
          r.saleNo,
          r.accessionNo,
          r.title,
          r.author,
          r.fromStatus === 'available' ? 'On the shelf' : r.fromStatus,
          r.buyer,
          BUYER[r.buyerKind] ?? r.buyerKind,
          r.buyerRef,
          r.copyPrice,
          r.price,
          SALE_STATE_LABEL[r.state] ?? r.state,
          r.receiptNo,
          r.mode?.toUpperCase(),
          r.soldBy,
        ]),
        totals: [
          `Total · ${String(totals.books)}`,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          totals.amount,
          `Paid ${totals.paid.toFixed(2)} · due ${totals.due.toFixed(2)}`,
          '',
          '',
          '',
        ],
      });
    });
  }

  // ---- a file of sales ---------------------------------------------------------------------------
  private async parse(fileName: string, body: Buffer): Promise<FileRow[]> {
    let grid: string[][] = [];
    if (/\.csv$/i.test(fileName)) {
      grid = body
        .toString('utf8')
        .replace(/^﻿/, '')
        .split(/\r?\n/)
        .map((l) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, '')));
    } else {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(body as unknown as ArrayBuffer);
      } catch {
        throw new DomainError('validation-failed', 'Not a readable .xlsx file', { status: 400 });
      }
      const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
      if (!ws) throw new DomainError('validation-failed', 'The file is empty', { status: 400 });
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        if (n > 5010) return;
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cells[col - 1] = cellText(cell.value).trim();
        });
        grid[n - 1] = cells;
      });
      grid = Array.from(grid, (r) => r ?? []);
    }
    let start = -1;
    const at: Partial<Record<keyof typeof ALIAS, number>> = {};
    for (let i = 0; i < Math.min(grid.length, 10) && start < 0; i += 1) {
      const cells = grid[i]!.map((x) => norm(x ?? ''));
      const acc = cells.findIndex((x) => ALIAS.accessionNo.includes(x));
      const price = cells.findIndex((x) => ALIAS.price.includes(x));
      if (acc >= 0 && price >= 0) {
        start = i + 1;
        for (const k of Object.keys(ALIAS) as Array<keyof typeof ALIAS>) {
          const n = cells.findIndex((x) => ALIAS[k].includes(x));
          if (n >= 0) at[k] = n;
        }
      }
    }
    if (start < 0)
      throw new DomainError(
        'validation-failed',
        'No heading row with Accession no. and Price: use the layout',
        { status: 400 },
      );
    const pick = (cells: string[], k: keyof typeof ALIAS) =>
      at[k] === undefined ? '' : (cells[at[k]!] ?? '').trim();
    const out: FileRow[] = [];
    grid.slice(start).forEach((cells, i) => {
      if (!cells.some((x) => (x ?? '').trim())) return;
      out.push({
        row: start + i + 1,
        accessionNo: pick(cells, 'accessionNo').slice(0, 40),
        buyerType: pick(cells, 'buyerType'),
        ref: pick(cells, 'ref').slice(0, 40),
        name: pick(cells, 'name').slice(0, 120),
        mobile: pick(cells, 'mobile').replace(/\D/g, '').slice(-10),
        price: pick(cells, 'price'),
        mode: pick(cells, 'mode'),
        reference: pick(cells, 'reference').slice(0, 80),
        remark: pick(cells, 'remark').slice(0, 300),
      });
    });
    if (!out.length)
      throw new DomainError('validation-failed', 'No sales in the file', { status: 400 });
    if (out.length > 5000)
      throw new DomainError('validation-failed', 'More than 5000 rows: split the file', {
        status: 400,
      });
    return out;
  }

  /** Each row checked: the book can be sold, the buyer is found or named, the price and mode read. */
  private async check(c: PoolClient, rows: FileRow[]): Promise<CheckedRow[]> {
    const seen = new Map<string, number>();
    const out: CheckedRow[] = [];
    for (const r of rows) {
      const fail = (error: string, extra: Partial<CheckedRow> = {}): CheckedRow => ({
        row: r.row,
        ok: false,
        error,
        accessionNo: r.accessionNo,
        title: null,
        buyerKind: null,
        buyerId: null,
        buyer: null,
        mobile: null,
        price: null,
        mode: null,
        reference: null,
        remark: null,
        group: null,
        ...extra,
      });
      if (!r.accessionNo) {
        out.push(fail('No book number'));
        continue;
      }
      const b = await this.copyOf(c, r.accessionNo);
      if (!b.copy || b.problem) {
        out.push(fail(b.problem ?? 'No such book', { title: b.copy?.title ?? null }));
        continue;
      }
      const twice = seen.get(b.copy.id);
      if (twice) {
        out.push(fail(`The same book as row ${String(twice)}`, { title: b.copy.title }));
        continue;
      }
      // no buyer type: someone outside, unless a number is given (then say which)
      const kind = kindOf(r.buyerType || (r.ref ? '' : 'other'));
      if (!kind) {
        out.push(
          fail(
            r.buyerType
              ? `Buyer "${r.buyerType}" is not Pupil, Staff or Outside`
              : 'Say whether the buyer is a Pupil or Staff',
            { title: b.copy.title },
          ),
        );
        continue;
      }
      const price = Number(r.price.replace(/[₹,\s]/g, ''));
      if (r.price === '' || !Number.isFinite(price) || price < 0) {
        out.push(fail('The price is not a number', { title: b.copy.title }));
        continue;
      }
      let buyerId: string | null = null;
      let buyer = r.name;
      if (kind === 'student' || kind === 'employee') {
        const found =
          kind === 'student'
            ? await c.query<{ id: string; name: string }>(
                `SELECT id::text, display_name AS name FROM students WHERE upper(admission_no) = upper($1) AND deleted_at IS NULL LIMIT 1`,
                [r.ref],
              )
            : await c.query<{ id: string; name: string }>(
                `SELECT id::text, display_name AS name FROM employees WHERE upper(employee_code) = upper($1) AND deleted_at IS NULL LIMIT 1`,
                [r.ref],
              );
        if (!r.ref || !found.rows[0]) {
          out.push(
            fail(
              kind === 'student'
                ? `No pupil with admission no. "${r.ref}"`
                : `No staff member with code "${r.ref}"`,
              { title: b.copy.title },
            ),
          );
          continue;
        }
        buyerId = found.rows[0].id;
        buyer = found.rows[0].name;
      } else if (r.name.trim().length < 2) {
        out.push(fail('Name the buyer from outside', { title: b.copy.title }));
        continue;
      } else if (r.mobile && !MOBILE.test(r.mobile)) {
        out.push(fail('The mobile is not a 10-digit number', { title: b.copy.title }));
        continue;
      }
      const mode = (norm(r.mode) || 'cash') as Mode;
      if (kind === 'other' && price > 0 && !MODES.includes(mode)) {
        out.push(
          fail(`Pay mode "${r.mode}" is not cash, UPI, card or bank`, { title: b.copy.title }),
        );
        continue;
      }
      // a book is the row's once the row is good (a row with a problem does not take it)
      seen.set(b.copy.id, r.row);
      out.push({
        row: r.row,
        ok: true,
        error: null,
        accessionNo: b.copy.accessionNo,
        title: b.copy.title,
        buyerKind: kind,
        buyerId,
        buyer,
        mobile: kind === 'other' ? r.mobile || null : null,
        price: round(price),
        mode: kind === 'other' ? mode : null,
        reference: r.reference || null,
        remark: r.remark || null,
        // one sale a buyer (someone outside: a name, mobile, mode and reference)
        group:
          kind === 'other'
            ? `other|${buyer.trim().toUpperCase()}|${r.mobile}|${mode}|${r.reference}`
            : `${kind}|${buyerId!}`,
      });
    }
    return out;
  }

  private summary(rows: CheckedRow[]) {
    const ok = rows.filter((x) => x.ok);
    const groups = new Map<string, CheckedRow[]>();
    for (const r of ok) groups.set(r.group!, [...(groups.get(r.group!) ?? []), r]);
    return {
      rows: rows.length,
      ok: ok.length,
      errors: rows.length - ok.length,
      sales: groups.size,
      amount: round(ok.reduce((n, x) => n + (x.price ?? 0), 0)),
      groups,
    };
  }

  async upload(ctx: RequestContext, fileName: string, body: unknown) {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Send the file as the request body', {
        status: 400,
      });
    if (body.length > 5 * 1024 * 1024)
      throw new DomainError('validation-failed', 'File larger than 5 MB: split it', {
        status: 400,
      });
    if (!/\.(xlsx|csv)$/i.test(fileName))
      throw new DomainError('validation-failed', 'An .xlsx or .csv file, please', { status: 400 });
    const rows = await this.parse(fileName, body);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_sale_uploads (school_id, file_name, rows, by_user, by_name)
         VALUES (app.current_school_id(), $1, $2::jsonb, app.current_user_id(), $3) RETURNING id::text`,
        [fileName.slice(0, 200), JSON.stringify(rows), ctx.user.displayName],
      );
      return this.uploadIn(c, r.rows[0]!.id);
    });
  }

  private async uploadIn(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const r = await c.query<{
      id: string;
      file_name: string;
      rows: FileRow[];
      status: string;
      result: Record<string, unknown> | null;
      by_name: string | null;
      at: string;
    }>(
      `SELECT id::text, file_name, rows, status, result, by_name, at::text FROM library_sale_uploads WHERE id = $1`,
      [id],
    );
    const u = r.rows[0];
    if (!u) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const checked = u.status === 'checked' ? await this.check(c, u.rows) : [];
    const s = this.summary(checked);
    return {
      id: u.id,
      fileName: u.file_name,
      status: u.status,
      by: u.by_name,
      at: u.at,
      counts:
        u.status === 'checked'
          ? { rows: s.rows, ok: s.ok, errors: s.errors, sales: s.sales, amount: s.amount }
          : ((u.result?.counts as Record<string, number> | undefined) ?? null),
      sales: (u.result?.sales as Array<Record<string, unknown>> | undefined) ?? null,
      lines: checked.slice(0, 500).map(({ group: _g, ...x }) => x),
    };
  }

  async getUpload(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.uploadIn(c, id));
  }

  /** The good rows sold, one sale a buyer, all together; the rows with a problem left out (and listed). */
  async applyUpload(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.uploadIn(c, id);
      if (u.status !== 'checked')
        throw new DomainError('library.sale_upload', `The file is ${u.status} already`, {
          status: 409,
        });
      const rows = (
        await c.query<{ rows: FileRow[] }>(`SELECT rows FROM library_sale_uploads WHERE id = $1`, [
          id,
        ])
      ).rows[0]!.rows;
      const s = this.summary(await this.check(c, rows));
      if (!s.ok)
        throw new DomainError('library.sale_upload', 'No row of the file can be sold', {
          status: 400,
        });
      const sales: Array<Record<string, unknown>> = [];
      for (const list of s.groups.values()) {
        const first = list[0]!;
        const orderId = await this.sellIn(
          c,
          ctx,
          {
            buyerKind: first.buyerKind!,
            buyerId: first.buyerId ?? undefined,
            buyerName: first.buyerKind === 'other' ? first.buyer! : undefined,
            buyerMobile: first.mobile ?? undefined,
            books: list.map((x) => ({ accessionNo: x.accessionNo, price: x.price! })),
            mode: first.mode ?? undefined,
            reference: first.reference ?? undefined,
            note:
              list
                .map((x) => x.remark)
                .filter(Boolean)
                .join('; ')
                .slice(0, 300) || undefined,
          },
          id,
        );
        const o = await this.orderIn(c, orderId);
        sales.push({
          id: o.id,
          saleNo: o.saleNo,
          buyer: o.buyer.name,
          books: o.books.length,
          total: o.total,
        });
      }
      const counts = { rows: s.rows, ok: s.ok, errors: s.errors, sales: s.sales, amount: s.amount };
      await c.query(
        `UPDATE library_sale_uploads SET status = 'applied', applied_at = now(), result = $2::jsonb WHERE id = $1`,
        [id, JSON.stringify({ counts, sales })],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.sales.upload',
        entityType: 'library_sale_uploads',
        entityId: id,
        after: counts,
      });
      return { counts, sales };
    });
  }

  async discardUpload(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.uploadIn(c, id);
      if (u.status !== 'checked')
        throw new DomainError('library.sale_upload', `The file is ${u.status} already`, {
          status: 409,
        });
      await c.query(`UPDATE library_sale_uploads SET status = 'discarded' WHERE id = $1`, [id]);
      return { id, status: 'discarded' };
    });
  }

  /** The sales file layout, with examples and how to fill it. */
  async template() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EduPro';
    const ws = wb.addWorksheet('Book sales');
    ws.columns = [
      { header: 'Accession no.', width: 16 },
      { header: 'Buyer', width: 12 },
      { header: 'Admission or employee no.', width: 24 },
      { header: 'Buyer name', width: 24 },
      { header: 'Mobile', width: 14 },
      { header: 'Price', width: 10 },
      { header: 'Pay mode', width: 10 },
      { header: 'Reference', width: 16 },
      { header: 'Remarks', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow(['B00101', 'Pupil', 'A1024', '', '', 40, '', '', 'Old edition']);
    ws.addRow(['B00102', 'Staff', 'E015', '', '', 25, '', '', '']);
    ws.addRow([
      'B00103',
      'Outside',
      '',
      'City Book Bank',
      '9876543210',
      10,
      'Cash',
      '',
      'Weeded stock',
    ]);
    ws.addRow(['B00104', 'Outside', '', 'City Book Bank', '9876543210', 10, 'Cash', '', '']);
    const about = wb.addWorksheet('How to fill');
    [
      'One book a row. Accession no. (an old number or the barcode works too) and Price are needed.',
      'Buyer: Pupil, Staff or Outside. A pupil by admission no., a staff member by employee code; someone outside by name (mobile optional).',
      'A pupil or staff member owes the sale as a misc fee, paid at the fees counter. Someone outside pays now: Pay mode Cash, UPI, Card or Bank (blank: Cash); the library prints the receipt.',
      'The rows of one buyer make one sale (for someone outside: the same name, mobile, mode and reference).',
      'Only books on the shelf, damaged or withdrawn can be sold. The file is checked first: rows with a problem are listed and left out.',
    ].forEach((l) => about.addRow([l]));
    about.getColumn(1).width = 120;
    const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    return {
      filename: 'Library-book-sales-upload.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }
}
