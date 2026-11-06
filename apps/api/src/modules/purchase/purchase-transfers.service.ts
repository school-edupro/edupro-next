import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import {
  dmy,
  freeStock,
  istToday,
  money2,
  mustOperateStore,
  pdfSchool,
  PERSON_OF,
  qty3,
} from './purchase-stock-core';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { postStock } from './purchase-stores.service';
import { PURCHASE, type NoteDto, type StockDocQueryDto, type TransferDto } from './purchase.dto';

/** I keep the transfer's receiving store. */
const RECEIVES = `EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
  WHERE k.store_id = t.to_store_id AND e.user_id = app.current_user_id())`;

// eslint-disable-next-line no-restricted-syntax -- PERSON_OF and RECEIVES are fixed fragments
const SELECT = `
  SELECT t.id::text, t.number, t.status, t.from_store_id::text, fs.name AS from_store, t.to_store_id::text, ts.name AS to_store,
         t.sent_on::text, t.received_on::text, t.note, t.receive_note,
         (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = t.created_by) AS sent_by,
         (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = t.received_by) AS received_by,
         (SELECT count(*)::int FROM stock_transfer_lines l WHERE l.transfer_id = t.id) AS lines,
         COALESCE((SELECT sum(l.value) FROM stock_transfer_lines l WHERE l.transfer_id = t.id), 0)::text AS value,
         ${RECEIVES} AS receiver
    FROM stock_transfers t JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id`;

interface TransferRow {
  id: string;
  number: string;
  status: 'in_transit' | 'received' | 'cancelled';
  from_store_id: string;
  from_store: string;
  to_store_id: string;
  to_store: string;
  sent_on: string;
  received_on: string | null;
  note: string | null;
  receive_note: string | null;
  sent_by: string | null;
  received_by: string | null;
  lines: number;
  value: string;
  receiver: boolean;
}

/**
 * Transfers between stores (docs/design/84, part 8): the sending keeper sends items (out at the
 * average, the named batch or the earliest expiry first; never more than the free stock); they are in
 * transit until the receiving keeper receives them (in at the same rate, batch and expiry); the sender
 * may cancel one still in transit (back into the sending store).
 */
