import type { PoolClient } from '@edupro/db';
import { GST_STATES } from './gstin';
import { supplyOf, taxOf, totalsOf, type GstStatus } from './purchase-gst';
import { instalmentWords } from './purchase-setup.service';

/**
 * The Purchase Order's shared steps (docs/design/83, part 4), used by the requisition's approval, the
 * indent's bypass and the order screens: draft one PO per chosen vendor, work out the GST and totals
 * again, and mark the requisition and its indents ordered.
 */

/** A PO that still counts: not rejected, cancelled or superseded, and not replaced by a live revision. */
export const LIVE_PO = `po.status NOT IN ('rejected', 'cancelled', 'superseded')
  AND NOT EXISTS (SELECT 1 FROM purchase_orders nr WHERE nr.supersedes_id = po.id AND nr.status NOT IN ('rejected', 'cancelled'))`;
/** A PO the vendor has (approved, sent or closed). */
export const PLACED = `po.status IN ('approved', 'sent', 'closed')`;

/** How much of a requisition line is already on live POs. */
// eslint-disable-next-line no-restricted-syntax -- LIVE_PO is a fixed fragment
export const ON_ORDER = `COALESCE((SELECT sum(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
    WHERE pol.requisition_line_id = rl.id AND ${LIVE_PO}), 0)`;

const stateName = (code: string | null) =>
  code ? (GST_STATES[code as keyof typeof GST_STATES] ?? code) : null;

/**
 * The GST, totals, place of supply, payment words and MSME warning of a PO worked out again from its
 * vendor (its GST status and state now), its lines and charges.
 */
export async function recomputeOrder(c: PoolClient, orderId: string) {
  const po = (
    await c.query<{
      vendor_id: string;
      payment_term_id: string | null;
      gst_status: GstStatus;
      vendor_state: string | null;
      msme_type: string | null;
      vendor_name: string;
      school_state: string | null;
    }>(
      `SELECT po.vendor_id::text, po.payment_term_id::text, v.gst_status, v.state_code AS vendor_state, v.msme_type,
              v.legal_name AS vendor_name, s.state_code AS school_state
         FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
         JOIN purchase_settings s ON s.school_id = po.school_id
        WHERE po.id = $1`,
      [orderId],
    )
  ).rows[0]!;
  const supply = supplyOf(po.school_state, po.vendor_state);
  const lines = await c.query<{
    id: string;
    quantity: string;
    rate: string;
    discount_pct: string;
    gst_rate: string;
    reverse_charge: boolean;
    exempt: boolean;
  }>(
    `SELECT id::text, quantity::text, rate::text, discount_pct::text, gst_rate::text, reverse_charge, exempt
       FROM purchase_order_lines WHERE order_id = $1`,
    [orderId],
  );
  const parts = [];
  for (const l of lines.rows) {
    const t = taxOf(
      {
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        discountPct: Number(l.discount_pct),
        gstRate: Number(l.gst_rate),
        reverseCharge: l.reverse_charge,
        exempt: l.exempt,
      },
      po.gst_status,
      supply,
    );
    parts.push(t);
    await c.query(
      `UPDATE purchase_order_lines SET taxable = $2, cgst = $3, sgst = $4, igst = $5, rcm_gst = $6, total = $7 WHERE id = $1`,
      [l.id, t.taxable, t.cgst, t.sgst, t.igst, t.rcm, t.total],
    );
  }
  const charges = await c.query<{ id: string; amount: string; gst_rate: string }>(
    `SELECT id::text, amount::text, gst_rate::text FROM purchase_order_charges WHERE order_id = $1`,
    [orderId],
  );
  for (const ch of charges.rows) {
    const t = taxOf(
      { quantity: 1, rate: Number(ch.amount), gstRate: Number(ch.gst_rate) },
      po.gst_status,
      supply,
    );
    parts.push(t);
    await c.query(
      `UPDATE purchase_order_charges SET cgst = $2, sgst = $3, igst = $4, total = $5 WHERE id = $1`,
      [ch.id, t.cgst, t.sgst, t.igst, t.total],
    );
  }
  const totals = totalsOf(parts);
  // the payment term in words, and the MSME 45-day warning
  let paymentText: string | null = null;
  let longest = 0;
  if (po.payment_term_id) {
    const t = await c.query<{
      print_text: string | null;
      pct: string;
      due_on: string;
      days: number;
    }>(
      `SELECT t.print_text, l.pct::text, l.due_on, l.days FROM purchase_payment_terms t
         JOIN purchase_payment_term_lines l ON l.term_id = t.id WHERE t.id = $1 ORDER BY l.seq`,
      [po.payment_term_id],
    );
    if (t.rows.length) {
      paymentText =
        t.rows[0]!.print_text ||
        instalmentWords(t.rows.map((x) => ({ pct: x.pct, dueOn: x.due_on, days: x.days })));
      longest = t.rows.reduce((m, x) => (x.due_on === 'advance' ? m : Math.max(m, x.days)), 0);
    }
  }
  const msme =
    (po.msme_type === 'micro' || po.msme_type === 'small') && longest > 45
      ? `${po.vendor_name} is a ${po.msme_type} enterprise (MSME): it must be paid within 45 days of acceptance (MSMED Act s.15); this term allows ${String(longest)} days.`
      : null;
  await c.query(
    `UPDATE purchase_orders SET vendor_gst_status = $2, vendor_state_code = $3, supply = $4, taxable = $5, cgst = $6, sgst = $7,
            igst = $8, rcm_gst = $9, round_off = $10, total = $11, payment_text = $12, msme_warning = $13, updated_at = now()
      WHERE id = $1`,
    [
      orderId,
      po.gst_status,
      po.vendor_state,
      supply,
      totals.taxable,
      totals.cgst,
      totals.sgst,
      totals.igst,
      totals.rcm,
      totals.roundOff,
      totals.total,
      paymentText,
      msme,
    ],
  );
  return { ...totals, supply, msmeWarning: msme, vendorState: stateName(po.vendor_state) };
}

