import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { syncFlow } from './purchase-flow';
import { blankBox, signerOf, type SignBox } from './purchase-doc-sign';
import { purchaseHead } from './purchase-head';
import { purchaseReceiptPdf, type ReceiptPdfData } from './purchase-receipt-pdf';
import { assetsFromReceipt } from './purchase-asset-core';
import { postIssues, shareAmongIndents, type IssueShare } from './purchase-stock-core';
import { postStock, PurchaseStoresService } from './purchase-stores.service';
import {
  PURCHASE,
  type InspectionDto,
  type ReasonDto,
  type ReceiptDto,
  type ReceiptListQueryDto,
} from './purchase.dto';

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dmy = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '';
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const label = (number: string, revision: number) =>
  revision ? `${number}-R${String(revision)}` : number;
/** MSMED Act s.15: no written objection within 15 days of delivery is acceptance. */
const DEEMED_DAYS = 15;
const PERSON = (u: 'u' | 'au') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

/** A receipt I may see: I made it, I am (or was) on its inspection, or it is the committee's and I sit on it. */
const PARTICIPANT = `(g.created_by = app.current_user_id()
  OR EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances wi ON wi.id = s.instance_id
              WHERE wi.entity_type = 'purchase_inspection' AND wi.entity_id = g.id
                AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()
                     OR EXISTS (SELECT 1 FROM delegations dl WHERE dl.to_user_id = app.current_user_id()
                                  AND dl.from_user_id = ANY(s.assignee_user_ids) AND dl.revoked_at IS NULL)))
  OR (g.inspection = 'committee' AND EXISTS (SELECT 1 FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
                                              WHERE e.user_id = app.current_user_id())))`;
/** A receipt waiting for me: my inspection level, or the committee's and I have not signed. */
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const WAITING = `(g.status = 'inspecting' AND g.created_by <> app.current_user_id() AND (
   (g.inspection = 'department' AND EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
      WHERE i.id = g.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'
        AND ${WorkflowService.MAY_ACT}))
   OR (g.inspection = 'committee' AND EXISTS (SELECT 1 FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
      WHERE e.user_id = app.current_user_id()
        AND NOT EXISTS (SELECT 1 FROM goods_receipt_signoffs so WHERE so.receipt_id = g.id AND so.employee_id = e.id)))))`;
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;

// eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
const SELECT = `
  SELECT g.id::text, g.number, g.kind, g.status, g.inspection, g.order_id::text, po.number AS po_number, po.revision AS po_revision,
         po.po_date::text, po.created_by::text AS po_maker, po.department_id::text, d.name AS department, v.legal_name AS vendor, v.code AS vendor_code,
         v.msme_type, g.store_id::text, st.name AS store, g.received_on::text, g.challan_no, g.challan_date::text, g.invoice_no,
         g.invoice_date::text, g.file_id::text, g.note, g.workflow_instance_id::text, g.accepted_on::text, g.decided_at, g.decision_note,
         g.cancel_reason, g.created_by::text, (SELECT ${PERSON('u')} FROM users u WHERE u.id = g.created_by) AS created_by_name,
         (SELECT ${PERSON('u')} FROM users u WHERE u.id = g.decided_by) AS decided_by_name, g.created_at,
         CASE WHEN g.inspection = 'committee' AND g.status = 'inspecting'
              THEN 'Purchase committee (' || (SELECT count(*) FROM goods_receipt_signoffs so WHERE so.receipt_id = g.id) || ' signed)'
              ELSE (SELECT s.name || ' (' || COALESCE((SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au
                                                         WHERE au.id = ANY(s.assignee_user_ids)), 'nobody') || ')'
                      FROM workflow_instances i JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
                     WHERE i.id = g.workflow_instance_id AND i.status = 'pending') END AS waiting_with,
         (SELECT count(*)::int FROM goods_receipt_lines gl WHERE gl.receipt_id = g.id) AS lines,
         COALESCE((SELECT sum(round(gl.accepted_qty * gl.unit_cost, 2)) FROM goods_receipt_lines gl WHERE gl.receipt_id = g.id), 0)::text AS accepted_value
    FROM goods_receipts g
    JOIN purchase_orders po ON po.id = g.order_id
    JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN departments d ON d.id = po.department_id
    LEFT JOIN stores st ON st.id = g.store_id`;

interface ReceiptRow {
  id: string;
  number: string;
  kind: 'goods' | 'service';
  status: 'inspecting' | 'accepted' | 'rejected' | 'cancelled';
  inspection: 'department' | 'committee';
  order_id: string;
  po_number: string;
  po_revision: number;
  po_date: string;
  po_maker: string | null;
  department_id: string | null;
  department: string | null;
  vendor: string;
  vendor_code: string;
  msme_type: string | null;
  store_id: string | null;
  store: string | null;
  received_on: string;
  challan_no: string | null;
  challan_date: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  file_id: string | null;
  note: string | null;
  workflow_instance_id: string | null;
  accepted_on: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_by_name: string | null;
  decided_by_name: string | null;
  created_at: Date;
  waiting_with: string | null;
  lines: number;
  accepted_value: string;
}

interface OrderLine {
  id: string;
  seq: number;
  description: string;
  item_id: string | null;
  item_code: string | null;
  item_type: string | null;
  hsn_code: string | null;
  quantity: string;
  uom: string;
  received_qty: string;
  accepted_qty: string;
  rejected_qty: string;
  returned_qty: string;
  waiting: string;
  taxable: string;
  gst: string;
  stock_tracked: boolean;
  tracks_batch: boolean;
  tracks_serial: boolean;
  per_unit: string;
  store_uom: string | null;
  service: boolean;
  requisition_line_id: string | null;
}

/**
 * Goods received against a PO and services' completion certificates (docs/design/84, part 7). The
 * keeper of the store (not the PO's maker) records what came; the PO's department inspects it on its
 * Inspection levels (Purchase → Who approves; the HOD when not set), the purchase committee above the
 * committee limit (its signatures, as on comparative statements); nobody inspects a receipt they made.
 * On acceptance the accepted quantity enters the store at the PO line's cost (with GST unless the
 * setting leaves it out; other charges shared by value) and what was bought for an indent is issued at
 * once to its department; the PO lines keep received, accepted and rejected quantities, and the PO
 * closes by itself when every line is accepted in full. A receipt not inspected in 15 days shows its
 * MSME deemed-acceptance date.
 */
