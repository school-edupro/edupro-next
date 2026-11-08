import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { libraryFile, type FileCell, type FileColumn } from '../library/library-file';
import { LIVE_PO, PLACED, TO_ORDER } from './purchase-order-core';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { type PurchaseReport, type ReportQueryDto } from './purchase.dto';

/** A user's name as staff know it: their employee record's, else the account's. */
const PERSON = (u: 'u' | 'au' | 'cu') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;
const ist = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
/** The first day of the financial year (April) of a day. */
export const fyStart = (day: string) => {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 4 ? `${String(y)}-04-01` : `${String(y - 1)}-04-01`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const words: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back',
  cancelled: 'Cancelled',
  sourcing: 'Sourcing',
  part_ordered: 'Partly ordered',
  ordered: 'Ordered',
  sent: 'Sent to the vendor',
  closed: 'Closed',
  superseded: 'Replaced by an amendment',
  placed: 'Placed (approved, sent or closed)',
  to_requisition: 'Waiting for the PR',
  to_order: 'PR skipped: for the PO',
  in_requisition: 'On a PR',
  rate_contract: 'Rate contract',
  under_limit: 'Under the limit',
  none: 'No sourcing needed',
  direct: 'Direct purchase',
  committee: 'Purchase committee',
  tender: 'Tender',
  buy: 'Buy',
  store: 'From the store',
  regular: 'Regular',
  composition: 'Composition',
  unregistered: 'Unregistered',
  inspecting: 'Waiting for inspection',
  accepted: 'Accepted',
  goods: 'Goods received',
  late: 'Late only',
  in_transit: 'In transit',
  in_store: 'In store',
  in_use: 'In use',
  under_repair: 'Under repair',
  lost: 'Lost',
  returned: 'Returned to the vendor',
  written_off: 'Written off',
  disposed: 'Disposed of',
  held: 'On the books',
  approval: 'Waiting for approval',
  received: 'Received',
  expired: 'Expired already',
  d30: 'Within 30 days',
  d60: 'Within 60 days',
  d90: 'Within 90 days',
  n90: 'No issue in 90 days',
  n180: 'No issue in 180 days',
  n365: 'No issue in a year',
  service: 'Completion certificate',
};
const w = (v: string | null | undefined) => (v ? (words[v] ?? v) : '');

export const REPORT_NAMES: Record<PurchaseReport, string> = {
  pi_register: 'Purchase Indent register',
  pr_register: 'Purchase Requisition register',
  po_register: 'Purchase Order register',
  tracker: 'Status tracker: indent to order',
  pending: 'Pending approvals',
  overrides: 'Overrides',
  department_spend: 'Department spend by month',
  vendor_purchases: 'Purchases by vendor',
  item_history: 'Item purchase history',
  comparative: 'Comparative statements',
  gst_summary: 'GST summary of purchase orders',
  msme_vendors: 'MSME vendors',
  grn_register: 'Goods receipt register',
  pending_deliveries: 'Pending deliveries',
  consumption: 'Issues by department (consumption)',
  slow_moving: 'Slow-moving and dead stock',
  expiring: 'Expiring soon',
  below_reorder: 'Below reorder level',
  transfers: 'Transfers between stores',
  count_differences: 'Physical count differences',
  asset_register: 'Asset register',
  fixed_assets: 'Fixed-asset register (by category)',
  condemnations: 'Condemnations and disposals',
};

export interface ReportResult {
  report: PurchaseReport;
  name: string;
  words: string;
  columns: FileColumn[];
  rows: FileCell[][];
  totals?: FileCell[];
  /** rows beyond what the screen shows (the file has them all) */
  more: number;
  /** for the screen: a link per row (the document) */
  links?: Array<string | null>;
}

interface Scope {
  from: string;
  to: string;
  dept: string | null;
  vendor: string | null;
  item: string | null;
  status: string | null;
}

/**
 * The purchase dashboard and reports (docs/design/83, part 5): the registers of indents, requisitions
 * and orders; the tracker from each indent line to its order; pending approvals with their age and SLA;
 * the overrides an auditor asks about (bypassed requisitions, split-guard hits, vendors other than the
 * lowest, emergency purchases, cancelled and amended orders, contract rates changed); department and
 * vendor spend; an item's history; comparative statements; the GST of orders by HSN; MSME vendors. Each
 * on screen and as Excel or PDF, with the filters in words. Spend counts placed orders (approved, sent,
 * closed) by PO date.
 */
@Injectable()
export class PurchaseReportsService {
  constructor(private readonly db: DbService) {}

  private scope(q: ReportQueryDto): Scope {
    const today = ist();
    return {
      from: q.from ?? fyStart(today),
      to: q.to ?? today,
      dept: q.departmentId ?? null,
      vendor: q.vendorId ?? null,
      item: q.itemId ?? null,
      status: q.status ?? null,
    };
  }

  private async filterWords(c: PoolClient, s: Scope) {
    const parts = [`${dmy(s.from)} to ${dmy(s.to)}`];
    if (s.dept)
      parts.push(
        (await c.query<{ name: string }>(`SELECT name FROM departments WHERE id = $1`, [s.dept]))
          .rows[0]?.name ?? 'a department',
      );
    if (s.vendor)
      parts.push(
        (
          await c.query<{ n: string }>(`SELECT legal_name AS n FROM vendors WHERE id = $1`, [
            s.vendor,
          ])
        ).rows[0]?.n ?? 'a vendor',
      );
    if (s.item)
      parts.push(
        (
          await c.query<{ n: string }>(`SELECT name AS n FROM purchase_items WHERE id = $1`, [
            s.item,
          ])
        ).rows[0]?.n ?? 'an item',
      );
    if (s.status) parts.push(w(s.status));
    return parts.join(' · ');
  }

