import type { PoolClient } from '@edupro/db';

/**
 * The asset register kept in step with the store (docs/design/84, part 9): an accepted unit of an asset
 * item becomes an asset in the store; an issue gives the oldest ones in that store to the department
 * and the person who took them; goods brought back come back into the store; a store transfer moves
 * them (in transit until received); a return to the vendor takes them off the register. Fewer assets
 * than the quantity moved (stock from before the register) is fine: those units are simply not
 * registered yet.
 */

/** An asset's book value: its last depreciation year's closing, else its cost. */
export const BOOK_VALUE = (a: string) =>
  // eslint-disable-next-line no-restricted-syntax -- a is a fixed table alias
  `COALESCE((SELECT d.closing FROM asset_depreciation d WHERE d.asset_id = ${a}.id ORDER BY d.fy DESC LIMIT 1), ${a}.cost)`;

async function move(
  c: PoolClient,
  ids: string[],
  m: {
    kind: string;
    day: string;
    fromStore?: string | null;
    toStore?: string | null;
    toDepartment?: string | null;
    toCustodian?: string | null;
    doc?: string | null;
    note?: string | null;
  },
) {
  if (!ids.length) return;
  await c.query(
    `INSERT INTO asset_movements (school_id, asset_id, kind, moved_on, from_store_id, to_store_id, to_department_id, to_custodian_id,
                                  doc, note, created_by)
     SELECT app.current_school_id(), a, $2, $3::date, $4, $5, $6, $7, $8, $9, app.current_user_id() FROM unnest($1::bigint[]) a`,
    [
      ids,
      m.kind,
      m.day,
      m.fromStore ?? null,
      m.toStore ?? null,
      m.toDepartment ?? null,
      m.toCustodian ?? null,
      m.doc?.slice(0, 60) ?? null,
      m.note?.slice(0, 500) ?? null,
    ],
  );
}

