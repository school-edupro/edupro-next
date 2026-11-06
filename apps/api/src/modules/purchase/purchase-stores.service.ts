import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { libraryFile, type FileCell, type FileColumn } from '../library/library-file';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  OpeningLineSchema,
  PURCHASE,
  type LedgerQueryDto,
  type OpeningDto,
  type OpeningImportDto,
  type StockQueryDto,
  type StoreDto,
  type StoreLevelsDto,
} from './purchase.dto';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const KIND_WORDS: Record<string, string> = {
  opening: 'Opening stock',
  receipt: 'Received',
  issue: 'Issued',
  return_in: 'Returned to the store',
  return_vendor: 'Returned to the vendor',
  transfer_out: 'Sent to another store',
  transfer_in: 'From another store',
  adjustment: 'Count adjustment',
  write_off: 'Written off',
};

/** A move posted to a store's stock (weighted average; batches earliest expiry first). */
export async function postStock(
  c: PoolClient,
  m: {
    storeId: string;
    itemId: string;
    kind: string;
    qty: number;
    rate?: number;
    batch?: string | null;
    expiry?: string | null;
    docType?: string | null;
    docId?: string | null;
    docLineId?: string | null;
    note?: string | null;
    day?: string | null;
  },
  /** the item's name, for the message */
  name = 'The item',
) {
  await c.query('SAVEPOINT stock_post');
  try {
    const r = await c.query<{ id: string }>(
      `SELECT app.stock_post($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12::date)::text AS id`,
      [
        m.storeId,
        m.itemId,
        m.kind,
        m.qty,
        m.rate ?? 0,
        m.batch ?? null,
        m.expiry ?? null,
        m.docType ?? null,
        m.docId ?? null,
        m.docLineId ?? null,
        m.note ?? null,
        m.day ?? null,
      ],
    );
    await c.query('RELEASE SAVEPOINT stock_post');
    return r.rows[0]!.id;
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT stock_post');
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('stock.insufficient'))
      throw new DomainError('stock.insufficient', `${name}: not enough in the store`, {
        status: 409,
      });
    if (msg.startsWith('stock.batch_required'))
      throw new DomainError('validation-failed', `${name}: give the batch (and its expiry)`, {
        status: 400,
      });
    if (msg.startsWith('stock.not_tracked'))
      throw new DomainError('validation-failed', `${name} is not kept in stock`, { status: 400 });
    throw e;
  }
}

/**
 * Stores and the stock ledger (docs/design/84, part 6): the main store (made on first use) and the
 * sub-stores with their keepers; the item's stock settings live on the item master; reorder levels per
 * store; stock in hand and its value; an item's stock register with the running balance; opening stock
 * by hand or from Excel (once per store and item: later changes are count adjustments). Every move goes
 * through `app.stock_post` (append-only, weighted average).
 */
