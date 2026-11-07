import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { amountInWords, type PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { emailLayout } from '../comms/email-html';
import { STORAGE_DRIVER } from '../files/storage';
import { WorkflowService, type InstanceRow, type Level } from '../workflow/workflow.service';
import { GST_STATES } from './gstin';
import { syncFlow } from './purchase-flow';
import { gstSummary, type Tax } from './purchase-gst';
import {
  addRequisitionLines,
  newOrder,
  ON_ORDER,
  recomputeOrder,
  refreshOrdered,
} from './purchase-order-core';
import { registerGeneratedOn } from '../exams/register-head';
import { purchaseHead } from './purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from './purchase-list-file';
import { purchaseOrderPdf, type OrderPdfData } from './purchase-order-pdf';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  PURCHASE,
  type CreateOrderDto,
  type EmergencyDto,
  type IndentDecisionDto,
  type OrderExportQueryDto,
  type OrderListQueryDto,
  type ReasonDto,
  type SendOrderDto,
  type UpdateOrderDto,
} from './purchase.dto';

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '';
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
/** "PO/2026-27/0001", or "PO/2026-27/0001-R1" for an amendment. */
const PO_STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  sent: 'Sent to the vendor',
  closed: 'Closed',
  rejected: 'Rejected',
  sent_back: 'Sent back for changes',
  cancelled: 'Cancelled',
  superseded: 'Replaced by an amendment',
};
const label = (number: string, revision: number) =>
  revision ? `${number}-R${String(revision)}` : number;
const EDITABLE = ['draft', 'sent_back'];
const PERSON = (u: 'au' | 'u' | 'cu') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

interface PoRow {
  id: string;
  number: string;
  revision: number;
  supersedes_id: string | null;
  amend_reason: string | null;
  status: string;
  emergency: boolean;
  emergency_reason: string | null;
  bill_file_id: string | null;
  bill_ref: string | null;
  requisition_id: string | null;
  requisition: string | null;
  department_id: string | null;
  department: string | null;
  vendor_id: string;
  vendor: string;
  vendor_code: string;
  vendor_status: string;
  vendor_email: string | null;
  vendor_gst_status: 'regular' | 'composition' | 'unregistered';
  supply: 'intra' | 'inter';
  quote_ref: string | null;
  po_date: string;
  delivery_date: string | null;
  delivery_address: string | null;
  payment_term_id: string | null;
  payment_text: string | null;
  validity_days: number;
  terms: string | null;
  msme_warning: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  rcm_gst: string;
  round_off: string;
  total: string;
  workflow_instance_id: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  approved_at: Date | null;
  decision_note: string | null;
  sent_at: Date | null;
  closed_at: Date | null;
  closed_note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  waiting_with: string | null;
  lines: number;
  newer: string | null;
  receipt_status: 'none' | 'part' | 'received';
  receipts: number;
}

// eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
const SELECT = `
  SELECT po.id::text, po.number, po.revision, po.supersedes_id::text, po.amend_reason, po.status, po.emergency, po.emergency_reason,
         po.bill_file_id::text, po.bill_ref, po.requisition_id::text, r.number AS requisition, po.department_id::text, d.name AS department,
         po.vendor_id::text, v.legal_name AS vendor, v.code AS vendor_code, v.status AS vendor_status, v.email AS vendor_email,
         po.vendor_gst_status, po.supply, po.quote_ref, po.po_date::text, po.delivery_date::text, po.delivery_address,
         po.payment_term_id::text, po.payment_text, po.validity_days, po.terms, po.msme_warning, po.taxable::text, po.cgst::text,
         po.sgst::text, po.igst::text, po.rcm_gst::text, po.round_off::text, po.total::text, po.workflow_instance_id::text,
         po.submitted_at, po.decided_at, po.approved_at, po.decision_note, po.sent_at, po.closed_at, po.closed_note,
         po.created_by::text, (SELECT ${PERSON('u')} FROM users u WHERE u.id = po.created_by) AS created_by_name, po.created_at,
         (SELECT st.name || ' (' || COALESCE((SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody') || ')'
            FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
           WHERE i.id = po.workflow_instance_id AND i.status = 'pending') AS waiting_with,
         (SELECT count(*)::int FROM purchase_order_lines l WHERE l.order_id = po.id) AS lines,
         (SELECT n.id::text FROM purchase_orders n WHERE n.supersedes_id = po.id AND n.status NOT IN ('rejected', 'cancelled') LIMIT 1) AS newer,
         po.receipt_status, (SELECT count(*)::int FROM goods_receipts g WHERE g.order_id = po.id AND g.status <> 'cancelled') AS receipts
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN purchase_requisitions r ON r.id = po.requisition_id
    LEFT JOIN departments d ON d.id = po.department_id`;

// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;
const PARTICIPANT = `EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances wi ON wi.id = s.instance_id
    WHERE wi.entity_type = 'purchase_order' AND wi.entity_id = po.id
      AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()
           OR EXISTS (SELECT 1 FROM delegations dl WHERE dl.to_user_id = app.current_user_id() AND dl.from_user_id = ANY(s.assignee_user_ids)
                        AND dl.revoked_at IS NULL)))`;
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const WAITING = `EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
    WHERE i.id = po.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'
      AND ${WorkflowService.MAY_ACT})`;

/**
 * The Purchase Order (docs/design/83, part 4): drafted per vendor when a requisition is approved (or
 * from its lines on To order), its lines' rates, discounts and GST, other charges, delivery, payment
 * term (the MSME 45-day warning) and terms; approved on the department's PO levels (the maker never
 * approves it); then printed and e-mailed to the vendor, closed, cancelled (its own right once
 * approved) or amended (the next revision, approved again; the one it replaces superseded). An
 * emergency purchase is recorded after the fact with the vendor's bill and ratified (the designation in
 * Purchase settings, the Principal by default).
 */