/** Each accepted unit of an asset item on a goods receipt becomes an asset in the receipt's store. */
export async function assetsFromReceipt(c: PoolClient, receiptId: string, day: string) {
  const lines = await c.query<{
    id: string;
    item_id: string;
    description: string;
    accepted: string;
    per_unit: string;
    unit_cost: string | null;
    serials: string[];
    rejected_serials: string[];
    store_id: string;
    order_id: string;
    vendor_id: string;
    number: string;
  }>(
    `SELECT gl.id::text, ol.item_id::text, ol.description, gl.accepted_qty::text AS accepted, i.stock_per_unit::text AS per_unit,
            gl.unit_cost::text, gl.serials, gl.rejected_serials, g.store_id::text, g.order_id::text, po.vendor_id::text, g.number
       FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.receipt_id
       JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
       JOIN purchase_orders po ON po.id = g.order_id
       JOIN purchase_items i ON i.id = ol.item_id AND i.item_type = 'asset' AND i.stock_tracked
      WHERE gl.receipt_id = $1 AND gl.accepted_qty > 0 AND g.kind = 'goods' ORDER BY gl.seq`,
    [receiptId],
  );
  let made = 0;
  for (const l of lines.rows) {
    const per = Number(l.per_unit);
    const units = Math.floor(Number(l.accepted) * per + 1e-9);
    const serials = l.serials.filter((s) => !l.rejected_serials.includes(s));
    const cost = l.unit_cost === null ? 0 : Math.round((Number(l.unit_cost) / per) * 100) / 100;
    const ids: string[] = [];
    for (let i = 0; i < units; i += 1) {
      const tag = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('asset') AS n`))
        .rows[0]!.n;
      ids.push(
        (
          await c.query<{ id: string }>(
            `INSERT INTO assets (school_id, tag, item_id, description, serial_no, receipt_line_id, order_id, vendor_id, cost, acquired_on,
                                 status, store_id, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'in_store', $10, app.current_user_id())
             RETURNING id::text`,
            [
              tag,
              l.item_id,
              l.description.slice(0, 300),
              serials[i] ?? null,
              l.id,
              l.order_id,
              l.vendor_id,
              cost,
              day,
              l.store_id,
            ],
          )
        ).rows[0]!.id,
      );
    }
    await move(c, ids, { kind: 'received', day, toStore: l.store_id, doc: l.number });
    made += ids.length;
  }
  return made;
}

/** The oldest assets of an item in a store go out with an issue to the department and who took it. */
export async function assetsOut(
  c: PoolClient,
  m: {
    storeId: string;
    itemId: string;
    qty: number;
    issueLineId: string;
    departmentId: string;
    custodianId: string | null;
    day: string;
    doc: string;
  },
) {
  const r = await c.query<{ id: string }>(
    `WITH pick AS (SELECT id FROM assets WHERE store_id = $1 AND item_id = $2 AND status = 'in_store'
                        AND NOT EXISTS (SELECT 1 FROM condemnation_lines cl JOIN condemnations ck ON ck.id = cl.condemnation_id
                                       WHERE cl.asset_id = assets.id AND ck.status IN ('draft', 'committee', 'approval'))
        ORDER BY id LIMIT $7 FOR UPDATE)
      UPDATE assets a SET status = 'in_use', store_id = NULL, department_id = $3, custodian_employee_id = $4,
            put_to_use_on = COALESCE(a.put_to_use_on, $5::date), issue_line_id = $6, updated_at = now()
        FROM pick WHERE a.id = pick.id
      RETURNING a.id::text`,
    [
      m.storeId,
      m.itemId,
      m.departmentId,
      m.custodianId,
      m.day,
      m.issueLineId,
      Math.floor(m.qty + 1e-9),
    ],
  );
  await move(
    c,
    r.rows.map((x) => x.id),
    {
      kind: 'issued',
      day: m.day,
      fromStore: m.storeId,
      toDepartment: m.departmentId,
      toCustodian: m.custodianId,
      doc: m.doc,
    },
  );
}

/** Assets brought back against an issue line come back into the store (damaged ones marked so). */
export async function assetsBack(
  c: PoolClient,
  m: {
    issueLineId: string;
    qty: number;
    storeId: string;
    damaged: boolean;
    day: string;
    doc: string;
  },
) {
  const r = await c.query<{ id: string }>(
    `WITH pick AS (SELECT id FROM assets WHERE issue_line_id = $1 AND status = 'in_use' ORDER BY id LIMIT $4 FOR UPDATE)
     UPDATE assets a SET status = 'in_store', store_id = $2, department_id = NULL, custodian_employee_id = NULL,
            condition = CASE WHEN $3 THEN 'unserviceable' ELSE a.condition END, updated_at = now()
       FROM pick WHERE a.id = pick.id
     RETURNING a.id::text`,
    [m.issueLineId, m.storeId, m.damaged, Math.floor(m.qty + 1e-9)],
  );
  await move(
    c,
    r.rows.map((x) => x.id),
    {
      kind: 'back_to_store',
      day: m.day,
      toStore: m.storeId,
      doc: m.doc,
      note: m.damaged ? 'Came back damaged' : null,
    },
  );
}

/** A store transfer: sent (in transit), received into the other store, or cancelled back. */
export async function assetsTransfer(
  c: PoolClient,
  m: {
    phase: 'send' | 'receive' | 'cancel';
    transferLineId: string;
    fromStoreId: string;
    toStoreId: string;
    itemId: string;
    qty: number;
    day: string;
    doc: string;
  },
) {
  const r =
    m.phase === 'send'
      ? await c.query<{ id: string }>(
          `WITH pick AS (SELECT id FROM assets WHERE store_id = $1 AND item_id = $2 AND status = 'in_store'
                           AND NOT EXISTS (SELECT 1 FROM condemnation_lines cl JOIN condemnations ck ON ck.id = cl.condemnation_id
                                            WHERE cl.asset_id = assets.id AND ck.status IN ('draft', 'committee', 'approval'))
                         ORDER BY id LIMIT $4 FOR UPDATE)
           UPDATE assets a SET status = 'in_transit', transfer_line_id = $3, updated_at = now()
             FROM pick WHERE a.id = pick.id
           RETURNING a.id::text`,
          [m.fromStoreId, m.itemId, m.transferLineId, Math.floor(m.qty + 1e-9)],
        )
      : await c.query<{ id: string }>(
          `UPDATE assets SET status = 'in_store', store_id = $2, updated_at = now()
            WHERE transfer_line_id = $1 AND status = 'in_transit' RETURNING id::text`,
          [m.transferLineId, m.phase === 'receive' ? m.toStoreId : m.fromStoreId],
        );
  await move(
    c,
    r.rows.map((x) => x.id),
    {
      kind: 'store_transfer',
      day: m.day,
      fromStore: m.fromStoreId,
      toStore: m.phase === 'cancel' ? m.fromStoreId : m.toStoreId,
      doc: m.doc,
      note: m.phase === 'send' ? 'Sent' : m.phase === 'receive' ? 'Received' : 'Cancelled: back',
    },
  );
}

/** Units sent back to the vendor from stock leave the register (those of that receipt line first). */
export async function assetsToVendor(
  c: PoolClient,
  m: {
    receiptLineId: string;
    storeId: string;
    itemId: string;
    qty: number;
    day: string;
    doc: string;
  },
) {
  const r = await c.query<{ id: string }>(
    `WITH pick AS (SELECT id FROM assets WHERE store_id = $1 AND item_id = $2 AND status = 'in_store'
        ORDER BY (receipt_line_id = $3::bigint) DESC NULLS LAST, id LIMIT $4 FOR UPDATE)
      UPDATE assets a SET status = 'returned', store_id = NULL, left_on = $5::date, book_value_at_exit = a.cost, updated_at = now()
        FROM pick WHERE a.id = pick.id
      RETURNING a.id::text`,
    [m.storeId, m.itemId, m.receiptLineId, Math.floor(m.qty + 1e-9), m.day],
  );
  await move(
    c,
    r.rows.map((x) => x.id),
    { kind: 'returned', day: m.day, fromStore: m.storeId, doc: m.doc },
  );
}