@Injectable()
export class PurchaseStoresService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }

  /** The school's main store, made on first use (the purchase office's department). */
  static async ensureMain(c: PoolClient) {
    await PurchaseVendorsService.seed(c);
    const m = await c.query<{ id: string }>(`SELECT id::text FROM stores WHERE kind = 'main'`);
    if (m.rows[0]) return m.rows[0].id;
    return (
      await c.query<{ id: string }>(
        `INSERT INTO stores (school_id, code, name, kind, department_id)
         SELECT app.current_school_id(), 'MAIN', 'Main store', 'main', purchase_department_id
           FROM purchase_settings WHERE school_id = app.current_school_id()
         ON CONFLICT DO NOTHING RETURNING id::text`,
      )
    ).rows[0]!.id;
  }

  /** May I work this store: the manage right, or the operate right and I keep it. */
  private async mustOperate(c: PoolClient, ctx: RequestContext, storeId: string) {
    const s = await c.query<{ name: string; status: string; mine: boolean }>(
      `SELECT s.name, s.status::text,
              EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                       WHERE k.store_id = s.id AND e.user_id = app.current_user_id()) AS mine
         FROM stores s WHERE s.id = $1`,
      [storeId],
    );
    const x = s.rows[0];
    if (!x) throw new DomainError('not-found', 'Store not found', { status: 404 });
    if (!this.has(ctx, PURCHASE.storeManage) && !(this.has(ctx, PURCHASE.storeOperate) && x.mine))
      throw new DomainError('permission-denied', `Only the keepers of ${x.name} work it`, {
        status: 403,
      });
    if (x.status !== 'active')
      throw new DomainError('purchase.store_inactive', `${x.name} is inactive`, { status: 409 });
    return x;
  }

  // ---- stores ------------------------------------------------------------------------------------
  async stores(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseStoresService.ensureMain(c);
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        kind: string;
        parent: string | null;
        department_id: string | null;
        department: string | null;
        location: string | null;
        status: string;
        items: number;
        value: string;
        below: number;
        mine: boolean;
      }>(
        `SELECT s.id::text, s.code, s.name, s.kind, p.name AS parent, s.department_id::text, d.name AS department, s.location,
                s.status::text,
                (SELECT count(*)::int FROM stock_balances b WHERE b.store_id = s.id AND b.qty > 0) AS items,
                (SELECT COALESCE(sum(b.value), 0) FROM stock_balances b WHERE b.store_id = s.id)::text AS value,
                (SELECT count(*)::int FROM item_store_levels l LEFT JOIN stock_balances b ON b.store_id = l.store_id AND b.item_id = l.item_id
                  WHERE l.store_id = s.id AND l.reorder_level > 0 AND COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) <= l.reorder_level) AS below,
                EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                         WHERE k.store_id = s.id AND e.user_id = app.current_user_id()) AS mine
           FROM stores s LEFT JOIN stores p ON p.id = s.parent_id LEFT JOIN departments d ON d.id = s.department_id
          ORDER BY s.kind = 'main' DESC, s.status, s.name`,
      );
      const keepers = await c.query<{ store_id: string; id: string; code: string; name: string }>(
        `SELECT k.store_id::text, e.id::text, e.employee_code AS code, e.display_name AS name
           FROM store_keepers k JOIN employees e ON e.id = k.employee_id ORDER BY e.display_name`,
      );
      return {
        data: r.rows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          kind: s.kind,
          parent: s.parent,
          departmentId: s.department_id,
          department: s.department,
          location: s.location,
          status: s.status,
          items: s.items,
          value: Number(s.value),
          belowReorder: s.below,
          mine: s.mine,
          keepers: keepers.rows
            .filter((k) => k.store_id === s.id)
            .map((k) => ({ id: k.id, code: k.code, name: k.name })),
        })),
        canManage: this.has(ctx, PURCHASE.storeManage),
      };
    });
  }

  async saveStore(ctx: RequestContext, id: string | null, dto: StoreDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const main = await PurchaseStoresService.ensureMain(c);
      const taken = await c.query(
        `SELECT 1 FROM stores WHERE code = $1 AND id IS DISTINCT FROM $2`,
        [dto.code, id],
      );
      if (taken.rowCount)
        throw new DomainError('conflict', `Store code ${dto.code} is taken`, { status: 409 });
      let storeId = id;
      if (id) {
        const cur = await c.query<{ kind: string; stock: number }>(
          `SELECT s.kind, (SELECT count(*)::int FROM stock_balances b WHERE b.store_id = s.id AND b.qty > 0) AS stock
             FROM stores s WHERE s.id = $1`,
          [id],
        );
        if (!cur.rows[0]) throw new DomainError('not-found', 'Store not found', { status: 404 });
        if (dto.status === 'inactive' && cur.rows[0].kind === 'main')
          throw new DomainError('validation-failed', 'The main store stays active', {
            status: 400,
          });
        if (dto.status === 'inactive' && cur.rows[0].stock)
          throw new DomainError(
            'purchase.store_has_stock',
            'The store still holds stock: transfer it to another store first',
            { status: 409 },
          );
        await c.query(
          `UPDATE stores SET code = $2, name = $3, department_id = $4, location = $5, status = $6::row_status, updated_at = now()
            WHERE id = $1`,
          [id, dto.code, dto.name, dto.departmentId ?? null, dto.location ?? null, dto.status],
        );
      } else
        storeId = (
          await c.query<{ id: string }>(
            `INSERT INTO stores (school_id, code, name, kind, parent_id, department_id, location, status)
             VALUES (app.current_school_id(), $1, $2, 'sub', $3, $4, $5, $6::row_status) RETURNING id::text`,
            [dto.code, dto.name, main, dto.departmentId ?? null, dto.location ?? null, dto.status],
          )
        ).rows[0]!.id;
      if (dto.keeperIds.length) {
        const ok = await c.query(
          `SELECT 1 FROM employees WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active'`,
          [dto.keeperIds],
        );
        if (ok.rowCount !== new Set(dto.keeperIds).size)
          throw new DomainError('validation-failed', 'A keeper is not an active employee', {
            status: 400,
          });
      }
      await c.query(
        `DELETE FROM store_keepers WHERE store_id = $1 AND NOT (employee_id = ANY($2::bigint[]))`,
        [storeId, dto.keeperIds],
      );
      for (const e of new Set(dto.keeperIds))
        await c.query(
          `INSERT INTO store_keepers (school_id, store_id, employee_id) VALUES (app.current_school_id(), $1, $2) ON CONFLICT DO NOTHING`,
          [storeId, e],
        );
      await this.audit.stage(ctx, c, {
        action: id ? 'purchase.store.update' : 'purchase.store.create',
        entityType: 'stores',
        entityId: storeId!,
        after: {
          code: dto.code,
          name: dto.name,
          keepers: dto.keeperIds.length,
          status: dto.status,
        },
      });
      return { id: storeId };
    });
  }

  /** A store: its keepers, its stock with reorder levels, and what may be done. */
  async store(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseStoresService.ensureMain(c);
      const all = await this.stores(ctx);
      const s = all.data.find((x) => x.id === id);
      if (!s) throw new DomainError('not-found', 'Store not found', { status: 404 });
      const stock = await this.stockRows(c, { storeId: id, empty: true, below: false });
      // the physical counts of the store (GFR 213: at least once a year)
      const counts = await c.query<{
        id: string;
        number: string;
        status: string;
        counted_on: string;
        this_year: boolean;
      }>(
        `SELECT id::text, number, status, counted_on::text,
                counted_on >= make_date(left(app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date), 4)::int, 4, 1) AS this_year
           FROM stock_counts WHERE store_id = $1 AND status <> 'cancelled' ORDER BY counted_on DESC, id DESC LIMIT 5`,
        [id],
      );
      return {
        ...s,
        stock,
        counts: counts.rows.map((k) => ({
          id: k.id,
          number: k.number,
          status: k.status,
          countedOn: k.counted_on,
        })),
        countedThisYear: counts.rows.some((k) => k.status === 'approved' && k.this_year),
        can: {
          manage: this.has(ctx, PURCHASE.storeManage),
          operate:
            s.status === 'active' &&
            (this.has(ctx, PURCHASE.storeManage) ||
              (this.has(ctx, PURCHASE.storeOperate) && s.mine)),
        },
      };
    });
  }

  async saveLevels(ctx: RequestContext, storeId: string, dto: StoreLevelsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query(`SELECT 1 FROM stores WHERE id = $1`, [storeId]);
      if (!s.rowCount) throw new DomainError('not-found', 'Store not found', { status: 404 });
      for (const l of dto.lines) {
        const it = await c.query(`SELECT 1 FROM purchase_items WHERE id = $1 AND stock_tracked`, [
          l.itemId,
        ]);
        if (!it.rowCount)
          throw new DomainError('validation-failed', 'An item is not kept in stock', {
            status: 400,
          });
        if (!l.reorderLevel && !l.reorderQty && !l.maxQty)
          await c.query(`DELETE FROM item_store_levels WHERE store_id = $1 AND item_id = $2`, [
            storeId,
            l.itemId,
          ]);
        else
          await c.query(
            `INSERT INTO item_store_levels (school_id, store_id, item_id, reorder_level, reorder_qty, max_qty)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
             ON CONFLICT (store_id, item_id) DO UPDATE SET reorder_level = EXCLUDED.reorder_level, reorder_qty = EXCLUDED.reorder_qty,
                    max_qty = EXCLUDED.max_qty, updated_at = now()`,
            [storeId, l.itemId, l.reorderLevel, l.reorderQty ?? null, l.maxQty ?? null],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.store.levels',
        entityType: 'stores',
        entityId: storeId,
        after: { lines: dto.lines.length },
      });
      return { saved: dto.lines.length };
    });
  }

  // ---- stock in hand -----------------------------------------------------------------------------
  private async stockRows(
    c: PoolClient,
    q: { storeId?: string; categoryId?: string; q?: string; below: boolean; empty: boolean },
  ) {
    const r = await c.query<{
      store_id: string;
      store: string;
      item_id: string;
      code: string;
      name: string;
      category: string;
      unit: string;
      batch: boolean;
      qty: string;
      reserved: string;
      value: string;
      avg_rate: string;
      level: string | null;
      reorder_qty: string | null;
      max_qty: string | null;
      last: string | null;
      expiring: string | null;
    }>(
      `SELECT s.id::text AS store_id, s.name AS store, i.id::text AS item_id, i.code, i.name, cat.name AS category,
              COALESCE(su.code, u.code) AS unit, i.tracks_batch AS batch, COALESCE(b.qty, 0)::text AS qty,
              COALESCE(b.reserved, 0)::text AS reserved, COALESCE(b.value, 0)::text AS value, COALESCE(b.avg_rate, 0)::text AS avg_rate,
              l.reorder_level::text AS level, l.reorder_qty::text, l.max_qty::text, b.last_move_on::text AS last,
              (SELECT min(bt.expiry)::text FROM stock_batches bt WHERE bt.store_id = s.id AND bt.item_id = i.id AND bt.qty_left > 0) AS expiring
         FROM stores s
         CROSS JOIN purchase_items i
         JOIN purchase_item_categories cat ON cat.id = i.category_id
         JOIN purchase_uoms u ON u.id = i.uom_id
         LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
         LEFT JOIN stock_balances b ON b.store_id = s.id AND b.item_id = i.id
         LEFT JOIN item_store_levels l ON l.store_id = s.id AND l.item_id = i.id
        WHERE i.stock_tracked
          AND ($1::bigint IS NULL OR s.id = $1) AND ($2::bigint IS NULL OR i.category_id = $2 OR i.sub_category_id = $2)
          AND ($3::text IS NULL OR i.code ILIKE $3 OR i.name ILIKE $3)
          AND (COALESCE(b.qty, 0) > 0 OR COALESCE(b.reserved, 0) > 0 OR ($4 AND l.item_id IS NOT NULL))
          AND (NOT $5 OR (l.reorder_level > 0 AND COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) <= l.reorder_level))
        ORDER BY s.kind = 'main' DESC, s.name, cat.name, i.name
        LIMIT 20000`,
      [q.storeId ?? null, q.categoryId ?? null, q.q ? `%${q.q}%` : null, q.empty, q.below],
    );
    return r.rows.map((x) => {
      const qty = Number(x.qty);
      const reserved = Number(x.reserved);
      const level = x.level === null ? null : Number(x.level);
      return {
        storeId: x.store_id,
        store: x.store,
        itemId: x.item_id,
        code: x.code,
        name: x.name,
        category: x.category,
        unit: x.unit,
        tracksBatch: x.batch,
        qty,
        reserved,
        free: round(qty - reserved, 3),
        value: Number(x.value),
        avgRate: Number(x.avg_rate),
        reorderLevel: level,
        reorderQty: x.reorder_qty === null ? null : Number(x.reorder_qty),
        maxQty: x.max_qty === null ? null : Number(x.max_qty),
        below: level !== null && level > 0 && qty - reserved <= level,
        lastMoveOn: x.last,
        earliestExpiry: x.expiring,
      };
    });
  }

  async stock(ctx: RequestContext, q: StockQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseStoresService.ensureMain(c);
      const rows = await this.stockRows(c, {
        storeId: q.storeId,
        categoryId: q.categoryId,
        q: q.q,
        below: q.below,
        empty: q.empty || q.below,
      });
      if (q.format) {
        const columns: FileColumn[] = [
          { label: 'Store', width: 2 },
          { label: 'Code', width: 1.4 },
          { label: 'Item', width: 3 },
          { label: 'Category', width: 2 },
          { label: 'Unit', width: 0.9 },
          { label: 'In stock', type: 'number', width: 1.2 },
          { label: 'Reserved', type: 'number', width: 1.2 },
          { label: 'Free', type: 'number', width: 1.2 },
          { label: 'Average rate (₹)', type: 'money' },
          { label: 'Value (₹)', type: 'money' },
          { label: 'Reorder level', type: 'number', width: 1.2 },
          { label: 'Below it', width: 1 },
          { label: 'Earliest expiry', type: 'date' },
        ];
        const cells: FileCell[][] = rows.map((x) => [
          x.store,
          x.code,
          x.name,
          x.category,
          x.unit,
          x.qty,
          x.reserved,
          x.free,
          x.avgRate,
          x.value,
          x.reorderLevel,
          x.below ? 'Yes' : '',
          x.earliestExpiry,
        ]);
        const head = await this.fileHead(c);
        return libraryFile({
          format: q.format,
          name: 'Stock in hand',
          slug: 'Purchase-stock-in-hand',
          school: head.school,
          by: head.by,
          words: await this.words(c, q.storeId, q.below),
          columns,
          rows: cells,
          totals: columns.map((_, i) =>
            i === 0 ? 'Total' : i === 9 ? round(rows.reduce((a, x) => a + x.value, 0)) : '',
          ),
        });
      }
      const cats = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM purchase_item_categories WHERE status = 'active' ORDER BY parent_id NULLS FIRST, name`,
      );
      return {
        data: rows.slice(0, 1000),
        total: rows.length,
        value: round(rows.reduce((a, x) => a + x.value, 0)),
        below: rows.filter((x) => x.below).length,
        categories: cats.rows,
      };
    });
  }

  private async fileHead(c: PoolClient) {
    return (
      await c.query<{ school: string; by: string }>(
        `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.display_name) AS by
           FROM users u WHERE u.id = app.current_user_id()`,
      )
    ).rows[0]!;
  }

  private async words(c: PoolClient, storeId?: string, below?: boolean) {
    const parts: string[] = [];
    if (storeId)
      parts.push(
        (await c.query<{ name: string }>(`SELECT name FROM stores WHERE id = $1`, [storeId]))
          .rows[0]?.name ?? 'a store',
      );
    else parts.push('All stores');
    if (below) parts.push('below the reorder level');
    parts.push(`as on ${today().split('-').reverse().join('-')}`);
    return parts.join(' · ');
  }

  /** An item's stock register: every move, with the store's balance after it. */
  async ledger(ctx: RequestContext, itemId: string, q: LedgerQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const it = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          unit: string;
          purchase_unit: string;
          per: string;
          batch: boolean;
          tracked: boolean;
        }>(
          `SELECT i.id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, u.code AS purchase_unit, i.stock_per_unit::text AS per,
                  i.tracks_batch AS batch, i.stock_tracked AS tracked
             FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
            WHERE i.id = $1`,
          [itemId],
        )
      ).rows[0];
      if (!it) throw new DomainError('not-found', 'Item not found', { status: 404 });
      const moves = await c.query<{
        id: string;
        day: string;
        store: string;
        kind: string;
        qty: string;
        rate: string;
        value: string;
        balance_qty: string;
        balance_value: string;
        batch_no: string | null;
        expiry: string | null;
        doc_type: string | null;
        doc_id: string | null;
        note: string | null;
        by: string | null;
      }>(
        `SELECT m.id::text, m.moved_on::text AS day, s.name AS store, m.kind, m.qty::text, m.rate::text, m.value::text,
                m.balance_qty::text, m.balance_value::text, m.batch_no, m.expiry::text, m.doc_type, m.doc_id::text, m.note,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.display_name) AS by
           FROM stock_moves m JOIN stores s ON s.id = m.store_id LEFT JOIN users u ON u.id = m.created_by
          WHERE m.item_id = $1 AND ($2::bigint IS NULL OR m.store_id = $2)
            AND ($3::date IS NULL OR m.moved_on >= $3) AND ($4::date IS NULL OR m.moved_on <= $4)
          ORDER BY m.id LIMIT 20000`,
        [itemId, q.storeId ?? null, q.from ?? null, q.to ?? null],
      );
      const rows = moves.rows.map((m) => ({
        id: m.id,
        day: m.day,
        store: m.store,
        kind: m.kind,
        what: KIND_WORDS[m.kind] ?? m.kind,
        qty: Number(m.qty),
        rate: Number(m.rate),
        value: Number(m.value),
        balanceQty: Number(m.balance_qty),
        balanceValue: Number(m.balance_value),
        batch: m.batch_no,
        expiry: m.expiry,
        docType: m.doc_type,
        docId: m.doc_id,
        note: m.note,
        by: m.by,
      }));
      if (q.format) {
        const columns: FileColumn[] = [
          { label: 'Date', type: 'date' },
          { label: 'Store', width: 2 },
          { label: 'What', width: 2 },
          { label: 'In', type: 'number', width: 1 },
          { label: 'Out', type: 'number', width: 1 },
          { label: 'Rate (₹)', type: 'money' },
          { label: 'Value (₹)', type: 'money' },
          { label: 'Balance', type: 'number', width: 1.2 },
          { label: 'Balance value (₹)', type: 'money' },
          { label: 'Batch', width: 1.4 },
          { label: 'Expiry', type: 'date' },
          { label: 'Note', width: 2.4 },
          { label: 'By', width: 1.8 },
        ];
        const head = await this.fileHead(c);
        return libraryFile({
          format: q.format,
          name: `Stock register: ${it.name} (${it.code})`,
          slug: `Stock-register-${it.code}`,
          school: head.school,
          by: head.by,
          words: `${await this.words(c, q.storeId)} · in ${it.unit}`,
          columns,
          rows: rows.map((m) => [
            m.day,
            m.store,
            m.what,
            m.qty > 0 ? m.qty : null,
            m.qty < 0 ? -m.qty : null,
            m.rate,
            m.value,
            m.balanceQty,
            m.balanceValue,
            m.batch,
            m.expiry,
            m.note,
            m.by,
          ]),
        });
      }
      const balances = await this.stockRows(c, { below: false, empty: true });
      return {
        item: {
          id: it.id,
          code: it.code,
          name: it.name,
          unit: it.unit,
          purchaseUnit: it.purchase_unit,
          perUnit: Number(it.per),
          tracksBatch: it.batch,
          tracked: it.tracked,
        },
        balances: balances.filter((b) => b.itemId === itemId),
        batches: (
          await c.query<{
            store: string;
            batch_no: string;
            expiry: string | null;
            qty_left: string;
          }>(
            `SELECT s.name AS store, b.batch_no, b.expiry::text, b.qty_left::text FROM stock_batches b JOIN stores s ON s.id = b.store_id
              WHERE b.item_id = $1 AND b.qty_left > 0 ORDER BY b.expiry NULLS LAST, s.name`,
            [itemId],
          )
        ).rows.map((b) => ({
          store: b.store,
          batch: b.batch_no,
          expiry: b.expiry,
          qty: Number(b.qty_left),
        })),
        moves: rows,
      };
    });
  }

  // ---- opening stock ------------------------------------------------------------------------------
  private async postOpening(
    c: PoolClient,
    storeId: string,
    lines: Array<{ itemId: string; qty: number; rate: number; batch?: string; expiry?: string }>,
    day: string | undefined,
    dryRun: boolean,
  ) {
    const out: Array<{ itemId: string; name: string; error?: string }> = [];
    const seen = new Set<string>();
    // the items this store already had moves of, before this opening (several batches of one item post together)
    const before = new Set(
      (
        await c.query<{ item_id: string }>(
          `SELECT DISTINCT item_id::text FROM stock_moves WHERE store_id = $1 AND item_id = ANY($2::bigint[])`,
          [storeId, lines.map((l) => l.itemId)],
        )
      ).rows.map((r) => r.item_id),
    );
    for (const l of lines) {
      const it = (
        await c.query<{ name: string; tracked: boolean; batch: boolean }>(
          `SELECT i.name, i.stock_tracked AS tracked, i.tracks_batch AS batch FROM purchase_items i WHERE i.id = $1`,
          [l.itemId],
        )
      ).rows[0];
      const name = it?.name ?? 'An item';
      const err = !it
        ? 'Item not found'
        : !it.tracked
          ? `${name} is not kept in stock (Items: Kept in stock)`
          : before.has(l.itemId)
            ? `${name}: this store already has its opening or moves — correct it with a count`
            : it.batch && !l.batch
              ? `${name}: give the batch (and its expiry)`
              : !it.batch && seen.has(l.itemId)
                ? `${name} is twice in the list`
                : null;
      seen.add(l.itemId);
      if (err) {
        out.push({ itemId: l.itemId, name, error: err });
        continue;
      }
      if (!dryRun)
        await postStock(
          c,
          {
            storeId,
            itemId: l.itemId,
            kind: 'opening',
            qty: l.qty,
            rate: l.rate,
            batch: it!.batch ? l.batch : null,
            expiry: it!.batch ? (l.expiry ?? null) : null,
            docType: 'opening',
            note: 'Opening stock',
            day: day ?? null,
          },
          name,
        );
      out.push({ itemId: l.itemId, name });
    }
    return out;
  }

  async opening(ctx: RequestContext, storeId: string, dto: OpeningDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const check = await this.postOpening(c, storeId, dto.lines, dto.day, true);
      const bad = check.filter((x) => x.error);
      if (bad.length)
        throw new DomainError('validation-failed', bad.map((x) => x.error).join('; '), {
          status: 400,
        });
      await this.postOpening(c, storeId, dto.lines, dto.day, false);
      await this.audit.stage(ctx, c, {
        action: 'purchase.stock.opening',
        entityType: 'stores',
        entityId: storeId,
        after: { lines: dto.lines.length },
      });
      return { posted: dto.lines.length };
    });
  }

  private static readonly COLUMNS = ['Item code', 'Quantity', 'Rate', 'Batch', 'Expiry'] as const;

  async openingTemplate(ctx: RequestContext, storeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.mustOperate(c, ctx, storeId);
      const items = await c.query<{ code: string; name: string; unit: string; batch: boolean }>(
        `SELECT i.code, i.name, COALESCE(su.code, u.code) AS unit, i.tracks_batch AS batch
           FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE i.stock_tracked AND i.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.store_id = $1 AND m.item_id = i.id)
          ORDER BY i.code`,
        [storeId],
      );
      const bytes = await templateSheet({
        sheet: 'Opening stock',
        columns: [
          { header: 'Item code', width: 14, required: true, format: 'text' },
          { header: 'Quantity', width: 10, required: true, note: 'In the store unit' },
          { header: 'Rate', width: 10, required: true, note: 'Per store unit, in rupees' },
          { header: 'Batch', width: 14, format: 'text', note: 'For an item kept by batch' },
          { header: 'Expiry', width: 12, format: 'text', note: 'YYYY-MM-DD or DD-MM-YYYY' },
        ],
        guide: [
          `The opening stock of ${s.name}: one row per item (one per batch for an item kept by batch).`,
          'Quantity in the store unit (shown on the Items list); rate per store unit — what one cost.',
          'Only items with no opening or moves in this store yet; correct later stock with a physical count.',
          'Upload the sheet: every row is checked first, then the good rows are posted.',
        ],
        rows: items.rows.map((i) => [i.code, null, null, null, null]),
        examples: [['PEN', 200, 8.5, null, null]],
      });
      return {
        filename: `opening-stock-${s.name.replace(/[^\w]+/g, '-')}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  async openingImport(ctx: RequestContext, storeId: string, dto: OpeningImportDto) {
    const rows = await readSheet(dto.file, ['Item code', 'Quantity', 'Rate'], ['Batch', 'Expiry']);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const items = new Map(
        (
          await c.query<{ id: string; code: string }>(`SELECT id::text, code FROM purchase_items`)
        ).rows.map((i) => [i.code.toUpperCase(), i.id]),
      );
      const results: Array<{ row: number; code: string; ok: boolean; error?: string }> = [];
      const good: Array<{ row: number; code: string; line: OpeningDto['lines'][number] }> = [];
      for (const { row, cells } of rows) {
        const code = (cells['Item code'] ?? '').trim().toUpperCase();
        if (!code && !cells['Quantity']) continue;
        const exp = (cells['Expiry'] ?? '').trim();
        const expiry = /^\d{2}-\d{2}-\d{4}$/.test(exp)
          ? exp.split('-').reverse().join('-')
          : exp || undefined;
        const parsed = OpeningLineSchema.safeParse({
          itemId: items.get(code) ?? '0',
          qty: cells['Quantity'],
          rate: cells['Rate'],
          batch: cells['Batch'] || undefined,
          expiry,
        });
        if (!items.has(code))
          results.push({ row, code, ok: false, error: `Unknown item code ${code || '(empty)'}` });
        else if (!parsed.success)
          results.push({
            row,
            code,
            ok: false,
            error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
        else good.push({ row, code, line: parsed.data });
      }
      const check = await this.postOpening(
        c,
        storeId,
        good.map((g) => g.line),
        undefined,
        true,
      );
      const fine = good.filter((g, i) => !check[i]!.error);
      good.forEach((g, i) =>
        results.push(
          check[i]!.error
            ? { row: g.row, code: g.code, ok: false, error: check[i]!.error }
            : { row: g.row, code: g.code, ok: true },
        ),
      );
      if (!dto.dryRun && fine.length) {
        await this.postOpening(
          c,
          storeId,
          fine.map((g) => g.line),
          undefined,
          false,
        );
        await this.audit.stage(ctx, c, {
          action: 'purchase.stock.opening_import',
          entityType: 'stores',
          entityId: storeId,
          after: { rows: fine.length },
        });
      }
      results.sort((a, b) => a.row - b.row);
      return {
        dryRun: dto.dryRun,
        rows: results,
        good: results.filter((r) => r.ok).length,
        bad: results.filter((r) => !r.ok).length,
        posted: dto.dryRun ? 0 : fine.length,
      };
    });
  }

  /** What the store screens pick from. */
  async formLists(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseStoresService.ensureMain(c);
      const emp = await c.query<{
        id: string;
        code: string;
        name: string;
        designation: string | null;
      }>(
        `SELECT id::text, employee_code AS code, display_name AS name, designation FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
      );
      const deps = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const items = await c.query<{
        id: string;
        code: string;
        name: string;
        unit: string;
        batch: boolean;
      }>(
        `SELECT i.id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, i.tracks_batch AS batch
           FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE i.stock_tracked AND i.status = 'active' ORDER BY i.name LIMIT 5000`,
      );
      return {
        employees: emp.rows,
        departments: deps.rows,
        items: items.rows.map((i) => ({
          id: i.id,
          code: i.code,
          name: i.name,
          unit: i.unit,
          tracksBatch: i.batch,
        })),
      };
    });
  }
}