@Injectable()
export class PurchaseTransfersService {
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
      throw new DomainError('permission-denied', 'Only the stores see transfers', { status: 403 });
  }

  private shape(t: TransferRow) {
    return {
      id: t.id,
      number: t.number,
      status: t.status,
      fromStoreId: t.from_store_id,
      fromStore: t.from_store,
      toStoreId: t.to_store_id,
      toStore: t.to_store,
      sentOn: t.sent_on,
      receivedOn: t.received_on,
      note: t.note,
      receiveNote: t.receive_note,
      sentBy: t.sent_by,
      receivedBy: t.received_by,
      lines: t.lines,
      value: Number(t.value),
      receiver: t.receiver,
    };
  }

  async list(ctx: RequestContext, q: StockDocQueryDto) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<TransferRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} WHERE ($1::text IS NULL OR t.status = $1) AND ($2::bigint IS NULL OR t.from_store_id = $2 OR t.to_store_id = $2)
            AND (NOT $3 OR (t.status = 'in_transit' AND (${RECEIVES} OR $4)))
            AND ($5::text IS NULL OR t.number ILIKE '%' || $5 || '%')
          ORDER BY (t.status = 'in_transit') DESC, t.sent_on DESC, t.id DESC LIMIT 50 OFFSET $6`,
        [
          q.status ?? null,
          q.storeId ?? null,
          q.mine,
          this.has(ctx, PURCHASE.storeManage),
          q.q ?? null,
          (q.page - 1) * 50,
        ],
      );
      return { rows: r.rows.map((x) => this.shape(x)), page: q.page };
    });
  }

  private async load(c: PoolClient, id: string, lock = false) {
    const r = await c.query<TransferRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE t.id = $1${lock ? ' FOR UPDATE OF t' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Transfer not found', { status: 404 });
    return r.rows[0];
  }

  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        item_id: string;
        item_code: string;
        item: string;
        unit: string;
        qty: string;
        rate: string;
        value: string;
        batch_no: string | null;
        expiry: string | null;
      }>(
        `SELECT l.id::text, l.item_id::text, i.code AS item_code, i.name AS item, COALESCE(su.code, u.code) AS unit, l.qty::text,
                l.rate::text, l.value::text, l.batch_no, l.expiry::text
           FROM stock_transfer_lines l JOIN purchase_items i ON i.id = l.item_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE l.transfer_id = $1 ORDER BY l.id`,
        [id],
      )
    ).rows;
  }

  async get(ctx: RequestContext, id: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.load(c, id);
      const lines = await this.linesOf(c, id);
      const manage = this.has(ctx, PURCHASE.storeManage);
      const sends =
        manage ||
        (this.has(ctx, PURCHASE.storeOperate) &&
          !!(
            await c.query(
              `SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                WHERE k.store_id = $1 AND e.user_id = app.current_user_id()`,
              [t.from_store_id],
            )
          ).rowCount);
      return {
        ...this.shape(t),
        lineItems: lines.map((l) => ({
          id: l.id,
          itemId: l.item_id,
          itemCode: l.item_code,
          item: l.item,
          unit: l.unit,
          qty: Number(l.qty),
          rate: Number(l.rate),
          value: Number(l.value),
          batch: l.batch_no,
          expiry: l.expiry,
        })),
        can: {
          receive:
            t.status === 'in_transit' &&
            (manage || (this.has(ctx, PURCHASE.storeOperate) && t.receiver)),
          cancel: t.status === 'in_transit' && sends,
        },
      };
    });
  }

  async create(ctx: RequestContext, dto: TransferDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const from = await mustOperateStore(c, ctx.permissions, dto.fromStoreId, 'send from');
      const to = (
        await c.query<{ name: string; status: string }>(
          `SELECT name, status FROM stores WHERE id = $1`,
          [dto.toStoreId],
        )
      ).rows[0];
      if (!to)
        throw new DomainError('not-found', 'The receiving store was not found', { status: 404 });
      if (from.status !== 'active' || to.status !== 'active')
        throw new DomainError('validation-failed', 'Both stores must be in use', { status: 400 });
      const need = new Map<string, number>();
      for (const l of dto.lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
      for (const [itemId, q] of need) {
        const it = (
          await c.query<{ name: string; stock_tracked: boolean }>(
            `SELECT name, stock_tracked FROM purchase_items WHERE id = $1`,
            [itemId],
          )
        ).rows[0];
        if (!it?.stock_tracked)
          throw new DomainError(
            'validation-failed',
            `${it?.name ?? 'An item'} is not kept in stock`,
          );
        const f = await freeStock(c, dto.fromStoreId, itemId);
        if (q > f.free + 1e-9)
          throw new DomainError(
            'stock.insufficient',
            `${it.name}: ${qty3(f.free)} free in ${from.name} (${qty3(f.reserved)} reserved for requisitions)`,
            { status: 409 },
          );
      }
      const day = istToday();
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('transfer') AS n`)
      ).rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO stock_transfers (school_id, number, from_store_id, to_store_id, sent_on, note, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
          [number, dto.fromStoreId, dto.toStoreId, day, dto.note ?? null],
        )
      ).rows[0]!.id;
      for (const l of dto.lines) {
        const it = (
          await c.query<{ name: string; tracks_batch: boolean }>(
            `SELECT name, tracks_batch FROM purchase_items WHERE id = $1`,
            [l.itemId],
          )
        ).rows[0]!;
        // a batch item goes batch by batch (the named one, else the earliest expiry first), so the
        // receiving store gets the same batches
        const parts: Array<{ qty: number; batch: string | null; expiry: string | null }> = [];
        if (it.tracks_batch) {
          let left = l.qty;
          const bs = await c.query<{ batch_no: string; expiry: string | null; qty_left: string }>(
            `SELECT batch_no, expiry::text, qty_left::text FROM stock_batches
              WHERE store_id = $1 AND item_id = $2 AND qty_left > 0 AND ($3::text IS NULL OR batch_no = $3)
              ORDER BY expiry NULLS LAST, id`,
            [dto.fromStoreId, l.itemId, l.batch ?? null],
          );
          for (const b of bs.rows) {
            if (left <= 0) break;
            const take = Math.round(Math.min(left, Number(b.qty_left)) * 1000) / 1000;
            parts.push({ qty: take, batch: b.batch_no, expiry: b.expiry });
            left = Math.round((left - take) * 1000) / 1000;
          }
          if (left > 1e-9)
            throw new DomainError(
              'stock.insufficient',
              `${it.name}: not enough in ${l.batch ? `batch ${l.batch}` : 'its batches'}`,
              { status: 409 },
            );
        } else parts.push({ qty: l.qty, batch: null, expiry: null });
        for (const p of parts) {
          const moveId = await postStock(
            c,
            {
              storeId: dto.fromStoreId,
              itemId: l.itemId,
              kind: 'transfer_out',
              qty: -p.qty,
              batch: p.batch,
              docType: 'stock_transfer',
              docId: id,
              note: `${number} to ${to.name}`,
              day,
            },
            it.name,
          );
          await c.query(
            `INSERT INTO stock_transfer_lines (school_id, transfer_id, item_id, qty, rate, value, batch_no, expiry, out_move_id)
             SELECT app.current_school_id(), $1, $2, $3, m.rate, -m.value, $4, $5::date, m.id FROM stock_moves m WHERE m.id = $6`,
            [id, l.itemId, p.qty, p.batch, p.expiry, moveId],
          );
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.transfer.send',
        entityType: 'stock_transfers',
        entityId: id,
        after: { number, from: from.name, to: to.name, lines: dto.lines.length },
      });
      return { id, number };
    });
  }

  /** Into the receiving store (by its keeper), or back into the sending one (cancelled by its keeper). */
  private async land(c: PoolClient, t: TransferRow, back: boolean, day: string) {
    const storeId = back ? t.from_store_id : t.to_store_id;
    for (const l of await this.linesOf(c, t.id)) {
      const moveId = await postStock(
        c,
        {
          storeId,
          itemId: l.item_id,
          kind: 'transfer_in',
          qty: Number(l.qty),
          rate: Number(l.rate),
          batch: l.batch_no,
          expiry: l.expiry,
          docType: 'stock_transfer',
          docId: t.id,
          note: back ? `${t.number} cancelled` : `${t.number} from ${t.from_store}`,
          day,
        },
        l.item,
      );
      await c.query(`UPDATE stock_transfer_lines SET in_move_id = $2 WHERE id = $1`, [
        l.id,
        moveId,
      ]);
    }
  }

  async receive(ctx: RequestContext, id: string, dto: NoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.load(c, id, true);
      if (t.status !== 'in_transit')
        throw new DomainError('purchase.not_waiting', 'This transfer is not in transit', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, t.to_store_id, 'receive into');
      const day = istToday();
      await this.land(c, t, false, day);
      await c.query(
        `UPDATE stock_transfers SET status = 'received', received_on = $2, received_by = app.current_user_id(), receive_note = $3
          WHERE id = $1`,
        [id, day, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.transfer.receive',
        entityType: 'stock_transfers',
        entityId: id,
        after: { number: t.number },
      });
      return { received: true };
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: NoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.load(c, id, true);
      if (t.status !== 'in_transit')
        throw new DomainError('purchase.not_waiting', 'This transfer is not in transit', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, t.from_store_id, 'cancel transfers of');
      if (!dto.note)
        throw new DomainError('validation-failed', 'Say why it is cancelled', { status: 400 });
      await this.land(c, t, true, istToday());
      await c.query(
        `UPDATE stock_transfers SET status = 'cancelled', receive_note = $2 WHERE id = $1`,
        [id, dto.note],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.transfer.cancel',
        entityType: 'stock_transfers',
        entityId: id,
        after: { number: t.number, note: dto.note },
      });
      return { cancelled: true };
    });
  }

  async pdf(ctx: RequestContext, id: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.load(c, id);
      const lines = await this.linesOf(c, id);
      const head = await pdfSchool(c, (k) => this.storage.read(k));
      const bytes = await purchaseStockPdf({
        ...head,
        title: 'Stock Transfer Note',
        number: t.number,
        watermark: t.status === 'cancelled' ? 'CANCELLED' : null,
        facts: [
          ['Sent on', dmy(t.sent_on)],
          ['From', t.from_store],
          ['To', t.to_store],
          [
            'Status',
            t.status === 'received'
              ? `Received on ${dmy(t.received_on)}${t.receive_note ? ` (${t.receive_note})` : ''}`
              : t.status === 'cancelled'
                ? `Cancelled: ${t.receive_note ?? ''}`
                : 'In transit',
          ],
          ...((t.note ? [['Note', t.note]] : []) as Array<[string, string]>),
        ],
        columns: [
          { label: '#', width: 4 },
          { label: 'Item', width: 46 },
          { label: 'Unit', width: 8 },
          { label: 'Quantity', width: 12, right: true },
          { label: 'Rate (Rs)', width: 13, right: true },
          { label: 'Value (Rs)', width: 14, right: true },
        ],
        rows: lines.map((l, i) => ({
          cells: [
            String(i + 1),
            `${l.item} (${l.item_code})`,
            l.unit,
            qty3(Number(l.qty)),
            money2(Number(l.rate)),
            money2(Number(l.value)),
          ],
          detail: l.batch_no
            ? `Batch ${l.batch_no}${l.expiry ? `, expiry ${dmy(l.expiry)}` : ''}`
            : undefined,
        })),
        total: {
          label: 'Value (Rs)',
          value: money2(lines.reduce((a, l) => a + Number(l.value), 0)),
        },
        signatures: [
          { label: 'Sent by', name: t.sent_by },
          { label: 'Received by', name: t.received_by },
        ],
      });
      return { bytes, filename: `${t.number.replaceAll('/', '-')}.pdf` };
    });
  }
}
