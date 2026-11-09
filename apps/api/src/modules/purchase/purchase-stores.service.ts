import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { libraryFile, type FileCell, type FileColumn } from '../library/library-file';
import { STORAGE_DRIVER } from '../files/storage';
import { assetsForOpening, openingAssets, removeOpeningAssets } from './purchase-asset-core';
import { blankBox, signerOf } from './purchase-doc-sign';
import { dmy, money2, pdfSchool, qty3 } from './purchase-stock-core';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  OpeningLineSchema,
  PURCHASE,
  type LedgerQueryDto,
  type OpeningDto,
  type OpeningFixDto,
  type OpeningImportDto,
  type RevaluationDecisionDto,
  type RevaluationDto,
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
  opening_undo: 'Opening corrected (reversed)',
  revalue: 'Rate corrected',
};
/** A user's name as staff know it (their employee record's, else the account's), by a user id expression. */
const PERSON = (idExpr: string) =>
  // eslint-disable-next-line no-restricted-syntax -- idExpr is a fixed column of the query
  `(SELECT COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = pu.id AND e.deleted_at IS NULL LIMIT 1), pu.display_name)
      FROM users pu WHERE pu.id = ${idExpr})`;

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
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
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

  // ---- opening stock (docs/design/84, part 6; "As built — opening stock corrections", 9 Nov 2026) ---
  /**
   * The items of a store whose opening is settled: moved since (received, issued, counted…), reserved,
   * or on a count waiting for approval — with why, in words.
   */
  private async settled(c: PoolClient, storeId: string, itemIds: string[]) {
    const r = await c.query<{ item_id: string; why: string }>(
      `SELECT item_id::text, 'it has moved since (' || string_agg(DISTINCT kind, ', ') || ')' AS why FROM stock_moves
        WHERE store_id = $1 AND item_id = ANY($2::bigint[]) AND kind NOT IN ('opening', 'opening_undo') GROUP BY item_id
       UNION ALL
       SELECT item_id::text, 'part of it is reserved for an indent or a requisition' FROM stock_balances
        WHERE store_id = $1 AND item_id = ANY($2::bigint[]) AND reserved > 0
       UNION ALL
       SELECT l.item_id::text, 'it is on ' || k.number || ', waiting for approval' FROM stock_count_lines l
         JOIN stock_counts k ON k.id = l.count_id
        WHERE k.store_id = $1 AND k.status = 'submitted' AND l.item_id = ANY($2::bigint[])`,
      [storeId, itemIds],
    );
    const out = new Map<string, string>();
    for (const x of r.rows) if (!out.has(x.item_id)) out.set(x.item_id, x.why.replace(/_/g, ' '));
    return out;
  }

  /** The opening lines still standing (not reversed) in a store: of some items, or of one posting. */
  private async liveOpenings(
    c: PoolClient,
    storeId: string,
    by: { itemIds?: string[]; openingId?: string },
  ) {
    return (
      await c.query<{
        id: string;
        item_id: string;
        qty: string;
        rate: string;
        value: string;
        batch_no: string | null;
        expiry: string | null;
        opening_id: string;
        moved_on: string;
      }>(
        `SELECT m.id::text, m.item_id::text, m.qty::text, m.rate::text, m.value::text, m.batch_no, m.expiry::text,
                m.doc_id::text AS opening_id, m.moved_on::text
           FROM stock_moves m
          WHERE m.store_id = $1 AND m.kind = 'opening'
            AND ($2::bigint[] IS NULL OR m.item_id = ANY($2::bigint[])) AND ($3::bigint IS NULL OR m.doc_id = $3)
            AND NOT EXISTS (SELECT 1 FROM stock_moves u WHERE u.kind = 'opening_undo' AND u.doc_line_id = m.id)
          ORDER BY m.id`,
        [storeId, by.itemIds ?? null, by.openingId ?? null],
      )
    ).rows;
  }

  /** What the items are: name, unit, batch / asset, and the rate to compare with (per store unit). */
  private async openingItems(c: PoolClient, itemIds: string[]) {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      unit: string;
      tracked: boolean;
      batch: boolean;
      asset: boolean;
      decimals: boolean;
      reference: string | null;
      reference_from: string | null;
    }>(
      `SELECT i.id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, i.stock_tracked AS tracked, i.tracks_batch AS batch,
              i.item_type = 'asset' AS asset, COALESCE(su.decimals, u.decimals) AS decimals,
              (COALESCE(i.last_purchase_rate,
                        (SELECT rc.rate FROM purchase_rate_contracts rc WHERE rc.item_id = i.id AND rc.status = 'active'
                            AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to
                          ORDER BY rc.valid_from DESC LIMIT 1))
               / COALESCE(NULLIF(i.stock_per_unit, 0), 1))::text AS reference,
              CASE WHEN i.last_purchase_rate IS NOT NULL THEN 'the last purchase'
                   WHEN EXISTS (SELECT 1 FROM purchase_rate_contracts rc WHERE rc.item_id = i.id AND rc.status = 'active') THEN 'the rate contract'
              END AS reference_from
         FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
        WHERE i.id = ANY($1::bigint[])`,
      [itemIds],
    );
    return new Map(r.rows.map((x) => [x.id, x]));
  }

  /**
   * Opening lines checked (and, unless a dry run, posted as one posting): an item already opened here or
   * moved is refused (change its opening instead); each good line has its value and its warnings — a ₹0
   * rate, a rate far from the last purchase or the rate contract — and how many assets it makes.
   */
  private async postOpening(
    c: PoolClient,
    storeId: string,
    lines: Array<{ itemId: string; qty: number; rate: number; batch?: string; expiry?: string }>,
    o: {
      day?: string;
      dryRun: boolean;
      source: 'hand' | 'excel' | 'correction';
      fileName?: string;
      reason?: string;
      /** a correction: the item's reversed lines are not counted, and its assets are kept */
      reuse?: Map<string, string[]>;
    },
  ) {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = await this.openingItems(c, ids);
    const settled = await this.settled(c, storeId, ids);
    const opened = new Set(
      o.source === 'correction'
        ? []
        : (await this.liveOpenings(c, storeId, { itemIds: ids })).map((m) => m.item_id),
    );
    const out: Array<{
      itemId: string;
      name: string;
      code: string;
      unit: string;
      qty: number;
      rate: number;
      value: number;
      assets: number;
      warnings: string[];
      error?: string;
    }> = [];
    const seen = new Set<string>();
    for (const l of lines) {
      const it = items.get(l.itemId);
      const name = it?.name ?? 'An item';
      const units = Math.floor(l.qty + 1e-9);
      const error = !it
        ? 'Item not found'
        : !it.tracked
          ? `${name} is not kept in stock (Items: Kept in stock)`
          : opened.has(l.itemId)
            ? `${name}: this store already has its opening — change it under Opening stock posted`
            : settled.has(l.itemId) && o.source !== 'correction'
              ? `${name}: ${settled.get(l.itemId)!} — correct it with a physical count`
              : it.batch && !l.batch
                ? `${name}: give the batch (and its expiry)`
                : !it.batch && seen.has(l.itemId)
                  ? `${name} is twice in the list`
                  : (it.asset || !it.decimals) && Math.abs(l.qty - units) > 1e-9
                    ? `${name} is counted in whole ${it.unit}`
                    : null;
      seen.add(l.itemId);
      const warnings: string[] = [];
      const ref = it?.reference ? Number(it.reference) : null;
      if (!error && l.rate === 0) warnings.push('Rate ₹0: the stock will have no value');
      else if (!error && ref && (l.rate < ref / 3 || l.rate > ref * 3))
        warnings.push(
          `₹${l.rate.toLocaleString('en-IN')} per ${it!.unit} is far from ${it!.reference_from ?? 'the usual rate'} (₹${round(ref).toLocaleString('en-IN')})`,
        );
      out.push({
        itemId: l.itemId,
        name,
        code: it?.code ?? '',
        unit: it?.unit ?? '',
        qty: l.qty,
        rate: l.rate,
        value: round(l.qty * l.rate),
        assets: it?.asset && !error ? units : 0,
        warnings,
        ...(error ? { error } : {}),
      });
    }
    if (o.dryRun || out.some((x) => x.error)) return { lines: out, openingId: null };
    const openingId = (
      await c.query<{ id: string }>(
        `INSERT INTO stock_openings (school_id, store_id, source, file_name, reason, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id()) RETURNING id::text`,
        [storeId, o.source, o.fileName ?? null, o.reason ?? null],
      )
    ).rows[0]!.id;
    const day = o.day ?? today();
    for (const l of lines) {
      const it = items.get(l.itemId)!;
      const moveId = await postStock(
        c,
        {
          storeId,
          itemId: l.itemId,
          kind: 'opening',
          qty: l.qty,
          rate: l.rate,
          batch: it.batch ? l.batch : null,
          expiry: it.batch ? (l.expiry ?? null) : null,
          docType: 'opening',
          docId: openingId,
          note:
            o.source === 'correction' ? `Opening corrected: ${o.reason ?? ''}` : 'Opening stock',
          day,
        },
        it.name,
      );
      if (it.asset) {
        const r = await assetsForOpening(
          c,
          {
            moveId,
            storeId,
            itemId: l.itemId,
            description: it.name,
            units: Math.floor(l.qty + 1e-9),
            cost: round(l.rate),
            day,
          },
          o.reuse?.get(l.itemId) ?? [],
        );
        o.reuse?.set(l.itemId, r.left);
      }
    }
    return { lines: out, openingId };
  }

  async opening(ctx: RequestContext, storeId: string, dto: OpeningDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const r = await this.postOpening(c, storeId, dto.lines, {
        day: dto.day,
        dryRun: dto.dryRun,
        source: 'hand',
      });
      const bad = r.lines.filter((x) => x.error);
      if (!dto.dryRun && bad.length)
        throw new DomainError('validation-failed', bad.map((x) => x.error).join('; '), {
          status: 400,
        });
      if (!dto.dryRun)
        await this.audit.stage(ctx, c, {
          action: 'purchase.stock.opening',
          entityType: 'stores',
          entityId: storeId,
          after: { opening: r.openingId, lines: dto.lines.length },
        });
      return {
        dryRun: dto.dryRun,
        lines: r.lines,
        value: round(r.lines.reduce((a, x) => a + (x.error ? 0 : x.value), 0)),
        posted: dto.dryRun ? 0 : dto.lines.length,
      };
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
            AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.store_id = $1 AND m.item_id = i.id
                              AND (m.kind NOT IN ('opening', 'opening_undo')
                                   OR (m.kind = 'opening' AND NOT EXISTS (SELECT 1 FROM stock_moves u
                                         WHERE u.kind = 'opening_undo' AND u.doc_line_id = m.id))))
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
          'Only items with no opening here yet. A mistake after posting: change or remove the line on the store’s page (Opening stock posted) while the item has not moved.',
          'Upload the sheet and press Check: each row’s value and any warning (a ₹0 rate, a rate far from the last purchase) shows first; then post the good rows.',
          'An asset item (projector, furniture…) makes one asset per unit, with its tag and QR label.',
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
      const results: Array<{
        row: number;
        code: string;
        ok: boolean;
        error?: string;
        name?: string;
        unit?: string;
        qty?: number;
        rate?: number;
        value?: number;
        assets?: number;
        warnings?: string[];
      }> = [];
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
        { dryRun: true, source: 'excel' },
      );
      const fine = good.filter((_, i) => !check.lines[i]!.error);
      good.forEach((g, i) => {
        const x = check.lines[i]!;
        results.push(
          x.error
            ? { row: g.row, code: g.code, ok: false, error: x.error }
            : {
                row: g.row,
                code: g.code,
                ok: true,
                name: x.name,
                unit: x.unit,
                qty: x.qty,
                rate: x.rate,
                value: x.value,
                assets: x.assets,
                warnings: x.warnings,
              },
        );
      });
      let openingId: string | null = null;
      if (!dto.dryRun && fine.length) {
        openingId = (
          await this.postOpening(
            c,
            storeId,
            fine.map((g) => g.line),
            { dryRun: false, source: 'excel', fileName: dto.fileName },
          )
        ).openingId;
        await this.audit.stage(ctx, c, {
          action: 'purchase.stock.opening_import',
          entityType: 'stores',
          entityId: storeId,
          after: { opening: openingId, rows: fine.length },
        });
      }
      results.sort((a, b) => a.row - b.row);
      const ok = results.filter((r) => r.ok);
      return {
        dryRun: dto.dryRun,
        rows: results,
        good: ok.length,
        bad: results.length - ok.length,
        warned: ok.filter((r) => r.warnings?.length).length,
        value: round(ok.reduce((a, r) => a + (r.value ?? 0), 0)),
        assets: ok.reduce((a, r) => a + (r.assets ?? 0), 0),
        posted: dto.dryRun ? 0 : fine.length,
      };
    });
  }

  /**
   * The opening stock posted to a store: each posting (by hand, from Excel, a correction) with its
   * lines (reversed ones marked), and per item whether its opening can still be changed — and if not,
   * why; the asset items whose units have no asset yet.
   */
  async openings(ctx: RequestContext, storeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!this.has(ctx, PURCHASE.storeView))
        throw new DomainError('permission-denied', 'Only the stores see the opening stock', {
          status: 403,
        });
      const posts = await c.query<{
        id: string;
        source: string;
        file_name: string | null;
        reason: string | null;
        by: string | null;
        by_id: string | null;
        at: Date;
        undone_at: Date | null;
        undone_by: string | null;
        undo_reason: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT o.id::text, o.source, o.file_name, o.reason, ${PERSON('o.created_by')} AS by, o.created_by::text AS by_id, o.created_at AS at,
                o.undone_at, ${PERSON('o.undone_by')} AS undone_by, o.undo_reason
           FROM stock_openings o WHERE o.store_id = $1 ORDER BY o.created_at DESC, o.id DESC`,
        [storeId],
      );
      const lines = await c.query<{
        id: string;
        opening_id: string;
        item_id: string;
        code: string;
        name: string;
        unit: string;
        asset: boolean;
        qty: string;
        rate: string;
        value: string;
        batch_no: string | null;
        expiry: string | null;
        reversed: boolean;
        assets: number;
      }>(
        `SELECT m.id::text, m.doc_id::text AS opening_id, m.item_id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit,
                i.item_type = 'asset' AS asset, m.qty::text, m.rate::text, m.value::text, m.batch_no, m.expiry::text,
                EXISTS (SELECT 1 FROM stock_moves x WHERE x.kind = 'opening_undo' AND x.doc_line_id = m.id) AS reversed,
                (SELECT count(*)::int FROM assets a WHERE a.opening_move_id = m.id) AS assets
           FROM stock_moves m JOIN purchase_items i ON i.id = m.item_id
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE m.store_id = $1 AND m.kind = 'opening' ORDER BY m.id`,
        [storeId],
      );
      const live = lines.rows.filter((l) => !l.reversed);
      const settled = await this.settled(c, storeId, [...new Set(live.map((l) => l.item_id))]);
      const used = new Set<string>();
      for (const itemId of new Set(live.map((l) => l.item_id))) {
        const a = await openingAssets(
          c,
          live.filter((l) => l.item_id === itemId).map((l) => l.id),
        );
        if (a.used) used.add(itemId);
      }
      const why = (itemId: string) =>
        settled.get(itemId) ?? (used.has(itemId) ? 'its assets have been used since' : null);
      return {
        postings: posts.rows.map((p) => {
          const own = lines.rows.filter((l) => l.opening_id === p.id);
          return {
            id: p.id,
            source: p.source,
            fileName: p.file_name,
            reason: p.reason,
            by: p.by,
            at: p.at.toISOString(),
            undoneAt: p.undone_at?.toISOString() ?? null,
            undoneBy: p.undone_by,
            undoReason: p.undo_reason,
            value: round(own.filter((l) => !l.reversed).reduce((a, l) => a + Number(l.value), 0)),
            // undone at once: none of its standing items has moved
            canUndo:
              !p.undone_at &&
              own.some((l) => !l.reversed) &&
              own.filter((l) => !l.reversed).every((l) => !why(l.item_id)),
            lines: own.map((l) => ({
              moveId: l.id,
              itemId: l.item_id,
              code: l.code,
              name: l.name,
              unit: l.unit,
              asset: l.asset,
              qty: Number(l.qty),
              rate: Number(l.rate),
              value: Number(l.value),
              batch: l.batch_no,
              expiry: l.expiry,
              reversed: l.reversed,
              assets: l.assets,
            })),
          };
        }),
        items: Object.fromEntries(
          [...new Set(live.map((l) => l.item_id))].map((id) => [
            id,
            { canChange: !why(id), why: why(id) },
          ]),
        ),
        missingAssets: [...new Set(live.filter((l) => l.asset).map((l) => l.item_id))]
          .map((id) => {
            const own = live.filter((l) => l.item_id === id);
            const units = own.reduce((a, l) => a + Math.floor(Number(l.qty) + 1e-9), 0);
            const have = own.reduce((a, l) => a + l.assets, 0);
            return { itemId: id, name: own[0]!.name, units, assets: have, canMake: !why(id) };
          })
          .filter((x) => x.assets < x.units),
      };
    });
  }

  /** After an opening changes, a count still being counted takes the new book quantity. */
  private async refreshCountBook(c: PoolClient, storeId: string, itemIds: string[]) {
    await c.query(
      `UPDATE stock_count_lines l
          SET book_qty = CASE WHEN l.batch_no IS NULL
                              THEN COALESCE((SELECT b.qty FROM stock_balances b WHERE b.store_id = k.store_id AND b.item_id = l.item_id), 0)
                              ELSE COALESCE((SELECT sum(sb.qty_left) FROM stock_batches sb WHERE sb.store_id = k.store_id
                                               AND sb.item_id = l.item_id AND sb.batch_no = l.batch_no
                                               AND sb.expiry IS NOT DISTINCT FROM l.expiry), 0) END
         FROM stock_counts k
        WHERE k.id = l.count_id AND k.status = 'counting' AND k.store_id = $1 AND l.item_id = ANY($2::bigint[])`,
      [storeId, itemIds],
    );
  }

  /**
   * One item's opening corrected while the item has not moved since: every standing opening line of it
   * is reversed exactly and the lines it should have been post as a correction (with the reason); none:
   * the opening is removed. The item's assets made from the opening are kept (tags and all) with the new
   * cost, added or removed to match the new quantity.
   */
  async fixOpening(ctx: RequestContext, storeId: string, dto: OpeningFixDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const live = await this.liveOpenings(c, storeId, { itemIds: [dto.itemId] });
      if (!live.length)
        throw new DomainError('not-found', 'This item has no opening here to correct', {
          status: 404,
        });
      const name = (await this.openingItems(c, [dto.itemId])).get(dto.itemId)?.name ?? 'The item';
      const settled = (await this.settled(c, storeId, [dto.itemId])).get(dto.itemId);
      if (settled)
        throw new DomainError(
          'purchase.opening_settled',
          `${name}: ${settled} — correct the quantity with a physical count and the rate with a rate correction`,
          { status: 409 },
        );
      const assets = await openingAssets(
        c,
        live.map((m) => m.id),
      );
      if (assets.used)
        throw new DomainError(
          'purchase.opening_settled',
          `${name}: its assets have been used since — correct them on the asset register`,
          { status: 409 },
        );
      for (const m of live)
        await c.query(`SELECT app.stock_opening_undo($1, $2)`, [
          m.id,
          `Opening corrected: ${dto.reason}`.slice(0, 300),
        ]);
      const reuse = new Map([[dto.itemId, assets.ids]]);
      let openingId: string | null = null;
      if (dto.lines.length) {
        const r = await this.postOpening(
          c,
          storeId,
          dto.lines.map((l) => ({ ...l, itemId: dto.itemId })),
          {
            dryRun: false,
            source: 'correction',
            reason: dto.reason,
            day: live[0]!.moved_on,
            reuse,
          },
        );
        const bad = r.lines.filter((x) => x.error);
        if (bad.length)
          throw new DomainError('validation-failed', bad.map((x) => x.error).join('; '), {
            status: 400,
          });
        openingId = r.openingId;
      }
      await removeOpeningAssets(c, reuse.get(dto.itemId) ?? []);
      await this.refreshCountBook(c, storeId, [dto.itemId]);
      await this.audit.stage(ctx, c, {
        action: dto.lines.length
          ? 'purchase.stock.opening_fixed'
          : 'purchase.stock.opening_removed',
        entityType: 'stores',
        entityId: storeId,
        before: {
          item: dto.itemId,
          lines: live.map((m) => ({ qty: Number(m.qty), rate: Number(m.rate), batch: m.batch_no })),
        },
        after: { item: dto.itemId, opening: openingId, lines: dto.lines, reason: dto.reason },
      });
      return { corrected: true, removed: !dto.lines.length, openingId };
    });
  }

  /** A whole posting undone while none of its items has moved: every standing line reversed. */
  async undoOpening(ctx: RequestContext, openingId: string, dto: { reason: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const o = (
        await c.query<{ store_id: string; undone: boolean }>(
          `SELECT store_id::text, undone_at IS NOT NULL AS undone FROM stock_openings WHERE id = $1 FOR UPDATE`,
          [openingId],
        )
      ).rows[0];
      if (!o) throw new DomainError('not-found', 'Opening stock not found', { status: 404 });
      await this.mustOperate(c, ctx, o.store_id);
      if (o.undone)
        throw new DomainError('purchase.not_waiting', 'This upload is undone already', {
          status: 409,
        });
      const live = await this.liveOpenings(c, o.store_id, { openingId });
      if (!live.length)
        throw new DomainError('purchase.not_waiting', 'Nothing of this upload is left to undo', {
          status: 409,
        });
      const itemIds = [...new Set(live.map((m) => m.item_id))];
      const settled = await this.settled(c, o.store_id, itemIds);
      const items = await this.openingItems(c, itemIds);
      const stuck = itemIds.filter((id) => settled.has(id));
      if (stuck.length)
        throw new DomainError(
          'purchase.opening_settled',
          `Not undone: ${stuck.map((id) => `${items.get(id)?.name ?? 'an item'} (${settled.get(id)!})`).join('; ')}. Change or remove the other lines one by one.`,
          { status: 409 },
        );
      const assets = await openingAssets(
        c,
        live.map((m) => m.id),
      );
      if (assets.used)
        throw new DomainError(
          'purchase.opening_settled',
          'Not undone: some of its assets have been used since',
          { status: 409 },
        );
      for (const m of live)
        await c.query(`SELECT app.stock_opening_undo($1, $2)`, [
          m.id,
          `Upload undone: ${dto.reason}`.slice(0, 300),
        ]);
      await removeOpeningAssets(c, assets.ids);
      await c.query(
        `UPDATE stock_openings SET undone_at = now(), undone_by = app.current_user_id(), undo_reason = $2 WHERE id = $1`,
        [openingId, dto.reason],
      );
      await this.refreshCountBook(c, o.store_id, itemIds);
      await this.audit.stage(ctx, c, {
        action: 'purchase.stock.opening_undone',
        entityType: 'stores',
        entityId: o.store_id,
        after: { opening: openingId, lines: live.length, reason: dto.reason },
      });
      return { undone: live.length };
    });
  }

  /** The assets an asset item's opening should have made (stock posted before openings made them). */
  async makeOpeningAssets(ctx: RequestContext, storeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const live = (await this.liveOpenings(c, storeId, {})).filter(Boolean);
      const items = await this.openingItems(c, [...new Set(live.map((m) => m.item_id))]);
      const settled = await this.settled(c, storeId, [...items.keys()]);
      let made = 0;
      for (const m of live) {
        const it = items.get(m.item_id);
        if (!it?.asset || settled.has(m.item_id)) continue;
        const have = Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM assets WHERE opening_move_id = $1`,
              [m.id],
            )
          ).rows[0]!.n,
        );
        const units = Math.floor(Number(m.qty) + 1e-9);
        if (have >= units) continue;
        const r = await assetsForOpening(c, {
          moveId: m.id,
          storeId,
          itemId: m.item_id,
          description: it.name,
          units: units - have,
          cost: round(Number(m.rate)),
          day: m.moved_on,
        });
        made += r.made;
      }
      if (made)
        await this.audit.stage(ctx, c, {
          action: 'purchase.stock.opening_assets',
          entityType: 'stores',
          entityId: storeId,
          after: { assets: made },
        });
      return { made };
    });
  }

  /** The opening stock statement of a store (what stands now), as PDF or Excel, for signing. */
  async openingStatement(ctx: RequestContext, storeId: string, format: 'pdf' | 'xlsx') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!this.has(ctx, PURCHASE.storeView))
        throw new DomainError('permission-denied', 'Only the stores see the opening stock', {
          status: 403,
        });
      const s = (
        await c.query<{ name: string; code: string }>(
          `SELECT name, code FROM stores WHERE id = $1`,
          [storeId],
        )
      ).rows[0];
      if (!s) throw new DomainError('not-found', 'Store not found', { status: 404 });
      const live = await this.liveOpenings(c, storeId, {});
      const items = await this.openingItems(c, [...new Set(live.map((m) => m.item_id))]);
      const rows = live
        .map((m) => ({ m, it: items.get(m.item_id)! }))
        .sort((a, b) => a.it.name.localeCompare(b.it.name));
      const total = round(rows.reduce((a, r) => a + Number(r.m.value), 0));
      const first = (
        await c.query<{ by: string | null; by_id: string | null; at: Date | null }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `SELECT ${PERSON('o.created_by')} AS by, o.created_by::text AS by_id, o.created_at AS at
             FROM stock_openings o WHERE o.store_id = $1 AND o.undone_at IS NULL ORDER BY o.created_at LIMIT 1`,
          [storeId],
        )
      ).rows[0];
      const day = rows[0]?.m.moved_on ?? null;
      const slug = `Opening-stock-${s.code}`;
      if (format === 'xlsx') {
        const school = (
          await c.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]!.name;
        return libraryFile({
          format: 'xlsx',
          name: `Opening stock statement — ${s.name}`,
          slug,
          school,
          by: first?.by ?? '',
          words: day ? `As on ${day.split('-').reverse().join('-')}` : 'No opening stock',
          columns: [
            { label: 'Item code', width: 1.4 },
            { label: 'Item', width: 3 },
            { label: 'Batch', width: 1.3 },
            { label: 'Expiry', type: 'date' },
            { label: 'Unit', width: 0.9 },
            { label: 'Quantity', type: 'number' },
            { label: 'Rate (₹)', type: 'money' },
            { label: 'Value (₹)', type: 'money' },
          ] as FileColumn[],
          rows: rows.map(({ m, it }) => [
            it.code,
            it.name,
            m.batch_no,
            m.expiry,
            it.unit,
            Number(m.qty),
            Number(m.rate),
            Number(m.value),
          ]),
          totals: ['Total', '', '', '', '', '', '', total],
        });
      }
      const read = (key: string) => this.storage.read(key);
      const head = await pdfSchool(c, read);
      const bytes = await purchaseStockPdf({
        ...head,
        title: 'Opening Stock Statement',
        number: s.code,
        watermark: null,
        facts: [
          ['Store', s.name],
          ['As on', day ? dmy(day) : '—'],
          ['Lines', String(rows.length)],
        ],
        columns: [
          { label: '#', width: 4 },
          { label: 'Item', width: 38 },
          { label: 'Unit', width: 7 },
          { label: 'Quantity', width: 11, right: true },
          { label: 'Rate (Rs)', width: 12, right: true },
          { label: 'Value (Rs)', width: 13, right: true },
        ],
        rows: rows.map(({ m, it }, i) => ({
          cells: [
            String(i + 1),
            `${it.name} (${it.code})`,
            it.unit,
            qty3(Number(m.qty)),
            money2(Number(m.rate)),
            money2(Number(m.value)),
          ],
          detail: [
            m.batch_no ? `Batch ${m.batch_no}` : null,
            m.expiry ? `expiry ${dmy(m.expiry)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        total: { label: 'Total value (Rs)', value: money2(total) },
        signatures: [
          first?.by_id
            ? await signerOf(c, read, {
                as: 'Posted by (store keeper)',
                name: first.by,
                userId: first.by_id,
                at: first.at,
                verb: 'Posted on',
              })
            : blankBox('Store keeper'),
          blankBox('Verified by'),
          blankBox('Principal'),
        ],
        foot: 'The opening stock of the store as it stands, corrections included. Each item is checked against the shelf and signed.',
      });
      return { bytes, filename: `${slug}.pdf` };
    });
  }

  // ---- a rate correction: what is left of an item, revalued once the school admin approves ----------
  async revaluations(ctx: RequestContext, q: { status?: string; storeId?: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!this.has(ctx, PURCHASE.storeView) && !this.has(ctx, PURCHASE.countApprove))
        throw new DomainError('permission-denied', 'Only the stores see rate corrections', {
          status: 403,
        });
      const r = await c.query<{
        id: string;
        number: string;
        store_id: string;
        store: string;
        item_id: string;
        item: string;
        code: string;
        unit: string;
        qty: string;
        old_rate: string;
        new_rate: string;
        reason: string;
        status: string;
        by: string | null;
        by_id: string | null;
        at: Date;
        decided_by: string | null;
        decided_at: Date | null;
        decision_note: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT r.id::text, r.number, r.store_id::text, st.name AS store, r.item_id::text, i.name AS item, i.code,
                COALESCE(su.code, u.code) AS unit, r.qty::text, r.old_rate::text, r.new_rate::text, r.reason, r.status,
                ${PERSON('r.created_by')} AS by, r.created_by::text AS by_id, r.created_at AS at,
                ${PERSON('r.decided_by')} AS decided_by, r.decided_at, r.decision_note
           FROM stock_revaluations r JOIN stores st ON st.id = r.store_id JOIN purchase_items i ON i.id = r.item_id
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE ($1::text IS NULL OR r.status = $1) AND ($2::bigint IS NULL OR r.store_id = $2)
          ORDER BY (r.status = 'submitted') DESC, r.created_at DESC LIMIT 100`,
        [q.status ?? null, q.storeId ?? null],
      );
      const me = String(ctx.user.id);
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          storeId: x.store_id,
          store: x.store,
          itemId: x.item_id,
          item: x.item,
          code: x.code,
          unit: x.unit,
          qty: Number(x.qty),
          oldRate: Number(x.old_rate),
          newRate: Number(x.new_rate),
          change: round(Number(x.qty) * (Number(x.new_rate) - Number(x.old_rate))),
          reason: x.reason,
          status: x.status,
          by: x.by,
          at: x.at.toISOString(),
          decidedBy: x.decided_by,
          decidedAt: x.decided_at?.toISOString() ?? null,
          decisionNote: x.decision_note,
          can: {
            decide:
              x.status === 'submitted' && this.has(ctx, PURCHASE.countApprove) && x.by_id !== me,
            cancel:
              x.status === 'submitted' && (x.by_id === me || this.has(ctx, PURCHASE.storeManage)),
          },
        })),
      };
    });
  }

  async requestRevaluation(ctx: RequestContext, storeId: string, dto: RevaluationDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustOperate(c, ctx, storeId);
      const b = (
        await c.query<{ qty: string; avg: string; name: string }>(
          `SELECT b.qty::text, b.avg_rate::text AS avg, i.name FROM stock_balances b JOIN purchase_items i ON i.id = b.item_id
            WHERE b.store_id = $1 AND b.item_id = $2`,
          [storeId, dto.itemId],
        )
      ).rows[0];
      if (!b || Number(b.qty) <= 0)
        throw new DomainError('validation-failed', 'Nothing of this item is in the store', {
          status: 400,
        });
      if (Number(b.avg) === dto.newRate)
        throw new DomainError('validation-failed', `${b.name} is at ₹${b.avg} already`, {
          status: 400,
        });
      const live = await this.liveOpenings(c, storeId, { itemIds: [dto.itemId] });
      if (live.length && !(await this.settled(c, storeId, [dto.itemId])).has(dto.itemId))
        throw new DomainError(
          'validation-failed',
          `${b.name} has not moved since its opening: change the opening instead`,
          { status: 400 },
        );
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('revaluation') AS n`)
      ).rows[0]!.n;
      const id = (
        await c
          .query<{ id: string }>(
            `INSERT INTO stock_revaluations (school_id, number, store_id, item_id, qty, old_rate, new_rate, reason, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
            [number, storeId, dto.itemId, b.qty, b.avg, dto.newRate, dto.reason],
          )
          .catch((e: unknown) => {
            if (e instanceof Error && e.message.includes('stock_revaluations_open'))
              throw new DomainError(
                'purchase.duplicate',
                `${b.name} already has a rate correction waiting for approval`,
                { status: 409 },
              );
            throw e;
          })
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'purchase.stock.revaluation_asked',
        entityType: 'stock_revaluations',
        entityId: id,
        after: { number, item: dto.itemId, from: Number(b.avg), to: dto.newRate },
      });
      return { id, number };
    });
  }

  /**
   * The school admin (not who asked) approves: what is in the store now goes out at the average and
   * back in at the new rate (batch by batch), the value of the item's opening assets in the store
   * follows; or rejects. Who asked (or the stores' manager) may cancel it while it waits.
   */
  async decideRevaluation(ctx: RequestContext, id: string, dto: RevaluationDecisionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{
          number: string;
          store_id: string;
          item_id: string;
          new_rate: string;
          status: string;
          created_by: string | null;
        }>(
          `SELECT number, store_id::text, item_id::text, new_rate::text, status, created_by::text
             FROM stock_revaluations WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!r) throw new DomainError('not-found', 'Rate correction not found', { status: 404 });
      if (r.status !== 'submitted')
        throw new DomainError('purchase.not_waiting', 'This rate correction is decided already', {
          status: 409,
        });
      const me = String(ctx.user.id);
      if (dto.action === 'cancel') {
        if (r.created_by !== me && !this.has(ctx, PURCHASE.storeManage))
          throw new DomainError('permission-denied', 'Only who asked may cancel it', {
            status: 403,
          });
      } else if (!this.has(ctx, PURCHASE.countApprove) || r.created_by === me)
        throw new DomainError(
          'permission-denied',
          'The school admin approves rate corrections (not who asked)',
          { status: 403 },
        );
      if (dto.action === 'approve') {
        const it = (await this.openingItems(c, [r.item_id])).get(r.item_id)!;
        const rate = Number(r.new_rate);
        const parts = it.batch
          ? (
              await c.query<{ batch_no: string; expiry: string | null; qty: string }>(
                `SELECT batch_no, expiry::text, qty_left::text AS qty FROM stock_batches
                  WHERE store_id = $1 AND item_id = $2 AND qty_left > 0 ORDER BY expiry NULLS LAST, id`,
                [r.store_id, r.item_id],
              )
            ).rows.map((x) => ({ batch: x.batch_no, expiry: x.expiry, qty: Number(x.qty) }))
          : [
              {
                batch: null,
                expiry: null,
                qty: Number(
                  (
                    await c.query<{ q: string }>(
                      `SELECT COALESCE(qty, 0)::text AS q FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
                      [r.store_id, r.item_id],
                    )
                  ).rows[0]?.q ?? 0,
                ),
              },
            ];
        if (!parts.some((p) => p.qty > 0))
          throw new DomainError('validation-failed', `Nothing of ${it.name} is left to revalue`, {
            status: 400,
          });
        const note = `${r.number}: rate corrected`;
        for (const p of parts)
          await postStock(
            c,
            {
              storeId: r.store_id,
              itemId: r.item_id,
              kind: 'revalue',
              qty: -p.qty,
              batch: p.batch,
              docType: 'revaluation',
              docId: id,
              note,
            },
            it.name,
          );
        for (const p of parts)
          await postStock(
            c,
            {
              storeId: r.store_id,
              itemId: r.item_id,
              kind: 'revalue',
              qty: p.qty,
              rate,
              batch: p.batch,
              expiry: p.expiry,
              docType: 'revaluation',
              docId: id,
              note,
            },
            it.name,
          );
        await c.query(
          `UPDATE assets SET cost = $3, updated_at = now()
            WHERE store_id = $1 AND item_id = $2 AND status = 'in_store' AND opening_move_id IS NOT NULL`,
          [r.store_id, r.item_id, round(rate)],
        );
      }
      const status =
        dto.action === 'approve' ? 'approved' : dto.action === 'reject' ? 'rejected' : 'cancelled';
      await c.query(
        `UPDATE stock_revaluations SET status = $2, decided_at = now(), decided_by = app.current_user_id(),
                decision_note = $3 WHERE id = $1`,
        [id, status, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `purchase.stock.revaluation_${status}`,
        entityType: 'stock_revaluations',
        entityId: id,
        after: { number: r.number, status },
      });
      return { status };
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