@Injectable()
export class PurchaseOrdersService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('purchase_order', (c, ctx, instance, outcome) =>
      this.onDecided(c, ctx, instance, outcome),
    );
  }

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private seesAll(ctx: RequestContext) {
    return (
      this.has(ctx, PURCHASE.orderManage) ||
      this.has(ctx, PURCHASE.indentView) ||
      this.has(ctx, PURCHASE.emergencyRecord)
    );
  }
  private mustManage(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.orderManage))
      throw new DomainError('permission-denied', 'Only the purchase office makes purchase orders', {
        status: 403,
      });
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string): Promise<PoRow> {
    const r = await c.query<PoRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE po.id = $1 AND ($2 OR ${PARTICIPANT})`,
      [id, this.seesAll(ctx)],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Purchase order not found', { status: 404 });
    return r.rows[0];
  }

  private shape(r: PoRow) {
    return {
      id: r.id,
      number: r.number,
      revision: r.revision,
      label: label(r.number, r.revision),
      supersedesId: r.supersedes_id,
      newerId: r.newer,
      amendReason: r.amend_reason,
      status: r.status,
      emergency: r.emergency,
      requisitionId: r.requisition_id,
      requisition: r.requisition,
      departmentId: r.department_id,
      department: r.department,
      vendorId: r.vendor_id,
      vendor: r.vendor,
      vendorCode: r.vendor_code,
      total: Number(r.total),
      poDate: r.po_date,
      deliveryDate: r.delivery_date,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      approvedAt: r.approved_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      sentAt: r.sent_at?.toISOString() ?? null,
      createdBy: r.created_by_name,
      createdAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      msmeWarning: r.msme_warning,
      lines: r.lines,
      receiptStatus: r.receipt_status,
      receipts: r.receipts,
    };
  }

  // ---- lists -------------------------------------------------------------------------------------
  /** The list's filters as SQL ($1-$10), the same for the screen and its file. */
  private filterOf(ctx: RequestContext, q: OrderExportQueryDto | OrderListQueryDto) {
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
    const where = `WHERE ($1::text IS NULL OR po.status = $1)
          AND ($2::boolean IS NULL OR po.emergency = $2)
          AND ($3::text IS NULL OR po.number ILIKE $3 OR v.legal_name ILIKE $3)
          AND CASE $4 WHEN 'waiting' THEN ${WAITING} ELSE ($5 OR ${PARTICIPANT}) END
          AND ($6::bigint IS NULL OR po.department_id = $6::bigint OR EXISTS (
                SELECT 1 FROM purchase_order_lines pol JOIN purchase_requisition_sources src ON src.requisition_line_id = pol.requisition_line_id
                  JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                 WHERE pol.order_id = po.id AND pi.department_id = $6::bigint))
          AND ($7::date IS NULL OR po.po_date >= $7::date)
          AND ($8::date IS NULL OR po.po_date <= $8::date)
          AND ($9::text IS NULL OR EXISTS (
                SELECT 1 FROM purchase_order_lines pol JOIN purchase_requisition_sources src ON src.requisition_line_id = pol.requisition_line_id
                  JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                 WHERE pol.order_id = po.id AND pi.number ILIKE $9))
          AND ($10::bigint IS NULL OR po.vendor_id = $10::bigint)`;
    const args = [
      q.status ?? null,
      q.emergency ?? null,
      q.q ? `%${q.q}%` : null,
      q.view,
      this.seesAll(ctx),
      q.departmentId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.indent ? `%${q.indent}%` : null,
      q.vendorId ?? null,
    ];
    return { where, args };
  }

  async list(ctx: RequestContext, q: OrderListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = this.filterOf(ctx, q);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id ${where}`,
        args,
      );
      const rows = await c.query<PoRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY po.created_at DESC, po.revision DESC LIMIT $11 OFFSET $12`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const counts = (
        await c.query<{ waiting: number; drafts: number; to_send: number; to_order: number }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments
          `SELECT (SELECT count(*)::int FROM purchase_orders po WHERE po.status = 'submitted' AND ${WAITING}) AS waiting,
                  (SELECT count(*)::int FROM purchase_orders po WHERE po.status IN ('draft', 'sent_back')) AS drafts,
                  (SELECT count(*)::int FROM purchase_orders po WHERE po.status = 'approved' AND NOT po.emergency) AS to_send,
                  (SELECT count(*)::int FROM purchase_requisition_lines rl JOIN purchase_requisitions r ON r.id = rl.requisition_id
                    WHERE r.status IN ('approved', 'part_ordered') AND rl.fulfil = 'buy' AND rl.quantity > ${ON_ORDER}) AS to_order`,
        )
      ).rows[0]!;
      const all = this.seesAll(ctx);
      return {
        data: rows.rows.map((r) => this.shape(r)),
        total: total.rows[0]!.n,
        page: q.page,
        size: q.size,
        waitingForMe: counts.waiting,
        drafts: all ? counts.drafts : 0,
        toSend: all ? counts.to_send : 0,
        toOrder: all ? counts.to_order : 0,
      };
    });
  }

  /**
   * The list as on screen (its filters, every page) as Excel or PDF, with the letterhead; the Excel adds
   * a sheet of the order lines (HSN, rate, discount, GST, totals) (docs/design/83).
   */
  async exportList(ctx: RequestContext, q: OrderExportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = this.filterOf(ctx, q);
      const rows = (
        await c.query<PoRow>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `${SELECT} ${where} ORDER BY po.po_date DESC, po.created_at DESC LIMIT $11`,
          [...args, LIST_LIMIT],
        )
      ).rows;
      checkListSize(rows.length, 'orders');
      const ids = rows.map((r) => r.id);
      const gst = (r: PoRow) =>
        Math.round((Number(r.cgst) + Number(r.sgst) + Number(r.igst)) * 100) / 100;
      const list = {
        columns: [
          { label: 'Order', width: 2.4 },
          { label: 'Date', type: 'date' as const },
          { label: 'Vendor', width: 3 },
          { label: 'Department', width: 2 },
          { label: 'Requisition', width: 2.2 },
          { label: 'Lines', type: 'number' as const, width: 0.9 },
          { label: 'Taxable (₹)', type: 'money' as const },
          { label: 'GST (₹)', type: 'money' as const },
          { label: 'Total (₹)', type: 'money' as const },
          { label: 'Status', width: 1.8 },
          { label: 'Received', width: 1.4 },
        ],
        rows: rows.map((r) => [
          `${label(r.number, r.revision)}${r.emergency ? ' (emergency)' : ''}`,
          r.po_date,
          `${r.vendor} (${r.vendor_code})`,
          r.department,
          r.requisition,
          r.lines,
          Number(r.taxable),
          gst(r),
          Number(r.total),
          r.status === 'submitted' && r.waiting_with
            ? `With ${r.waiting_with}`
            : (PO_STATUS_WORDS[r.status] ?? r.status),
          r.receipt_status === 'received'
            ? 'All received'
            : r.receipt_status === 'part'
              ? 'Part received'
              : '',
        ]),
      };
      let lines;
      if (q.format === 'xlsx' && ids.length) {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const l = await c.query<{
          order_id: string;
          seq: number;
          description: string;
          hsn_code: string | null;
          quantity: string;
          uom: string;
          rate: string;
          discount_pct: string | null;
          gst_rate: string;
          taxable: string;
          total: string;
          contract: boolean;
        }>(
          `SELECT l.order_id::text, l.seq, l.description, l.hsn_code, l.quantity::text, u.code AS uom, l.rate::text,
                  l.discount_pct::text, l.gst_rate::text, l.taxable::text, l.total::text, l.contract_id IS NOT NULL AS contract
             FROM purchase_order_lines l JOIN purchase_uoms u ON u.id = l.uom_id
            WHERE l.order_id = ANY($1::bigint[]) ORDER BY l.order_id DESC, l.seq`,
          [ids],
        );
        lines = {
          columns: [
            { label: 'Order', width: 2.4 },
            { label: 'Vendor', width: 3 },
            { label: '#', type: 'number' as const, width: 0.6 },
            { label: 'Item', width: 3.4 },
            { label: 'HSN / SAC', width: 1.4 },
            { label: 'Quantity', type: 'number' as const },
            { label: 'Unit', width: 1 },
            { label: 'Rate (₹)', type: 'money' as const },
            { label: 'Discount %', type: 'number' as const, width: 1.2 },
            { label: 'GST %', type: 'number' as const, width: 1 },
            { label: 'Taxable (₹)', type: 'money' as const },
            { label: 'Total (₹)', type: 'money' as const },
            { label: 'On rate contract', width: 1.4 },
          ],
          rows: l.rows.map((x) => {
            const po = byId.get(x.order_id)!;
            return [
              label(po.number, po.revision),
              po.vendor,
              x.seq,
              x.description,
              x.hsn_code,
              Number(x.quantity),
              x.uom,
              Number(x.rate),
              x.discount_pct === null ? null : Number(x.discount_pct),
              Number(x.gst_rate),
              Number(x.taxable),
              Number(x.total),
              x.contract ? 'Yes' : '',
            ];
          }),
        };
      }
      const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
      const named = async (sql: string, id?: string) =>
        id ? (await c.query<{ name: string }>(sql, [id])).rows[0]?.name : undefined;
      const dept = await named(`SELECT name FROM departments WHERE id = $1`, q.departmentId);
      const vendor = await named(
        `SELECT legal_name AS name FROM vendors WHERE id = $1`,
        q.vendorId,
      );
      const words =
        [
          q.view === 'waiting' ? 'Waiting for me' : null,
          dept ? `Department: ${dept}` : null,
          q.from && q.to
            ? `${dmy(q.from)} to ${dmy(q.to)}`
            : q.from
              ? `From ${dmy(q.from)}`
              : q.to
                ? `Up to ${dmy(q.to)}`
                : null,
          q.status ? `Status: ${PO_STATUS_WORDS[q.status] ?? q.status}` : null,
          q.emergency === true
            ? 'Emergency purchases'
            : q.emergency === false
              ? 'Not emergency'
              : null,
          q.indent ? `Indent: ${q.indent}` : null,
          vendor ? `Vendor: ${vendor}` : null,
          q.q ? `Search: ${q.q}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'All orders';
      return purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: 'Purchase Orders',
        slug: 'Purchase-Orders',
        words,
        list,
        sum: [6, 7, 8],
        ...(lines ? { lines } : {}),
      });
    });
  }

  /** The approved requisitions' lines not yet on a PO, grouped by requisition and vendor (To order). */
  async toOrder(ctx: RequestContext) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await c.query<{
        requisition_id: string;
        number: string;
        department: string | null;
        auto_rule: string | null;
        required_by: string | null;
        line_id: string;
        seq: number;
        item: string;
        remaining: string;
        uom: string;
        rate: string;
        vendor_id: string | null;
        vendor: string | null;
        vendor_status: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- ON_ORDER is a fixed fragment
        `SELECT r.id::text AS requisition_id, r.number, d.name AS department, r.auto_rule, r.required_by::text,
                rl.id::text AS line_id, rl.seq, COALESCE(i.name, rl.free_text) AS item, (rl.quantity - ${ON_ORDER})::text AS remaining,
                u.code AS uom, COALESCE(rl.rate, rl.est_rate)::text AS rate, rl.vendor_id::text, v.legal_name AS vendor, v.status AS vendor_status
           FROM purchase_requisitions r
           JOIN purchase_requisition_lines rl ON rl.requisition_id = r.id
           LEFT JOIN departments d ON d.id = r.department_id
           LEFT JOIN purchase_items i ON i.id = rl.item_id
           JOIN purchase_uoms u ON u.id = rl.uom_id
           LEFT JOIN vendors v ON v.id = rl.vendor_id
          WHERE r.status IN ('approved', 'part_ordered') AND rl.fulfil = 'buy' AND rl.quantity > ${ON_ORDER}
          ORDER BY r.required_by NULLS LAST, r.number, rl.seq`,
      );
      const vendors = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, legal_name AS name FROM vendors WHERE status = 'active' ORDER BY legal_name LIMIT 5000`,
      );
      const groups = new Map<
        string,
        {
          requisitionId: string;
          number: string;
          department: string | null;
          autoRule: string | null;
          requiredBy: string | null;
          vendorId: string | null;
          vendor: string | null;
          vendorActive: boolean;
          lines: Array<{
            id: string;
            seq: number;
            item: string;
            quantity: number;
            uom: string;
            rate: number;
          }>;
        }
      >();
      for (const x of rows.rows) {
        const key = `${x.requisition_id}:${x.vendor_id ?? '-'}`;
        const g = groups.get(key) ?? {
          requisitionId: x.requisition_id,
          number: x.number,
          department: x.department,
          autoRule: x.auto_rule,
          requiredBy: x.required_by,
          vendorId: x.vendor_id,
          vendor: x.vendor,
          vendorActive: x.vendor_status === 'active',
          lines: [],
        };
        g.lines.push({
          id: x.line_id,
          seq: x.seq,
          item: x.item,
          quantity: Number(x.remaining),
          uom: x.uom,
          rate: Number(x.rate),
        });
        groups.set(key, g);
      }
      return { data: [...groups.values()], vendors: vendors.rows };
    });
  }

  /** A draft PO for ticked lines of an approved requisition, to one vendor. */
  async create(ctx: RequestContext, dto: CreateOrderDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await c.query<{
        status: string;
        department_id: string | null;
        required_by: string | null;
      }>(
        `SELECT status, department_id::text, required_by::text FROM purchase_requisitions WHERE id = $1`,
        [dto.requisitionId],
      );
      if (!pr.rows[0]) throw new DomainError('not-found', 'Requisition not found', { status: 404 });
      if (!['approved', 'part_ordered'].includes(pr.rows[0].status))
        throw new DomainError(
          'purchase.requisition_not_approved',
          'The requisition is not approved',
          {
            status: 409,
          },
        );
      await this.activeVendor(c, dto.vendorId);
      const ok = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- ON_ORDER is a fixed fragment
        `SELECT rl.id::text FROM purchase_requisition_lines rl
          WHERE rl.requisition_id = $1 AND rl.id = ANY($2::bigint[]) AND rl.fulfil = 'buy' AND rl.quantity > ${ON_ORDER}`,
        [dto.requisitionId, dto.lineIds],
      );
      if (ok.rows.length !== new Set(dto.lineIds).size)
        throw new DomainError(
          'validation-failed',
          'A line is not on this requisition, is from the store, or is already on a PO',
          { status: 400 },
        );
      const o = await newOrder(c, {
        vendorId: dto.vendorId,
        departmentId: pr.rows[0].department_id,
        requisitionId: dto.requisitionId,
        createdBy: String(ctx.user.id),
        deliveryDate: pr.rows[0].required_by,
      });
      await addRequisitionLines(c, o.id, dto.lineIds);
      // a line with no vendor chosen on the PR takes the PO's vendor
      await c.query(
        `UPDATE purchase_requisition_lines SET vendor_id = $2 WHERE id = ANY($1::bigint[]) AND vendor_id IS NULL`,
        [dto.lineIds, dto.vendorId],
      );
      await recomputeOrder(c, o.id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.create',
        entityType: 'purchase_orders',
        entityId: o.id,
        after: { number: o.number, requisition: dto.requisitionId, lines: dto.lineIds.length },
      });
      return o;
    });
  }

  private async activeVendor(c: PoolClient, vendorId: string) {
    const v = await c.query<{ legal_name: string; status: string }>(
      `SELECT legal_name, status FROM vendors WHERE id = $1`,
      [vendorId],
    );
    const x = v.rows[0];
    if (!x) throw new DomainError('not-found', 'Vendor not found', { status: 404 });
    if (x.status !== 'active')
      throw new DomainError(
        'purchase.vendor_not_active',
        x.status === 'pending'
          ? `${x.legal_name} waits for approval: no order can go to it yet`
          : `${x.legal_name} is ${x.status}: no order can go to it`,
        { status: 409 },
      );
  }

  // ---- the detail ----------------------------------------------------------------------------------
  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        seq: number;
        requisition_line_id: string | null;
        item_id: string | null;
        item_code: string | null;
        description: string;
        hsn_code: string | null;
        quantity: string;
        uom_id: string;
        uom: string;
        rate: string;
        discount_pct: string;
        gst_rate: string;
        reverse_charge: boolean;
        exempt: boolean;
        taxable: string;
        cgst: string;
        sgst: string;
        igst: string;
        rcm_gst: string;
        total: string;
        contract_id: string | null;
        contract_rate: string | null;
        rate_change_reason: string | null;
        max_qty: string | null;
        received_qty: string;
        accepted_qty: string;
        rejected_qty: string;
        returned_qty: string;
      }>(
        `SELECT l.id::text, l.seq, l.received_qty::text, l.accepted_qty::text, l.rejected_qty::text, l.returned_qty::text, l.requisition_line_id::text, l.item_id::text, i.code AS item_code, l.description, l.hsn_code,
                l.quantity::text, l.uom_id::text, u.code AS uom, l.rate::text, l.discount_pct::text, l.gst_rate::text, l.reverse_charge,
                l.exempt, l.taxable::text, l.cgst::text, l.sgst::text, l.igst::text, l.rcm_gst::text, l.total::text, l.contract_id::text,
                rc.rate::text AS contract_rate, l.rate_change_reason,
                (SELECT rl.quantity - COALESCE((SELECT sum(ol.quantity) FROM purchase_order_lines ol JOIN purchase_orders po ON po.id = ol.order_id
                                                 WHERE ol.requisition_line_id = rl.id AND ol.order_id <> l.order_id
                                                   AND po.status NOT IN ('rejected', 'cancelled', 'superseded')
                                                   AND po.id IS DISTINCT FROM (SELECT supersedes_id FROM purchase_orders WHERE id = l.order_id)), 0)
                   FROM purchase_requisition_lines rl WHERE rl.id = l.requisition_line_id)::text AS max_qty
           FROM purchase_order_lines l
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_rate_contracts rc ON rc.id = l.contract_id
          WHERE l.order_id = $1 ORDER BY l.seq`,
        [id],
      )
    ).rows;
  }

  private async chargesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        kind: string;
        label: string | null;
        amount: string;
        gst_rate: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
      }>(
        `SELECT id::text, kind, label, amount::text, gst_rate::text, cgst::text, sgst::text, igst::text, total::text
           FROM purchase_order_charges WHERE order_id = $1 ORDER BY id`,
        [id],
      )
    ).rows;
  }

  private static chargeLabel(kind: string, lbl: string | null) {
    return (
      lbl ||
      (
        { freight: 'Freight', installation: 'Installation', packing: 'Packing' } as Record<
          string,
          string
        >
      )[kind] ||
      'Other charges'
    );
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      const lines = await this.linesOf(c, id);
      const charges = await this.chargesOf(c, id);
      const vendor = (
        await c.query<{
          gstin: string | null;
          pan: string | null;
          address: string | null;
          city: string | null;
          pin: string | null;
          state_code: string | null;
          msme_type: string | null;
          phone: string | null;
        }>(
          `SELECT gstin, pan, address, city, pin, state_code, msme_type, phone FROM vendors WHERE id = $1`,
          [po.vendor_id],
        )
      ).rows[0]!;
      const revisions = await c.query<{
        id: string;
        revision: number;
        status: string;
        approved_at: Date | null;
      }>(
        `SELECT id::text, revision, status, approved_at FROM purchase_orders WHERE number = $1 ORDER BY revision`,
        [po.number],
      );
      const sends = await c.query<{
        id: string;
        to_address: string;
        sent_at: Date;
        by: string | null;
        message_status: string | null;
        file_id: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT s.id::text, s.to_address, s.sent_at, (SELECT ${PERSON('u')} FROM users u WHERE u.id = s.sent_by) AS by,
                m.status::text AS message_status, s.file_id::text
           FROM purchase_order_sends s LEFT JOIN comms_messages m ON m.id = s.message_id
          WHERE s.order_id = $1 ORDER BY s.sent_at DESC`,
        [id],
      );
      const terms = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM purchase_payment_terms WHERE status = 'active' ORDER BY is_default DESC, name`,
      );
      const instance = po.workflow_instance_id
        ? await this.workflow.instanceWith(c, po.workflow_instance_id)
        : null;
      const history = (
        await c.query<{ kind: string; actor: string | null; note: string | null; at: Date }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `SELECT e.kind, ${PERSON('u')} AS actor, e.note, e.occurred_at AS at
             FROM workflow_events e LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.instance_id IN (SELECT id FROM workflow_instances WHERE entity_type = 'purchase_order' AND entity_id = $1)
            ORDER BY e.occurred_at, e.id`,
          [id],
        )
      ).rows;
      const mine = po.workflow_instance_id
        ? await c.query<{ id: string }>(MY_STEP, [po.workflow_instance_id])
        : { rows: [] };
      const receipts = await c.query<{
        id: string;
        number: string;
        kind: string;
        status: string;
        received_on: string;
        accepted_on: string | null;
        store: string | null;
        by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT g.id::text, g.number, g.kind, g.status, g.received_on::text, g.accepted_on::text, st.name AS store,
                (SELECT ${PERSON('u')} FROM users u WHERE u.id = g.created_by) AS by
           FROM goods_receipts g LEFT JOIN stores st ON st.id = g.store_id WHERE g.order_id = $1 ORDER BY g.received_on, g.id`,
        [id],
      );
      const manage = this.has(ctx, PURCHASE.orderManage);
      const approvedYet = instance?.steps.some((s) => s.status === 'approved') ?? false;
      const placed = ['approved', 'sent'].includes(po.status);
      const lineTax = (l: (typeof lines)[number]): Tax => ({
        taxable: Number(l.taxable),
        cgst: Number(l.cgst),
        sgst: Number(l.sgst),
        igst: Number(l.igst),
        rcm: Number(l.rcm_gst),
        total: Number(l.total),
      });
      return {
        ...this.shape(po),
        emergencyReason: po.emergency_reason,
        billFileId: po.bill_file_id,
        billRef: po.bill_ref,
        vendorStatus: po.vendor_status,
        vendorEmail: po.vendor_email,
        vendorGstStatus: po.vendor_gst_status,
        vendorDetail: {
          gstin: vendor.gstin,
          pan: vendor.pan,
          address: [vendor.address, vendor.city, vendor.pin].filter(Boolean).join(', ') || null,
          state: vendor.state_code ? (GST_STATES[vendor.state_code] ?? vendor.state_code) : null,
          msme: vendor.msme_type,
          phone: vendor.phone,
        },
        supply: po.supply,
        quoteRef: po.quote_ref,
        deliveryAddress: po.delivery_address,
        paymentTermId: po.payment_term_id,
        paymentText: po.payment_text,
        validityDays: po.validity_days,
        validUntil: addDays(po.po_date, po.validity_days),
        terms: po.terms,
        totals: {
          taxable: Number(po.taxable),
          cgst: Number(po.cgst),
          sgst: Number(po.sgst),
          igst: Number(po.igst),
          rcm: Number(po.rcm_gst),
          roundOff: Number(po.round_off),
          total: Number(po.total),
        },
        words: amountInWords(po.total),
        decisionNote: po.decision_note,
        closedAt: po.closed_at?.toISOString() ?? null,
        closedNote: po.closed_note,
        lineItems: lines.map((l) => ({
          id: l.id,
          seq: l.seq,
          requisitionLineId: l.requisition_line_id,
          itemId: l.item_id,
          itemCode: l.item_code,
          description: l.description,
          hsnCode: l.hsn_code,
          quantity: Number(l.quantity),
          maxQuantity: l.max_qty === null ? null : Number(l.max_qty),
          uomId: l.uom_id,
          uom: l.uom,
          rate: Number(l.rate),
          discountPct: Number(l.discount_pct),
          gstRate: Number(l.gst_rate),
          reverseCharge: l.reverse_charge,
          exempt: l.exempt,
          ...lineTax(l),
          contractRate: l.contract_rate === null ? null : Number(l.contract_rate),
          rateChangeReason: l.rate_change_reason,
          received: Number(l.received_qty),
          accepted: Number(l.accepted_qty),
          rejected: Number(l.rejected_qty),
          returned: Number(l.returned_qty),
        })),
        charges: charges.map((x) => ({
          id: x.id,
          kind: x.kind,
          label: PurchaseOrdersService.chargeLabel(x.kind, x.label),
          ownLabel: x.label,
          amount: Number(x.amount),
          gstRate: Number(x.gst_rate),
          gst: Number(x.cgst) + Number(x.sgst) + Number(x.igst),
          total: Number(x.total),
        })),
        summary: gstSummary([
          ...lines.map((l) => ({
            hsn: l.hsn_code,
            gstRate: Number(l.gst_rate),
            reverseCharge: l.reverse_charge,
            tax: lineTax(l),
          })),
          // other charges (no HSN) so the summary adds up to the totals
          ...charges.map((x) => ({
            hsn: null,
            gstRate: Number(x.gst_rate),
            reverseCharge: false,
            tax: {
              taxable: Number(x.amount),
              cgst: Number(x.cgst),
              sgst: Number(x.sgst),
              igst: Number(x.igst),
              rcm: 0,
              total: Number(x.total),
            },
          })),
        ]),
        revisions: revisions.rows.map((x) => ({
          id: x.id,
          revision: x.revision,
          label: label(po.number, x.revision),
          status: x.status,
          approvedAt: x.approved_at?.toISOString() ?? null,
        })),
        sends: sends.rows.map((s) => ({
          id: s.id,
          to: s.to_address,
          at: s.sent_at.toISOString(),
          by: s.by,
          messageStatus: s.message_status,
          fileId: s.file_id,
        })),
        paymentTerms: manage ? terms.rows : [],
        steps: instance?.steps ?? [],
        history: history.map((h) => ({
          kind: h.kind,
          actor: h.actor,
          note: h.note,
          at: h.at.toISOString(),
        })),
        can: {
          edit: manage && EDITABLE.includes(po.status),
          submit: manage && EDITABLE.includes(po.status),
          decide: mine.rows.length > 0 && po.created_by !== String(ctx.user.id),
          send: manage && placed && !po.emergency,
          close: manage && placed,
          amend: manage && placed && !po.emergency && !po.newer && !po.receipts,
          cancel:
            !po.receipts &&
            ((manage &&
              (EDITABLE.includes(po.status) || (po.status === 'submitted' && !approvedYet))) ||
              (this.has(ctx, PURCHASE.orderCancel) && placed)),
          receive:
            placed &&
            !po.newer &&
            po.receipt_status !== 'received' &&
            po.created_by !== String(ctx.user.id) &&
            (this.has(ctx, PURCHASE.storeOperate) || this.has(ctx, PURCHASE.storeManage) || manage),
        },
        receiptList: receipts.rows.map((g) => ({
          id: g.id,
          number: g.number,
          kind: g.kind,
          status: g.status,
          receivedOn: g.received_on,
          acceptedOn: g.accepted_on,
          store: g.store,
          by: g.by,
        })),
      };
    });
  }

  // ---- change --------------------------------------------------------------------------------------
  async update(ctx: RequestContext, id: string, dto: UpdateOrderDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      if (!EDITABLE.includes(po.status))
        throw new DomainError(
          'purchase.order_closed',
          'Only a draft or a PO sent back is changed',
          {
            status: 409,
          },
        );
      const lines = await this.linesOf(c, id);
      for (const l of dto.lines) {
        const have = lines.find((x) => x.id === l.id);
        if (!have) throw new DomainError('not-found', 'A line was not found', { status: 404 });
        if (have.max_qty !== null && l.quantity > Number(have.max_qty) + 0.0005)
          throw new DomainError(
            'validation-failed',
            `${have.description}: at most ${have.max_qty} on this PO (the requisition's quantity less other orders)`,
            { status: 400 },
          );
        if (
          have.contract_rate !== null &&
          Math.abs(l.rate - Number(have.contract_rate)) > 0.004 &&
          !l.rateChangeReason
        )
          throw new DomainError(
            'purchase.contract_rate',
            `${have.description}: the rate contract's rate is ${rupees(Number(have.contract_rate))} — give the reason for another rate`,
            { status: 400 },
          );
      }
      const keep = new Set(dto.lines.map((l) => l.id));
      for (const l of lines)
        if (!keep.has(l.id))
          await c.query(`DELETE FROM purchase_order_lines WHERE id = $1`, [l.id]);
      for (const l of dto.lines) {
        const have = lines.find((x) => x.id === l.id)!;
        await c.query(
          `UPDATE purchase_order_lines SET description = $2, hsn_code = $3, quantity = $4, rate = $5, discount_pct = $6, gst_rate = $7,
                  rate_change_reason = $8 WHERE id = $1`,
          [
            l.id,
            l.description,
            l.hsnCode ?? null,
            l.quantity,
            l.rate,
            l.discountPct,
            l.gstRate,
            have.contract_rate !== null && Math.abs(l.rate - Number(have.contract_rate)) > 0.004
              ? (l.rateChangeReason ?? null)
              : null,
          ],
        );
      }
      await c.query(`DELETE FROM purchase_order_charges WHERE order_id = $1`, [id]);
      for (const ch of dto.charges)
        await c.query(
          `INSERT INTO purchase_order_charges (school_id, order_id, kind, label, amount, gst_rate) VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [id, ch.kind, ch.label ?? null, ch.amount, ch.gstRate],
        );
      if (dto.paymentTermId) {
        const t = await c.query(
          `SELECT 1 FROM purchase_payment_terms WHERE id = $1 AND status = 'active'`,
          [dto.paymentTermId],
        );
        if (!t.rowCount)
          throw new DomainError('not-found', 'Payment term not found', { status: 404 });
      }
      await c.query(
        `UPDATE purchase_orders SET quote_ref = $2, po_date = COALESCE($3::date, po_date), delivery_date = $4, delivery_address = $5,
                payment_term_id = $6, validity_days = $7, terms = $8, updated_at = now() WHERE id = $1`,
        [
          id,
          dto.quoteRef ?? null,
          dto.poDate ?? null,
          dto.deliveryDate ?? null,
          dto.deliveryAddress ?? null,
          dto.paymentTermId ?? null,
          dto.validityDays,
          dto.terms ?? null,
        ],
      );
      const t = await recomputeOrder(c, id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.update',
        entityType: 'purchase_orders',
        entityId: id,
        after: { lines: dto.lines.length, charges: dto.charges.length, total: t.total },
      });
      return { id, ...t };
    });
  }

  // ---- approval ------------------------------------------------------------------------------------
  /** The emergency ratification level: everyone with the designation in Purchase settings. */
  private async emergencyFlow(c: PoolClient) {
    const s = (
      await c.query<{ emergency_ratifier: string; emergency_enabled: boolean }>(
        `SELECT emergency_ratifier, emergency_enabled FROM purchase_settings WHERE school_id = app.current_school_id()`,
      )
    ).rows[0]!;
    const levels: Level[] = [
      {
        level: 1,
        name: `Ratification (${s.emergency_ratifier})`,
        resolver: {
          kind: 'staff',
          by: 'designation',
          employeeIds: [],
          designation: s.emergency_ratifier,
        },
        escalateTo: { kind: 'role', roleCode: 'school_admin' },
        slaHours: 72,
        autoSkip: true,
        noSelfApproval: true,
      },
    ];
    const upd = await c.query(
      `UPDATE workflow_definitions SET levels = $1::jsonb, status = 'active', updated_at = now(), updated_by = app.current_user_id()
        WHERE code = 'purchase_emergency' AND deleted_at IS NULL`,
      [JSON.stringify(levels)],
    );
    if (!upd.rowCount)
      await c.query(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, status, created_by, updated_by)
         VALUES (app.current_school_id(), 'purchase_emergency', 'Emergency purchase: ratification', 'purchase_order', $1::jsonb, '{}', 'active',
                 app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(levels)],
      );
    return { code: 'purchase_emergency', enabled: s.emergency_enabled };
  }

  async submit(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      if (!EDITABLE.includes(po.status))
        throw new DomainError('purchase.order_closed', 'This PO is not a draft', { status: 409 });
      if (!po.lines)
        throw new DomainError('validation-failed', 'The PO has no line', { status: 400 });
      await this.activeVendor(c, po.vendor_id);
      const s = (
        await c.query<{ state_code: string | null }>(
          `SELECT state_code FROM purchase_settings WHERE school_id = app.current_school_id()`,
        )
      ).rows[0]!;
      if (po.vendor_gst_status === 'regular' && !s.state_code)
        throw new DomainError(
          'purchase.school_state_missing',
          "Set the school's GSTIN or state on Purchase settings: it decides CGST + SGST or IGST",
          { status: 409 },
        );
      const t = await recomputeOrder(c, id);
      let code: string;
      let dept = po.department ?? '';
      if (po.emergency) code = (await this.emergencyFlow(c)).code;
      else {
        if (!po.department_id)
          throw new DomainError('purchase.no_approvers', 'The PO has no department', {
            status: 409,
          });
        const flow = await syncFlow(c, 'order', po.department_id);
        if (!flow.levels)
          throw new DomainError(
            'purchase.no_approvers',
            `Who approves ${flow.department}'s Purchase Orders is not set: ask the school admin (Purchase → Who approves)`,
            { status: 409 },
          );
        code = flow.code;
        dept = flow.department;
      }
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: code,
        entityType: 'purchase_order',
        entityId: id,
        subject: `${label(po.number, po.revision)}${po.emergency ? ' · emergency' : ''} · ${po.vendor} · ${rupees(t.total)}`,
        payload: {
          department: dept,
          departmentId: po.department_id,
          amount: t.total,
          number: label(po.number, po.revision),
        },
      });
      await c.query(
        `UPDATE purchase_orders SET status = 'submitted', workflow_instance_id = $2, submitted_at = now(), decision_note = NULL,
                updated_at = now() WHERE id = $1`,
        [id, instance.id],
      );
      await this.audit.stage(ctx, c, {
        action: po.emergency ? 'purchase.emergency.submit' : 'purchase.order.submit',
        entityType: 'purchase_orders',
        entityId: id,
        after: { number: label(po.number, po.revision), total: t.total },
      });
      return { id, number: label(po.number, po.revision), total: t.total };
    });
  }

  async decide(ctx: RequestContext, id: string, dto: IndentDecisionDto) {
    if (dto.action !== 'approve' && (dto.note ?? '').length < 3)
      throw new DomainError(
        'validation-failed',
        dto.action === 'reject' ? 'Give the reason' : 'Say what to change',
        { status: 400 },
      );
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      if (po.status !== 'submitted' || !po.workflow_instance_id)
        throw new DomainError('purchase.not_waiting', 'This PO is not waiting for approval', {
          status: 409,
        });
      if (po.created_by === String(ctx.user.id))
        throw new DomainError(
          'workflow.self_approval',
          'You made this PO: another approver decides it',
          {
            status: 403,
          },
        );
      const s = await c.query<{ id: string }>(MY_STEP, [po.workflow_instance_id]);
      if (!s.rows[0])
        throw new DomainError('workflow.not_assignee', 'This PO is not waiting for you', {
          status: 403,
        });
      if (dto.action === 'send_back') {
        await this.workflow.cancelIn(c, ctx, po.workflow_instance_id, `Sent back: ${dto.note!}`);
        await c.query(
          `UPDATE purchase_orders SET status = 'sent_back', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
          [id, dto.note],
        );
      }
      return s.rows[0].id;
    });
    if (dto.action !== 'send_back')
      await this.workflow.act(ctx, step, dto.action === 'approve' ? 'approved' : 'rejected', {
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
    const po = (
      await c.query<{
        requisition_id: string | null;
        supersedes_id: string | null;
        po_date: string;
      }>(
        `SELECT requisition_id::text, supersedes_id::text, po_date::text FROM purchase_orders WHERE id = $1`,
        [id],
      )
    ).rows[0]!;
    if (outcome === 'rejected') {
      const note = [...instance.steps].reverse().find((s) => s.status === 'rejected')?.note ?? null;
      await c.query(
        `UPDATE purchase_orders SET status = 'rejected', decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, note],
      );
      return;
    }
    await c.query(
      `UPDATE purchase_orders SET status = 'approved', decided_at = now(), approved_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    // an amendment replaces the revision before it
    if (po.supersedes_id)
      await c.query(
        `UPDATE purchase_orders SET status = 'superseded', updated_at = now() WHERE id = $1 AND status IN ('approved', 'sent')`,
        [po.supersedes_id],
      );
    // the items' last purchase rate
    await c.query(
      `UPDATE purchase_items i SET last_purchase_rate = l.rate, last_purchased_on = $2::date, updated_at = now()
         FROM purchase_order_lines l WHERE l.order_id = $1 AND l.item_id = i.id`,
      [id, po.po_date],
    );
    if (po.requisition_id) await refreshOrdered(c, po.requisition_id);
    await this.audit.stage(ctx, c, {
      action: 'purchase.order.approved',
      entityType: 'purchase_orders',
      entityId: id,
      after: { supersedes: po.supersedes_id },
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      const placed = ['approved', 'sent'].includes(po.status);
      if (placed && !this.has(ctx, PURCHASE.orderCancel))
        throw new DomainError(
          'permission-denied',
          'Cancelling an approved PO needs the cancel right',
          {
            status: 403,
          },
        );
      if (!placed) this.mustManage(ctx);
      if (po.receipts)
        throw new DomainError(
          'purchase.order_received',
          'Goods or work have been received against this PO: close it short instead',
          { status: 409 },
        );
      if (po.status === 'submitted' && po.workflow_instance_id) {
        const done = await c.query(
          `SELECT 1 FROM workflow_steps WHERE instance_id = $1 AND status = 'approved'`,
          [po.workflow_instance_id],
        );
        if (done.rowCount)
          throw new DomainError(
            'purchase.order_closed',
            'An approver has approved it already: ask them to send it back',
            { status: 409 },
          );
        await this.workflow.cancelIn(c, ctx, po.workflow_instance_id, `Cancelled: ${dto.reason}`);
      } else if (!placed && !EDITABLE.includes(po.status))
        throw new DomainError('purchase.order_closed', 'This PO cannot be cancelled', {
          status: 409,
        });
      await c.query(
        `UPDATE purchase_orders SET status = 'cancelled', decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      if (po.requisition_id) await refreshOrdered(c, po.requisition_id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.cancel',
        entityType: 'purchase_orders',
        entityId: id,
        after: { reason: dto.reason, was: po.status },
      });
      return { cancelled: true };
    });
  }

  /** Short-closed by hand with the reason (a PO accepted in full closes by itself, part 7). */
  async close(ctx: RequestContext, id: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE purchase_orders SET status = 'closed', closed_at = now(), closed_note = $2, updated_at = now()
          WHERE id = $1 AND status IN ('approved', 'sent')`,
        [id, dto.reason],
      );
      if (!r.rowCount)
        throw new DomainError('purchase.order_closed', 'Only an approved or sent PO is closed', {
          status: 409,
        });
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.close',
        entityType: 'purchase_orders',
        entityId: id,
        after: { note: dto.reason },
      });
      return { closed: true };
    });
  }

  /** The next revision of an approved PO, as a draft to change and approve again. */
  async amend(ctx: RequestContext, id: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      if (!['approved', 'sent'].includes(po.status) || po.emergency)
        throw new DomainError('purchase.order_closed', 'Only an approved or sent PO is amended', {
          status: 409,
        });
      if (po.newer)
        throw new DomainError('conflict', 'An amendment of this PO is already open', {
          status: 409,
        });
      if (po.receipts)
        throw new DomainError(
          'purchase.order_received',
          'Goods or work have been received against this PO: close it short and raise a new PO for the change',
          { status: 409 },
        );
      const n = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_orders (school_id, number, revision, supersedes_id, amend_reason, status, requisition_id, department_id, vendor_id,
                                        vendor_gst_status, vendor_state_code, supply, quote_ref, po_date, delivery_date, delivery_address,
                                        payment_term_id, validity_days, terms, created_by)
           SELECT school_id, number, revision + 1, id, $2, 'draft', requisition_id, department_id, vendor_id, vendor_gst_status,
                  vendor_state_code, supply, quote_ref, (now() AT TIME ZONE 'Asia/Kolkata')::date, delivery_date, delivery_address,
                  payment_term_id, validity_days, terms, app.current_user_id()
             FROM purchase_orders WHERE id = $1 RETURNING id::text`,
          [id, dto.reason],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO purchase_order_lines (school_id, order_id, seq, requisition_line_id, item_id, description, hsn_code, quantity, uom_id, rate,
                                           discount_pct, gst_rate, reverse_charge, exempt, contract_id, rate_change_reason)
         SELECT school_id, $2, seq, requisition_line_id, item_id, description, hsn_code, quantity, uom_id, rate, discount_pct, gst_rate,
                reverse_charge, exempt, contract_id, rate_change_reason
           FROM purchase_order_lines WHERE order_id = $1`,
        [id, n],
      );
      await c.query(
        `INSERT INTO purchase_order_charges (school_id, order_id, kind, label, amount, gst_rate)
         SELECT school_id, $2, kind, label, amount, gst_rate FROM purchase_order_charges WHERE order_id = $1`,
        [id, n],
      );
      await recomputeOrder(c, n);
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.amend',
        entityType: 'purchase_orders',
        entityId: n,
        after: { from: id, revision: po.revision + 1, reason: dto.reason },
      });
      return { id: n, label: label(po.number, po.revision + 1) };
    });
  }

  // ---- the PDF and the e-mail ----------------------------------------------------------------------
  private async pdfData(c: PoolClient, ctx: RequestContext, id: string): Promise<OrderPdfData> {
    const po = await this.load(c, ctx, id);
    const lines = await this.linesOf(c, id);
    const charges = await this.chargesOf(c, id);
    const s = (
      await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
        gstin: string | null;
        state_code: string | null;
        billing_address: string | null;
        po_signatures: string[];
      }>(
        `SELECT sc.name,
                NULLIF(concat_ws(', ', NULLIF(btrim(sc.address->>'line1'), ''), NULLIF(btrim(sc.address->>'line2'), ''),
                       NULLIF(btrim(sc.address->>'city'), ''), NULLIF(btrim(sc.address->>'state'), ''),
                       NULLIF(btrim(COALESCE(sc.address->>'pincode', sc.address->>'pin')), '')), '') AS address,
                NULLIF(concat_ws(' · ', 'Phone ' || NULLIF(btrim(sc.contact->>'phone'), ''), NULLIF(btrim(sc.contact->>'email'), '')), '') AS contact,
                NULLIF(sc.branding->>'logoFileId', '') AS logo, ps.gstin, ps.state_code, ps.billing_address, ps.po_signatures
           FROM schools sc JOIN purchase_settings ps ON ps.school_id = sc.id WHERE sc.id = app.current_school_id()`,
      )
    ).rows[0]!;
    let logo: OrderPdfData['logo'] = null;
    if (s.logo && /^\d{1,18}$/.test(s.logo)) {
      const f = await c.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
        [s.logo],
      );
      if (f.rows[0])
        try {
          logo = {
            contentType: f.rows[0].content_type,
            bytes: await this.storage.read(f.rows[0].object_key),
          };
        } catch {
          logo = null;
        }
    }
    const v = (
      await c.query<{
        gstin: string | null;
        pan: string | null;
        address: string | null;
        city: string | null;
        pin: string | null;
        state_code: string | null;
        msme_type: string | null;
        phone: string | null;
        email: string | null;
        udyam_no: string | null;
      }>(
        `SELECT gstin, pan, address, city, pin, state_code, msme_type, phone, email, udyam_no FROM vendors WHERE id = $1`,
        [po.vendor_id],
      )
    ).rows[0]!;
    const approver = po.workflow_instance_id
      ? ((
          await c.query<{ by: string | null }>(
            // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
            `SELECT (SELECT ${PERSON('u')} FROM users u WHERE u.id = st.acted_by) AS by FROM workflow_steps st
              WHERE st.instance_id = $1 AND st.status = 'approved' ORDER BY st.level DESC LIMIT 1`,
            [po.workflow_instance_id],
          )
        ).rows[0]?.by ?? null)
      : null;
    const tax = (l: {
      taxable: string;
      cgst: string;
      sgst: string;
      igst: string;
      rcm_gst: string;
      total: string;
    }): Tax => ({
      taxable: Number(l.taxable),
      cgst: Number(l.cgst),
      sgst: Number(l.sgst),
      igst: Number(l.igst),
      rcm: Number(l.rcm_gst),
      total: Number(l.total),
    });
    const placed = ['approved', 'sent', 'closed'].includes(po.status);
    return {
      school: {
        name: s.name,
        address: s.address,
        contact: s.contact,
        gstin: s.gstin,
        state: s.state_code ? `${GST_STATES[s.state_code] ?? ''} (${s.state_code})` : null,
      },
      logo,
      title: po.emergency ? 'Emergency Purchase' : 'Purchase Order',
      generatedOn: registerGeneratedOn(),
      watermark: placed
        ? null
        : po.status === 'cancelled' || po.status === 'superseded' || po.status === 'rejected'
          ? po.status.toUpperCase()
          : 'DRAFT',
      number: label(po.number, po.revision),
      date: dmy(po.po_date),
      validUntil: dmy(addDays(po.po_date, po.validity_days)),
      quoteRef: po.quote_ref,
      deliveryDate: po.delivery_date ? dmy(po.delivery_date) : null,
      department: po.department,
      requisition: po.requisition,
      billingAddress: s.billing_address,
      deliveryAddress: po.delivery_address,
      vendor: {
        name: po.vendor,
        code: po.vendor_code,
        address: [v.address, v.city, v.pin].filter(Boolean).join(', ') || null,
        gstin: v.gstin,
        pan: v.pan,
        state: v.state_code ? `${GST_STATES[v.state_code] ?? ''} (${v.state_code})` : null,
        gstStatus: po.vendor_gst_status,
        msme: v.msme_type ? `${v.msme_type}${v.udyam_no ? ` · ${v.udyam_no}` : ''}` : null,
        contact: [v.phone, v.email].filter(Boolean).join(' · ') || null,
      },
      supply: po.supply,
      lines: lines.map((l) => ({
        seq: l.seq,
        description: l.description,
        hsn: l.hsn_code,
        quantity: Number(l.quantity),
        uom: l.uom,
        rate: Number(l.rate),
        discountPct: Number(l.discount_pct),
        taxable: Number(l.taxable),
        gstRate: Number(l.gst_rate),
        gst: Number(l.cgst) + Number(l.sgst) + Number(l.igst),
        rcm: Number(l.rcm_gst),
        total: Number(l.total),
      })),
      charges: charges.map((x) => ({
        label: PurchaseOrdersService.chargeLabel(x.kind, x.label),
        amount: Number(x.amount),
        gstRate: Number(x.gst_rate),
        gst: Number(x.cgst) + Number(x.sgst) + Number(x.igst),
        total: Number(x.total),
      })),
      totals: {
        taxable: Number(po.taxable),
        cgst: Number(po.cgst),
        sgst: Number(po.sgst),
        igst: Number(po.igst),
        rcm: Number(po.rcm_gst),
        roundOff: Number(po.round_off),
        total: Number(po.total),
      },
      words: amountInWords(po.total),
      summary: gstSummary([
        ...lines.map((l) => ({
          hsn: l.hsn_code,
          gstRate: Number(l.gst_rate),
          reverseCharge: l.reverse_charge,
          tax: tax(l),
        })),
        ...charges.map((x) => ({
          hsn: null,
          gstRate: Number(x.gst_rate),
          reverseCharge: false,
          tax: tax({
            taxable: x.amount,
            cgst: x.cgst,
            sgst: x.sgst,
            igst: x.igst,
            rcm_gst: '0',
            total: x.total,
          }),
        })),
      ]),
      paymentText: po.payment_text,
      msmeWarning: po.msme_warning,
      terms: po.terms,
      emergency: po.emergency ? { reason: po.emergency_reason ?? '', billRef: po.bill_ref } : null,
      signatures: s.po_signatures,
      approved: placed
        ? { by: approver, at: po.approved_at ? dmy(po.approved_at.toISOString()) : null }
        : null,
    };
  }

  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const d = await this.pdfData(c, ctx, id);
      return {
        filename: `${d.number.replaceAll('/', '-')}.pdf`,
        bytes: await purchaseOrderPdf(d),
      };
    });
  }

  /** The PDF e-mailed to the vendor through the school's e-mail (the template on Communication). */
  async send(ctx: RequestContext, id: string, dto: SendOrderDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const po = await this.load(c, ctx, id);
      if (!['approved', 'sent'].includes(po.status) || po.emergency)
        throw new DomainError(
          'purchase.order_closed',
          'Only an approved PO is sent to the vendor',
          {
            status: 409,
          },
        );
      const d = await this.pdfData(c, ctx, id);
      const bytes = await purchaseOrderPdf(d);
      const filename = `${d.number.replaceAll('/', '-')}.pdf`;
      const school = (await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`))
        .rows[0]!.id;
      const key = objectKeyFor(
        school,
        'pdf',
        `purchase-order-${id}-${randomBytes(6).toString('hex')}`,
      );
      await this.storage.write(key, bytes, 'application/pdf');
      const fileId = (
        await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                              owner_entity_id, classification, storage_driver, status, scanned_at, scan_result, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, 'application/pdf', $3, $4, $5, 'purchase_order', $6, 'internal', $7, 'ready',
                   now(), 'generated', app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            this.storage.bucket,
            key,
            bytes.length,
            createHash('sha256').update(bytes).digest('hex'),
            filename,
            id,
            this.storage.name,
          ],
        )
      ).rows[0]!.id;
      await c.query(`SELECT app.purchase_seed_templates(app.current_school_id())`);
      const t = (
        await c.query<{ id: string; subject: string | null; body: string }>(
          `SELECT id::text, subject, body FROM comms_templates
            WHERE code = 'purchase_order' AND channel = 'email' AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        )
      ).rows[0];
      if (!t)
        throw new DomainError(
          'purchase.no_template',
          'The e-mail template "Purchase: order to the vendor" is switched off (Communication → Templates)',
          { status: 409 },
        );
      const me = (
        await c.query<{ name: string; email: string | null }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `SELECT ${PERSON('u')} AS name, (SELECT NULLIF(btrim(contact->>'email'), '') FROM schools WHERE id = app.current_school_id()) AS email
             FROM users u WHERE u.id = app.current_user_id()`,
        )
      ).rows[0]!;
      const vars: Record<string, string> = {
        vendor: po.vendor,
        number: d.number,
        date: d.date,
        amount: rupees(Number(po.total)),
        delivery: d.deliveryDate ?? 'the date agreed',
        address: d.deliveryAddress ?? 'the school',
        contact: me.email ?? 'the school office',
        signatory: me.name,
        school: d.school.name,
      };
      let subject = t.subject ?? `Purchase Order ${d.number}`;
      let body = t.body;
      for (const [k, v] of Object.entries(vars)) {
        subject = subject.replaceAll(`{{${k}}}`, v);
        body = body.replaceAll(`{{${k}}}`, v);
      }
      const html = emailLayout(
        esc(d.school.name),
        body
          .split(/\n{2,}|(?<=\.) (?=Regards,)/)
          .map((p) => `<p style="margin:0 0 12px">${esc(p.trim())}</p>`)
          .join(''),
      );
      const msg = (
        await c.query<{ id: string }>(
          `INSERT INTO comms_messages (school_id, template_id, channel, recipient_address, subject, body, format, status, variables, attachments)
           VALUES (app.current_school_id(), $1, 'email', $2, $3, $4, 'html', 'queued', $5::jsonb, $6::jsonb) RETURNING id::text`,
          [
            t.id,
            dto.to.toLowerCase(),
            subject.slice(0, 200),
            html,
            JSON.stringify(vars),
            JSON.stringify([{ fileId, name: filename, contentType: 'application/pdf' }]),
          ],
        )
      ).rows[0]!.id;
      await c.query(
        `SELECT app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', app.current_user_id()::text,
                'requestId', NULL, 'kind', 'comms.message', 'payload', jsonb_build_object('messageId', $1::text)))`,
        [msg],
      );
      await c.query(
        `INSERT INTO purchase_order_sends (school_id, order_id, to_address, file_id, message_id, sent_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
        [id, dto.to.toLowerCase(), fileId, msg],
      );
      await c.query(
        `UPDATE purchase_orders SET status = 'sent', sent_at = COALESCE(sent_at, now()), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.order.send',
        entityType: 'purchase_orders',
        entityId: id,
        after: { to: dto.to, message: msg },
      });
      return { sent: true, messageId: msg, fileId };
    });
  }

  // ---- emergency purchase --------------------------------------------------------------------------
  async emergency(ctx: RequestContext, dto: EmergencyDto) {
    if (!this.has(ctx, PURCHASE.emergencyRecord))
      throw new DomainError(
        'permission-denied',
        'Recording an emergency purchase needs its right',
        {
          status: 403,
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const s = (
        await c.query<{ emergency_enabled: boolean; purchase_department_id: string | null }>(
          `SELECT emergency_enabled, purchase_department_id::text FROM purchase_settings WHERE school_id = app.current_school_id()`,
        )
      ).rows[0]!;
      if (!s.emergency_enabled)
        throw new DomainError(
          'purchase.emergency_off',
          'Emergency purchase is switched off (Purchase settings)',
          { status: 409 },
        );
      await this.activeVendor(c, dto.vendorId);
      const f = await c.query(
        `SELECT 1 FROM files WHERE id = $1 AND status = 'ready' AND created_by = app.current_user_id()
            AND size_bytes <= 5242880 AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$'`,
        [dto.billFileId],
      );
      if (!f.rowCount)
        throw new DomainError(
          'validation-failed',
          "Attach the vendor's bill (PDF or photo, 5 MB)",
          {
            status: 400,
          },
        );
      const o = await newOrder(c, {
        vendorId: dto.vendorId,
        departmentId: dto.departmentId ?? s.purchase_department_id,
        requisitionId: null,
        createdBy: String(ctx.user.id),
        emergency: { reason: dto.reason, billFileId: dto.billFileId, billRef: dto.billRef ?? null },
      });
      if (dto.poDate)
        await c.query(`UPDATE purchase_orders SET po_date = $2 WHERE id = $1`, [o.id, dto.poDate]);
      for (const [i, l] of dto.lines.entries()) {
        const it = l.itemId
          ? (
              await c.query<{
                name: string;
                uom_id: string;
                hsn: string | null;
                gst: string | null;
                rc: boolean;
                ex: boolean;
              }>(
                `SELECT i.name, i.uom_id::text, h.code AS hsn, COALESCE(i.gst_rate, h.gst_rate)::text AS gst,
                        COALESCE(h.reverse_charge, false) AS rc, COALESCE(h.exempt, false) AS ex
                   FROM purchase_items i LEFT JOIN purchase_hsn h ON h.id = i.hsn_id WHERE i.id = $1 AND i.status = 'active'`,
                [l.itemId],
              )
            ).rows[0]
          : undefined;
        if (l.itemId && !it)
          throw new DomainError('validation-failed', 'An item is not in the catalogue', {
            status: 400,
          });
        await c.query(
          `INSERT INTO purchase_order_lines (school_id, order_id, seq, item_id, description, hsn_code, quantity, uom_id, rate, gst_rate,
                                             reverse_charge, exempt)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            o.id,
            i + 1,
            l.itemId ?? null,
            (it?.name ?? l.description!).slice(0, 300),
            it?.hsn ?? null,
            l.quantity,
            l.uomId ?? it!.uom_id,
            l.rate,
            l.gstRate ?? Number(it?.gst ?? 0),
            it?.rc ?? false,
            it?.ex ?? false,
          ],
        );
      }
      const t = await recomputeOrder(c, o.id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.emergency.record',
        entityType: 'purchase_orders',
        entityId: o.id,
        after: { number: o.number, reason: dto.reason, total: t.total },
      });
      return { id: o.id, number: o.number, total: t.total };
    });
  }

  /** What the order screens pick from: active vendors, items, units, departments, payment terms. */
  async formLists(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.orderManage) && !this.has(ctx, PURCHASE.emergencyRecord))
      throw new DomainError('permission-denied', 'Only the purchase office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const vendors = await c.query<{
        id: string;
        code: string;
        name: string;
        gst_status: string;
        email: string | null;
      }>(
        `SELECT id::text, code, legal_name AS name, gst_status, email FROM vendors WHERE status = 'active' ORDER BY legal_name LIMIT 5000`,
      );
      const items = await c.query<{
        id: string;
        code: string;
        name: string;
        uom_id: string;
        uom: string;
        gst: string | null;
      }>(
        `SELECT i.id::text, i.code, i.name, i.uom_id::text, u.code AS uom, COALESCE(i.gst_rate, h.gst_rate)::text AS gst
           FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
          WHERE i.status = 'active' ORDER BY i.name LIMIT 5000`,
      );
      const uoms = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM purchase_uoms WHERE status = 'active' ORDER BY code`,
      );
      const deps = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const s = (
        await c.query<{
          emergency_enabled: boolean;
          emergency_ratifier: string;
          purchase_department_id: string | null;
        }>(
          `SELECT emergency_enabled, emergency_ratifier, purchase_department_id::text FROM purchase_settings WHERE school_id = app.current_school_id()`,
        )
      ).rows[0]!;
      return {
        vendors: vendors.rows.map((v) => ({
          id: v.id,
          code: v.code,
          name: v.name,
          gstStatus: v.gst_status,
          email: v.email,
        })),
        items: items.rows.map((i) => ({
          id: i.id,
          code: i.code,
          name: i.name,
          uomId: i.uom_id,
          uom: i.uom,
          gstRate: i.gst === null ? null : Number(i.gst),
        })),
        uoms: uoms.rows,
        departments: deps.rows,
        emergencyEnabled: s.emergency_enabled,
        emergencyRatifier: s.emergency_ratifier,
        purchaseDepartmentId: s.purchase_department_id,
      };
    });
  }
}