/** A new PO (draft) for a vendor with the school's delivery address, terms, validity and its term. */
export async function newOrder(
  c: PoolClient,
  o: {
    vendorId: string;
    departmentId: string | null;
    requisitionId: string | null;
    createdBy: string | null;
    deliveryDate?: string | null;
    quoteRef?: string | null;
    emergency?: { reason: string; billFileId: string; billRef: string | null };
  },
) {
  const number = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('order') AS n`))
    .rows[0]!.n;
  const r = await c.query<{ id: string }>(
    `INSERT INTO purchase_orders (school_id, number, vendor_id, vendor_gst_status, vendor_state_code, department_id, requisition_id,
                                  quote_ref, delivery_date, delivery_address, payment_term_id, validity_days, terms, created_by,
                                  emergency, emergency_reason, bill_file_id, bill_ref)
     SELECT app.current_school_id(), $1, v.id, v.gst_status, v.state_code, $3, $4, $5, $6, s.delivery_address,
            COALESCE(v.payment_term_id, (SELECT t.id FROM purchase_payment_terms t WHERE t.is_default AND t.status = 'active' LIMIT 1)),
            s.po_validity_days, s.po_terms, $7, $8, $9, $10, $11
       FROM vendors v JOIN purchase_settings s ON s.school_id = v.school_id
      WHERE v.id = $2
     RETURNING id::text`,
    [
      number,
      o.vendorId,
      o.departmentId,
      o.requisitionId,
      o.quoteRef ?? null,
      o.deliveryDate ?? null,
      o.createdBy,
      !!o.emergency,
      o.emergency?.reason ?? null,
      o.emergency?.billFileId ?? null,
      o.emergency?.billRef ?? null,
    ],
  );
  return { id: r.rows[0]!.id, number };
}

/** PO lines from requisition lines (the remaining quantity), with their HSN, GST and contract. */
export async function addRequisitionLines(c: PoolClient, orderId: string, lineIds: string[]) {
  const rows = await c.query<{
    id: string;
    item_id: string | null;
    description: string;
    hsn: string | null;
    remaining: string;
    uom_id: string;
    rate: string;
    gst: string;
    reverse_charge: boolean;
    exempt: boolean;
    contract_id: string | null;
    make: string | null;
  }>(
    // eslint-disable-next-line no-restricted-syntax -- ON_ORDER is a fixed fragment
    `SELECT rl.id::text, rl.item_id::text, COALESCE(i.name, rl.free_text) AS description, h.code AS hsn,
            (rl.quantity - ${ON_ORDER})::text AS remaining, rl.uom_id::text, COALESCE(rl.rate, rl.est_rate)::text AS rate,
            -- a reverse-charge line takes the SAC's rate (the school pays it whoever the vendor is)
            (CASE WHEN COALESCE(h.reverse_charge, false) THEN COALESCE(i.gst_rate, h.gst_rate, 0)
                  ELSE COALESCE(rl.gst_rate, i.gst_rate, h.gst_rate, 0) END)::text AS gst, COALESCE(h.reverse_charge, false) AS reverse_charge,
            COALESCE(h.exempt, false) AS exempt, rl.contract_id::text, i.brand AS make
       FROM purchase_requisition_lines rl
       LEFT JOIN purchase_items i ON i.id = rl.item_id
       LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
      WHERE rl.id = ANY($1::bigint[]) AND rl.fulfil = 'buy'
      ORDER BY rl.seq`,
    [lineIds],
  );
  const seq = (
    await c.query<{ n: number }>(
      `SELECT COALESCE(max(seq), 0)::int AS n FROM purchase_order_lines WHERE order_id = $1`,
      [orderId],
    )
  ).rows[0]!.n;
  let n = seq;
  for (const l of rows.rows) {
    if (Number(l.remaining) <= 0) continue;
    n += 1;
    await c.query(
      `INSERT INTO purchase_order_lines (school_id, order_id, seq, requisition_line_id, item_id, description, hsn_code, quantity, uom_id,
                                         rate, gst_rate, reverse_charge, exempt, contract_id, make)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        orderId,
        n,
        l.id,
        l.item_id,
        l.description.slice(0, 300),
        l.hsn,
        l.remaining,
        l.uom_id,
        l.rate,
        l.gst,
        l.reverse_charge,
        l.exempt,
        l.contract_id,
        l.make,
      ],
    );
  }
  return n - seq;
}