  // ---- the reports -------------------------------------------------------------------------------
  private async build(c: PoolClient, report: PurchaseReport, s: Scope, limit: number) {
    const P = [s.from, s.to, s.dept, s.vendor, s.item, s.status];
    switch (report) {
      case 'pi_register': {
        const r = await c.query<{
          id: string;
          number: string | null;
          day: string;
          dept: string;
          raised_by: string;
          purpose: string;
          priority: string;
          estimate: string;
          status: string;
          route: string | null;
          bypass_rule: string | null;
          decided: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `SELECT pi.id::text, pi.number, (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
                  d.name AS dept, ${PERSON('u')} AS raised_by, pi.purpose, pi.priority, pi.estimate::text, pi.status, pi.route,
                  pi.bypass_rule, (pi.decided_at AT TIME ZONE 'Asia/Kolkata')::date::text AS decided
             FROM purchase_indents pi JOIN departments d ON d.id = pi.department_id JOIN users u ON u.id = pi.raised_by
            WHERE (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
              AND ($3::bigint IS NULL OR pi.department_id = $3) AND ($6::text IS NULL OR pi.status = $6)
              AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_indent_lines l JOIN purchase_requisition_sources src ON src.indent_line_id = l.id
                                                  JOIN purchase_order_lines pol ON pol.requisition_line_id = src.requisition_line_id
                                                  JOIN purchase_orders po ON po.id = pol.order_id
                                                 WHERE l.indent_id = pi.id AND po.vendor_id = $4))
              AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_indent_lines l WHERE l.indent_id = pi.id AND l.item_id = $5))
            ORDER BY day, pi.number NULLS LAST LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Indent', width: 2 },
            { label: 'Date', type: 'date' },
            { label: 'Department', width: 2 },
            { label: 'Raised by', width: 2 },
            { label: 'Purpose', width: 3.5 },
            { label: 'Priority', width: 1.2 },
            { label: 'Estimate (₹)', type: 'money' },
            { label: 'Status', width: 1.8 },
            { label: 'Where it went', width: 2 },
            { label: 'PR skipped by', width: 1.6 },
            { label: 'Decided', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number ?? 'Draft',
            x.day,
            x.dept,
            x.raised_by,
            x.purpose,
            x.priority === 'urgent' ? 'Urgent' : 'Normal',
            Number(x.estimate),
            w(x.status),
            w(x.route),
            w(x.bypass_rule),
            x.decided,
          ]),
          links: r.rows.map((x) => `/purchase/indents/${x.id}`),
          sum: [6],
        };
      }
      case 'pr_register': {
        const r = await c.query<{
          id: string;
          number: string;
          day: string;
          dept: string | null;
          combined: boolean;
          tier: string | null;
          auto_rule: string | null;
          quotes: number;
          vendors: string | null;
          estimate: string;
          status: string;
          approved: string | null;
        }>(
          `SELECT r.id::text, r.number, (r.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, d.name AS dept, r.combined, r.tier,
                  r.auto_rule, (SELECT count(*)::int FROM purchase_quotes q WHERE q.requisition_id = r.id) AS quotes,
                  (SELECT string_agg(DISTINCT v.legal_name, ', ') FROM purchase_requisition_lines rl JOIN vendors v ON v.id = rl.vendor_id
                    WHERE rl.requisition_id = r.id) AS vendors,
                  r.estimate::text, r.status, (r.approved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS approved
             FROM purchase_requisitions r LEFT JOIN departments d ON d.id = r.department_id
            WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
              AND ($3::bigint IS NULL OR r.department_id = $3) AND ($6::text IS NULL OR r.status = $6)
              AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_requisition_lines rl WHERE rl.requisition_id = r.id AND rl.vendor_id = $4))
              AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_requisition_lines rl WHERE rl.requisition_id = r.id AND rl.item_id = $5))
            ORDER BY day, r.number LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Requisition', width: 2 },
            { label: 'Date', type: 'date' },
            { label: 'Department', width: 2 },
            { label: 'Sourcing', width: 1.8 },
            { label: 'Quotes', type: 'number', width: 1 },
            { label: 'Vendors chosen', width: 3 },
            { label: 'Value (₹)', type: 'money' },
            { label: 'Status', width: 1.8 },
            { label: 'Approved', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number,
            x.day,
            `${x.dept ?? ''}${x.combined ? ' (combined)' : ''}`,
            x.auto_rule ? `By the system: ${w(x.auto_rule)}` : w(x.tier),
            x.quotes,
            x.vendors,
            Number(x.estimate),
            w(x.status),
            x.approved,
          ]),
          links: r.rows.map((x) => `/purchase/requisitions/${x.id}`),
          sum: [6],
        };
      }
      case 'po_register': {
        const r = await c.query<{
          id: string;
          label: string;
          day: string;
          vendor: string;
          dept: string | null;
          emergency: boolean;
          taxable: string;
          gst: string;
          rcm: string;
          total: string;
          status: string;
          approved: string | null;
          sent: string | null;
        }>(
          `SELECT po.id::text, po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS label, po.po_date::text AS day,
                  v.legal_name AS vendor, d.name AS dept, po.emergency, po.taxable::text, (po.cgst + po.sgst + po.igst)::text AS gst,
                  po.rcm_gst::text AS rcm, po.total::text, po.status, (po.approved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS approved,
                  (po.sent_at AT TIME ZONE 'Asia/Kolkata')::date::text AS sent
             FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id LEFT JOIN departments d ON d.id = po.department_id
            WHERE po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR po.vendor_id = $4)
              AND ($6::text IS NULL OR po.status = $6 OR ($6 = 'placed' AND po.status IN ('approved', 'sent', 'closed')))
              AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.order_id = po.id AND l.item_id = $5))
            ORDER BY po.po_date, po.number, po.revision LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Order', width: 2.2 },
            { label: 'Date', type: 'date' },
            { label: 'Vendor', width: 2.6 },
            { label: 'Department', width: 2 },
            { label: 'Emergency', width: 1.2 },
            { label: 'Taxable (₹)', type: 'money' },
            { label: 'GST (₹)', type: 'money' },
            { label: 'Reverse charge (₹)', type: 'money' },
            { label: 'Total (₹)', type: 'money' },
            { label: 'Status', width: 2 },
            { label: 'Approved', type: 'date' },
            { label: 'Sent', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.label,
            x.day,
            x.vendor,
            x.dept,
            x.emergency ? 'Emergency' : '',
            Number(x.taxable),
            Number(x.gst),
            Number(x.rcm),
            Number(x.total),
            w(x.status),
            x.approved,
            x.sent,
          ]),
          links: r.rows.map((x) => `/purchase/orders/${x.id}`),
          sum: [5, 6, 7, 8],
        };
      }
      case 'tracker': {
        const r = await c.query<{
          pi_id: string;
          pi: string | null;
          day: string;
          dept: string;
          item: string;
          qty: string;
          uom: string;
          pi_status: string;
          route: string | null;
          pr_id: string | null;
          pr: string | null;
          pr_status: string | null;
          fulfil: string | null;
          pos: string | null;
          vendors: string | null;
          po_day: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- LIVE_PO is a fixed fragment
          `SELECT pi.id::text AS pi_id, pi.number AS pi, (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
                  d.name AS dept, COALESCE(i.name, il.free_text) AS item, il.quantity::text AS qty, u.code AS uom, pi.status AS pi_status, pi.route,
                  r.id::text AS pr_id, r.number AS pr, r.status AS pr_status, rl.fulfil,
                  (SELECT string_agg(po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END, ', ' ORDER BY po.number)
                     FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                    WHERE pol.requisition_line_id = rl.id AND ${LIVE_PO}) AS pos,
                  (SELECT string_agg(DISTINCT v.legal_name, ', ') FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                     JOIN vendors v ON v.id = po.vendor_id WHERE pol.requisition_line_id = rl.id AND ${LIVE_PO}) AS vendors,
                  (SELECT max(po.approved_at AT TIME ZONE 'Asia/Kolkata')::date::text FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                    WHERE pol.requisition_line_id = rl.id AND ${LIVE_PO}) AS po_day
             FROM purchase_indent_lines il
             JOIN purchase_indents pi ON pi.id = il.indent_id
             JOIN departments d ON d.id = pi.department_id
             JOIN purchase_uoms u ON u.id = il.uom_id
             LEFT JOIN purchase_items i ON i.id = il.item_id
             LEFT JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
             LEFT JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
             LEFT JOIN purchase_requisitions r ON r.id = rl.requisition_id
            WHERE pi.status <> 'draft'
              AND (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
              AND ($3::bigint IS NULL OR pi.department_id = $3) AND ($5::bigint IS NULL OR il.item_id = $5)
              AND ($6::text IS NULL OR pi.status = $6)
              AND ($4::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.order_id
                                                  WHERE pol.requisition_line_id = rl.id AND po.vendor_id = $4))
            ORDER BY day, pi.number, il.seq LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Indent', width: 2 },
            { label: 'Date', type: 'date' },
            { label: 'Department', width: 1.8 },
            { label: 'Item', width: 2.8 },
            { label: 'Quantity', width: 1.4 },
            { label: 'Indent status', width: 2 },
            { label: 'Requisition', width: 2 },
            { label: 'PR status', width: 1.6 },
            { label: 'Order', width: 2.2 },
            { label: 'Vendor', width: 2.4 },
            { label: 'Ordered', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.pi,
            x.day,
            x.dept,
            x.item,
            `${Number(x.qty).toLocaleString('en-IN')} ${x.uom}`,
            x.pi_status === 'approved' && x.route ? w(x.route) : w(x.pi_status),
            x.pr ?? '',
            x.fulfil === 'store' ? 'From the store' : w(x.pr_status),
            x.pos ?? '',
            x.vendors ?? '',
            x.po_day,
          ]),
          links: r.rows.map((x) => `/purchase/indents/${x.pi_id}`),
          sum: [],
        };
      }
      case 'pending': {
        const r = await c.query<{
          kind: string;
          id: string;
          label: string;
          dept: string | null;
          amount: string;
          level: string;
          approvers: string | null;
          delegates: string | null;
          since: Date;
          due: Date | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `WITH docs AS (
             SELECT 'Indent' AS kind, pi.id, pi.number AS label, pi.department_id, pi.estimate AS amount, pi.workflow_instance_id AS inst
               FROM purchase_indents pi WHERE pi.status = 'submitted'
             UNION ALL
             SELECT 'Requisition', r.id, r.number, r.department_id, r.estimate, r.workflow_instance_id FROM purchase_requisitions r WHERE r.status = 'submitted'
             UNION ALL
             SELECT CASE WHEN po.emergency THEN 'Emergency purchase' ELSE 'Order' END, po.id,
                    po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END, po.department_id, po.total, po.workflow_instance_id
               FROM purchase_orders po WHERE po.status = 'submitted')
           SELECT docs.kind, docs.id::text, docs.label, d.name AS dept, docs.amount::text, st.name AS level,
                  (SELECT string_agg(${PERSON('au')}, ', ') FROM users au WHERE au.id = ANY(st.assignee_user_ids)) AS approvers,
                  (SELECT string_agg(${PERSON('cu')}, ', ') FROM delegations dl JOIN users cu ON cu.id = dl.to_user_id
                    WHERE dl.from_user_id = ANY(st.assignee_user_ids) AND dl.revoked_at IS NULL AND now() BETWEEN dl.starts_at AND dl.ends_at) AS delegates,
                  COALESCE((SELECT max(s2.acted_at) FROM workflow_steps s2 WHERE s2.instance_id = i.id AND s2.level < st.level AND s2.acted_at IS NOT NULL),
                           i.created_at) AS since,
                  st.due_at AS due
             FROM docs
             JOIN workflow_instances i ON i.id = docs.inst AND i.status = 'pending'
             JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
             LEFT JOIN departments d ON d.id = docs.department_id
            WHERE ($1::bigint IS NULL OR docs.department_id = $1)
            ORDER BY since LIMIT $2`,
          [s.dept, limit + 1],
        );
        const now = Date.now();
        return {
          columns: [
            { label: 'Document', width: 1.8 },
            { label: 'Number', width: 2 },
            { label: 'Department', width: 2 },
            { label: 'Amount (₹)', type: 'money' },
            { label: 'Level', width: 1.8 },
            { label: 'Waiting with', width: 3 },
            { label: 'Their delegate', width: 2 },
            { label: 'Waiting since', type: 'date' },
            { label: 'Days', type: 'number', width: 1 },
            { label: 'Over the SLA', width: 1.2 },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.kind,
            x.label,
            x.dept,
            Number(x.amount),
            x.level,
            x.approvers ?? 'Nobody',
            x.delegates ?? '',
            new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(x.since),
            Math.floor((now - x.since.getTime()) / 86_400_000),
            x.due && x.due.getTime() < now ? 'Yes' : '',
          ]),
          links: r.rows.map((x) =>
            x.kind === 'Indent'
              ? `/purchase/indents/${x.id}`
              : x.kind === 'Requisition'
                ? `/purchase/requisitions/${x.id}`
                : `/purchase/orders/${x.id}`,
          ),
          sum: [3],
        };
      }
      case 'overrides':
        return this.overrides(c, s, limit);
      case 'department_spend': {
        const months: string[] = [];
        const start = new Date(`${s.from.slice(0, 7)}-01T00:00:00Z`);
        const end = s.to.slice(0, 7);
        for (let d = start; months.length < 12; d.setUTCMonth(d.getUTCMonth() + 1)) {
          const m = d.toISOString().slice(0, 7);
          if (m > end) break;
          months.push(m);
        }
        const r = await c.query<{ dept: string | null; month: string; total: string }>(
          // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
          `SELECT COALESCE(d.name, 'No department') AS dept, to_char(po.po_date, 'YYYY-MM') AS month, sum(po.total)::text AS total
             FROM purchase_orders po LEFT JOIN departments d ON d.id = po.department_id
            WHERE ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR po.vendor_id = $4)
            GROUP BY 1, 2 ORDER BY 1, 2`,
          [s.from, s.to, s.dept, s.vendor],
        );
        const depts = [...new Set(r.rows.map((x) => x.dept ?? ''))];
        const rows = depts.map((dpt) => {
          const vals = months.map((m) =>
            Number(r.rows.find((x) => x.dept === dpt && x.month === m)?.total ?? 0),
          );
          return [dpt, ...vals, vals.reduce((a, b) => a + b, 0)];
        });
        return {
          columns: [
            { label: 'Department', width: 2.4 },
            ...months.map(
              (m) =>
                ({
                  label: `${MONTHS[Number(m.slice(5, 7)) - 1]!} ${m.slice(2, 4)} (₹)`,
                  type: 'money',
                  width: 1.4,
                }) as FileColumn,
            ),
            { label: 'Total (₹)', type: 'money', width: 1.6 },
          ] as FileColumn[],
          rows,
          links: rows.map(() => null),
          sum: [...months.map((_, i) => i + 1), months.length + 1],
        };
      }
      case 'vendor_purchases': {
        const r = await c.query<{
          id: string;
          code: string;
          name: string;
          gst_status: string;
          msme: string | null;
          n: number;
          taxable: string;
          gst: string;
          total: string;
          last: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
          `SELECT v.id::text, v.code, v.legal_name AS name, v.gst_status, v.msme_type AS msme, count(po.id)::int AS n,
                  COALESCE(sum(po.taxable), 0)::text AS taxable, COALESCE(sum(po.cgst + po.sgst + po.igst), 0)::text AS gst,
                  COALESCE(sum(po.total), 0)::text AS total, max(po.po_date)::text AS last
             FROM vendors v JOIN purchase_orders po ON po.vendor_id = v.id
            WHERE ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR v.id = $4)
            GROUP BY v.id ORDER BY sum(po.total) DESC LIMIT $5`,
          [s.from, s.to, s.dept, s.vendor, limit + 1],
        );
        return {
          columns: [
            { label: 'Code', width: 1.2 },
            { label: 'Vendor', width: 3 },
            { label: 'GST', width: 1.4 },
            { label: 'MSME', width: 1 },
            { label: 'Orders', type: 'number', width: 1 },
            { label: 'Taxable (₹)', type: 'money' },
            { label: 'GST (₹)', type: 'money' },
            { label: 'Total (₹)', type: 'money' },
            { label: 'Last order', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.code,
            x.name,
            w(x.gst_status),
            x.msme ? x.msme[0]!.toUpperCase() + x.msme.slice(1) : '',
            x.n,
            Number(x.taxable),
            Number(x.gst),
            Number(x.total),
            x.last,
          ]),
          links: r.rows.map((x) => `/purchase/vendors/${x.id}`),
          sum: [4, 5, 6, 7],
        };
      }
      case 'item_history': {
        const r = await c.query<{
          id: string;
          day: string;
          item: string;
          label: string;
          vendor: string;
          qty: string;
          uom: string;
          rate: string;
          disc: string;
          gst: string;
          taxable: string;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
          `SELECT po.id::text, po.po_date::text AS day, COALESCE(i.name, l.description) AS item,
                  po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS label, v.legal_name AS vendor,
                  l.quantity::text AS qty, u.code AS uom, l.rate::text, l.discount_pct::text AS disc, l.gst_rate::text AS gst, l.taxable::text
             FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.order_id JOIN vendors v ON v.id = po.vendor_id
             JOIN purchase_uoms u ON u.id = l.uom_id LEFT JOIN purchase_items i ON i.id = l.item_id
            WHERE ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR po.vendor_id = $4) AND ($5::bigint IS NULL OR l.item_id = $5)
            ORDER BY item, po.po_date LIMIT $6`,
          [s.from, s.to, s.dept, s.vendor, s.item, limit + 1],
        );
        return {
          columns: [
            { label: 'Item', width: 2.8 },
            { label: 'Date', type: 'date' },
            { label: 'Order', width: 2 },
            { label: 'Vendor', width: 2.6 },
            { label: 'Quantity', type: 'number', width: 1.2 },
            { label: 'Unit', width: 0.9 },
            { label: 'Rate (₹)', type: 'money' },
            { label: 'Discount %', type: 'number', width: 1 },
            { label: 'Net rate (₹)', type: 'money' },
            { label: 'GST %', type: 'number', width: 0.9 },
            { label: 'Taxable (₹)', type: 'money' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.item,
            x.day,
            x.label,
            x.vendor,
            Number(x.qty),
            x.uom,
            Number(x.rate),
            Number(x.disc),
            Math.round(Number(x.rate) * (1 - Number(x.disc) / 100) * 100) / 100,
            Number(x.gst),
            Number(x.taxable),
          ]),
          links: r.rows.map((x) => `/purchase/orders/${x.id}`),
          sum: [10],
        };
      }
      case 'comparative': {
        const r = await c.query<{
          id: string;
          number: string;
          day: string;
          item: string;
          qty: string;
          vendor: string;
          rate: string;
          gst: string;
          chosen: boolean;
          reason: string | null;
          signed: number;
          l1: string;
        }>(
          `SELECT r.id::text, r.number, (COALESCE(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
                  COALESCE(i.name, rl.free_text) AS item, rl.quantity::text AS qty, v.legal_name AS vendor, ql.rate::text, ql.gst_rate::text AS gst,
                  rl.vendor_id = q.vendor_id AS chosen, CASE WHEN rl.vendor_id = q.vendor_id THEN rl.choice_reason END AS reason,
                  (SELECT count(*)::int FROM purchase_cs_signoffs so WHERE so.requisition_id = r.id) AS signed,
                  (SELECT min(round(ql2.rate * (1 + ql2.gst_rate / 100), 2)) FROM purchase_quote_lines ql2 WHERE ql2.requisition_line_id = rl.id)::text AS l1
             FROM purchase_quote_lines ql
             JOIN purchase_quotes q ON q.id = ql.quote_id
             JOIN purchase_requisition_lines rl ON rl.id = ql.requisition_line_id
             JOIN purchase_requisitions r ON r.id = rl.requisition_id
             JOIN vendors v ON v.id = q.vendor_id
             LEFT JOIN purchase_items i ON i.id = rl.item_id
            WHERE (COALESCE(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
              AND ($3::bigint IS NULL OR r.department_id = $3) AND ($4::bigint IS NULL OR q.vendor_id = $4)
              AND ($5::bigint IS NULL OR rl.item_id = $5)
            ORDER BY r.number, rl.seq, round(ql.rate * (1 + ql.gst_rate / 100), 2) LIMIT $6`,
          [s.from, s.to, s.dept, s.vendor, s.item, limit + 1],
        );
        return {
          columns: [
            { label: 'Requisition', width: 2 },
            { label: 'Date', type: 'date' },
            { label: 'Item', width: 2.6 },
            { label: 'Quantity', type: 'number', width: 1 },
            { label: 'Vendor', width: 2.6 },
            { label: 'Rate (₹)', type: 'money' },
            { label: 'GST %', type: 'number', width: 0.9 },
            { label: 'With GST (₹)', type: 'money' },
            { label: 'L1', width: 0.7 },
            { label: 'Chosen', width: 0.9 },
            { label: 'Reason', width: 3 },
            { label: 'Signatures', type: 'number', width: 1 },
          ] as FileColumn[],
          rows: r.rows.map((x) => {
            const landed = Math.round(Number(x.rate) * (1 + Number(x.gst) / 100) * 100) / 100;
            return [
              x.number,
              x.day,
              x.item,
              Number(x.qty),
              x.vendor,
              Number(x.rate),
              Number(x.gst),
              landed,
              Math.abs(landed - Number(x.l1)) < 0.005 ? 'L1' : '',
              x.chosen ? 'Yes' : '',
              x.reason ?? '',
              x.signed,
            ];
          }),
          links: r.rows.map((x) => `/purchase/requisitions/${x.id}`),
          sum: [],
        };
      }
      case 'gst_summary': {
        const r = await c.query<{
          hsn: string | null;
          gst: string;
          rcm: boolean;
          taxable: string;
          cgst: string;
          sgst: string;
          igst: string;
          rcm_gst: string;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
          `SELECT hsn, gst::text, rcm, sum(taxable)::text AS taxable, sum(cgst)::text AS cgst, sum(sgst)::text AS sgst, sum(igst)::text AS igst,
                  sum(rcm_gst)::text AS rcm_gst
             FROM (SELECT l.hsn_code AS hsn, l.gst_rate AS gst, l.reverse_charge AS rcm, l.taxable, l.cgst, l.sgst, l.igst, l.rcm_gst
                     FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.order_id
                    WHERE ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
                      AND ($4::bigint IS NULL OR po.vendor_id = $4)
                   UNION ALL
                   SELECT 'charges', ch.gst_rate, false, ch.amount, ch.cgst, ch.sgst, ch.igst, 0
                     FROM purchase_order_charges ch JOIN purchase_orders po ON po.id = ch.order_id
                    WHERE ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
                      AND ($4::bigint IS NULL OR po.vendor_id = $4)) x
            GROUP BY hsn, gst, rcm ORDER BY hsn = 'charges', hsn NULLS LAST, gst`,
          [s.from, s.to, s.dept, s.vendor],
        );
        return {
          columns: [
            { label: 'HSN / SAC', width: 1.6 },
            { label: 'GST %', type: 'number', width: 1 },
            { label: 'Reverse charge', width: 1.4 },
            { label: 'Taxable (₹)', type: 'money' },
            { label: 'CGST (₹)', type: 'money' },
            { label: 'SGST (₹)', type: 'money' },
            { label: 'IGST (₹)', type: 'money' },
            { label: 'Paid by the school (₹)', type: 'money', width: 1.8 },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.hsn === 'charges' ? 'Other charges' : (x.hsn ?? 'No HSN / SAC'),
            Number(x.gst),
            x.rcm ? 'Yes' : '',
            Number(x.taxable),
            Number(x.cgst),
            Number(x.sgst),
            Number(x.igst),
            Number(x.rcm_gst),
          ]),
          links: r.rows.map(() => null),
          sum: [3, 4, 5, 6, 7],
        };
      }
      case 'grn_register': {
        const r = await c.query<{
          id: string;
          number: string;
          kind: string;
          day: string;
          po: string;
          vendor: string;
          dept: string | null;
          store: string | null;
          papers: string | null;
          value: string;
          status: string;
          accepted_on: string | null;
          deemed: string;
        }>(
          `SELECT g.id::text, g.number, g.kind, g.received_on::text AS day,
                  po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS po, v.legal_name AS vendor,
                  d.name AS dept, st.name AS store, NULLIF(concat_ws(' · ', g.challan_no, g.invoice_no), '') AS papers,
                  COALESCE((SELECT sum(round(gl.accepted_qty * gl.unit_cost, 2)) FROM goods_receipt_lines gl WHERE gl.receipt_id = g.id), 0)::text AS value,
                  g.status, g.accepted_on::text, (g.received_on + 15)::text AS deemed
             FROM goods_receipts g JOIN purchase_orders po ON po.id = g.order_id JOIN vendors v ON v.id = po.vendor_id
             LEFT JOIN departments d ON d.id = po.department_id LEFT JOIN stores st ON st.id = g.store_id
            WHERE g.received_on BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR po.vendor_id = $4)
              AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM goods_receipt_lines gl JOIN purchase_order_lines ol ON ol.id = gl.order_line_id
                                                  WHERE gl.receipt_id = g.id AND ol.item_id = $5))
              AND ($6::text IS NULL OR g.status = $6 OR g.kind = $6)
            ORDER BY g.received_on, g.number LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Receipt', width: 2.2 },
            { label: 'Kind', width: 1.8 },
            { label: 'Received', type: 'date' },
            { label: 'Order', width: 2.2 },
            { label: 'Vendor', width: 2.6 },
            { label: 'Department', width: 2 },
            { label: 'Store', width: 1.6 },
            { label: 'Challan / invoice', width: 2 },
            { label: 'Accepted value (₹)', type: 'money' },
            { label: 'Status', width: 1.8 },
            { label: 'Accepted on', type: 'date' },
            { label: 'Deemed accepted', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number,
            w(x.kind),
            x.day,
            x.po,
            x.vendor,
            x.dept,
            x.store,
            x.papers,
            Math.round(Number(x.value) * 100) / 100,
            w(x.status),
            x.accepted_on,
            x.status === 'inspecting' ? x.deemed : null,
          ]),
          links: r.rows.map((x) => `/purchase/receipts/${x.id}`),
          sum: [8],
        };
      }
      case 'pending_deliveries': {
        // what placed orders still wait for (PO date in the period), latest delivery date first
        const r = await c.query<{
          id: string;
          po: string;
          vendor: string;
          dept: string | null;
          item: string;
          uom: string;
          ordered: string;
          received: string;
          accepted: string;
          rejected: string;
          returned: string;
          due: string | null;
          late: number | null;
        }>(
          `SELECT po.id::text, po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS po, v.legal_name AS vendor,
                  d.name AS dept, l.description AS item, u.code AS uom, l.quantity::text AS ordered, l.received_qty::text AS received,
                  l.accepted_qty::text AS accepted, l.rejected_qty::text AS rejected, l.returned_qty::text AS returned,
                  po.delivery_date::text AS due,
                  CASE WHEN po.delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
                       THEN ((now() AT TIME ZONE 'Asia/Kolkata')::date - po.delivery_date) END AS late
             FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.order_id JOIN vendors v ON v.id = po.vendor_id
             JOIN purchase_uoms u ON u.id = l.uom_id LEFT JOIN departments d ON d.id = po.department_id
            WHERE po.status IN ('approved', 'sent') AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity
              AND NOT EXISTS (SELECT 1 FROM purchase_orders n WHERE n.supersedes_id = po.id AND n.status NOT IN ('rejected', 'cancelled'))
              AND po.po_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR po.department_id = $3)
              AND ($4::bigint IS NULL OR po.vendor_id = $4) AND ($5::bigint IS NULL OR l.item_id = $5)
              AND ($6::text IS NULL OR ($6 = 'late' AND po.delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date))
            ORDER BY po.delivery_date NULLS LAST, po.number, l.seq LIMIT $7`,
          [...P, limit + 1],
        );
        return {
          columns: [
            { label: 'Order', width: 2.2 },
            { label: 'Vendor', width: 2.6 },
            { label: 'Department', width: 2 },
            { label: 'Item', width: 3 },
            { label: 'Unit', width: 1 },
            { label: 'Ordered', type: 'number' },
            { label: 'Received', type: 'number' },
            { label: 'Accepted', type: 'number' },
            { label: 'Rejected', type: 'number' },
            { label: 'Still to come', type: 'number' },
            { label: 'Deliver by', type: 'date' },
            { label: 'Days late', type: 'number' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.po,
            x.vendor,
            x.dept,
            x.item,
            x.uom,
            Number(x.ordered),
            Number(x.received),
            Number(x.accepted),
            Number(x.rejected),
            Math.round(
              (Number(x.ordered) - Number(x.received) + Number(x.rejected) + Number(x.returned)) *
                1000,
            ) / 1000,
            x.due,
            x.late,
          ]),
          links: r.rows.map((x) => `/purchase/orders/${x.id}`),
          sum: [],
        };
      }
      case 'consumption': {
        const r = await c.query<{
          dept: string;
          item: string;
          code: string;
          unit: string;
          issues: number;
          qty: string;
          value: string;
        }>(
          `SELECT d.name AS dept, i.name AS item, i.code, COALESCE(su.code, u.code) AS unit, count(DISTINCT si.id)::int AS issues,
                  sum(l.qty - l.returned_qty)::text AS qty,
                  sum(l.value - round(l.returned_qty * l.rate, 2))::text AS value
             FROM stock_issue_lines l JOIN stock_issues si ON si.id = l.issue_id JOIN departments d ON d.id = si.department_id
             JOIN purchase_items i ON i.id = l.item_id JOIN purchase_uoms u ON u.id = i.uom_id
             LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
            WHERE si.issued_on BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR si.department_id = $3)
              AND ($4::bigint IS NULL OR l.item_id = $4)
            GROUP BY d.name, i.name, i.code, su.code, u.code ORDER BY d.name, sum(l.value) DESC LIMIT $5`,
          [s.from, s.to, s.dept, s.item, limit + 1],
        );
        return {
          columns: [
            { label: 'Department', width: 2.4 },
            { label: 'Item', width: 3 },
            { label: 'Unit', width: 1 },
            { label: 'Issues', type: 'number', width: 1 },
            { label: 'Quantity (net of returns)', type: 'number' },
            { label: 'Value (₹)', type: 'money' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.dept,
            `${x.item} (${x.code})`,
            x.unit,
            x.issues,
            Number(x.qty),
            Math.round(Number(x.value) * 100) / 100,
          ]),
          sum: [5],
        };
      }
      case 'slow_moving': {
        const days = /^n\d{2,3}$/.test(s.status ?? '') ? Number(s.status!.slice(1)) : 180;
        const r = await c.query<{
          item_id: string;
          store: string;
          item: string;
          code: string;
          unit: string;
          qty: string;
          value: string;
          last_issue: string | null;
          last_in: string | null;
          idle: number | null;
        }>(
          `SELECT b.item_id::text, st.name AS store, i.name AS item, i.code, COALESCE(su.code, u.code) AS unit, b.qty::text, b.value::text,
                  li.last_issue::text, (SELECT max(m.moved_on) FROM stock_moves m WHERE m.store_id = b.store_id AND m.item_id = b.item_id AND m.qty > 0)::text AS last_in,
                  ((now() AT TIME ZONE 'Asia/Kolkata')::date - COALESCE(li.last_issue,
                     (SELECT min(m.moved_on) FROM stock_moves m WHERE m.store_id = b.store_id AND m.item_id = b.item_id))) AS idle
             FROM stock_balances b JOIN stores st ON st.id = b.store_id JOIN purchase_items i ON i.id = b.item_id
             JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
             LEFT JOIN LATERAL (SELECT max(m.moved_on) AS last_issue FROM stock_moves m
                                 WHERE m.store_id = b.store_id AND m.item_id = b.item_id AND m.kind IN ('issue', 'transfer_out')) li ON true
            WHERE b.qty > 0 AND ($1::bigint IS NULL OR b.item_id = $1)
              AND COALESCE(li.last_issue, '1900-01-01'::date) < (now() AT TIME ZONE 'Asia/Kolkata')::date - $2::int
            ORDER BY b.value DESC LIMIT $3`,
          [s.item, days, limit + 1],
        );
        return {
          columns: [
            { label: 'Store', width: 1.8 },
            { label: 'Item', width: 3 },
            { label: 'Unit', width: 1 },
            { label: 'In hand', type: 'number' },
            { label: 'Value (₹)', type: 'money' },
            { label: 'Last issued', type: 'date' },
            { label: 'Days without an issue', type: 'number' },
            { label: 'Last received', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.store,
            `${x.item} (${x.code})`,
            x.unit,
            Number(x.qty),
            Number(x.value),
            x.last_issue,
            x.idle,
            x.last_in,
          ]),
          links: r.rows.map((x) => `/purchase/stock/${x.item_id}`),
          sum: [4],
        };
      }
      case 'expiring': {
        const expired = s.status === 'expired';
        const days = /^d\d{1,3}$/.test(s.status ?? '') ? Number(s.status!.slice(1)) : 90;
        const r = await c.query<{
          item_id: string;
          store: string;
          item: string;
          code: string;
          unit: string;
          batch: string;
          expiry: string;
          left: number;
          qty: string;
          value: string;
        }>(
          `SELECT sb.item_id::text, st.name AS store, i.name AS item, i.code, COALESCE(su.code, u.code) AS unit, sb.batch_no AS batch,
                  sb.expiry::text, (sb.expiry - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS left, sb.qty_left::text AS qty,
                  round(sb.qty_left * COALESCE(b.avg_rate, 0), 2)::text AS value
             FROM stock_batches sb JOIN stores st ON st.id = sb.store_id JOIN purchase_items i ON i.id = sb.item_id
             JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
             LEFT JOIN stock_balances b ON b.store_id = sb.store_id AND b.item_id = sb.item_id
            WHERE sb.qty_left > 0 AND sb.expiry IS NOT NULL AND ($1::bigint IS NULL OR sb.item_id = $1)
              AND sb.expiry <= (now() AT TIME ZONE 'Asia/Kolkata')::date + $2::int
              AND (NOT $3 OR sb.expiry < (now() AT TIME ZONE 'Asia/Kolkata')::date)
            ORDER BY sb.expiry, st.name LIMIT $4`,
          [s.item, expired ? 0 : days, expired, limit + 1],
        );
        return {
          columns: [
            { label: 'Store', width: 1.8 },
            { label: 'Item', width: 3 },
            { label: 'Batch', width: 1.4 },
            { label: 'Expiry', type: 'date' },
            { label: 'Days left', type: 'number' },
            { label: 'Quantity', type: 'number' },
            { label: 'Unit', width: 1 },
            { label: 'Value (₹)', type: 'money' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.store,
            `${x.item} (${x.code})`,
            x.batch,
            x.expiry,
            x.left,
            Number(x.qty),
            x.unit,
            Number(x.value),
          ]),
          links: r.rows.map((x) => `/purchase/stock/${x.item_id}`),
          sum: [7],
        };
      }
      case 'below_reorder': {
        const r = await c.query<{
          item_id: string;
          store: string;
          item: string;
          code: string;
          unit: string;
          qty: string;
          reserved: string;
          level: string;
          reorder: string | null;
          on_order: string;
        }>(
          `SELECT l.item_id::text, st.name AS store, i.name AS item, i.code, COALESCE(su.code, u.code) AS unit,
                  COALESCE(b.qty, 0)::text AS qty, COALESCE(b.reserved, 0)::text AS reserved, l.reorder_level::text AS level,
                  l.reorder_qty::text AS reorder,
                  COALESCE((SELECT sum((ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty) * i.stock_per_unit)
                              FROM purchase_order_lines ol JOIN purchase_orders po ON po.id = ol.order_id
                             WHERE ol.item_id = l.item_id AND po.status IN ('approved', 'sent')), 0)::text AS on_order
             FROM item_store_levels l JOIN stores st ON st.id = l.store_id JOIN purchase_items i ON i.id = l.item_id
             JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
             LEFT JOIN stock_balances b ON b.store_id = l.store_id AND b.item_id = l.item_id
            WHERE l.reorder_level > 0 AND COALESCE(b.qty, 0) - COALESCE(b.reserved, 0) <= l.reorder_level
              AND ($1::bigint IS NULL OR l.item_id = $1)
            ORDER BY st.name, i.name LIMIT $2`,
          [s.item, limit + 1],
        );
        return {
          columns: [
            { label: 'Store', width: 1.8 },
            { label: 'Item', width: 3 },
            { label: 'Unit', width: 1 },
            { label: 'In hand', type: 'number' },
            { label: 'Reserved', type: 'number' },
            { label: 'Free', type: 'number' },
            { label: 'Reorder level', type: 'number' },
            { label: 'Reorder quantity', type: 'number' },
            { label: 'On order', type: 'number' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.store,
            `${x.item} (${x.code})`,
            x.unit,
            Number(x.qty),
            Number(x.reserved),
            Math.round((Number(x.qty) - Number(x.reserved)) * 1000) / 1000,
            Number(x.level),
            x.reorder === null ? null : Number(x.reorder),
            Number(x.on_order),
          ]),
          links: r.rows.map((x) => `/purchase/stock/${x.item_id}`),
          sum: [],
        };
      }
      case 'transfers': {
        const r = await c.query<{
          id: string;
          number: string;
          sent: string;
          from_store: string;
          to_store: string;
          lines: number;
          value: string;
          status: string;
          received: string | null;
        }>(
          `SELECT t.id::text, t.number, t.sent_on::text AS sent, fs.name AS from_store, ts.name AS to_store,
                  (SELECT count(*)::int FROM stock_transfer_lines l WHERE l.transfer_id = t.id) AS lines,
                  COALESCE((SELECT sum(l.value) FROM stock_transfer_lines l WHERE l.transfer_id = t.id), 0)::text AS value,
                  t.status, t.received_on::text AS received
             FROM stock_transfers t JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
            WHERE t.sent_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR t.status = $3)
            ORDER BY t.sent_on, t.number LIMIT $4`,
          [s.from, s.to, s.status, limit + 1],
        );
        return {
          columns: [
            { label: 'Transfer', width: 2.2 },
            { label: 'Sent', type: 'date' },
            { label: 'From', width: 1.8 },
            { label: 'To', width: 1.8 },
            { label: 'Lines', type: 'number', width: 1 },
            { label: 'Value (₹)', type: 'money' },
            { label: 'Status', width: 1.4 },
            { label: 'Received', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number,
            x.sent,
            x.from_store,
            x.to_store,
            x.lines,
            Number(x.value),
            w(x.status),
            x.received,
          ]),
          links: r.rows.map((x) => `/purchase/transfers/${x.id}`),
          sum: [5],
        };
      }
      case 'count_differences': {
        const r = await c.query<{
          id: string;
          number: string;
          day: string;
          store: string;
          item: string;
          code: string;
          batch: string | null;
          book: string;
          counted: string;
          value: string | null;
          reason: string | null;
        }>(
          `SELECT k.id::text, k.number, k.counted_on::text AS day, st.name AS store, i.name AS item, i.code, l.batch_no AS batch,
                  l.book_qty::text AS book, l.counted_qty::text AS counted, l.value::text, l.reason
             FROM stock_count_lines l JOIN stock_counts k ON k.id = l.count_id AND k.status = 'approved'
             JOIN stores st ON st.id = k.store_id JOIN purchase_items i ON i.id = l.item_id
            WHERE l.counted_qty <> l.book_qty AND k.counted_on BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR l.item_id = $3)
            ORDER BY k.counted_on, k.number, i.name LIMIT $4`,
          [s.from, s.to, s.item, limit + 1],
        );
        return {
          columns: [
            { label: 'Count', width: 2.2 },
            { label: 'Counted on', type: 'date' },
            { label: 'Store', width: 1.8 },
            { label: 'Item', width: 3 },
            { label: 'Batch', width: 1.2 },
            { label: 'Book', type: 'number' },
            { label: 'Counted', type: 'number' },
            { label: 'Difference', type: 'number' },
            { label: 'Value (₹)', type: 'money' },
            { label: 'Reason', width: 3 },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number,
            x.day,
            x.store,
            `${x.item} (${x.code})`,
            x.batch,
            Number(x.book),
            Number(x.counted),
            Math.round((Number(x.counted) - Number(x.book)) * 1000) / 1000,
            x.value === null ? null : Number(x.value),
            x.reason,
          ]),
          links: r.rows.map((x) => `/purchase/counts/${x.id}`),
          sum: [8],
        };
      }
      case 'asset_register': {
        const r = await c.query<{
          id: string;
          tag: string;
          item: string;
          category: string;
          make: string | null;
          serial: string | null;
          acquired: string | null;
          cost: string;
          book: string;
          status: string;
          place: string | null;
          custodian: string | null;
          warranty: string | null;
        }>(
          `SELECT a.id::text, a.tag, i.name AS item, cat.name AS category, NULLIF(concat_ws(' ', a.make, a.model), '') AS make,
                  a.serial_no AS serial, a.acquired_on::text AS acquired, a.cost::text,
                  COALESCE((SELECT d.closing FROM asset_depreciation d WHERE d.asset_id = a.id ORDER BY d.fy DESC LIMIT 1), a.cost)::text AS book,
                  a.status, NULLIF(concat_ws(' · ', COALESCE(st.name, d.name), a.location), '') AS place, ce.display_name AS custodian,
                  a.warranty_until::text AS warranty
             FROM assets a JOIN purchase_items i ON i.id = a.item_id JOIN purchase_item_categories cat ON cat.id = i.category_id
             LEFT JOIN stores st ON st.id = a.store_id LEFT JOIN departments d ON d.id = a.department_id
             LEFT JOIN employees ce ON ce.id = a.custodian_employee_id
            WHERE ($1::bigint IS NULL OR a.department_id = $1) AND ($2::bigint IS NULL OR a.item_id = $2)
              AND ($3::text IS NULL OR a.status = $3 OR ($3 = 'held' AND a.status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost')))
            ORDER BY cat.name, a.tag LIMIT $4`,
          [s.dept, s.item, s.status, limit + 1],
        );
        return {
          columns: [
            { label: 'Tag', width: 2 },
            { label: 'Item', width: 2.6 },
            { label: 'Category', width: 1.8 },
            { label: 'Make / model', width: 2 },
            { label: 'Serial', width: 1.6 },
            { label: 'Acquired', type: 'date' },
            { label: 'Cost (₹)', type: 'money' },
            { label: 'Book value (₹)', type: 'money' },
            { label: 'Status', width: 1.4 },
            { label: 'Where', width: 2.2 },
            { label: 'Custodian', width: 2 },
            { label: 'Warranty until', type: 'date' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.tag,
            x.item,
            x.category,
            x.make,
            x.serial,
            x.acquired,
            Number(x.cost),
            Number(x.book),
            w(x.status),
            x.place,
            x.custodian,
            x.warranty,
          ]),
          links: r.rows.map((x) => `/purchase/assets/${x.id}`),
          sum: [6, 7],
        };
      }
      case 'fixed_assets': {
        // the financial year of the period's end: opening, additions, depreciation, disposals, closing
        const fy = fyStart(s.to);
        const fyEnd = `${String(Number(fy.slice(0, 4)) + 1)}-03-31`;
        const fyCode = `${fy.slice(0, 4)}-${String(Number(fy.slice(0, 4)) + 1).slice(2)}`;
        const prevCode = `${String(Number(fy.slice(0, 4)) - 1)}-${fy.slice(2, 4)}`;
        const r = await c.query<{
          category: string;
          opening: string;
          additions: string;
          depreciation: string;
          disposals: string;
          assets: number;
        }>(
          `WITH a AS (
             SELECT a.id, cat.name AS category, a.cost, COALESCE(a.acquired_on, a.put_to_use_on, (a.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS acq,
                    a.left_on, a.book_value_at_exit,
                    COALESCE((SELECT d.closing FROM asset_depreciation d WHERE d.asset_id = a.id AND d.fy = $3), a.cost) AS opening_book,
                    COALESCE((SELECT d.depreciation FROM asset_depreciation d WHERE d.asset_id = a.id AND d.fy = $4), 0) AS dep
               FROM assets a JOIN purchase_items i ON i.id = a.item_id JOIN purchase_item_categories cat ON cat.id = i.category_id
              WHERE a.status <> 'returned')
           SELECT category,
                  COALESCE(sum(opening_book) FILTER (WHERE acq < $1::date AND (left_on IS NULL OR left_on >= $1::date)), 0)::text AS opening,
                  COALESCE(sum(cost) FILTER (WHERE acq BETWEEN $1::date AND $2::date), 0)::text AS additions,
                  COALESCE(sum(dep), 0)::text AS depreciation,
                  COALESCE(sum(book_value_at_exit) FILTER (WHERE left_on BETWEEN $1::date AND $2::date), 0)::text AS disposals,
                  count(*) FILTER (WHERE acq <= $2::date AND (left_on IS NULL OR left_on > $2::date))::int AS assets
             FROM a WHERE acq <= $2::date AND (left_on IS NULL OR left_on >= $1::date)
            GROUP BY category ORDER BY category LIMIT $5`,
          [fy, fyEnd, prevCode, fyCode, limit + 1],
        );
        return {
          columns: [
            { label: `Category (${fyCode})`, width: 2.6 },
            { label: 'Opening (₹)', type: 'money' },
            { label: 'Additions (₹)', type: 'money' },
            { label: 'Depreciation (₹)', type: 'money' },
            { label: 'Disposals (₹)', type: 'money' },
            { label: 'Closing (₹)', type: 'money' },
            { label: 'Assets at the end', type: 'number', width: 1 },
          ] as FileColumn[],
          rows: r.rows.map((x) => {
            const o = Number(x.opening);
            const ad = Number(x.additions);
            const dp = Number(x.depreciation);
            const ds = Number(x.disposals);
            return [
              x.category,
              o,
              ad,
              dp,
              ds,
              Math.round((o + ad - dp - ds) * 100) / 100,
              x.assets,
            ];
          }),
          sum: [1, 2, 3, 4, 5, 6],
        };
      }
      case 'condemnations': {
        const r = await c.query<{
          id: string;
          number: string;
          title: string;
          status: string;
          created: string;
          lines: number;
          value: string;
          written_off: string | null;
          method: string | null;
          disposed: string | null;
          amount: string | null;
          party: string | null;
        }>(
          `SELECT k.id::text, k.number, k.title, k.status, (k.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created,
                  (SELECT count(*)::int FROM condemnation_lines l WHERE l.condemnation_id = k.id) AS lines,
                  COALESCE((SELECT sum(l.book_value) FROM condemnation_lines l WHERE l.condemnation_id = k.id), 0)::text AS value,
                  k.written_off_on::text AS written_off, dp.method, dp.disposed_on::text AS disposed, dp.amount::text, dp.party
             FROM condemnations k LEFT JOIN disposals dp ON dp.condemnation_id = k.id
            WHERE (k.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR k.status = $3)
            ORDER BY k.created_at LIMIT $4`,
          [s.from, s.to, s.status, limit + 1],
        );
        return {
          columns: [
            { label: 'Condemnation', width: 2.2 },
            { label: 'Proposal', width: 3 },
            { label: 'Proposed', type: 'date' },
            { label: 'Lines', type: 'number', width: 1 },
            { label: 'Book value (₹)', type: 'money' },
            { label: 'Status', width: 1.6 },
            { label: 'Written off', type: 'date' },
            { label: 'Disposed', type: 'date' },
            { label: 'How', width: 1.6 },
            { label: 'To', width: 2 },
            { label: 'Realised (₹)', type: 'money' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.number,
            x.title,
            x.created,
            x.lines,
            Number(x.value),
            w(x.status),
            x.written_off,
            x.disposed,
            x.method,
            x.party,
            x.amount === null ? null : Number(x.amount),
          ]),
          links: r.rows.map((x) => `/purchase/condemnations/${x.id}`),
          sum: [4, 10],
        };
      }
      case 'msme_vendors': {
        const r = await c.query<{
          id: string;
          code: string;
          name: string;
          msme: string;
          udyam: string | null;
          term: string | null;
          longest: number | null;
          status: string;
          n: number;
          total: string;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
          `SELECT v.id::text, v.code, v.legal_name AS name, v.msme_type AS msme, v.udyam_no AS udyam, t.name AS term,
                  (SELECT max(CASE WHEN l.due_on = 'advance' THEN 0 ELSE l.days END) FROM purchase_payment_term_lines l WHERE l.term_id = t.id) AS longest,
                  v.status,
                  (SELECT count(*)::int FROM purchase_orders po WHERE po.vendor_id = v.id AND ${PLACED} AND po.po_date BETWEEN $1::date AND $2::date) AS n,
                  (SELECT COALESCE(sum(po.total), 0) FROM purchase_orders po WHERE po.vendor_id = v.id AND ${PLACED}
                     AND po.po_date BETWEEN $1::date AND $2::date)::text AS total
             FROM vendors v LEFT JOIN purchase_payment_terms t ON t.id = v.payment_term_id
            WHERE v.msme_type IS NOT NULL AND ($3::bigint IS NULL OR v.id = $3)
            ORDER BY v.msme_type, v.legal_name LIMIT $4`,
          [s.from, s.to, s.vendor, limit + 1],
        );
        return {
          columns: [
            { label: 'Code', width: 1.2 },
            { label: 'Vendor', width: 3 },
            { label: 'MSME', width: 1 },
            { label: 'Udyam no.', width: 2.2 },
            { label: 'Payment term', width: 2 },
            { label: 'Longest days', type: 'number', width: 1.2 },
            { label: 'Over 45 days', width: 1.2 },
            { label: 'Status', width: 1.2 },
            { label: 'Orders', type: 'number', width: 1 },
            { label: 'Ordered (₹)', type: 'money' },
          ] as FileColumn[],
          rows: r.rows.map((x) => [
            x.code,
            x.name,
            x.msme[0]!.toUpperCase() + x.msme.slice(1),
            x.udyam ?? '',
            x.term ?? '',
            x.longest ?? 0,
            (x.msme === 'micro' || x.msme === 'small') && (x.longest ?? 0) > 45 ? 'Yes' : '',
            x.status,
            x.n,
            Number(x.total),
          ]),
          links: r.rows.map((x) => `/purchase/vendors/${x.id}`),
          sum: [8, 9],
        };
      }
    }
  }

  /** The overrides an auditor asks about, newest first. */
  private async overrides(c: PoolClient, s: Scope, limit: number) {
    const r = await c.query<{
      kind: string;
      href: string;
      label: string | null;
      day: string | null;
      dept: string | null;
      detail: string | null;
      amount: string | null;
    }>(
      `SELECT x.kind, x.href, x.label, x.day::text, d.name AS dept, x.detail, x.amount::text FROM (
         SELECT CASE pi.bypass_rule WHEN 'rate_contract' THEN 'PR skipped: rate contract' ELSE 'PR skipped: under the limit' END AS kind,
                '/purchase/indents/' || pi.id AS href, pi.number AS label, (pi.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                pi.department_id AS dept_id, pi.bypass_note AS detail, pi.estimate AS amount
           FROM purchase_indents pi WHERE pi.bypass_rule IS NOT NULL
         UNION ALL
         SELECT 'Split guard: PR not skipped', '/purchase/indents/' || pi.id, pi.number, (pi.decided_at AT TIME ZONE 'Asia/Kolkata')::date,
                pi.department_id, pi.bypass_note, pi.estimate
           FROM purchase_indents pi WHERE pi.bypass_note LIKE 'Not skipped:%'
         UNION ALL
         SELECT 'Vendor not the lowest (L1)', '/purchase/requisitions/' || r.id, r.number,
                (COALESCE(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kolkata')::date, r.department_id,
                COALESCE(i.name, rl.free_text) || ': ' || v.legal_name || ' — ' || rl.choice_reason, rl.quantity * rl.rate
           FROM purchase_requisition_lines rl JOIN purchase_requisitions r ON r.id = rl.requisition_id
           LEFT JOIN purchase_items i ON i.id = rl.item_id LEFT JOIN vendors v ON v.id = rl.vendor_id
          WHERE rl.choice_reason IS NOT NULL AND r.status NOT IN ('draft', 'sourcing', 'cancelled')
         UNION ALL
         SELECT 'Emergency purchase', '/purchase/orders/' || po.id, po.number, po.po_date, po.department_id,
                po.emergency_reason || ' (' || CASE po.status WHEN 'approved' THEN 'ratified' WHEN 'closed' THEN 'ratified' WHEN 'rejected' THEN 'not ratified'
                                                   WHEN 'submitted' THEN 'waiting for ratification' ELSE 'not yet sent for ratification' END || ')',
                po.total
           FROM purchase_orders po WHERE po.emergency AND po.status <> 'cancelled'
         UNION ALL
         SELECT 'Order cancelled after approval', '/purchase/orders/' || po.id,
                po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END,
                (po.updated_at AT TIME ZONE 'Asia/Kolkata')::date, po.department_id, po.decision_note, po.total
           FROM purchase_orders po WHERE po.status = 'cancelled' AND po.approved_at IS NOT NULL
         UNION ALL
         SELECT 'Order amended', '/purchase/orders/' || po.id, po.number || '-R' || po.revision, (po.created_at AT TIME ZONE 'Asia/Kolkata')::date,
                po.department_id, po.amend_reason, po.total
           FROM purchase_orders po WHERE po.revision > 0 AND po.status <> 'cancelled'
         UNION ALL
         SELECT 'Contract rate changed', '/purchase/orders/' || po.id,
                po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END, po.po_date, po.department_id,
                l.description || ': ' || l.rate::text || ' for the contract''s ' || rc.rate::text || ' — ' || l.rate_change_reason, l.quantity * l.rate
           FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.order_id JOIN purchase_rate_contracts rc ON rc.id = l.contract_id
          WHERE l.rate_change_reason IS NOT NULL AND po.status NOT IN ('cancelled', 'rejected', 'superseded')
       ) x
       LEFT JOIN departments d ON d.id = x.dept_id
       WHERE x.day BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR x.dept_id = $3) AND ($4::text IS NULL OR x.kind = $4)
       ORDER BY x.day DESC, x.label LIMIT $5`,
      [s.from, s.to, s.dept, s.status ? (OVERRIDE_KINDS[s.status] ?? '-') : null, limit + 1],
    );
    return {
      columns: [
        { label: 'Override', width: 2.6 },
        { label: 'Document', width: 2 },
        { label: 'Date', type: 'date' },
        { label: 'Department', width: 2 },
        { label: 'What', width: 5 },
        { label: 'Amount (₹)', type: 'money' },
      ] as FileColumn[],
      rows: r.rows.map((x) => [x.kind, x.label, x.day, x.dept, x.detail, Number(x.amount ?? 0)]),
      links: r.rows.map((x) => x.href),
      sum: [] as number[],
    };
  }

  /** A report on screen (the first 500 rows) or as a file (all of them). */
  async report(ctx: RequestContext, report: PurchaseReport, q: ReportQueryDto) {
    if (!(report in REPORT_NAMES))
      throw new DomainError('not-found', 'No such report', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = this.scope(q);
      const limit = q.format ? 20000 : 500;
      const b = await this.build(c, report, s, limit);
      const more = b.rows.length > limit ? 1 : 0;
      const rows = b.rows.slice(0, limit);
      const links = b.links?.slice(0, limit);
      const totals = b.sum.length
        ? b.columns.map((_, i) =>
            i === 0
              ? 'Total'
              : b.sum.includes(i)
                ? Math.round(rows.reduce((a, r) => a + Number(r[i] ?? 0), 0) * 100) / 100
                : '',
          )
        : undefined;
      const fw = await this.filterWords(c, s);
      if (q.format) {
        const school = (
          await c.query<{ name: string; by: string }>(
            // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
            `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS name, ${PERSON('u')} AS by
               FROM users u WHERE u.id = app.current_user_id()`,
          )
        ).rows[0]!;
        return libraryFile({
          format: q.format,
          name: REPORT_NAMES[report],
          slug: `Purchase-${report.replaceAll('_', '-')}`,
          school: school.name,
          by: school.by,
          words: fw,
          columns: b.columns,
          rows,
          totals,
        });
      }
      return {
        report,
        name: REPORT_NAMES[report],
        words: fw,
        columns: b.columns,
        rows,
        totals,
        more,
        links,
        from: s.from,
        to: s.to,
      };
    });
  }

  /** What the reports filter by: departments, vendors (any status), items. */
  async filters(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const d = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const v = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, legal_name AS name FROM vendors ORDER BY legal_name LIMIT 5000`,
      );
      const i = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM purchase_items ORDER BY name LIMIT 5000`,
      );
      return { departments: d.rows, vendors: v.rows, items: i.rows, reports: REPORT_NAMES };
    });
  }

  // ---- the dashboard -------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const today = ist();
      const fy = fyStart(today);
      const month = `${today.slice(0, 7)}-01`;
      const f = (
        await c.query<{
          open_pis: number;
          pending: number;
          to_requisition: number;
          to_order: number;
          po_month: number;
          po_month_value: string;
          po_year_value: string;
          emergency: number;
          alert: string | null;
          inspecting: number;
          deemed: number;
          late: number;
          to_receive: number;
          accepted_month: string;
          stock_value: string;
          below: number;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments
          `SELECT (SELECT count(*)::int FROM purchase_indents WHERE status = 'submitted'
                     OR (status = 'approved' AND route IN ('to_requisition', 'in_requisition', 'to_order'))) AS open_pis,
                  (SELECT count(*)::int FROM purchase_indents WHERE status = 'submitted')
                    + (SELECT count(*)::int FROM purchase_requisitions WHERE status = 'submitted')
                    + (SELECT count(*)::int FROM purchase_orders WHERE status = 'submitted') AS pending,
                  (SELECT count(*)::int FROM purchase_indents WHERE status = 'approved' AND route = 'to_requisition') AS to_requisition,
                  (SELECT count(*)::int FROM purchase_requisition_lines rl JOIN purchase_requisitions r ON r.id = rl.requisition_id
                    WHERE r.status IN ('approved', 'part_ordered') AND ${TO_ORDER}) AS to_order,
                  (SELECT count(*)::int FROM purchase_orders po WHERE ${PLACED} AND po.po_date >= $1::date) AS po_month,
                  (SELECT COALESCE(sum(po.total), 0) FROM purchase_orders po WHERE ${PLACED} AND po.po_date >= $1::date)::text AS po_month_value,
                  (SELECT COALESCE(sum(po.total), 0) FROM purchase_orders po WHERE ${PLACED} AND po.po_date >= $2::date)::text AS po_year_value,
                  (SELECT count(*)::int FROM purchase_orders po WHERE po.emergency AND po.status IN ('draft', 'submitted')) AS emergency,
                  (SELECT large_po_alert::text FROM purchase_settings WHERE school_id = app.current_school_id()) AS alert,
                  (SELECT count(*)::int FROM goods_receipts WHERE status = 'inspecting') AS inspecting,
                  (SELECT count(*)::int FROM goods_receipts WHERE status = 'inspecting'
                      AND received_on + 15 < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS deemed,
                  (SELECT count(DISTINCT po.id)::int FROM purchase_orders po JOIN purchase_order_lines l ON l.order_id = po.id
                    WHERE po.status IN ('approved', 'sent') AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity
                      AND po.delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS late,
                  (SELECT count(DISTINCT po.id)::int FROM purchase_orders po JOIN purchase_order_lines l ON l.order_id = po.id
                    WHERE po.status IN ('approved', 'sent') AND l.received_qty - l.rejected_qty - l.returned_qty < l.quantity) AS to_receive,
                  (SELECT COALESCE(sum(round(gl.accepted_qty * gl.unit_cost, 2)), 0) FROM goods_receipt_lines gl
                     JOIN goods_receipts g ON g.id = gl.receipt_id WHERE g.status = 'accepted' AND g.accepted_on >= $1::date)::text AS accepted_month,
                  (SELECT COALESCE(sum(value), 0) FROM stock_balances)::text AS stock_value,
                  (SELECT count(*)::int FROM item_store_levels l LEFT JOIN stock_balances b ON b.store_id = l.store_id AND b.item_id = l.item_id
                    JOIN stores st ON st.id = l.store_id AND st.status = 'active'
                    JOIN purchase_items it ON it.id = l.item_id AND it.status = 'active'
                    WHERE l.reorder_level > 0
                      AND GREATEST(COALESCE(b.qty, 0) - COALESCE(b.reserved, 0), 0)
                          + COALESCE((SELECT sum((ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty) * it.stock_per_unit)
                                        FROM purchase_order_lines ol JOIN purchase_orders po ON po.id = ol.order_id
                                       WHERE ol.item_id = l.item_id AND po.status IN ('approved', 'sent')
                                         AND ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty > 0), 0)
                          <= l.reorder_level) AS below`,
          [month, fy],
        )
      ).rows[0]!;
      const pending = await this.build(c, 'pending', this.scope({}), 10);
      const largest = await c.query<{
        id: string;
        label: string;
        vendor: string;
        dept: string | null;
        day: string;
        total: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
        `SELECT po.id::text, po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS label, v.legal_name AS vendor,
                d.name AS dept, po.po_date::text AS day, po.total::text
           FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id LEFT JOIN departments d ON d.id = po.department_id
          WHERE ${PLACED} AND po.po_date >= $1::date ORDER BY po.total DESC LIMIT 10`,
        [fy],
      );
      const over = f.alert
        ? await c.query<{ id: string; label: string; vendor: string; day: string; total: string }>(
            // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
            `SELECT po.id::text, po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS label, v.legal_name AS vendor,
                    po.po_date::text AS day, po.total::text
               FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
              WHERE ${PLACED} AND po.po_date >= $1::date AND po.total >= $2::numeric ORDER BY po.po_date DESC LIMIT 20`,
            [fy, f.alert],
          )
        : { rows: [] };
      const byDept = await c.query<{ dept: string; total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
        `SELECT COALESCE(d.name, 'No department') AS dept, sum(po.total)::text AS total
           FROM purchase_orders po LEFT JOIN departments d ON d.id = po.department_id
          WHERE ${PLACED} AND po.po_date >= $1::date GROUP BY 1 ORDER BY sum(po.total) DESC LIMIT 10`,
        [fy],
      );
      const byMonth = await c.query<{ month: string; total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- PLACED is a fixed fragment
        `SELECT to_char(po.po_date, 'YYYY-MM') AS month, sum(po.total)::text AS total
           FROM purchase_orders po WHERE ${PLACED} AND po.po_date >= $1::date GROUP BY 1 ORDER BY 1`,
        [fy],
      );
      const months: string[] = [];
      for (
        let d = new Date(`${fy}T00:00:00Z`);
        d.toISOString().slice(0, 7) <= today.slice(0, 7);
        d.setUTCMonth(d.getUTCMonth() + 1)
      )
        months.push(d.toISOString().slice(0, 7));
      return {
        fyFrom: fy,
        monthFrom: month,
        today,
        figures: {
          openIndents: f.open_pis,
          pending: f.pending,
          toRequisition: f.to_requisition,
          toOrder: f.to_order,
          ordersThisMonth: f.po_month,
          ordersThisMonthValue: Number(f.po_month_value),
          ordersThisYearValue: Number(f.po_year_value),
          emergencyWaiting: f.emergency,
          inspecting: f.inspecting,
          deemedAccepted: f.deemed,
          lateOrders: f.late,
          toReceive: f.to_receive,
          acceptedThisMonthValue: Number(f.accepted_month),
          stockValue: Number(f.stock_value),
          belowReorder: f.below,
        },
        largePoAlert: f.alert === null ? null : Number(f.alert),
        oldestPending: pending.rows.slice(0, 10).map((r, i) => ({
          kind: String(r[0]),
          label: String(r[1]),
          department: r[2] ? String(r[2]) : null,
          amount: Number(r[3]),
          level: String(r[4]),
          waitingWith: String(r[5]),
          since: String(r[7]),
          days: Number(r[8]),
          overdue: r[9] === 'Yes',
          href: pending.links?.[i] ?? null,
        })),
        largest: largest.rows.map((x) => ({
          id: x.id,
          label: x.label,
          vendor: x.vendor,
          department: x.dept,
          date: x.day,
          total: Number(x.total),
        })),
        overAlert: over.rows.map((x) => ({
          id: x.id,
          label: x.label,
          vendor: x.vendor,
          date: x.day,
          total: Number(x.total),
        })),
        byDepartment: byDept.rows.map((x) => ({ department: x.dept, total: Number(x.total) })),
        byMonth: months.map((m) => ({
          month: m,
          label: `${MONTHS[Number(m.slice(5, 7)) - 1]!} ${m.slice(2, 4)}`,
          total: Number(byMonth.rows.find((x) => x.month === m)?.total ?? 0),
        })),
      };
    });
  }
}

/** The override kinds, for the report's filter. */
export const OVERRIDE_KINDS: Record<string, string> = {
  rate_contract: 'PR skipped: rate contract',
  under_limit: 'PR skipped: under the limit',
  split_guard: 'Split guard: PR not skipped',
  not_l1: 'Vendor not the lowest (L1)',
  emergency: 'Emergency purchase',
  cancelled: 'Order cancelled after approval',
  amended: 'Order amended',
  contract_rate: 'Contract rate changed',
};
