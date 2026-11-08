import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import {
  dmy,
  istToday,
  money2,
  mustOperateStore,
  pdfSchool,
  PERSON_OF,
  qty3,
} from './purchase-stock-core';
import { blankBox, signerOf } from './purchase-doc-sign';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { assetsToVendor } from './purchase-asset-core';
import { postStock } from './purchase-stores.service';
import {
  PURCHASE,
  type ReturnSourceQueryDto,
  type StockDocQueryDto,
  type VendorReturnDto,
} from './purchase.dto';

const label = (number: string, revision: number) =>
  revision ? `${number}-R${String(revision)}` : number;

/**
 * Returns (docs/design/84, part 8): to the vendor — goods rejected at inspection (they never entered
 * stock) or taken out of stock when found defective; a replacement wanted keeps the PO line waiting
 * (a PO closed by itself opens again), otherwise the PO is closed short by hand; the debit note is
 * phase 3 — and the list of returns to the store made on issues. Each with its return note.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private mustSee(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.storeView))
      throw new DomainError('permission-denied', 'Only the stores see returns', { status: 403 });
  }

  /** What of a PO can go back: rejected goods not yet returned, and accepted goods still in the store. */
  async returnable(ctx: RequestContext, orderId: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = (
        await c.query<{ number: string; revision: number; vendor: string; status: string }>(
          `SELECT po.number, po.revision, v.legal_name AS vendor, po.status FROM purchase_orders po
             JOIN vendors v ON v.id = po.vendor_id WHERE po.id = $1`,
          [orderId],
        )
      ).rows[0];
      if (!po) throw new DomainError('not-found', 'Purchase order not found', { status: 404 });
      const lines = await this.lines(c, orderId);
      return {
        order: {
          id: orderId,
          label: label(po.number, po.revision),
          vendor: po.vendor,
          status: po.status,
        },
        lines: lines.map((l) => ({
          receiptLineId: l.id,
          receipt: l.receipt,
          receiptId: l.receipt_id,
          store: l.store,
          storeId: l.store_id,
          item: l.description,
          unit: l.uom,
          batch: l.batch_no,
          rejected: Number(l.rejected),
          rejectReason: l.reject_reason,
          rejectedLeft: Math.max(
            0,
            Math.round((Number(l.rejected) - Number(l.ret_rejected)) * 1000) / 1000,
          ),
          accepted: Number(l.accepted),
          stockLeft: l.stock_tracked
            ? Math.max(0, Math.round((Number(l.accepted) - Number(l.ret_stock)) * 1000) / 1000)
            : 0,
          inStore: Number(l.in_store) / Number(l.per_unit),
        })),
      };
    });
  }

  private async lines(c: PoolClient, orderId: string) {
    return (
      await c.query<{
        id: string;
        receipt_id: string;
        receipt: string;
        store_id: string;
        store: string;
        item_id: string | null;
        description: string;
        uom: string;
        per_unit: string;
        stock_tracked: boolean;
        batch_no: string | null;
        expiry: string | null;
        rejected: string;
        reject_reason: string | null;
        accepted: string;
        ret_rejected: string;
        ret_stock: string;
        in_store: string;
      }>(
        `SELECT gl.id::text, g.id::text AS receipt_id, g.number AS receipt, g.store_id::text, st.name AS store, ol.item_id::text,
                ol.description, u.code AS uom, COALESCE(i.stock_per_unit, 1)::text AS per_unit, COALESCE(i.stock_tracked, false) AS stock_tracked,
                gl.batch_no, gl.expiry::text, COALESCE(gl.rejected_qty, 0)::text AS rejected, gl.reject_reason,
                COALESCE(gl.accepted_qty, 0)::text AS accepted,
                COALESCE((SELECT sum(rl.qty) FROM stock_return_lines rl WHERE rl.receipt_line_id = gl.id AND rl.source = 'rejected'), 0)::text AS ret_rejected,
                COALESCE((SELECT sum(rl.qty) FROM stock_return_lines rl WHERE rl.receipt_line_id = gl.id AND rl.source = 'stock'), 0)::text AS ret_stock,
                COALESCE((SELECT b.qty FROM stock_balances b WHERE b.store_id = g.store_id AND b.item_id = ol.item_id), 0)::text AS in_store
           FROM goods_receipt_lines gl
           JOIN goods_receipts g ON g.id = gl.receipt_id AND g.kind = 'goods' AND g.status IN ('accepted', 'rejected')
           JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
           JOIN purchase_uoms u ON u.id = ol.uom_id
           JOIN stores st ON st.id = g.store_id
           LEFT JOIN purchase_items i ON i.id = ol.item_id
          WHERE g.order_id = $1 AND (COALESCE(gl.rejected_qty, 0) > 0 OR COALESCE(gl.accepted_qty, 0) > 0)
          ORDER BY g.received_on, g.id, gl.seq`,
        [orderId],
      )
    ).rows;
  }

  async create(ctx: RequestContext, dto: VendorReturnDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = (
        await c.query<{ number: string; revision: number; vendor_id: string; status: string }>(
          `SELECT number, revision, vendor_id::text, status FROM purchase_orders WHERE id = $1 FOR UPDATE`,
          [dto.orderId],
        )
      ).rows[0];
      if (!po) throw new DomainError('not-found', 'Purchase order not found', { status: 404 });
      const lines = new Map((await this.lines(c, dto.orderId)).map((l) => [l.id, l]));
      const stores = new Set<string>();
      const want = new Map<string, number>();
      for (const l of dto.lines) {
        const gl = lines.get(l.receiptLineId);
        if (!gl) throw new DomainError('validation-failed', 'A line not received on this PO');
        stores.add(gl.store_id);
        const key = `${l.receiptLineId}:${l.source}`;
        want.set(key, (want.get(key) ?? 0) + l.qty);
        if (l.source === 'stock' && !gl.stock_tracked)
          throw new DomainError('validation-failed', `${gl.description} is not kept in stock`, {
            status: 400,
          });
      }
      if (stores.size > 1)
        throw new DomainError(
          'validation-failed',
          'One return note goes out of one store: return the others on another note',
          { status: 400 },
        );
      const storeId = [...stores][0]!;
      await mustOperateStore(c, ctx.permissions, storeId, 'return goods from');
      for (const [key, q] of want) {
        const [id, source] = key.split(':') as [string, 'rejected' | 'stock'];
        const gl = lines.get(id)!;
        const left =
          source === 'rejected'
            ? Number(gl.rejected) - Number(gl.ret_rejected)
            : Number(gl.accepted) - Number(gl.ret_stock);
        if (q > left + 1e-9)
          throw new DomainError(
            'validation-failed',
            `${gl.description} (${gl.receipt}): ${qty3(Math.max(0, left))} ${gl.uom} ${source === 'rejected' ? 'rejected is still here' : 'accepted can go back'}`,
            { status: 400 },
          );
      }
      const day = dto.returnedOn ?? istToday();
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('return') AS n`)
      ).rows[0]!.n;
      const rid = (
        await c.query<{ id: string }>(
          `INSERT INTO stock_returns (school_id, number, kind, store_id, order_id, vendor_id, returned_on, dispatch, note, created_by)
           VALUES (app.current_school_id(), $1, 'to_vendor', $2, $3, $4, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
          [number, storeId, dto.orderId, po.vendor_id, day, dto.dispatch ?? null, dto.note ?? null],
        )
      ).rows[0]!.id;
      for (const l of dto.lines) {
        const gl = lines.get(l.receiptLineId)!;
        let moveId: string | null = null;
        let rate = 0;
        let value = 0;
        if (l.source === 'stock') {
          moveId = await postStock(
            c,
            {
              storeId,
              itemId: gl.item_id!,
              kind: 'return_vendor',
              qty: -Math.round(l.qty * Number(gl.per_unit) * 1000) / 1000,
              batch: gl.batch_no,
              docType: 'stock_return',
              docId: rid,
              note: `${number} to the vendor`,
              day,
            },
            gl.description,
          );
          const m = (
            await c.query<{ rate: string; value: string }>(
              `SELECT rate::text, value::text FROM stock_moves WHERE id = $1`,
              [moveId],
            )
          ).rows[0]!;
          rate = Number(m.rate) * Number(gl.per_unit);
          value = -Number(m.value);
          await assetsToVendor(c, {
            receiptLineId: gl.id,
            storeId,
            itemId: gl.item_id!,
            qty: l.qty * Number(gl.per_unit),
            day,
            doc: number,
          });
        } else {
          const cost = (
            await c.query<{ unit_cost: string | null }>(
              `SELECT unit_cost::text FROM goods_receipt_lines WHERE id = $1`,
              [gl.id],
            )
          ).rows[0]!.unit_cost;
          rate = Number(cost ?? 0);
          value = Math.round(rate * l.qty * 100) / 100;
        }
        await c.query(
          `INSERT INTO stock_return_lines (school_id, return_id, item_id, receipt_line_id, source, qty, rate, value, batch_no, reason,
                                           replacement, move_id)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            rid,
            gl.item_id,
            gl.id,
            l.source,
            l.qty,
            Math.round(rate * 10000) / 10000,
            value,
            gl.batch_no,
            l.reason,
            l.replacement,
            moveId,
          ],
        );
      }
      const after = await PurchaseReceiptsService.refreshOrder(c, dto.orderId);
      await this.audit.stage(ctx, c, {
        action: 'purchase.return.to_vendor',
        entityType: 'stock_returns',
        entityId: rid,
        after: { number, order: label(po.number, po.revision), lines: dto.lines.length, ...after },
      });
      return { id: rid, number, reopened: 'reopened' in after };
    });
  }

  // ---- lists ---------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: StockDocQueryDto) {
    this.mustSee(ctx);
    const [from, to] = q.from && q.to && q.from > q.to ? [q.to, q.from] : [q.from, q.to];
    const FROM = `FROM stock_returns r JOIN stores st ON st.id = r.store_id
           LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN vendors v ON v.id = r.vendor_id
           LEFT JOIN stock_issues si ON si.id = r.issue_id LEFT JOIN purchase_orders po ON po.id = r.order_id`;
    const where = `WHERE ($1::text IS NULL OR r.kind = $1) AND ($2::bigint IS NULL OR r.store_id = $2)
            AND ($3::text IS NULL OR r.number ILIKE '%' || $3 || '%' OR v.legal_name ILIKE '%' || $3 || '%' OR d.name ILIKE '%' || $3 || '%'
                 OR si.number ILIKE '%' || $3 || '%' OR po.number ILIKE '%' || $3 || '%')
            AND ($4::date IS NULL OR r.returned_on >= $4) AND ($5::date IS NULL OR r.returned_on <= $5)
            AND ($6::bigint IS NULL OR r.department_id = $6)
            AND ($7::bigint IS NULL OR EXISTS (SELECT 1 FROM stock_return_lines l WHERE l.return_id = r.id AND l.item_id = $7))`;
    const args = [
      q.kind ?? null,
      q.storeId ?? null,
      q.q ?? null,
      from ?? null,
      to ?? null,
      q.departmentId ?? null,
      q.itemId ?? null,
    ];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        number: string;
        kind: 'to_store' | 'to_vendor';
        store: string;
        returned_on: string;
        department: string | null;
        vendor: string | null;
        doc: string | null;
        doc_id: string | null;
        lines: number;
        value: string;
        by: string | null;
        reason: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF and WHERE are fixed fragments
        `SELECT r.id::text, r.number, r.kind, st.name AS store, r.returned_on::text, d.name AS department, v.legal_name AS vendor,
                COALESCE(si.number, po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END) AS doc,
                COALESCE(r.issue_id, r.order_id)::text AS doc_id,
                (SELECT count(*)::int FROM stock_return_lines l WHERE l.return_id = r.id) AS lines,
                COALESCE((SELECT sum(l.value) FROM stock_return_lines l WHERE l.return_id = r.id), 0)::text AS value,
                (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = r.created_by) AS by,
                COALESCE((SELECT string_agg(DISTINCT l.reason, '; ') FROM stock_return_lines l WHERE l.return_id = r.id), r.note) AS reason
           ${FROM} ${where}
          ORDER BY r.returned_on DESC, r.id DESC LIMIT 50 OFFSET $8`,
        [...args, (q.page - 1) * 50],
      );
      const f = (
        await c.query<{ n: number; vendor: string; store: string; total: string }>(
          // eslint-disable-next-line no-restricted-syntax -- FROM and WHERE are fixed fragments
          `SELECT count(*)::int AS n,
                  COALESCE(sum(rv.value) FILTER (WHERE r.kind = 'to_vendor'), 0)::text AS vendor,
                  COALESCE(sum(rv.value) FILTER (WHERE r.kind = 'to_store'), 0)::text AS store,
                  COALESCE(sum(rv.value), 0)::text AS total
             ${FROM} CROSS JOIN LATERAL (SELECT COALESCE(sum(l.value), 0) AS value FROM stock_return_lines l WHERE l.return_id = r.id) rv
             ${where}`,
          [null, ...args.slice(1)],
        )
      ).rows[0]!;
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- FROM and WHERE are fixed fragments
          `SELECT count(*)::int AS n ${FROM} ${where}`,
          args,
        )
      ).rows[0]!.n;
      return {
        total,
        figures: {
          returns: f.n,
          toVendors: Number(f.vendor),
          intoStore: Number(f.store),
          value: Number(f.total),
        },
        rows: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          kind: x.kind,
          store: x.store,
          returnedOn: x.returned_on,
          department: x.department,
          vendor: x.vendor,
          doc: x.doc,
          docId: x.doc_id,
          lines: x.lines,
          value: Number(x.value),
          by: x.by,
          reason: x.reason,
        })),
        page: q.page,
      };
    });
  }

  /**
   * Where a new return starts: to a vendor, the POs with goods received that can still go back (rejected
   * goods not returned, or accepted stock goods); from a department, the issues with goods not yet back.
   * The newest first, at most 50; the return's own form checks the quantities.
   */
  async sources(ctx: RequestContext, q: ReturnSourceQueryDto) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (q.kind === 'to_vendor') {
        const r = await c.query<{
          id: string;
          number: string;
          revision: number;
          vendor: string;
          received: string;
          receipts: string;
          rejected: number;
          in_stock: number;
        }>(
          `SELECT po.id::text, po.number, po.revision, v.legal_name AS vendor, max(g.received_on)::text AS received,
                  string_agg(DISTINCT g.number, ', ') AS receipts,
                  (count(*) FILTER (WHERE COALESCE(gl.rejected_qty, 0) > COALESCE((SELECT sum(rl.qty) FROM stock_return_lines rl
                     WHERE rl.receipt_line_id = gl.id AND rl.source = 'rejected'), 0)))::int AS rejected,
                  (count(*) FILTER (WHERE COALESCE(i.stock_tracked, false) AND COALESCE(gl.accepted_qty, 0) > COALESCE((SELECT sum(rl.qty)
                     FROM stock_return_lines rl WHERE rl.receipt_line_id = gl.id AND rl.source = 'stock'), 0)))::int AS in_stock
             FROM goods_receipt_lines gl
             JOIN goods_receipts g ON g.id = gl.receipt_id AND g.kind = 'goods' AND g.status IN ('accepted', 'rejected')
             JOIN purchase_orders po ON po.id = g.order_id JOIN vendors v ON v.id = po.vendor_id
             JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
             LEFT JOIN purchase_items i ON i.id = ol.item_id
            WHERE ($1::text IS NULL OR po.number ILIKE '%' || $1 || '%' OR v.legal_name ILIKE '%' || $1 || '%' OR g.number ILIKE '%' || $1 || '%')
              AND ($2 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                              WHERE k.store_id = g.store_id AND e.user_id = app.current_user_id()))
            GROUP BY po.id, po.number, po.revision, v.legal_name
           HAVING count(*) FILTER (WHERE COALESCE(gl.rejected_qty, 0) > 0 OR COALESCE(gl.accepted_qty, 0) > 0) > 0
            ORDER BY max(g.received_on) DESC, po.id DESC LIMIT 50`,
          [q.q ?? null, this.has(ctx, PURCHASE.storeManage)],
        );
        return {
          kind: q.kind,
          rows: r.rows
            .filter((x) => x.rejected + x.in_stock > 0)
            .map((x) => ({
              id: x.id,
              number: label(x.number, x.revision),
              party: x.vendor,
              on: x.received,
              detail: x.receipts,
              rejectedLines: x.rejected,
              stockLines: x.in_stock,
              href: `/purchase/returns/new?order=${x.id}`,
            })),
        };
      }
      const r = await c.query<{
        id: string;
        number: string;
        department: string;
        store: string;
        issued: string;
        doc: string | null;
        lines: number;
      }>(
        `SELECT si.id::text, si.number, d.name AS department, st.name AS store, si.issued_on::text AS issued,
                COALESCE(pi.number, pr.number) AS doc,
                (SELECT count(*)::int FROM stock_issue_lines l WHERE l.issue_id = si.id AND l.qty > l.returned_qty) AS lines
           FROM stock_issues si JOIN departments d ON d.id = si.department_id JOIN stores st ON st.id = si.store_id
           LEFT JOIN purchase_indents pi ON pi.id = si.indent_id
           LEFT JOIN purchase_requisitions pr ON pr.id = si.requisition_id
          WHERE EXISTS (SELECT 1 FROM stock_issue_lines l WHERE l.issue_id = si.id AND l.qty > l.returned_qty)
            AND ($1::text IS NULL OR si.number ILIKE '%' || $1 || '%' OR d.name ILIKE '%' || $1 || '%'
                 OR pi.number ILIKE '%' || $1 || '%' OR pr.number ILIKE '%' || $1 || '%')
            AND ($2 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                              WHERE k.store_id = si.store_id AND e.user_id = app.current_user_id()))
          ORDER BY si.issued_on DESC, si.id DESC LIMIT 50`,
        [q.q ?? null, this.has(ctx, PURCHASE.storeManage)],
      );
      return {
        kind: q.kind,
        rows: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          party: x.department,
          on: x.issued,
          detail: [x.store, x.doc].filter(Boolean).join(' · '),
          openLines: x.lines,
          href: `/purchase/issues/${x.id}#return`,
        })),
      };
    });
  }

  private async one(c: PoolClient, id: string) {
    const r = (
      await c.query<{
        id: string;
        number: string;
        kind: 'to_store' | 'to_vendor';
        store: string;
        store_id: string;
        returned_on: string;
        department: string | null;
        vendor: string | null;
        issue: string | null;
        issue_id: string | null;
        order_label: string | null;
        order_id: string | null;
        dispatch: string | null;
        note: string | null;
        by: string | null;
        by_id: string | null;
        created_at: Date;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
        `SELECT r.id::text, r.number, r.kind, st.name AS store, r.store_id::text, r.returned_on::text, d.name AS department,
                r.created_by::text AS by_id, r.created_at,
                v.legal_name AS vendor, si.number AS issue, r.issue_id::text,
                po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS order_label, r.order_id::text,
                r.dispatch, r.note, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = r.created_by) AS by
           FROM stock_returns r JOIN stores st ON st.id = r.store_id
           LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN vendors v ON v.id = r.vendor_id
           LEFT JOIN stock_issues si ON si.id = r.issue_id LEFT JOIN purchase_orders po ON po.id = r.order_id
          WHERE r.id = $1`,
        [id],
      )
    ).rows[0];
    if (!r) throw new DomainError('not-found', 'Return not found', { status: 404 });
    const lines = (
      await c.query<{
        id: string;
        item: string;
        unit: string;
        source: string;
        condition: string | null;
        qty: string;
        rate: string;
        value: string;
        batch_no: string | null;
        reason: string | null;
        replacement: boolean;
        receipt: string | null;
      }>(
        `SELECT l.id::text, COALESCE(i.name, ol.description) AS item,
                CASE WHEN r.kind = 'to_vendor' THEN pu.code ELSE COALESCE(su.code, u.code) END AS unit, l.source, l.condition,
                l.qty::text, l.rate::text, l.value::text, l.batch_no, l.reason, l.replacement, g.number AS receipt
           FROM stock_return_lines l JOIN stock_returns r ON r.id = l.return_id
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN goods_receipt_lines gl ON gl.id = l.receipt_line_id
           LEFT JOIN goods_receipts g ON g.id = gl.receipt_id
           LEFT JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
           LEFT JOIN purchase_uoms pu ON pu.id = ol.uom_id
          WHERE l.return_id = $1 ORDER BY l.id`,
        [id],
      )
    ).rows;
    return { r, lines };
  }

  async get(ctx: RequestContext, id: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { r, lines } = await this.one(c, id);
      return {
        id: r.id,
        number: r.number,
        kind: r.kind,
        store: r.store,
        returnedOn: r.returned_on,
        department: r.department,
        vendor: r.vendor,
        issue: r.issue,
        issueId: r.issue_id,
        order: r.order_label,
        orderId: r.order_id,
        dispatch: r.dispatch,
        note: r.note,
        by: r.by,
        lineItems: lines.map((l) => ({
          id: l.id,
          item: l.item,
          unit: l.unit,
          source: l.source,
          condition: l.condition,
          qty: Number(l.qty),
          rate: Number(l.rate),
          value: Number(l.value),
          batch: l.batch_no,
          reason: l.reason,
          replacement: l.replacement,
          receipt: l.receipt,
        })),
      };
    });
  }

  /** The return note (to the vendor, or into the store). */
  async pdf(ctx: RequestContext, id: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { r, lines } = await this.one(c, id);
      const read = (k: string) => this.storage.read(k);
      const head = await pdfSchool(c, read);
      const vendor = r.kind === 'to_vendor';
      // as on the GRN: signature, name, Emp. ID · designation and when (docs/design/83)
      const by = await signerOf(c, read, {
        as: vendor ? 'Sent by (store)' : 'Received into the store by',
        name: r.by,
        userId: r.by_id,
        at: r.created_at,
        verb: vendor ? 'Sent on' : 'Received on',
      });
      const bytes = await purchaseStockPdf({
        ...head,
        title: vendor ? 'Return Note (to the vendor)' : 'Return to Store Note',
        number: r.number,
        watermark: null,
        facts: [
          ['Returned on', dmy(r.returned_on)],
          ['Store', r.store],
          ...((vendor
            ? [
                ['Vendor', r.vendor ?? ''],
                ['Purchase order', r.order_label ?? ''],
              ]
            : [
                ['From', r.department ?? ''],
                ['Against issue', r.issue ?? ''],
              ]) as Array<[string, string]>),
          ...((r.dispatch ? [['Sent with', r.dispatch]] : []) as Array<[string, string]>),
          ...((r.note ? [['Note', r.note]] : []) as Array<[string, string]>),
        ],
        columns: [
          { label: '#', width: 4 },
          { label: 'Item', width: 44 },
          { label: 'Unit', width: 8 },
          { label: 'Quantity', width: 11, right: true },
          { label: 'Value (Rs)', width: 13, right: true },
          { label: vendor ? 'Replacement' : 'Condition', width: 14 },
        ],
        rows: lines.map((l, i) => ({
          cells: [
            String(i + 1),
            l.item,
            l.unit,
            qty3(Number(l.qty)),
            money2(Number(l.value)),
            vendor
              ? l.replacement
                ? 'Wanted'
                : 'Not wanted'
              : l.condition === 'unused'
                ? 'Unused'
                : 'Damaged',
          ],
          detail: [
            l.reason,
            l.receipt
              ? `${l.source === 'rejected' ? 'Rejected on' : 'From stock, received on'} ${l.receipt}`
              : null,
            l.batch_no ? `Batch ${l.batch_no}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        total: {
          label: 'Value (Rs)',
          value: money2(lines.reduce((a, l) => a + Number(l.value), 0)),
        },
        signatures: vendor
          ? [by, blankBox('Received by (vendor)')]
          : [by, blankBox('Returned by (department)')],
        foot: vendor
          ? 'Goods returned against the purchase order. Where a replacement is wanted the order waits for it; the vendor’s credit (debit note) follows with the bill.'
          : 'Unused goods go back into stock at the rate they were issued at; damaged goods are recorded for condemnation.',
      });
      return { bytes, filename: `${r.number.replaceAll('/', '-')}.pdf` };
    });
  }
}