@Injectable()
export class PurchaseReceiptsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('purchase_inspection', (c, ctx, instance, outcome) =>
      this.onDecided(c, ctx, instance, outcome),
    );
  }

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private seesAll(ctx: RequestContext) {
    return (
      this.has(ctx, PURCHASE.storeView) ||
      this.has(ctx, PURCHASE.orderManage) ||
      this.has(ctx, PURCHASE.indentView)
    );
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string, lock = false) {
    const r = await c.query<ReceiptRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE g.id = $1 AND ($2 OR ${PARTICIPANT})${lock ? ' FOR UPDATE OF g' : ''}`,
      [id, this.seesAll(ctx)],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
    return r.rows[0];
  }

  private shape(r: ReceiptRow) {
    const deemedOn = addDays(r.received_on, DEEMED_DAYS);
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      status: r.status,
      inspection: r.inspection,
      orderId: r.order_id,
      order: label(r.po_number, r.po_revision),
      departmentId: r.department_id,
      department: r.department,
      vendor: r.vendor,
      vendorCode: r.vendor_code,
      msme: r.msme_type,
      storeId: r.store_id,
      store: r.store,
      receivedOn: r.received_on,
      challanNo: r.challan_no,
      challanDate: r.challan_date,
      invoiceNo: r.invoice_no,
      invoiceDate: r.invoice_date,
      hasFile: !!r.file_id,
      note: r.note,
      acceptedOn: r.accepted_on,
      deemedOn,
      overdue: r.status === 'inspecting' && today() > deemedOn,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decidedBy: r.decided_by_name,
      decisionNote: r.decision_note,
      cancelReason: r.cancel_reason,
      createdBy: r.created_by_name,
      createdAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      lines: r.lines,
      acceptedValue: Math.round(Number(r.accepted_value) * 100) / 100,
    };
  }

  // ---- the PO's lines and quantities --------------------------------------------------------------
  private async orderLines(c: PoolClient, orderId: string) {
    return (
      await c.query<OrderLine>(
        `SELECT l.id::text, l.seq, l.description, l.item_id::text, i.code AS item_code, i.item_type, l.hsn_code, l.quantity::text,
                u.code AS uom, l.received_qty::text, l.accepted_qty::text, l.rejected_qty::text, l.returned_qty::text,
                COALESCE((SELECT sum(gl.received_qty) FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.receipt_id
                           WHERE gl.order_line_id = l.id AND g.status = 'inspecting'), 0)::text AS waiting,
                l.taxable::text, (l.cgst + l.sgst + l.igst + l.rcm_gst)::text AS gst,
                COALESCE(i.stock_tracked, false) AS stock_tracked, COALESCE(i.tracks_batch, false) AS tracks_batch,
                COALESCE(i.tracks_serial, false) AS tracks_serial, COALESCE(i.stock_per_unit, 1)::text AS per_unit,
                COALESCE(su.code, u.code) AS store_uom,
                (COALESCE(i.item_type = 'service', false) OR (l.item_id IS NULL AND COALESCE(l.hsn_code LIKE '99%', false))) AS service,
                l.requisition_line_id::text
           FROM purchase_order_lines l
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE l.order_id = $1 ORDER BY l.seq`,
        [orderId],
      )
    ).rows;
  }

  /** The PO lines' received, accepted and rejected quantities and the PO's receipt status, worked out
   *  again; a PO accepted in full closes by itself. */
  static async refreshOrder(c: PoolClient, orderId: string) {
    await c.query(
      `UPDATE purchase_order_lines l
          SET received_qty = COALESCE(s.rec, 0), accepted_qty = COALESCE(s.acc, 0), rejected_qty = COALESCE(s.rej, 0),
              returned_qty = COALESCE((SELECT sum(rl.qty) FROM stock_return_lines rl JOIN goods_receipt_lines gl2 ON gl2.id = rl.receipt_line_id
                                        WHERE gl2.order_line_id = l.id AND rl.source = 'stock' AND rl.replacement), 0)
         FROM (SELECT ol.id,
                      sum(gl.received_qty) FILTER (WHERE g.status <> 'cancelled') AS rec,
                      sum(gl.accepted_qty) FILTER (WHERE g.status IN ('accepted', 'rejected')) AS acc,
                      sum(gl.rejected_qty) FILTER (WHERE g.status IN ('accepted', 'rejected')) AS rej
                 FROM purchase_order_lines ol
                 LEFT JOIN goods_receipt_lines gl ON gl.order_line_id = ol.id
                 LEFT JOIN goods_receipts g ON g.id = gl.receipt_id
                WHERE ol.order_id = $1 GROUP BY ol.id) s
        WHERE l.id = s.id`,
      [orderId],
    );
    const q = (
      await c.query<{
        any_in: boolean;
        all_in: boolean;
        all_accepted: boolean;
        status: string;
        auto_closed: boolean;
        sent: boolean;
      }>(
        `SELECT bool_or(l.received_qty > 0) AS any_in,
                bool_and(l.received_qty - l.rejected_qty - l.returned_qty >= l.quantity) AS all_in,
                bool_and(l.accepted_qty - l.returned_qty >= l.quantity) AS all_accepted, max(po.status) AS status,
                bool_and(po.closed_note IS NOT DISTINCT FROM 'Received and accepted in full') AS auto_closed,
                bool_and(po.sent_at IS NOT NULL) AS sent
           FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.order_id WHERE l.order_id = $1`,
        [orderId],
      )
    ).rows[0]!;
    const receipt = q.all_in ? 'received' : q.any_in ? 'part' : 'none';
    await c.query(
      `UPDATE purchase_orders SET receipt_status = $2, updated_at = now() WHERE id = $1 AND receipt_status <> $2`,
      [orderId, receipt],
    );
    if (q.all_accepted && ['approved', 'sent'].includes(q.status)) {
      await c.query(
        `UPDATE purchase_orders SET status = 'closed', closed_at = now(), closed_note = 'Received and accepted in full',
                updated_at = now() WHERE id = $1`,
        [orderId],
      );
      return { closed: true };
    }
    // goods sent back for a replacement reopen a PO that had closed by itself
    if (!q.all_accepted && q.status === 'closed' && q.auto_closed) {
      await c.query(
        `UPDATE purchase_orders SET status = $2, closed_at = NULL, closed_note = NULL, updated_at = now() WHERE id = $1`,
        [orderId, q.sent ? 'sent' : 'approved'],
      );
      return { closed: false, reopened: true };
    }
    return { closed: false };
  }

  // ---- lists ---------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: ReceiptListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      const where = `WHERE ($1::text IS NULL OR g.status = $1) AND ($2::text IS NULL OR g.kind = $2)
          AND ($3::bigint IS NULL OR g.order_id = $3) AND ($4::bigint IS NULL OR g.store_id = $4)
          AND (NOT $5 OR ${WAITING})
          AND ($6::text IS NULL OR g.number ILIKE '%' || $6 || '%' OR po.number ILIKE '%' || $6 || '%'
               OR v.legal_name ILIKE '%' || $6 || '%' OR g.challan_no ILIKE '%' || $6 || '%' OR g.invoice_no ILIKE '%' || $6 || '%')
          AND ($7 OR ${PARTICIPANT})`;
      const args = [
        q.status ?? null,
        q.kind ?? null,
        q.orderId ?? null,
        q.storeId ?? null,
        q.mine,
        q.q ?? null,
        this.seesAll(ctx),
      ];
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM goods_receipts g JOIN purchase_orders po ON po.id = g.order_id
           JOIN vendors v ON v.id = po.vendor_id ${where}`,
        args,
      );
      const r = await c.query<ReceiptRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY (g.status = 'inspecting') DESC, g.received_on DESC, g.id DESC LIMIT 50 OFFSET $8`,
        [...args, (q.page - 1) * 50],
      );
      const waiting = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- WAITING is a fixed fragment
        `SELECT count(*)::int AS n FROM goods_receipts g WHERE ${WAITING}`,
      );
      return {
        rows: r.rows.map((x) => this.shape(x)),
        total: total.rows[0]!.n,
        page: q.page,
        waitingForMe: waiting.rows[0]!.n,
      };
    });
  }

  /** How many receipts wait for me to inspect or sign (the staff app's menu). */
  async waitingCount(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- WAITING is a fixed fragment
        `SELECT count(*)::int AS n FROM goods_receipts g WHERE ${WAITING}`,
      );
      return { waiting: r.rows[0]!.n };
    });
  }

  /** Placed POs with something still to come (Receive: pick the PO; Pending deliveries). */
  async toReceive(ctx: RequestContext, q: { q?: string }) {
    this.mustReceive(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        number: string;
        revision: number;
        vendor: string;
        department: string | null;
        po_date: string;
        delivery_date: string | null;
        receipt_status: string;
        lines: number;
        open_lines: number;
        goods: boolean;
        services: boolean;
        mine: boolean;
      }>(
        `SELECT po.id::text, po.number, po.revision, v.legal_name AS vendor, d.name AS department, po.po_date::text,
                po.delivery_date::text, po.receipt_status,
                (SELECT count(*)::int FROM purchase_order_lines l WHERE l.order_id = po.id) AS lines,
                (SELECT count(*)::int FROM purchase_order_lines l WHERE l.order_id = po.id AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity) AS open_lines,
                EXISTS (SELECT 1 FROM purchase_order_lines l LEFT JOIN purchase_items i ON i.id = l.item_id
                         WHERE l.order_id = po.id AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity
                           AND NOT (COALESCE(i.item_type = 'service', false) OR (l.item_id IS NULL AND COALESCE(l.hsn_code LIKE '99%', false)))) AS goods,
                EXISTS (SELECT 1 FROM purchase_order_lines l LEFT JOIN purchase_items i ON i.id = l.item_id
                         WHERE l.order_id = po.id AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity
                           AND (COALESCE(i.item_type = 'service', false) OR (l.item_id IS NULL AND COALESCE(l.hsn_code LIKE '99%', false)))) AS services,
                (po.created_by = app.current_user_id()) AS mine
           FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id LEFT JOIN departments d ON d.id = po.department_id
          WHERE po.status IN ('approved', 'sent')
            AND NOT EXISTS (SELECT 1 FROM purchase_orders n WHERE n.supersedes_id = po.id AND n.status NOT IN ('rejected', 'cancelled'))
            AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.order_id = po.id AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity)
            AND ($1::text IS NULL OR po.number ILIKE '%' || $1 || '%' OR v.legal_name ILIKE '%' || $1 || '%')
          ORDER BY po.delivery_date NULLS LAST, po.po_date, po.id LIMIT 300`,
        [q.q ?? null],
      );
      const t = today();
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          label: label(x.number, x.revision),
          vendor: x.vendor,
          department: x.department,
          poDate: x.po_date,
          deliveryDate: x.delivery_date,
          late: !!x.delivery_date && x.delivery_date < t,
          receiptStatus: x.receipt_status,
          lines: x.lines,
          openLines: x.open_lines,
          goods: x.goods,
          services: x.services,
          madeByMe: x.mine,
        })),
      };
    });
  }

  private mustReceive(ctx: RequestContext) {
    if (
      !this.has(ctx, PURCHASE.storeOperate) &&
      !this.has(ctx, PURCHASE.storeManage) &&
      !this.has(ctx, PURCHASE.orderManage)
    )
      throw new DomainError(
        'permission-denied',
        'Only the store keepers and the purchase office record receipts',
        { status: 403 },
      );
  }

  /** The PO as the receipt form needs it: what is still to come per line, the stores I may receive into. */
  async form(ctx: RequestContext, orderId: string) {
    this.mustReceive(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mainId = await PurchaseStoresService.ensureMain(c);
      const po = await this.order(c, orderId, false);
      const s = await this.settings(c);
      const lines = await this.orderLines(c, orderId);
      const stores = await c.query<{ id: string; code: string; name: string; kind: string }>(
        `SELECT s.id::text, s.code, s.name, s.kind FROM stores s
          WHERE s.status = 'active'
            AND ($1 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                                WHERE k.store_id = s.id AND e.user_id = app.current_user_id()))
          ORDER BY (s.kind = 'main') DESC, s.name`,
        [this.has(ctx, PURCHASE.storeManage)],
      );
      return {
        order: {
          id: po.id,
          label: label(po.number, po.revision),
          status: po.status,
          vendor: po.vendor,
          department: po.department,
          poDate: po.po_date,
          deliveryDate: po.delivery_date,
          total: Number(po.total),
        },
        madeByMe: po.created_by === String(ctx.user.id),
        inspection: Number(po.total) > Number(s.committee_limit) ? 'committee' : 'department',
        tolerancePct: Number(s.receipt_tolerance_pct),
        mainStoreId: mainId,
        stores: stores.rows,
        lines: lines.map((l) => {
          const net = Number(l.received_qty) - Number(l.rejected_qty) - Number(l.returned_qty);
          const qty = Number(l.quantity);
          return {
            id: l.id,
            seq: l.seq,
            description: l.description,
            itemCode: l.item_code,
            uom: l.uom,
            storeUom: l.store_uom,
            perUnit: Number(l.per_unit),
            ordered: qty,
            received: Number(l.received_qty),
            accepted: Number(l.accepted_qty),
            rejected: Number(l.rejected_qty),
            waiting: Number(l.waiting),
            outstanding: Math.max(0, round(qty - net)),
            max: Math.max(0, round(qty * (1 + Number(s.receipt_tolerance_pct) / 100) - net)),
            service: l.service,
            stockTracked: l.stock_tracked,
            tracksBatch: l.tracks_batch,
            tracksSerial: l.tracks_serial,
          };
        }),
      };
    });
  }

  private async settings(c: PoolClient) {
    return (
      await c.query<{
        committee_limit: string;
        committee_signatures: number | null;
        receipt_tolerance_pct: string;
        stock_gst_in_cost: boolean;
        purchase_department_id: string | null;
      }>(
        `SELECT committee_limit::text, committee_signatures, receipt_tolerance_pct::text, stock_gst_in_cost,
                purchase_department_id::text FROM purchase_settings WHERE school_id = app.current_school_id()`,
      )
    ).rows[0]!;
  }

  private async order(c: PoolClient, orderId: string, lock: boolean) {
    const r = await c.query<{
      id: string;
      number: string;
      revision: number;
      status: string;
      created_by: string | null;
      department_id: string | null;
      department: string | null;
      vendor: string;
      total: string;
      po_date: string;
      delivery_date: string | null;
      newer: string | null;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- the lock clause is fixed text
      `SELECT po.id::text, po.number, po.revision, po.status, po.created_by::text, po.department_id::text, d.name AS department,
              v.legal_name AS vendor, po.total::text, po.po_date::text, po.delivery_date::text,
              (SELECT n.id::text FROM purchase_orders n WHERE n.supersedes_id = po.id AND n.status NOT IN ('rejected', 'cancelled') LIMIT 1) AS newer
         FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id LEFT JOIN departments d ON d.id = po.department_id
        WHERE po.id = $1${lock ? ' FOR UPDATE OF po' : ''}`,
      [orderId],
    );
    const po = r.rows[0];
    if (!po) throw new DomainError('not-found', 'Purchase order not found', { status: 404 });
    return po;
  }

  /** The committee members who may sign a receipt's inspection (signing in, not its receiver). */
  private async committee(c: PoolClient, receiverId: string, receiptId: string | null) {
    return (
      await c.query<{
        employee_id: string;
        user_id: string;
        name: string;
        designation: string | null;
        role: string | null;
        signed_at: Date | null;
        me: boolean;
      }>(
        `SELECT e.id::text AS employee_id, e.user_id::text, e.display_name AS name, e.designation, m.role,
                (SELECT so.signed_at FROM goods_receipt_signoffs so WHERE so.receipt_id = $2 AND so.employee_id = e.id) AS signed_at,
                (e.user_id = app.current_user_id()) AS me
           FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
          WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL AND e.status = 'active' AND e.user_id <> $1
          ORDER BY e.display_name`,
        [receiverId, receiptId],
      )
    ).rows;
  }

  // ---- receive ------------------------------------------------------------------------------------
  async create(ctx: RequestContext, dto: ReceiptDto) {
    this.mustReceive(ctx);
    const created = await this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.order(c, dto.orderId, true);
      if (!['approved', 'sent'].includes(po.status) || po.newer)
        throw new DomainError(
          'purchase.order_closed',
          po.newer
            ? 'An amendment replaces this PO: receive against the amendment'
            : 'Only an approved or sent PO is received against',
          { status: 409 },
        );
      if (po.created_by === String(ctx.user.id))
        throw new DomainError(
          'purchase.self_receipt',
          'You made this PO: someone else records what comes against it',
          { status: 403 },
        );
      if (dto.receivedOn > today())
        throw new DomainError('validation-failed', 'The day received is in the future', {
          status: 400,
        });
      if (dto.receivedOn < po.po_date)
        throw new DomainError('validation-failed', 'The day received is before the PO', {
          status: 400,
        });
      const s = await this.settings(c);
      let storeId: string | null = null;
      if (dto.kind === 'goods') {
        storeId = dto.storeId ?? (await PurchaseStoresService.ensureMain(c));
        await this.mustOperate(c, ctx, storeId);
      } else if (!this.has(ctx, PURCHASE.orderManage) && !this.has(ctx, PURCHASE.storeOperate))
        throw new DomainError(
          'permission-denied',
          'Only the purchase office and store keepers record completion certificates',
          { status: 403 },
        );
      const lines = await this.orderLines(c, dto.orderId);
      const byId = new Map(lines.map((l) => [l.id, l]));
      const tol = Number(s.receipt_tolerance_pct);
      const sum = new Map<string, number>();
      const problems: string[] = [];
      for (const [i, l] of dto.lines.entries()) {
        const n = `Line ${String(i + 1)}`;
        const ol = byId.get(l.orderLineId);
        if (!ol) throw new DomainError('validation-failed', `${n}: not a line of this PO`);
        if (ol.service !== (dto.kind === 'service'))
          problems.push(
            dto.kind === 'service'
              ? `${n} (${ol.description}) is goods: record it on a goods receipt`
              : `${n} (${ol.description}) is a service: record it on a completion certificate`,
          );
        sum.set(ol.id, (sum.get(ol.id) ?? 0) + l.receivedQty);
        const units = round(l.receivedQty * Number(ol.per_unit));
        if (
          dto.kind === 'goods' &&
          ol.stock_tracked &&
          ol.tracks_batch &&
          l.receivedQty > 0 &&
          !l.batch
        )
          problems.push(`${n} (${ol.description}): give the batch (and its expiry)`);
        if (l.serials.length) {
          if (new Set(l.serials).size !== l.serials.length)
            problems.push(`${n} (${ol.description}): a serial number is given twice`);
          if (l.serials.length !== units)
            problems.push(
              `${n} (${ol.description}): ${String(l.serials.length)} serial numbers for ${String(units)} received`,
            );
        }
        if (dto.kind === 'service' && l.receivedQty > 0 && !l.workDone)
          problems.push(`${n} (${ol.description}): say what was done`);
      }
      for (const [id, got] of sum) {
        const ol = byId.get(id)!;
        const net = Number(ol.received_qty) - Number(ol.rejected_qty) - Number(ol.returned_qty);
        const max = round(Number(ol.quantity) * (1 + tol / 100) - net);
        if (got > max + 1e-9)
          problems.push(
            `${ol.description}: ${String(got)} ${ol.uom} is more than the ${String(Math.max(0, max))} still to come${tol ? ` (with the ${String(tol)}% allowed)` : ''}: refuse the excess`,
          );
      }
      // the same serial number received before for the item (and not rejected)
      for (const l of dto.lines.filter((x) => x.serials.length)) {
        const ol = byId.get(l.orderLineId)!;
        if (!ol.item_id) continue;
        const dup = await c.query<{ serial: string }>(
          `SELECT DISTINCT x.serial FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.receipt_id
             JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
             CROSS JOIN LATERAL unnest(gl.serials) AS x(serial)
            WHERE ol.item_id = $1 AND g.status IN ('inspecting', 'accepted') AND x.serial = ANY($2::text[])
              AND NOT (x.serial = ANY(gl.rejected_serials))`,
          [ol.item_id, l.serials],
        );
        if (dup.rows.length)
          problems.push(
            `${ol.description}: serial number ${dup.rows.map((d) => d.serial).join(', ')} came before`,
          );
      }
      if (problems.length)
        throw new DomainError('validation-failed', problems.join('; '), {
          status: 400,
          extra: { problems },
        });
      if (dto.fileId) {
        const f = await c.query(`SELECT 1 FROM files WHERE id = $1 AND deleted_at IS NULL`, [
          dto.fileId,
        ]);
        if (!f.rowCount) throw new DomainError('validation-failed', 'The file was not found');
      }
      // who inspects: the committee above its limit, else the PO's department (the purchase office's)
      const inspection = Number(po.total) > Number(s.committee_limit) ? 'committee' : 'department';
      const departmentId = po.department_id ?? s.purchase_department_id;
      if (inspection === 'department' && !departmentId)
        throw new DomainError(
          'purchase.no_department',
          'The PO has no department and Purchase settings names no purchase department: nobody can inspect it',
          { status: 409 },
        );
      if (inspection === 'committee') {
        const members = await this.committee(c, String(ctx.user.id), null);
        if (!members.length)
          throw new DomainError(
            'purchase.no_committee',
            `The purchase committee inspects receipts of POs above ${rupees(Number(s.committee_limit))}: name its members (Purchase settings)`,
            { status: 409 },
          );
      }
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number($1) AS n`, [
          dto.kind === 'goods' ? 'receipt' : 'completion',
        ])
      ).rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO goods_receipts (school_id, number, kind, order_id, store_id, received_on, challan_no, challan_date, invoice_no,
                                       invoice_date, file_id, note, inspection, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, app.current_user_id()) RETURNING id::text`,
          [
            number,
            dto.kind,
            dto.orderId,
            storeId,
            dto.receivedOn,
            dto.challanNo ?? null,
            dto.challanDate ?? null,
            dto.invoiceNo ?? null,
            dto.invoiceDate ?? null,
            dto.fileId ?? null,
            dto.note ?? null,
            inspection,
          ],
        )
      ).rows[0]!.id;
      for (const [i, l] of dto.lines.entries())
        await c.query(
          `INSERT INTO goods_receipt_lines (school_id, receipt_id, seq, order_line_id, received_qty, refused_qty, refused_reason, batch_no,
                                            expiry, serials, work_done)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10)`,
          [
            id,
            i + 1,
            l.orderLineId,
            l.receivedQty,
            l.refusedQty,
            l.refusedQty ? (l.refusedReason ?? null) : null,
            l.batch ?? null,
            l.expiry ?? null,
            l.serials,
            l.workDone ?? null,
          ],
        );
      await PurchaseReceiptsService.refreshOrder(c, dto.orderId);
      const anything = dto.lines.some((l) => l.receivedQty > 0);
      if (!anything) {
        // everything refused at the door: nothing to inspect
        await c.query(
          `UPDATE goods_receipts SET status = 'rejected', decided_at = now(), decided_by = app.current_user_id(),
                  decision_note = 'Everything was refused at the door' WHERE id = $1`,
          [id],
        );
        await c.query(
          `UPDATE goods_receipt_lines SET accepted_qty = 0, rejected_qty = 0 WHERE receipt_id = $1`,
          [id],
        );
      } else if (inspection === 'department') {
        const flow = await syncFlow(c, 'inspection', departmentId!);
        let instance: InstanceRow;
        try {
          instance = await this.workflow.start(c, ctx, {
            definitionCode: flow.code,
            entityType: 'purchase_inspection',
            entityId: id,
            subject: `${number} · ${label(po.number, po.revision)} · ${po.vendor}`,
            payload: { department: flow.department, departmentId, number },
          });
        } catch (e) {
          if (e instanceof DomainError && e.type === 'workflow.no_assignee')
            throw new DomainError(
              'purchase.no_inspector',
              `Nobody can inspect ${flow.department}'s receipts: set its HOD or its Inspection levels (Purchase → Who approves)`,
              { status: 409 },
            );
          throw e;
        }
        await c.query(`UPDATE goods_receipts SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instance.id,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: dto.kind === 'goods' ? 'purchase.receipt.create' : 'purchase.completion.create',
        entityType: 'goods_receipts',
        entityId: id,
        after: { number, order: label(po.number, po.revision), lines: dto.lines.length },
      });
      return { id, number };
    });
    return created;
  }

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
    if (x.status !== 'active')
      throw new DomainError('validation-failed', `${x.name} is not in use`, { status: 400 });
    if (!this.has(ctx, PURCHASE.storeManage) && !(this.has(ctx, PURCHASE.storeOperate) && x.mine))
      throw new DomainError('permission-denied', `Only the keepers of ${x.name} receive into it`, {
        status: 403,
      });
  }

  // ---- one receipt -----------------------------------------------------------------------------------
  private async receiptLines(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        seq: number;
        order_line_id: string;
        po_seq: number;
        description: string;
        item_id: string | null;
        item_code: string | null;
        uom: string;
        store_uom: string | null;
        per_unit: string;
        ordered: string;
        received_qty: string;
        refused_qty: string;
        refused_reason: string | null;
        batch_no: string | null;
        expiry: string | null;
        serials: string[];
        work_done: string | null;
        accepted_qty: string | null;
        rejected_qty: string | null;
        reject_reason: string | null;
        rejected_serials: string[];
        unit_cost: string | null;
        stock_tracked: boolean;
        requisition_line_id: string | null;
        rate: string;
      }>(
        `SELECT gl.id::text, gl.seq, gl.order_line_id::text, ol.seq AS po_seq, ol.description, ol.item_id::text, i.code AS item_code,
                u.code AS uom, COALESCE(su.code, u.code) AS store_uom, COALESCE(i.stock_per_unit, 1)::text AS per_unit,
                ol.quantity::text AS ordered, gl.received_qty::text, gl.refused_qty::text, gl.refused_reason, gl.batch_no,
                gl.expiry::text, gl.serials, gl.work_done, gl.accepted_qty::text, gl.rejected_qty::text, gl.reject_reason,
                gl.rejected_serials, gl.unit_cost::text, COALESCE(i.stock_tracked, false) AS stock_tracked,
                ol.requisition_line_id::text, ol.rate::text
           FROM goods_receipt_lines gl
           JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
           JOIN purchase_uoms u ON u.id = ol.uom_id
           LEFT JOIN purchase_items i ON i.id = ol.item_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE gl.receipt_id = $1 ORDER BY gl.seq`,
        [id],
      )
    ).rows;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.load(c, ctx, id);
      const lines = await this.receiptLines(c, id);
      const instance = g.workflow_instance_id
        ? await this.workflow.instanceWith(c, g.workflow_instance_id)
        : null;
      // the inspectors as staff know them: their employee record's name
      const users = [
        ...new Set((instance?.steps ?? []).flatMap((s) => s.assignees.map((a) => a.id))),
      ];
      const names = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT DISTINCT ON (user_id) user_id::text AS id, display_name AS name FROM employees
              WHERE user_id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY user_id, id`,
            [users],
          )
        ).rows.map((r) => [r.id, r.name]),
      );
      const steps = (instance?.steps ?? []).map((s) => ({
        ...s,
        assignees: s.assignees.map((a) => ({ ...a, name: names.get(a.id) ?? a.name })),
      }));
      const mine = g.workflow_instance_id
        ? await c.query<{ id: string }>(MY_STEP, [g.workflow_instance_id])
        : { rows: [] };
      const history = g.workflow_instance_id
        ? (
            await c.query<{ kind: string; actor: string | null; note: string | null; at: Date }>(
              // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
              `SELECT e.kind, ${PERSON('u')} AS actor, e.note, e.occurred_at AS at
                 FROM workflow_events e LEFT JOIN users u ON u.id = e.actor_id
                WHERE e.instance_id = $1 ORDER BY e.occurred_at, e.id`,
              [g.workflow_instance_id],
            )
          ).rows
        : [];
      const s = await this.settings(c);
      const committee =
        g.inspection === 'committee' ? await this.committee(c, g.created_by, id) : [];
      const required = Math.min(s.committee_signatures ?? committee.length, committee.length);
      const issues = await c.query<{
        id: string;
        number: string;
        department: string;
        indent: string | null;
        indent_id: string | null;
        status: string;
        lines: number;
        value: string;
      }>(
        `SELECT si.id::text, si.number, d.name AS department, pi.number AS indent, si.indent_id::text, si.status,
                (SELECT count(*)::int FROM stock_issue_lines l WHERE l.issue_id = si.id) AS lines,
                COALESCE((SELECT sum(l.value) FROM stock_issue_lines l WHERE l.issue_id = si.id), 0)::text AS value
           FROM stock_issues si JOIN departments d ON d.id = si.department_id LEFT JOIN purchase_indents pi ON pi.id = si.indent_id
          WHERE si.receipt_id = $1 ORDER BY si.id`,
        [id],
      );
      const notMine = g.created_by !== String(ctx.user.id);
      const inspecting = g.status === 'inspecting';
      const me = committee.find((m) => m.me);
      return {
        ...this.shape(g),
        lineItems: lines.map((l) => ({
          id: l.id,
          seq: l.seq,
          orderLineId: l.order_line_id,
          poSeq: l.po_seq,
          description: l.description,
          itemCode: l.item_code,
          uom: l.uom,
          storeUom: l.store_uom,
          perUnit: Number(l.per_unit),
          ordered: Number(l.ordered),
          received: Number(l.received_qty),
          refused: Number(l.refused_qty),
          refusedReason: l.refused_reason,
          batch: l.batch_no,
          expiry: l.expiry,
          serials: l.serials,
          workDone: l.work_done,
          accepted: l.accepted_qty === null ? null : Number(l.accepted_qty),
          rejected: l.rejected_qty === null ? null : Number(l.rejected_qty),
          rejectReason: l.reject_reason,
          rejectedSerials: l.rejected_serials,
          unitCost: l.unit_cost === null ? null : Number(l.unit_cost),
          value:
            l.unit_cost === null || l.accepted_qty === null
              ? null
              : Math.round(Number(l.unit_cost) * Number(l.accepted_qty) * 100) / 100,
          stockTracked: l.stock_tracked,
        })),
        steps,
        history: history.map((h) => ({
          kind: h.kind,
          actor: h.actor,
          note: h.note,
          at: h.at.toISOString(),
        })),
        committee:
          g.inspection === 'committee'
            ? {
                required,
                members: committee.map((m) => ({
                  name: m.name,
                  designation: m.designation,
                  role: m.role,
                  signedAt: m.signed_at?.toISOString() ?? null,
                  me: m.me,
                })),
              }
            : null,
        issues: issues.rows.map((x) => ({
          id: x.id,
          number: x.number,
          department: x.department,
          indent: x.indent,
          indentId: x.indent_id,
          status: x.status,
          lines: x.lines,
          value: Number(x.value),
        })),
        can: {
          inspect:
            inspecting &&
            notMine &&
            (g.inspection === 'department' ? mine.rows.length > 0 : !!me && !me.signed_at),
          cancel:
            inspecting &&
            (!notMine ||
              this.has(ctx, PURCHASE.storeManage) ||
              this.has(ctx, PURCHASE.orderManage)),
        },
        madeByMe: !notMine,
      };
    });
  }

  // ---- inspect and accept -----------------------------------------------------------------------------
  /** The inspector's outcome per line, checked: accepted + rejected = received; a reason for rejecting. */
  private outcomes(
    lines: Awaited<ReturnType<PurchaseReceiptsService['receiptLines']>>,
    dto: InspectionDto,
  ) {
    const given = new Map(dto.lines.map((l) => [l.lineId, l]));
    const problems: string[] = [];
    const out = lines.map((l) => {
      const received = Number(l.received_qty);
      if (dto.action === 'reject')
        return {
          id: l.id,
          accepted: 0,
          rejected: received,
          reason: dto.note ?? null,
          rejectedSerials: l.serials,
        };
      const o = given.get(l.id);
      if (!o)
        return {
          id: l.id,
          accepted: received,
          rejected: 0,
          reason: null,
          rejectedSerials: [] as string[],
        };
      const n = `${l.description}`;
      if (Math.abs(o.acceptedQty + o.rejectedQty - received) > 1e-9)
        problems.push(
          `${n}: accepted and rejected make ${String(round(o.acceptedQty + o.rejectedQty))}, ${String(received)} came`,
        );
      if (o.rejectedQty > 0 && !o.reason) problems.push(`${n}: say why it is rejected`);
      if (o.rejectedSerials.some((x) => !l.serials.includes(x)))
        problems.push(`${n}: a rejected serial number did not come on this receipt`);
      if (
        l.serials.length &&
        o.rejectedSerials.length !== round(o.rejectedQty * Number(l.per_unit))
      )
        problems.push(`${n}: tick the serial numbers rejected (${String(o.rejectedQty)} rejected)`);
      return {
        id: l.id,
        accepted: o.acceptedQty,
        rejected: o.rejectedQty,
        reason: o.rejectedQty > 0 ? (o.reason ?? null) : null,
        rejectedSerials: o.rejectedSerials,
      };
    });
    if (dto.action === 'reject' && (dto.note ?? '').length < 3)
      problems.push('Give the reason for rejecting it');
    if (problems.length)
      throw new DomainError('validation-failed', problems.join('; '), {
        status: 400,
        extra: { problems },
      });
    return out;
  }

  private async saveOutcomes(
    c: PoolClient,
    out: Array<{
      id: string;
      accepted: number;
      rejected: number;
      reason: string | null;
      rejectedSerials: string[];
    }>,
  ) {
    let changed = false;
    for (const o of out) {
      const r = await c.query(
        `UPDATE goods_receipt_lines SET accepted_qty = $2, rejected_qty = $3, reject_reason = $4, rejected_serials = $5::text[]
          WHERE id = $1 AND (accepted_qty IS DISTINCT FROM $2::numeric OR rejected_qty IS DISTINCT FROM $3::numeric
                             OR reject_reason IS DISTINCT FROM $4 OR rejected_serials IS DISTINCT FROM $5::text[])`,
        [o.id, o.accepted, o.rejected, o.reason, o.rejectedSerials],
      );
      if (r.rowCount) changed = true;
    }
    return changed;
  }

  async inspect(ctx: RequestContext, id: string, dto: InspectionDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.load(c, ctx, id, true);
      if (g.status !== 'inspecting')
        throw new DomainError(
          'purchase.not_waiting',
          'This receipt is not waiting for inspection',
          {
            status: 409,
          },
        );
      if (g.created_by === String(ctx.user.id))
        throw new DomainError(
          'workflow.self_approval',
          'You recorded this receipt: someone else inspects it',
          { status: 403 },
        );
      const lines = await this.receiptLines(c, id);
      const out = this.outcomes(lines, dto);
      if (g.inspection === 'committee') {
        const members = await this.committee(c, g.created_by, id);
        const me = members.find((m) => m.me);
        if (!me)
          throw new DomainError(
            'workflow.not_assignee',
            'Only the purchase committee inspects this receipt',
            { status: 403 },
          );
        const changed = await this.saveOutcomes(c, out);
        // a changed inspection needs everybody's signature again
        if (changed)
          await c.query(`DELETE FROM goods_receipt_signoffs WHERE receipt_id = $1`, [id]);
        await c.query(
          `INSERT INTO goods_receipt_signoffs (school_id, receipt_id, employee_id, user_id)
           VALUES (app.current_school_id(), $1, $2, app.current_user_id()) ON CONFLICT DO NOTHING`,
          [id, me.employee_id],
        );
        if (dto.note)
          await c.query(`UPDATE goods_receipts SET decision_note = $2 WHERE id = $1`, [
            id,
            dto.note,
          ]);
        const s = await this.settings(c);
        const signed = (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM goods_receipt_signoffs WHERE receipt_id = $1`,
            [id],
          )
        ).rows[0]!.n;
        const required = Math.min(s.committee_signatures ?? members.length, members.length);
        await this.audit.stage(ctx, c, {
          action: 'purchase.receipt.sign',
          entityType: 'goods_receipts',
          entityId: id,
          after: { action: dto.action, signed, required, changed },
        });
        if (signed >= required) await this.finalise(c, ctx, id);
        return null;
      }
      if (!g.workflow_instance_id)
        throw new DomainError(
          'purchase.not_waiting',
          'This receipt is not waiting for inspection',
          {
            status: 409,
          },
        );
      const s = await c.query<{ id: string }>(MY_STEP, [g.workflow_instance_id]);
      if (!s.rows[0])
        throw new DomainError('workflow.not_assignee', 'This receipt is not waiting for you', {
          status: 403,
        });
      await this.saveOutcomes(c, out);
      if (dto.note)
        await c.query(`UPDATE goods_receipts SET decision_note = $2 WHERE id = $1`, [id, dto.note]);
      return s.rows[0].id;
    });
    if (step)
      await this.workflow.act(ctx, step, dto.action === 'accept' ? 'approved' : 'rejected', {
        note: dto.note,
      });
    return this.get(ctx, id);
  }

  private async onDecided(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    if (instance.status === 'cancelled') return;
    const id = instance.entityId;
    if (outcome === 'rejected') {
      const note = [...instance.steps].reverse().find((s) => s.status === 'rejected')?.note ?? null;
      await c.query(
        `UPDATE goods_receipt_lines SET accepted_qty = 0, rejected_qty = received_qty, reject_reason = COALESCE($2, reject_reason),
                rejected_serials = serials WHERE receipt_id = $1`,
        [id, note],
      );
    }
    await this.finalise(c, ctx, id);
  }

  /**
   * The inspection decided: the receipt accepted (in full or in part) or rejected; accepted goods kept
   * in stock enter the store at the PO line's cost, what was bought for an indent is issued at once to
   * its department; the PO's quantities move and it closes when everything is accepted.
   */
  private async finalise(c: PoolClient, ctx: RequestContext, id: string) {
    const g = (
      await c.query<{
        number: string;
        kind: string;
        order_id: string;
        store_id: string | null;
        status: string;
      }>(
        `SELECT number, kind, order_id::text, store_id::text, status FROM goods_receipts WHERE id = $1 FOR UPDATE`,
        [id],
      )
    ).rows[0]!;
    if (g.status !== 'inspecting') return;
    // a line nobody gave an outcome for is accepted as it came
    await c.query(
      `UPDATE goods_receipt_lines SET accepted_qty = received_qty, rejected_qty = 0 WHERE receipt_id = $1 AND accepted_qty IS NULL`,
      [id],
    );
    const s = await this.settings(c);
    const totals = (
      await c.query<{ lines_taxable: string; charges: string; charges_gst: string }>(
        `SELECT COALESCE((SELECT sum(taxable) FROM purchase_order_lines WHERE order_id = $1), 0)::text AS lines_taxable,
                COALESCE((SELECT sum(amount) FROM purchase_order_charges WHERE order_id = $1), 0)::text AS charges,
                COALESCE((SELECT sum(cgst + sgst + igst) FROM purchase_order_charges WHERE order_id = $1), 0)::text AS charges_gst`,
        [g.order_id],
      )
    ).rows[0]!;
    const ols = new Map((await this.orderLines(c, g.order_id)).map((l) => [l.id, l]));
    const lines = await this.receiptLines(c, id);
    const linesTaxable = Number(totals.lines_taxable);
    const charges = Number(totals.charges) + (s.stock_gst_in_cost ? Number(totals.charges_gst) : 0);
    const day = today();
    let acceptedTotal = 0;
    for (const l of lines) {
      const ol = ols.get(l.order_line_id)!;
      const q = Number(ol.quantity);
      const taxable = Number(ol.taxable);
      const cost =
        (taxable +
          (s.stock_gst_in_cost ? Number(ol.gst) : 0) +
          (linesTaxable > 0 ? (charges * taxable) / linesTaxable : 0)) /
        q;
      await c.query(`UPDATE goods_receipt_lines SET unit_cost = $2 WHERE id = $1`, [
        l.id,
        Math.round(cost * 10000) / 10000,
      ]);
      const accepted = Number(l.accepted_qty ?? l.received_qty);
      acceptedTotal += accepted;
      if (g.kind !== 'goods' || !ol.stock_tracked || accepted <= 0 || !ol.item_id) continue;
      const per = Number(ol.per_unit);
      await postStock(
        c,
        {
          storeId: g.store_id!,
          itemId: ol.item_id,
          kind: 'receipt',
          qty: round(accepted * per),
          rate: cost / per,
          batch: l.batch_no,
          expiry: l.expiry,
          docType: 'goods_receipt',
          docId: id,
          docLineId: l.id,
          note: g.number,
          day,
        },
        ol.description,
      );
    }
    const status = acceptedTotal > 0 ? 'accepted' : 'rejected';
    await c.query(
      `UPDATE goods_receipts SET status = $2, accepted_on = CASE WHEN $2 = 'accepted' THEN $3::date END, decided_at = now(),
              decided_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
      [id, status, day],
    );
    // accepted units of asset items join the asset register (in the store) before any issue
    const assets = g.kind === 'goods' ? await assetsFromReceipt(c, id, day) : 0;
    const issued = g.kind === 'goods' ? await this.issueToIndents(c, id, g.store_id!, day) : [];
    const po = await PurchaseReceiptsService.refreshOrder(c, g.order_id);
    await this.audit.stage(ctx, c, {
      action: status === 'accepted' ? 'purchase.receipt.accept' : 'purchase.receipt.reject',
      entityType: 'goods_receipts',
      entityId: id,
      after: { number: g.number, issued, assets, orderClosed: po.closed },
    });
  }

  /**
   * What a receipt brought for approved indents goes at once to each indent's department, on one issue
   * per indent (oldest indent first, up to what each indent line asked for less what it was issued
   * before); the rest stays in the store.
   */
  private async issueToIndents(c: PoolClient, receiptId: string, storeId: string, day: string) {
    const lines = await c.query<{
      requisition_line_id: string;
      item_id: string;
      description: string;
      per_unit: string;
      accepted: string;
      batch_no: string | null;
    }>(
      `SELECT ol.requisition_line_id::text, ol.item_id::text, ol.description, i.stock_per_unit::text AS per_unit,
              gl.accepted_qty::text AS accepted, gl.batch_no
         FROM goods_receipt_lines gl
         JOIN purchase_order_lines ol ON ol.id = gl.order_line_id AND ol.requisition_line_id IS NOT NULL
         JOIN purchase_items i ON i.id = ol.item_id AND i.stock_tracked
        WHERE gl.receipt_id = $1 AND gl.accepted_qty > 0 ORDER BY gl.seq`,
      [receiptId],
    );
    const shares: IssueShare[] = [];
    for (const l of lines.rows)
      for (const s of await shareAmongIndents(
        c,
        l.requisition_line_id,
        Number(l.accepted) * Number(l.per_unit),
        null,
      ))
        shares.push({
          ...s,
          itemId: l.item_id,
          name: l.description,
          batch: l.batch_no,
          reservationId: null,
        });
    const made = await postIssues(
      c,
      { storeId, kind: 'receipt', receiptId, day, purpose: null },
      shares,
      (m, name) => postStock(c, m, name),
    );
    return made.map((m) => m.number);
  }

  async cancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.load(c, ctx, id, true);
      if (g.status !== 'inspecting')
        throw new DomainError(
          'purchase.not_waiting',
          'Only a receipt waiting for inspection is cancelled',
          {
            status: 409,
          },
        );
      if (
        g.created_by !== String(ctx.user.id) &&
        !this.has(ctx, PURCHASE.storeManage) &&
        !this.has(ctx, PURCHASE.orderManage)
      )
        throw new DomainError('permission-denied', 'Only whoever recorded it cancels a receipt', {
          status: 403,
        });
      if (g.workflow_instance_id)
        await this.workflow.cancelIn(c, ctx, g.workflow_instance_id, `Cancelled: ${dto.reason}`);
      await c.query(`DELETE FROM goods_receipt_signoffs WHERE receipt_id = $1`, [id]);
      await c.query(
        `UPDATE goods_receipts SET status = 'cancelled', cancel_reason = $2, decided_at = now(), decided_by = app.current_user_id(),
                updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      await PurchaseReceiptsService.refreshOrder(c, g.order_id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.receipt.cancel',
        entityType: 'goods_receipts',
        entityId: id,
        after: { reason: dto.reason },
      });
      return { cancelled: true };
    });
  }

  // ---- files ---------------------------------------------------------------------------------------
  /** The challan / invoice photo or PDF kept with the receipt. */
  async file(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.load(c, ctx, id);
      if (!g.file_id) throw new DomainError('not-found', 'No file kept with it', { status: 404 });
      const f = (
        await c.query<{ object_key: string; content_type: string; original_name: string }>(
          `SELECT object_key, content_type, original_name FROM files WHERE id = $1 AND deleted_at IS NULL`,
          [g.file_id],
        )
      ).rows[0];
      if (!f) throw new DomainError('not-found', 'The file is gone', { status: 404 });
      return {
        bytes: await this.storage.read(f.object_key),
        contentType: f.content_type,
        filename: f.original_name,
      };
    });
  }

  /** The goods received and inspection note (or the completion certificate) as a PDF. */
  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.load(c, ctx, id);
      const lines = await this.receiptLines(c, id);
      const head = await purchaseHead(c, this.storage);
      const acted = g.workflow_instance_id
        ? (
            await c.query<{
              level: string;
              who: string;
              at: Date;
              user_id: string;
              status: string;
            }>(
              // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
              `SELECT s.name AS level, ${PERSON('u')} AS who, s.acted_at AS at, s.acted_by::text AS user_id, s.status
                 FROM workflow_steps s JOIN users u ON u.id = s.acted_by
                WHERE s.instance_id = $1 AND s.status IN ('approved', 'rejected') ORDER BY s.level`,
              [g.workflow_instance_id],
            )
          ).rows
        : [];
      const committee =
        g.inspection === 'committee' ? await this.committee(c, g.created_by, id) : [];
      // the boxes, as on the PO: who received it and who inspected it, filled from the system, then the
      // head of department and the Principal to sign by hand
      const read = (k: string) => this.storage.read(k);
      const goods = g.kind === 'goods';
      const signers: SignBox[] = [
        await signerOf(c, read, {
          as: goods ? 'Received by' : 'Reported by',
          name: g.created_by_name,
          userId: g.created_by,
          at: g.created_at,
          verb: goods ? 'Received on' : 'Reported on',
        }),
      ];
      if (g.inspection === 'committee')
        for (const m of committee.filter((x) => x.signed_at))
          signers.push(
            await signerOf(c, read, {
              as: m.role ?? 'Committee member',
              name: m.name,
              userId: m.user_id,
              at: m.signed_at,
              verb: 'Signed on',
            }),
          );
      else
        for (const a of acted)
          signers.push(
            await signerOf(c, read, {
              as: goods ? 'Inspected by' : 'Certified by',
              name: a.who,
              userId: a.user_id,
              at: a.at,
              verb: a.status === 'approved' ? 'Accepted on' : 'Rejected on',
            }),
          );
      if (signers.length === 1) signers.push(blankBox(goods ? 'Inspected by' : 'Certified by'));
      signers.push(blankBox('Head of department'), blankBox('Principal'));
      const data: ReceiptPdfData = {
        school: { name: head.school, address: head.address || null },
        logo: head.logo,
        generatedOn: head.generatedOn,
        title: g.kind === 'goods' ? 'Goods Received and Inspection Note' : 'Completion Certificate',
        watermark:
          g.status === 'inspecting'
            ? 'NOT INSPECTED'
            : g.status === 'cancelled'
              ? 'CANCELLED'
              : null,
        number: g.number,
        receivedOn: dmy(g.received_on),
        order: `${label(g.po_number, g.po_revision)} of ${dmy(g.po_date)}`,
        vendor: `${g.vendor} (${g.vendor_code})`,
        department: g.department,
        store: g.store,
        challan: [
          g.challan_no
            ? `Challan ${g.challan_no}${g.challan_date ? ` of ${dmy(g.challan_date)}` : ''}`
            : null,
          g.invoice_no
            ? `Invoice ${g.invoice_no}${g.invoice_date ? ` of ${dmy(g.invoice_date)}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        note: g.note,
        status:
          g.status === 'accepted'
            ? `Accepted on ${dmy(g.accepted_on)}`
            : g.status === 'rejected'
              ? 'Rejected'
              : g.status === 'cancelled'
                ? `Cancelled: ${g.cancel_reason ?? ''}`
                : `Waiting for inspection (deemed accepted on ${dmy(addDays(g.received_on, DEEMED_DAYS))} without an objection)`,
        kind: g.kind,
        lines: lines.map((l) => ({
          seq: l.seq,
          description: l.description + (l.item_code ? ` (${l.item_code})` : ''),
          uom: l.uom,
          ordered: Number(l.ordered),
          received: Number(l.received_qty),
          refused: Number(l.refused_qty),
          accepted: l.accepted_qty === null ? null : Number(l.accepted_qty),
          rejected: l.rejected_qty === null ? null : Number(l.rejected_qty),
          detail: [
            l.batch_no ? `Batch ${l.batch_no}${l.expiry ? `, expiry ${dmy(l.expiry)}` : ''}` : null,
            l.serials.length ? `Serial ${l.serials.join(', ')}` : null,
            l.work_done ? `Done: ${l.work_done}` : null,
            Number(l.refused_qty) ? `Refused: ${l.refused_reason ?? ''}` : null,
            Number(l.rejected_qty ?? 0) ? `Rejected: ${l.reject_reason ?? ''}` : null,
            l.rejected_serials.length ? `Rejected serial ${l.rejected_serials.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          value:
            l.unit_cost === null || l.accepted_qty === null
              ? null
              : Math.round(Number(l.unit_cost) * Number(l.accepted_qty) * 100) / 100,
        })),
        signers,
      };
      return {
        bytes: await purchaseReceiptPdf(data),
        filename: `${g.number.replaceAll('/', '-')}.pdf`,
      };
    });
  }
}