/**
 * The draft POs of an approved requisition: one per chosen vendor, with the lines (still to order)
 * chosen from it. Lines without a vendor wait on To order. Returns the POs made.
 */
export async function draftOrdersFor(
  c: PoolClient,
  requisitionId: string,
  createdBy: string | null,
) {
  const pr = (
    await c.query<{ department_id: string | null; required_by: string | null }>(
      `SELECT department_id::text, required_by::text FROM purchase_requisitions WHERE id = $1`,
      [requisitionId],
    )
  ).rows[0]!;
  const lines = await c.query<{ id: string; vendor_id: string; quote_ref: string | null }>(
    // eslint-disable-next-line no-restricted-syntax -- ON_ORDER is a fixed fragment
    `SELECT rl.id::text, rl.vendor_id::text,
            (SELECT q.quote_ref FROM purchase_quotes q WHERE q.requisition_id = rl.requisition_id AND q.vendor_id = rl.vendor_id) AS quote_ref
       FROM purchase_requisition_lines rl JOIN vendors v ON v.id = rl.vendor_id AND v.status = 'active'
      WHERE rl.requisition_id = $1 AND rl.fulfil = 'buy' AND rl.quantity > ${ON_ORDER}
      ORDER BY rl.seq`,
    [requisitionId],
  );
  const byVendor = new Map<string, { ids: string[]; quoteRef: string | null }>();
  for (const l of lines.rows) {
    const g = byVendor.get(l.vendor_id) ?? { ids: [], quoteRef: l.quote_ref };
    g.ids.push(l.id);
    byVendor.set(l.vendor_id, g);
  }
  const made: Array<{ id: string; number: string }> = [];
  for (const [vendorId, g] of byVendor) {
    const o = await newOrder(c, {
      vendorId,
      departmentId: pr.department_id,
      requisitionId,
      createdBy,
      deliveryDate: pr.required_by,
      quoteRef: g.quoteRef,
    });
    await addRequisitionLines(c, o.id, g.ids);
    await recomputeOrder(c, o.id);
    made.push(o);
  }
  return made;
}

/**
 * After a PO is placed or withdrawn: the requisition is ordered (every line bought on placed POs),
 * partly ordered, or approved again; an indent whose lines are all ordered (or from the store) is
 * "Ordered".
 */
export async function refreshOrdered(c: PoolClient, requisitionId: string) {
  const f = (
    await c.query<{ buy: number; full: number; some: number }>(
      // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
      `SELECT count(*)::int AS buy,
              (count(*) FILTER (WHERE placed >= quantity))::int AS full,
              (count(*) FILTER (WHERE placed > 0))::int AS some
         FROM (SELECT rl.quantity, COALESCE((SELECT sum(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                                              WHERE pol.requisition_line_id = rl.id AND ${PLACED}), 0) AS placed
                 FROM purchase_requisition_lines rl WHERE rl.requisition_id = $1 AND rl.fulfil = 'buy') x`,
      [requisitionId],
    )
  ).rows[0]!;
  const status = f.buy && f.full === f.buy ? 'ordered' : f.some ? 'part_ordered' : 'approved';
  await c.query(
    `UPDATE purchase_requisitions SET status = $2, updated_at = now()
      WHERE id = $1 AND status IN ('approved', 'part_ordered', 'ordered')`,
    [requisitionId, status],
  );
  // its indents: ordered when each of their lines is from the store or fully on placed POs
  await c.query(
    // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
    `UPDATE purchase_indents pi SET route = CASE WHEN ok THEN 'ordered' WHEN pi.bypass_rule IS NOT NULL THEN 'to_order' ELSE 'in_requisition' END,
            updated_at = now()
       FROM (SELECT il.indent_id,
                    bool_and(rl.fulfil = 'store' OR COALESCE((SELECT sum(pol.quantity) FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                                                               WHERE pol.requisition_line_id = rl.id AND ${PLACED}), 0) >= rl.quantity) AS ok
               FROM purchase_indent_lines il
               JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
               JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
              WHERE il.indent_id IN (SELECT il2.indent_id FROM purchase_indent_lines il2 JOIN purchase_requisition_sources s2 ON s2.indent_line_id = il2.id
                                       JOIN purchase_requisition_lines rl2 ON rl2.id = s2.requisition_line_id WHERE rl2.requisition_id = $1)
              GROUP BY il.indent_id) x
      WHERE pi.id = x.indent_id AND pi.route IN ('in_requisition', 'to_order', 'ordered')
        AND (x.ok OR pi.route = 'ordered')`,
    [requisitionId],
  );
  return status;
}
