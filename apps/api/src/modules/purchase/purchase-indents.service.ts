import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { FilesService } from '../files/files.service';
import { STORAGE_DRIVER } from '../files/storage';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { syncFlow } from './purchase-flow';
import { purchaseHead } from './purchase-head';
import { purchaseIndentPdf } from './purchase-indent-pdf';
import { checkListSize, LIST_LIMIT, purchaseListFile } from './purchase-list-file';
import {
  CLOSED_PLACED,
  draftOrdersFor,
  LINE_ORDERING,
  orderingWords,
  type LineOrderingRow,
} from './purchase-order-core';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  PURCHASE,
  type IndentDecisionDto,
  type IndentDto,
  type IndentExportQueryDto,
  type IndentListQueryDto,
  type IndentSheetDto,
  type PurchaseDelegationDto,
  type ReasonDto,
} from './purchase.dto';

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const qtyWords = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const INDENT_STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back for changes',
  cancelled: 'Withdrawn',
};
const INDENT_ROUTE_WORDS: Record<string, string> = {
  to_requisition: 'Waiting for the PR',
  to_order: 'PR skipped: for the PO',
  in_requisition: 'On a PR',
  ordered: 'Ordered',
  closed: 'Closed',
};
const dmy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d!}-${m!}-${y!}`;
};
/** A moment's day in India, as dd-mm-yyyy. */
const istDay = (t: Date) =>
  dmy(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t));

/**
 * Who sees a PI's rates and amounts (docs/design/83, "As built — rates hidden from the raiser"): the
 * purchase office and the admins (any of these rights), and the PI's approvers on the PIs they approve.
 * A raiser without them never does: the estimate is still worked out (the rate contract's rate, else
 * the last purchase rate) for the department's limit, but not shown to them.
 */
const RATE_RIGHTS = [
  PURCHASE.indentView,
  PURCHASE.requisitionManage,
  PURCHASE.orderManage,
  PURCHASE.reportView,
  PURCHASE.settingsManage,
] as const;

/** A bypass note without its amounts, for someone who does not see rates. */
const withoutMoney = (note: string | null) => {
  if (!note || !note.includes('₹')) return note;
  const t = note
    .replace(
      /^Auto-approved: ₹[\d,.]+ is within (.+)'s limit of ₹[\d,.]+$/,
      "Auto-approved: within $1's limit",
    )
    .replace(/ come to ₹[\d,.]+, over (.+)'s limit of ₹[\d,.]+$/, " go over $1's limit");
  return t.includes('₹') ? null : t;
};

interface IndentDbRow {
  id: string;
  number: string | null;
  department_id: string;
  department: string;
  raised_by: string;
  raised_by_name: string;
  on_behalf_employee_id: string | null;
  on_behalf: string | null;
  purpose: string;
  required_by: string | null;
  priority: 'normal' | 'urgent';
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'sent_back' | 'cancelled';
  route: string | null;
  bypass_rule: string | null;
  bypass_note: string | null;
  estimate: string;
  workflow_instance_id: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  waiting_with: string | null;
  lines: number;
  /** the signed-in user approves (or approved) it, not having raised it: they see its rates */
  approver: boolean;
  /** a line of it was ordered for less and the rest closed */
  part_closed: boolean;
}

/** A user's name as staff know it: their employee record's, else the account's. */
const PERSON = (u: 'au' | 'ru' | 'fu' | 'tu' | 'u') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases above
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

// eslint-disable-next-line no-restricted-syntax -- PERSON and CLOSED_PLACED are fixed fragments
const SELECT = `
  SELECT pi.id::text, pi.number, pi.department_id::text, d.name AS department, pi.raised_by::text, ${PERSON('ru')} AS raised_by_name,
         pi.on_behalf_employee_id::text, ob.display_name AS on_behalf, pi.purpose, pi.required_by::text, pi.priority, pi.status,
         pi.route, pi.bypass_rule, pi.bypass_note, pi.estimate::text, pi.workflow_instance_id::text, pi.submitted_at, pi.decided_at,
         pi.decision_note, pi.created_at,
         (SELECT st.name || ' (' || COALESCE((SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody') || ')'
            FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
           WHERE i.id = pi.workflow_instance_id AND i.status = 'pending') AS waiting_with,
         (SELECT count(*)::int FROM purchase_indent_lines l WHERE l.indent_id = pi.id) AS lines,
         EXISTS (SELECT 1 FROM purchase_indent_lines il JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
                   JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
                  WHERE il.indent_id = pi.id AND rl.fulfil = 'buy' AND ${CLOSED_PLACED}) AS part_closed,
         (pi.raised_by <> app.current_user_id() AND EXISTS (SELECT 1 FROM workflow_steps s WHERE s.instance_id = pi.workflow_instance_id
            AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()
                 OR EXISTS (SELECT 1 FROM delegations dg WHERE dg.to_user_id = app.current_user_id() AND dg.from_user_id = ANY(s.assignee_user_ids)
                              AND dg.revoked_at IS NULL)))) AS approver
    FROM purchase_indents pi
    JOIN departments d ON d.id = pi.department_id
    JOIN users ru ON ru.id = pi.raised_by
    LEFT JOIN employees ob ON ob.id = pi.on_behalf_employee_id`;

/** The step of an instance the signed-in user may act on now (as an approver or someone's delegate). */
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;

/**
 * The Purchase Indent (docs/design/83, part 2): any staff member with the raise right asks for items
 * for their department (or on behalf of a colleague); the department's PI levels approve it on the
 * workflow engine (nobody approves their own); a level may send it back for changes. On approval the
 * bypass rules decide whether the PR is made and approved by the system — every line on a rate
 * contract, or the PI under the department's limit with the split-indent guard — or the PI waits for
 * the purchase office's PR (part 3). A purchase approver may hand their approvals to a colleague for
 * some days (a purchase-only delegation).
 */
@Injectable()
export class PurchaseIndentsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly files: FilesService,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('purchase_indent', (c, ctx, instance, outcome) =>
      this.onDecided(c, ctx, instance, outcome),
    );
  }

  /** The departments of the signed-in employee (their employee record's department). */
  private async myDepartments(c: PoolClient): Promise<Array<{ id: string; name: string }>> {
    const r = await c.query<{ id: string; name: string }>(
      `SELECT DISTINCT d.id::text, d.name FROM employees e
         JOIN departments d ON d.status = 'active' AND (lower(d.name) = lower(btrim(e.department)) OR d.code = app.code_of(e.department))
        WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL AND e.status = 'active'`,
    );
    return r.rows;
  }

  /** The purchase office and the admins see every PI's rates (RATE_RIGHTS). */
  private officeRates(ctx: RequestContext) {
    const p = ctx.permissions;
    return !!p && RATE_RIGHTS.some((x) => p.has(x));
  }

  private shape(r: IndentDbRow, office: boolean) {
    const sees = office || r.approver;
    return {
      id: r.id,
      number: r.number,
      departmentId: r.department_id,
      department: r.department,
      raisedBy: r.raised_by_name,
      raisedById: r.raised_by,
      onBehalfEmployeeId: r.on_behalf_employee_id,
      onBehalf: r.on_behalf,
      purpose: r.purpose,
      requiredBy: r.required_by,
      priority: r.priority,
      status: r.status,
      route: r.route,
      bypassRule: r.bypass_rule,
      bypassNote: sees ? r.bypass_note : withoutMoney(r.bypass_note),
      /** NULL for someone who does not see rates */
      estimate: sees ? Number(r.estimate) : null,
      showRates: sees,
      workflowInstanceId: r.workflow_instance_id,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      createdAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      lines: r.lines,
      partClosed: r.part_closed,
    };
  }

  /** Who may see which PIs: the view right sees all; others theirs, their department's, and those they approve. */
  private seeAll(ctx: RequestContext) {
    return ctx.permissions?.has(PURCHASE.indentView) ?? false;
  }
  private static readonly MINE = `(pi.raised_by = app.current_user_id()
      OR EXISTS (SELECT 1 FROM employees e WHERE e.id = pi.on_behalf_employee_id AND e.user_id = app.current_user_id()))`;
  private static readonly PARTICIPANT = `EXISTS (SELECT 1 FROM workflow_steps s WHERE s.instance_id = pi.workflow_instance_id
      AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()
           OR EXISTS (SELECT 1 FROM delegations d WHERE d.to_user_id = app.current_user_id() AND d.from_user_id = ANY(s.assignee_user_ids)
                        AND d.revoked_at IS NULL)))`;
  // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
  private static readonly WAITING = `EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
      WHERE i.id = pi.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'
        AND ${WorkflowService.MAY_ACT})`;

  /** The list's filters as SQL ($1-$9), the same for the screen and its file. */
  private async filterOf(
    c: PoolClient,
    ctx: RequestContext,
    q: IndentExportQueryDto | IndentListQueryDto,
  ) {
    const deps = (await this.myDepartments(c)).map((d) => d.id);
    const all = this.seeAll(ctx);
    // eslint-disable-next-line no-restricted-syntax -- MINE, WAITING and PARTICIPANT are fixed fragments; values are bound
    const where = `WHERE ($1::text IS NULL OR pi.status = $1)
          AND ($2::text IS NULL OR pi.route = $2)
          AND ($3::bigint IS NULL OR pi.department_id = $3::bigint)
          AND ($4::text IS NULL OR pi.number ILIKE $4 OR pi.purpose ILIKE $4)
          AND CASE $5
                WHEN 'mine' THEN ${PurchaseIndentsService.MINE}
                WHEN 'waiting' THEN ${PurchaseIndentsService.WAITING}
                ELSE ($6 OR ${PurchaseIndentsService.MINE} OR (pi.department_id = ANY($7::bigint[]) AND pi.status <> 'draft')
                      OR ${PurchaseIndentsService.PARTICIPANT}) END
          AND ($8::date IS NULL OR (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= $8::date)
          AND ($9::date IS NULL OR (COALESCE(pi.submitted_at, pi.created_at) AT TIME ZONE 'Asia/Kolkata')::date <= $9::date)`;
    const args = [
      q.status ?? null,
      q.route ?? null,
      q.departmentId ?? null,
      q.q ? `%${q.q}%` : null,
      q.view,
      all,
      deps,
      q.from ?? null,
      q.to ?? null,
    ];
    return { where, args };
  }

  async list(ctx: RequestContext, q: IndentListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = await this.filterOf(c, ctx, q);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM purchase_indents pi ${where}`,
        args,
      );
      const rows = await c.query<IndentDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY pi.priority = 'urgent' DESC, COALESCE(pi.submitted_at, pi.created_at) DESC LIMIT $10 OFFSET $11`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const waiting = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed fragment
        `SELECT count(*)::int AS n FROM purchase_indents pi WHERE pi.status = 'submitted' AND ${PurchaseIndentsService.WAITING}`,
      );
      return {
        data: rows.rows.map((r) => this.shape(r, this.officeRates(ctx))),
        total: total.rows[0]!.n,
        page: q.page,
        size: q.size,
        waitingForMe: waiting.rows[0]!.n,
      };
    });
  }

  /**
   * The list as on screen (its filters, every page) as Excel or PDF, with the letterhead: estimates only
   * for those who see rates; the Excel adds a sheet of the item lines (docs/design/83).
   */
  async exportList(ctx: RequestContext, q: IndentExportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = await this.filterOf(c, ctx, q);
      const rows = (
        await c.query<IndentDbRow>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `${SELECT} ${where} ORDER BY COALESCE(pi.submitted_at, pi.created_at) DESC LIMIT $10`,
          [...args, LIST_LIMIT],
        )
      ).rows;
      checkListSize(rows.length, 'indents');
      const office = this.officeRates(ctx);
      const day = (t: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);
      const where_ = (r: IndentDbRow) =>
        r.status === 'submitted' && r.waiting_with
          ? `With ${r.waiting_with}`
          : r.status === 'approved' && r.route
            ? `${INDENT_ROUTE_WORDS[r.route] ?? r.route}${r.part_closed ? ' · part closed' : ''}`
            : (r.decision_note ?? '');
      const list = {
        columns: [
          { label: 'Indent', width: 2.2 },
          { label: 'Date', type: 'date' as const },
          { label: 'Department', width: 2 },
          { label: 'Raised by', width: 2.2 },
          { label: 'Purpose', width: 3.4 },
          { label: 'Priority', width: 1.2 },
          { label: 'Needed by', type: 'date' as const },
          { label: 'Lines', type: 'number' as const, width: 0.9 },
          ...(office ? [{ label: 'Estimate (₹)', type: 'money' as const }] : []),
          { label: 'Status', width: 1.8 },
          { label: 'Where it is', width: 2.6 },
        ],
        rows: rows.map((r) => [
          r.number ?? 'Draft',
          day(r.submitted_at ?? r.created_at),
          r.department,
          `${r.raised_by_name}${r.on_behalf ? ` for ${r.on_behalf}` : ''}`,
          r.purpose,
          r.priority === 'urgent' ? 'Urgent' : 'Normal',
          r.required_by,
          r.lines,
          ...(office ? [Number(r.estimate)] : []),
          INDENT_STATUS_WORDS[r.status] ?? r.status,
          where_(r),
        ]),
      };
      let lines;
      if (q.format === 'xlsx' && rows.length) {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const l = await c.query<{
          indent_id: string;
          seq: number;
          code: string | null;
          item: string;
          quantity: string;
          uom: string;
          est_rate: string;
          stock_free: string | null;
          stock_uom: string | null;
          note: string | null;
          stock_reason: string | null;
        }>(
          `SELECT l.indent_id::text, l.seq, i.code, COALESCE(i.name, l.free_text) AS item, l.quantity::text, u.code AS uom,
                  l.est_rate::text, l.stock_free::text, su.code AS stock_uom, l.note, l.stock_reason
             FROM purchase_indent_lines l
             LEFT JOIN purchase_items i ON i.id = l.item_id
             LEFT JOIN purchase_uoms su ON su.id = COALESCE(i.stock_uom_id, i.uom_id)
             JOIN purchase_uoms u ON u.id = l.uom_id
            WHERE l.indent_id = ANY($1::bigint[]) ORDER BY l.indent_id DESC, l.seq`,
          [rows.map((r) => r.id)],
        );
        lines = {
          columns: [
            { label: 'Indent', width: 2.2 },
            { label: 'Department', width: 2 },
            { label: '#', type: 'number' as const, width: 0.6 },
            { label: 'Item code', width: 2 },
            { label: 'Item', width: 3.4 },
            { label: 'Quantity', type: 'number' as const },
            { label: 'Unit', width: 1 },
            { label: 'In store when raised', width: 2 },
            ...(office
              ? [
                  { label: 'Rate (₹)', type: 'money' as const },
                  { label: 'Amount (₹)', type: 'money' as const },
                ]
              : []),
            { label: 'Note', width: 2.6 },
            { label: 'Why bought though the store has it', width: 3 },
          ],
          rows: l.rows.map((x) => {
            const pi = byId.get(x.indent_id)!;
            return [
              pi.number ?? 'Draft',
              pi.department,
              x.seq,
              x.code,
              x.item,
              Number(x.quantity),
              x.uom,
              x.stock_free === null
                ? ''
                : `${Number(x.stock_free).toLocaleString('en-IN')} ${x.stock_uom ?? ''}`.trim(),
              ...(office
                ? [
                    Number(x.est_rate),
                    Math.round(Number(x.quantity) * Number(x.est_rate) * 100) / 100,
                  ]
                : []),
              x.note,
              x.stock_reason,
            ];
          }),
        };
      }
      return purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: 'Purchase Indents',
        slug: 'Purchase-Indents',
        words: await this.filterWords(c, q),
        list,
        ...(office ? { sum: [8] } : {}),
        ...(lines ? { lines } : {}),
      });
    });
  }

  /** The filters in words, for the file's details line. */
  private async filterWords(c: PoolClient, q: IndentExportQueryDto) {
    const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    const dept = q.departmentId
      ? (
          await c.query<{ name: string }>(`SELECT name FROM departments WHERE id = $1`, [
            q.departmentId,
          ])
        ).rows[0]?.name
      : undefined;
    return (
      [
        q.view === 'mine' ? 'Mine' : q.view === 'waiting' ? 'Waiting for me' : null,
        dept ? `Department: ${dept}` : null,
        q.from && q.to
          ? `${dmy(q.from)} to ${dmy(q.to)}`
          : q.from
            ? `From ${dmy(q.from)}`
            : q.to
              ? `Up to ${dmy(q.to)}`
              : null,
        q.status ? `Status: ${INDENT_STATUS_WORDS[q.status] ?? q.status}` : null,
        q.route ? (INDENT_ROUTE_WORDS[q.route] ?? q.route) : null,
        q.q ? `Search: ${q.q}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'All indents'
    );
  }

  /**
   * What the purchase lists filter by: the departments one may see (every one for the purchase office,
   * the admins and the approvers of any department; else one's own) and, for those who see rates, the
   * vendors.
   */
  async listFilters(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = ctx.permissions;
      const wide =
        this.seeAll(ctx) ||
        this.officeRates(ctx) ||
        (p?.has(PURCHASE.indentAnyDepartment) ?? false);
      const departments = wide
        ? (
            await c.query<{ id: string; name: string }>(
              `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
            )
          ).rows
        : await this.myDepartments(c);
      const vendors = this.officeRates(ctx)
        ? (
            await c.query<{ id: string; code: string; name: string }>(
              `SELECT id::text, code, legal_name AS name FROM vendors ORDER BY legal_name LIMIT 3000`,
            )
          ).rows
        : [];
      return { departments, vendors };
    });
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string): Promise<IndentDbRow> {
    const deps = (await this.myDepartments(c)).map((d) => d.id);
    const r = await c.query<IndentDbRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE pi.id = $1 AND ($2 OR ${PurchaseIndentsService.MINE} OR (pi.department_id = ANY($3::bigint[]) AND pi.status <> 'draft')
          OR ${PurchaseIndentsService.PARTICIPANT})`,
      [id, this.seeAll(ctx), deps],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Indent not found', { status: 404 });
    return r.rows[0];
  }

  /** The PI's lines, with what the stores held free when it was raised. */
  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        seq: number;
        item_id: string | null;
        item_code: string | null;
        item: string | null;
        free_text: string | null;
        quantity: string;
        uom: string;
        uom_id: string;
        est_rate: string;
        rate_source: 'contract' | 'last' | 'typed';
        contract_id: string | null;
        contract_vendor: string | null;
        note: string | null;
        stock_free: string | null;
        stock_stores: Array<{ store: string; free: number }>;
        stock_reason: string | null;
        stock_uom: string | null;
        file_id: string | null;
        file_name: string | null;
      }>(
        `SELECT l.id::text, l.seq, l.item_id::text, i.code AS item_code, i.name AS item, l.free_text, l.quantity::text,
                u.code AS uom, l.uom_id::text, l.est_rate::text, l.rate_source, l.contract_id::text, v.legal_name AS contract_vendor, l.note,
                l.stock_free::text, l.stock_stores, l.stock_reason, su.code AS stock_uom,
                l.file_id::text, (SELECT f.original_name FROM files f WHERE f.id = l.file_id AND f.deleted_at IS NULL) AS file_name
           FROM purchase_indent_lines l
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_uoms su ON su.id = COALESCE(i.stock_uom_id, i.uom_id)
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN purchase_rate_contracts rc ON rc.id = l.contract_id
           LEFT JOIN vendors v ON v.id = rc.vendor_id
          WHERE l.indent_id = $1 ORDER BY l.seq`,
        [id],
      )
    ).rows;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pi = await this.load(c, ctx, id);
      const sees = this.officeRates(ctx) || pi.approver;
      const lines = { rows: await this.linesOf(c, id) };
      const spend = await c.query<{ total: string }>(
        `SELECT COALESCE(sum(estimate), 0)::text AS total FROM purchase_indents
          WHERE department_id = $1 AND status = 'approved'
            AND app.purchase_fy(decided_at::date) = app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date)`,
        [pi.department_id],
      );
      const pr = await c.query<{
        id: string;
        number: string;
        auto_rule: string | null;
        status: string;
      }>(
        `SELECT DISTINCT r.id::text, r.number, r.auto_rule, r.status FROM purchase_requisitions r
           JOIN purchase_requisition_lines rl ON rl.requisition_id = r.id
           JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
           JOIN purchase_indent_lines il ON il.id = src.indent_line_id WHERE il.indent_id = $1`,
        [id],
      );
      // what became of each line: ordered, part ordered with the rest closed or to order later
      const ordering = await c.query<LineOrderingRow & { line_id: string; shared: boolean }>(
        // eslint-disable-next-line no-restricted-syntax -- LINE_ORDERING is a fixed fragment
        `SELECT src.indent_line_id::text AS line_id, ${LINE_ORDERING},
                (SELECT count(*) FROM purchase_requisition_sources s2 WHERE s2.requisition_line_id = rl.id) > 1 AS shared
           FROM purchase_requisition_sources src
           JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
           JOIN purchase_requisitions r ON r.id = rl.requisition_id
          WHERE src.indent_line_id IN (SELECT id FROM purchase_indent_lines WHERE indent_id = $1)
            AND r.status IN ('approved', 'part_ordered', 'ordered')`,
        [id],
      );
      const instance = pi.workflow_instance_id
        ? await this.workflow.instanceWith(c, pi.workflow_instance_id)
        : null;
      const history = pi.workflow_instance_id
        ? (
            await c.query<{
              kind: string;
              actor: string | null;
              note: string | null;
              detail: Record<string, unknown>;
              at: Date;
            }>(
              // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
              `SELECT e.kind, ${PERSON('u')} AS actor, e.note, e.detail, e.occurred_at AS at
                 FROM workflow_events e LEFT JOIN users u ON u.id = e.actor_id
                WHERE e.instance_id IN (SELECT id FROM workflow_instances WHERE entity_type = 'purchase_indent' AND entity_id = $1)
                ORDER BY e.occurred_at, e.id`,
              [id],
            )
          ).rows
        : [];
      const mine = pi.workflow_instance_id
        ? await c.query<{ id: string }>(MY_STEP, [pi.workflow_instance_id])
        : { rows: [] };
      const isRaiser = pi.raised_by === String(ctx.user.id);
      const anyDept = ctx.permissions?.has(PURCHASE.indentAnyDepartment) ?? false;
      const editable =
        (pi.status === 'draft' || pi.status === 'sent_back') && (isRaiser || anyDept);
      const approvedYet = instance?.steps.some((s) => s.status === 'approved') ?? false;
      return {
        ...this.shape(pi, this.officeRates(ctx)),
        lineItems: lines.rows.map((l) => ({
          id: l.id,
          seq: l.seq,
          itemId: l.item_id,
          itemCode: l.item_code,
          item: l.item ?? l.free_text,
          inCatalogue: l.item_id !== null,
          quantity: Number(l.quantity),
          uom: l.uom,
          uomId: l.uom_id,
          // rates and amounts only for those who see them
          estRate: sees ? Number(l.est_rate) : null,
          amount: sees ? Math.round(Number(l.quantity) * Number(l.est_rate) * 100) / 100 : null,
          rateSource: sees ? l.rate_source : null,
          contractVendor: sees ? l.contract_vendor : null,
          note: l.note,
          // the free stock in the main store and the department's stores when it was raised
          stockFree: l.stock_free === null ? null : Number(l.stock_free),
          stockUom: l.stock_uom,
          stockStores: l.stock_stores,
          stockReason: l.stock_reason,
          // the line's document (view and download through the indent)
          fileId: l.file_id,
          fileName: l.file_name,
          // what became of it (quantities only)
          ordered:
            ordering.rows
              .filter((o) => o.line_id === l.id)
              .map((o) => {
                const w = orderingWords(o, l.uom);
                return w && o.shared ? `${w} (the requisition line also covers other indents)` : w;
              })
              .filter(Boolean)
              .join('; ') || null,
        })),
        departmentSpendThisYear: sees ? Number(spend.rows[0]!.total) : null,
        requisitions: pr.rows.map((r) => ({
          id: r.id,
          number: r.number,
          autoRule: r.auto_rule,
          status: r.status,
        })),
        steps: instance?.steps ?? [],
        history: history.map((h) => ({
          kind: h.kind,
          actor: h.actor,
          note: h.note,
          detail: h.detail,
          at: h.at.toISOString(),
        })),
        can: {
          edit: editable,
          submit: editable,
          cancel:
            (isRaiser || anyDept) &&
            (pi.status === 'draft' ||
              pi.status === 'sent_back' ||
              (pi.status === 'submitted' && !approvedYet)),
          decide: mine.rows.length > 0 && pi.raised_by !== String(ctx.user.id),
          // printed once it is sent (it has its number)
          print: pi.number !== null,
        },
      };
    });
  }

  /**
   * What the indent form picks from: the departments, the catalogue (with its rates for those who see
   * them, and its free stock in the main store and the departments' stores), units, staff.
   */
  async formLists(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const any = ctx.permissions?.has(PURCHASE.indentAnyDepartment) ?? false;
      const mine = await this.myDepartments(c);
      const deps = any
        ? (
            await c.query<{ id: string; name: string }>(
              `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
            )
          ).rows
        : mine;
      const items = await c.query<{
        id: string;
        code: string;
        name: string;
        category: string;
        uom_id: string;
        uom: string;
        decimals: boolean;
        last: string | null;
        contract_rate: string | null;
        contract_vendor: string | null;
        stock_tracked: boolean;
        stock_uom: string;
        per_unit: string;
      }>(
        `SELECT i.id::text, i.code, i.name, c.name AS category, u.id::text AS uom_id, u.code AS uom, u.decimals,
                i.last_purchase_rate::text AS last, rc.rate::text AS contract_rate, rc.vendor AS contract_vendor,
                i.stock_tracked, COALESCE(su.code, u.code) AS stock_uom, i.stock_per_unit::text AS per_unit
           FROM purchase_items i JOIN purchase_item_categories c ON c.id = i.category_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN LATERAL (SELECT rc.rate, v.legal_name AS vendor FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                               WHERE rc.item_id = i.id AND rc.status = 'active'
                                 AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1) rc ON true
          WHERE i.status = 'active' ORDER BY c.name, i.name LIMIT 5000`,
      );
      const uoms = await c.query<{ id: string; code: string; name: string; decimals: boolean }>(
        `SELECT id::text, code, name, decimals FROM purchase_uoms WHERE status = 'active' ORDER BY code`,
      );
      const staff = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
      );
      // the free stock (in hand less reserved) in the main store and the stores of the departments
      // the raiser may raise for
      const stock = await c.query<{
        item_id: string;
        store_id: string;
        store: string;
        main: boolean;
        department_id: string | null;
        free: string;
      }>(
        `SELECT sb.item_id::text, s.id::text AS store_id, s.name AS store, s.kind = 'main' AS main, s.department_id::text,
                (sb.qty - sb.reserved)::text AS free
           FROM stock_balances sb JOIN stores s ON s.id = sb.store_id AND s.status = 'active'
          WHERE sb.qty - sb.reserved > 0 AND (s.kind = 'main' OR s.department_id = ANY($1::bigint[]))
          ORDER BY s.kind = 'main' DESC, s.name`,
        [deps.map((d) => d.id)],
      );
      const held = new Map<
        string,
        Array<{
          storeId: string;
          store: string;
          main: boolean;
          departmentId: string | null;
          free: number;
        }>
      >();
      for (const r of stock.rows)
        held.set(r.item_id, [
          ...(held.get(r.item_id) ?? []),
          {
            storeId: r.store_id,
            store: r.store,
            main: r.main,
            departmentId: r.department_id,
            free: Number(r.free),
          },
        ]);
      const showRates = this.officeRates(ctx);
      return {
        departments: deps,
        myDepartmentIds: mine.map((d) => d.id),
        anyDepartment: any,
        /** the raiser sees rates and types them (the purchase office); otherwise they are left out */
        showRates,
        items: items.rows.map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          category: x.category,
          uomId: x.uom_id,
          uom: x.uom,
          decimals: x.decimals,
          lastRate: showRates && x.last !== null ? Number(x.last) : null,
          contractRate: showRates && x.contract_rate !== null ? Number(x.contract_rate) : null,
          contractVendor: showRates ? x.contract_vendor : null,
          stockTracked: x.stock_tracked,
          /** the unit the store counts in, and how many of it make one of the item's unit */
          stockUom: x.stock_uom,
          perUnit: Number(x.per_unit),
          stock: x.stock_tracked ? (held.get(x.id) ?? []) : [],
        })),
        uoms: uoms.rows,
        staff: staff.rows,
      };
    });
  }

  // ---- raise and change ---------------------------------------------------------------------------
  private async departmentFor(c: PoolClient, ctx: RequestContext, asked?: string) {
    const mine = await this.myDepartments(c);
    const any = ctx.permissions?.has(PURCHASE.indentAnyDepartment) ?? false;
    if (asked) {
      if (!any && !mine.some((d) => d.id === asked))
        throw new DomainError(
          'permission-denied',
          'You raise indents for your own department only',
          { status: 403 },
        );
      const d = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE id = $1 AND status = 'active'`,
        [asked],
      );
      if (!d.rows[0]) throw new DomainError('not-found', 'Department not found', { status: 404 });
      return d.rows[0];
    }
    if (mine.length === 1) return mine[0]!;
    throw new DomainError(
      'validation-failed',
      mine.length
        ? 'You belong to more than one department: pick the department'
        : 'Your employee record has no department: pick the department (or ask the office to set yours)',
      { status: 400 },
    );
  }

  /**
   * The lines checked and priced: the rate contract's rate, else the last purchase rate, unless typed
   * by someone who sees rates (a raiser's typed rate is ignored; a line in words is then priced 0 and
   * the purchase office prices it on the PR).
   */
  private async priceLines(c: PoolClient, lines: IndentDto['lines'], sees: boolean) {
    const out: Array<{
      itemId: string | null;
      freeText: string | null;
      quantity: number;
      uomId: string;
      estRate: number;
      rateSource: 'contract' | 'last' | 'typed';
      contractId: string | null;
      note: string | null;
      stockReason: string | null;
      fileId: string | null;
    }> = [];
    for (const l of lines) {
      const typed = sees ? l.estRate : undefined;
      if (l.itemId) {
        const it = await c.query<{
          uom_id: string;
          decimals: boolean;
          last: string | null;
          contract_id: string | null;
          contract_rate: string | null;
          name: string;
        }>(
          `SELECT i.uom_id::text, u.decimals, i.last_purchase_rate::text AS last, i.name,
                  rc.id::text AS contract_id, rc.rate::text AS contract_rate
             FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id
             LEFT JOIN LATERAL (SELECT rc.id, rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                                 WHERE rc.item_id = i.id AND rc.status = 'active'
                                   AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1) rc ON true
            WHERE i.id = $1 AND i.status = 'active'`,
          [l.itemId],
        );
        const x = it.rows[0];
        if (!x)
          throw new DomainError(
            'validation-failed',
            'An item is not in the catalogue (or inactive)',
            {
              status: 400,
            },
          );
        if (!x.decimals && !Number.isInteger(l.quantity))
          throw new DomainError('validation-failed', `${x.name}: a whole number`, { status: 400 });
        const source =
          typed !== undefined ? 'typed' : x.contract_rate ? 'contract' : x.last ? 'last' : 'typed';
        out.push({
          itemId: l.itemId,
          freeText: null,
          quantity: l.quantity,
          uomId: l.uomId ?? x.uom_id,
          estRate: typed ?? Number(x.contract_rate ?? x.last ?? 0),
          rateSource: source,
          contractId: x.contract_id,
          note: l.note ?? null,
          stockReason: l.stockReason ?? null,
          fileId: l.fileId ?? null,
        });
      } else {
        out.push({
          itemId: null,
          freeText: l.freeText!,
          quantity: l.quantity,
          uomId: l.uomId!,
          estRate: typed ?? 0,
          rateSource: 'typed',
          contractId: null,
          note: l.note ?? null,
          stockReason: null,
          fileId: l.fileId ?? null,
        });
      }
    }
    return out;
  }

  private async writeLines(
    c: PoolClient,
    ctx: RequestContext,
    indentId: string,
    departmentId: string,
    lines: IndentDto['lines'],
  ) {
    const priced = await this.priceLines(c, lines, this.officeRates(ctx));
    // a line's document: one the signed-in user uploaded, or already on this indent
    for (const fid of [...new Set(priced.map((l) => l.fileId).filter((x): x is string => !!x))]) {
      const ok = await c.query(
        `SELECT 1 FROM files f WHERE f.id = $1 AND f.deleted_at IS NULL AND f.status = 'ready'
            AND f.content_type IN ('application/pdf', 'image/png', 'image/jpeg')
            AND (f.created_by = app.current_user_id()
                 OR EXISTS (SELECT 1 FROM purchase_indent_lines l WHERE l.indent_id = $2 AND l.file_id = f.id))`,
        [fid, indentId],
      );
      if (!ok.rowCount)
        throw new DomainError(
          'validation-failed',
          'A line’s document was not found: attach it again',
          {
            status: 400,
          },
        );
    }
    await c.query(`DELETE FROM purchase_indent_lines WHERE indent_id = $1`, [indentId]);
    let estimate = 0;
    for (const [i, l] of priced.entries()) {
      await c.query(
        `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, free_text, quantity, uom_id, est_rate, rate_source, contract_id, note, stock_reason,
                                            file_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          indentId,
          i + 1,
          l.itemId,
          l.freeText,
          l.quantity,
          l.uomId,
          l.estRate,
          l.rateSource,
          l.contractId,
          l.note,
          l.stockReason,
          l.fileId,
        ],
      );
      estimate += Math.round(l.quantity * l.estRate * 100) / 100;
    }
    await c.query(`UPDATE purchase_indents SET estimate = $2, updated_at = now() WHERE id = $1`, [
      indentId,
      Math.round(estimate * 100) / 100,
    ]);
    await this.noteStock(c, indentId, departmentId);
  }

  /**
   * Keeps on each line what the main store and the department's stores hold free of its item now (in
   * the store unit), store by store: on saving and again on sending (docs/design/83).
   */
  private async noteStock(c: PoolClient, indentId: string, departmentId: string) {
    await c.query(
      `UPDATE purchase_indent_lines l SET stock_free = x.free, stock_stores = x.stores
         FROM (SELECT l2.id,
                      CASE WHEN i.stock_tracked THEN COALESCE(sum(GREATEST(sb.qty - sb.reserved, 0)), 0) END AS free,
                      CASE WHEN i.stock_tracked THEN
                        COALESCE(jsonb_agg(jsonb_build_object('store', s.name, 'free', sb.qty - sb.reserved) ORDER BY s.kind = 'main' DESC, s.name)
                                   FILTER (WHERE sb.qty - sb.reserved > 0), '[]'::jsonb)
                      ELSE '[]'::jsonb END AS stores
                 FROM purchase_indent_lines l2
                 JOIN purchase_items i ON i.id = l2.item_id
                 LEFT JOIN stores s ON s.status = 'active' AND (s.kind = 'main' OR s.department_id = $2::bigint)
                 LEFT JOIN stock_balances sb ON sb.store_id = s.id AND sb.item_id = l2.item_id
                WHERE l2.indent_id = $1
                GROUP BY l2.id, i.stock_tracked) x
        WHERE l.id = x.id`,
      [indentId, departmentId],
    );
  }

  /**
   * On sending: a line the stores can already cover (their free stock at least the quantity, in the
   * store unit) needs the raiser's reason for buying it anyway; the approvers see it.
   */
  private async stockCheck(c: PoolClient, indentId: string) {
    const r = await c.query<{
      seq: number;
      name: string;
      free: string;
      need: string | null;
      unit: string;
    }>(
      `SELECT l.seq, i.name, l.stock_free::text AS free, COALESCE(su.code, u.code) AS unit,
              (CASE WHEN l.uom_id = i.uom_id THEN l.quantity * i.stock_per_unit
                    WHEN l.uom_id = i.stock_uom_id THEN l.quantity END)::text AS need
         FROM purchase_indent_lines l JOIN purchase_items i ON i.id = l.item_id
         JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
        WHERE l.indent_id = $1 AND l.stock_free > 0 AND l.stock_reason IS NULL ORDER BY l.seq`,
      [indentId],
    );
    const errors = r.rows
      .filter((l) => l.need !== null && Number(l.need) <= Number(l.free) + 1e-9)
      .map((l) => ({
        path: `lines.${String(l.seq - 1)}.stockReason`,
        message: `${l.name}: the store has ${qtyWords(Number(l.free))} ${l.unit} free, enough for this. Say why it is bought, or ask the store to issue it`,
      }));
    if (errors.length)
      throw new DomainError('validation-failed', errors.map((e) => e.message).join('; '), {
        status: 400,
        extra: { errors },
      });
  }

  private checkDate(day?: string) {
    if (!day) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    if (day < today)
      throw new DomainError('validation-failed', 'The required-by date is in the past', {
        status: 400,
      });
  }

  async create(ctx: RequestContext, dto: IndentDto) {
    this.checkDate(dto.requiredBy);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const dep = await this.departmentFor(c, ctx, dto.departmentId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO purchase_indents (school_id, department_id, raised_by, on_behalf_employee_id, purpose, required_by, priority)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2, $3, $4, $5) RETURNING id::text`,
        [dep.id, dto.onBehalfEmployeeId ?? null, dto.purpose, dto.requiredBy ?? null, dto.priority],
      );
      const id = r.rows[0]!.id;
      await this.writeLines(c, ctx, id, dep.id, dto.lines);
      await this.audit.stage(ctx, c, {
        action: 'purchase.indent.create',
        entityType: 'purchase_indents',
        entityId: id,
        after: { department: dep.name, lines: dto.lines.length },
      });
      return { id };
    });
  }

  private async mustEdit(c: PoolClient, ctx: RequestContext, id: string) {
    const pi = await this.load(c, ctx, id);
    const anyDept = ctx.permissions?.has(PURCHASE.indentAnyDepartment) ?? false;
    if (pi.raised_by !== String(ctx.user.id) && !anyDept)
      throw new DomainError('permission-denied', 'Only its raiser changes this indent', {
        status: 403,
      });
    if (pi.status !== 'draft' && pi.status !== 'sent_back')
      throw new DomainError(
        'purchase.indent_closed',
        'Only a draft or an indent sent back can be changed',
        { status: 409 },
      );
    return pi;
  }

  async update(ctx: RequestContext, id: string, dto: IndentDto) {
    this.checkDate(dto.requiredBy);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustEdit(c, ctx, id);
      const dep = await this.departmentFor(c, ctx, dto.departmentId);
      await c.query(
        `UPDATE purchase_indents SET department_id = $2, on_behalf_employee_id = $3, purpose = $4, required_by = $5, priority = $6, updated_at = now()
          WHERE id = $1`,
        [
          id,
          dep.id,
          dto.onBehalfEmployeeId ?? null,
          dto.purpose,
          dto.requiredBy ?? null,
          dto.priority,
        ],
      );
      await this.writeLines(c, ctx, id, dep.id, dto.lines);
      await this.audit.stage(ctx, c, {
        action: 'purchase.indent.update',
        entityType: 'purchase_indents',
        entityId: id,
        after: { lines: dto.lines.length },
      });
      return { id };
    });
  }

  /** Sent to the department's PI levels (a number given on the first submit). */
  async submit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pi = await this.mustEdit(c, ctx, id);
      const flow = await syncFlow(c, 'indent', pi.department_id);
      if (!flow.levels)
        throw new DomainError(
          'purchase.no_approvers',
          `Who approves ${flow.department}'s Purchase Indents is not set: ask the school admin (Purchase → Who approves)`,
          { status: 409 },
        );
      // what the stores hold now; a line they can cover needs the raiser's reason
      await this.noteStock(c, id, pi.department_id);
      await this.stockCheck(c, id);
      let number = pi.number;
      if (!number)
        number = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('indent') AS n`))
          .rows[0]!.n;
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: flow.code,
        entityType: 'purchase_indent',
        entityId: id,
        // no amount here: the raiser opens the approval too, and does not see rates
        subject: `${number} · ${flow.department}${pi.priority === 'urgent' ? ' · urgent' : ''}`,
        payload: {
          department: flow.department,
          departmentId: pi.department_id,
          amount: Number(pi.estimate),
          number,
        },
      });
      await c.query(
        `UPDATE purchase_indents SET number = $2, status = 'submitted', workflow_instance_id = $3, submitted_at = now(),
                decision_note = NULL, updated_at = now() WHERE id = $1`,
        [id, number, instance.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.indent.submit',
        entityType: 'purchase_indents',
        entityId: id,
        after: { number, instance: instance.id },
      });
      return { id, number };
    });
  }

  /** Approve, reject (reason) or send back (reason) — by the current level's approver or their delegate. */
  async decide(ctx: RequestContext, id: string, dto: IndentDecisionDto) {
    if (dto.action !== 'approve' && (dto.note ?? '').length < 3)
      throw new DomainError(
        'validation-failed',
        dto.action === 'reject' ? 'Give the reason for rejecting' : 'Say what to change',
        { status: 400 },
      );
    const tenant = requireTenant(ctx);
    const found = await this.db.tenant(tenant, async (c) => {
      const pi = await this.load(c, ctx, id);
      if (pi.status !== 'submitted' || !pi.workflow_instance_id)
        throw new DomainError('purchase.not_waiting', 'This indent is not waiting for approval', {
          status: 409,
        });
      if (pi.raised_by === String(ctx.user.id))
        throw new DomainError(
          'workflow.self_approval',
          'You raised this indent: another approver decides it',
          { status: 403 },
        );
      const s = await c.query<{ id: string }>(MY_STEP, [pi.workflow_instance_id]);
      if (!s.rows[0])
        throw new DomainError('workflow.not_assignee', 'This indent is not waiting for you', {
          status: 403,
        });
      if (dto.action === 'send_back') {
        await this.workflow.cancelIn(c, ctx, pi.workflow_instance_id, `Sent back: ${dto.note!}`);
        await c.query(
          `UPDATE purchase_indents SET status = 'sent_back', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
          [id, dto.note],
        );
        await this.audit.stage(ctx, c, {
          action: 'purchase.indent.send_back',
          entityType: 'purchase_indents',
          entityId: id,
          after: { note: dto.note },
        });
      }
      return s.rows[0].id;
    });
    if (dto.action !== 'send_back')
      await this.workflow.act(ctx, found, dto.action === 'approve' ? 'approved' : 'rejected', {
        note: dto.note,
      });
    return this.get(ctx, id);
  }

  /** The raiser withdraws it: a draft, one sent back, or one no approver has approved yet. */
  async cancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pi = await this.load(c, ctx, id);
      const anyDept = ctx.permissions?.has(PURCHASE.indentAnyDepartment) ?? false;
      if (pi.raised_by !== String(ctx.user.id) && !anyDept)
        throw new DomainError('permission-denied', 'Only its raiser withdraws this indent', {
          status: 403,
        });
      if (pi.status === 'submitted' && pi.workflow_instance_id) {
        const done = await c.query(
          `SELECT 1 FROM workflow_steps WHERE instance_id = $1 AND status = 'approved'`,
          [pi.workflow_instance_id],
        );
        if (done.rowCount)
          throw new DomainError(
            'purchase.indent_closed',
            'An approver has approved it already: ask them to send it back',
            { status: 409 },
          );
        await this.workflow.cancelIn(c, ctx, pi.workflow_instance_id, `Withdrawn: ${dto.reason}`);
      } else if (pi.status !== 'draft' && pi.status !== 'sent_back')
        throw new DomainError('purchase.indent_closed', 'This indent cannot be withdrawn', {
          status: 409,
        });
      await c.query(
        `UPDATE purchase_indents SET status = 'cancelled', decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.indent.cancel',
        entityType: 'purchase_indents',
        entityId: id,
        after: { reason: dto.reason },
      });
      return { cancelled: true };
    });
  }

  // ---- the decision and the bypass rules ----------------------------------------------------------
  private async onDecided(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    // sent back or withdrawn: the caller has set the indent
    if (instance.status === 'cancelled') return;
    const id = instance.entityId;
    if (outcome === 'rejected') {
      const note = [...instance.steps].reverse().find((s) => s.status === 'rejected')?.note ?? null;
      await c.query(
        `UPDATE purchase_indents SET status = 'rejected', decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, note],
      );
      return;
    }
    await c.query(
      `UPDATE purchase_indents SET status = 'approved', decided_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.route(c, ctx, id);
  }

  /**
   * Where an approved PI goes: (a) every line a catalogue item on a valid rate contract (the department
   * allowing it) — a PR approved by the system with the contract vendors and rates, the PI to "To order";
   * (b) the estimate within the department's limit, also with its approved-by-rule PIs of the same item
   * categories in the split window — a PR approved by the system, the PI to "To order"; (c) otherwise
   * "To requisition" (the reason the limit did not apply is kept).
   */
  private async route(c: PoolClient, ctx: RequestContext, id: string) {
    const pi = (
      await c.query<{
        department_id: string;
        department: string;
        estimate: string;
        purpose: string;
        number: string;
        bypass_limit: string | null;
        rate_contract_bypass: boolean | null;
        split_window_days: number;
      }>(
        `SELECT pi.department_id::text, d.name AS department, pi.estimate::text, pi.purpose, pi.number,
                r.bypass_limit::text, r.rate_contract_bypass, s.split_window_days
           FROM purchase_indents pi JOIN departments d ON d.id = pi.department_id
           LEFT JOIN purchase_department_rules r ON r.department_id = pi.department_id
           JOIN purchase_settings s ON s.school_id = pi.school_id
          WHERE pi.id = $1`,
        [id],
      )
    ).rows[0]!;
    const lines = (
      await c.query<{
        id: string;
        item_id: string | null;
        free_text: string | null;
        quantity: string;
        uom_id: string;
        est_rate: string;
        category_id: string | null;
        contract_id: string | null;
        vendor_id: string | null;
        rate: string | null;
      }>(
        `SELECT l.id::text, l.item_id::text, l.free_text, l.quantity::text, l.uom_id::text, l.est_rate::text, i.category_id::text,
                rc.id::text AS contract_id, rc.vendor_id::text, rc.rate::text
           FROM purchase_indent_lines l LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN LATERAL (SELECT rc.id, rc.vendor_id, rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                               WHERE rc.item_id = l.item_id AND rc.status = 'active'
                                 AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1) rc ON true
          WHERE l.indent_id = $1 ORDER BY l.seq`,
        [id],
      )
    ).rows;
    const estimate = Number(pi.estimate);
    const limit = Number(pi.bypass_limit ?? 0);
    let rule: 'rate_contract' | 'under_limit' | null = null;
    let note: string | null = null;
    if (pi.rate_contract_bypass && lines.length && lines.every((l) => l.contract_id)) {
      rule = 'rate_contract';
      note = 'Auto-approved: every line is on a rate contract';
    } else if (limit > 0 && estimate <= limit && lines.some((l) => Number(l.est_rate) <= 0)) {
      // a line without a rate (one in words, or an item never bought) leaves the estimate short
      note = 'Not skipped: some lines have no rate yet (the purchase office prices them on the PR)';
    } else if (limit > 0 && estimate <= limit) {
      // the split-indent guard: this PI with the department's PIs that skipped the PR by the limit in
      // the window and share an item category with it
      const cats = [...new Set(lines.map((l) => l.category_id).filter((x): x is string => !!x))];
      const earlier = await c.query<{ number: string; estimate: string }>(
        `SELECT pi.number, pi.estimate::text FROM purchase_indents pi
          WHERE pi.department_id = $1 AND pi.id <> $2 AND pi.bypass_rule = 'under_limit'
            AND pi.decided_at >= now() - make_interval(days => $3::int)
            AND EXISTS (SELECT 1 FROM purchase_indent_lines l JOIN purchase_items i ON i.id = l.item_id
                         WHERE l.indent_id = pi.id AND i.category_id = ANY($4::bigint[]))
          ORDER BY pi.decided_at`,
        [pi.department_id, id, pi.split_window_days, cats],
      );
      const together = earlier.rows.reduce((s, r) => s + Number(r.estimate), estimate);
      if (earlier.rows.length && together > limit)
        note = `Not skipped: with ${earlier.rows.map((r) => r.number).join(', ')} of the last ${String(pi.split_window_days)} days the department's purchases of these categories come to ${rupees(together)}, over ${pi.department}'s limit of ${rupees(limit)}`;
      else {
        rule = 'under_limit';
        note = `Auto-approved: ${rupees(estimate)} is within ${pi.department}'s limit of ${rupees(limit)}`;
      }
    }
    if (!rule) {
      await c.query(
        `UPDATE purchase_indents SET route = 'to_requisition', bypass_note = $2 WHERE id = $1`,
        [id, note],
      );
      return;
    }
    const number = (
      await c.query<{ n: string }>(`SELECT app.purchase_next_number('requisition') AS n`)
    ).rows[0]!.n;
    const pr = await c.query<{ id: string }>(
      `INSERT INTO purchase_requisitions (school_id, number, department_id, purpose, status, auto_rule, auto_note, estimate, approved_at)
       VALUES (app.current_school_id(), $1, $2, $3, 'approved', $4, $5, $6, now()) RETURNING id::text`,
      [number, pi.department_id, `${pi.number}: ${pi.purpose}`, rule, note, estimate],
    );
    for (const [i, l] of lines.entries()) {
      const rl = await c.query<{ id: string }>(
        `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, free_text, quantity, uom_id, est_rate, vendor_id, rate, contract_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
        [
          pr.rows[0]!.id,
          i + 1,
          l.item_id,
          l.free_text,
          l.quantity,
          l.uom_id,
          l.est_rate,
          rule === 'rate_contract' ? l.vendor_id : null,
          rule === 'rate_contract' ? l.rate : null,
          rule === 'rate_contract' ? l.contract_id : null,
        ],
      );
      await c.query(
        `INSERT INTO purchase_requisition_sources (school_id, requisition_line_id, indent_line_id, quantity)
         VALUES (app.current_school_id(), $1, $2, $3)`,
        [rl.rows[0]!.id, l.id, l.quantity],
      );
    }
    await c.query(
      `UPDATE purchase_indents SET route = 'to_order', bypass_rule = $2, bypass_note = $3 WHERE id = $1`,
      [id, rule, note],
    );
    // every line on a contract: the draft POs at once (one per contract vendor), for the purchase office
    if (rule === 'rate_contract') await draftOrdersFor(c, pr.rows[0]!.id, null);
    await this.audit.stage(ctx, c, {
      action: 'purchase.requisition.auto_approve',
      entityType: 'purchase_requisitions',
      entityId: pr.rows[0]!.id,
      after: { indent: pi.number, rule, note },
    });
  }

  // ---- the item sheet and the line documents -------------------------------------------------------
  /** The indent's item sheet: the item list as a drop-down, the quantity, a note; an item in words. */
  async itemSheet(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const items = await c.query<{ label: string }>(
        `SELECT i.name || ' (' || i.code || ')' AS label FROM purchase_items i
          WHERE i.status = 'active' ORDER BY i.name LIMIT 5000`,
      );
      const uoms = await c.query<{ code: string }>(
        `SELECT code FROM purchase_uoms WHERE status = 'active' ORDER BY code`,
      );
      const bytes = await templateSheet({
        sheet: 'Indent items',
        columns: [
          {
            header: 'Item',
            width: 46,
            options: items.rows.map((x) => x.label),
            note: 'Pick from the list (the code in brackets is read). Leave it empty for an item not in the list',
          },
          { header: 'Quantity', width: 11, required: true, format: 'number' },
          { header: 'Note', width: 32, note: 'Size, make, colour… (optional)' },
          { header: 'Description', width: 36, note: 'Only for an item not in the list' },
          {
            header: 'Unit',
            width: 10,
            options: uoms.rows.map((x) => x.code),
            note: 'Only for an item not in the list',
          },
        ],
        guide: [
          'One row per item. Pick the item from the drop-down (or type its code), then the quantity.',
          'An item not in the list: leave Item empty, describe it in Description and pick its Unit.',
          'Items counted in whole units take whole numbers. Up to 200 rows.',
          'Upload the sheet on the indent: the rows fill its Items, to check before saving. Nothing is saved by the upload.',
        ],
        examples: [
          [items.rows[0]?.label ?? 'Ball pen (PEN)', 10, 'Blue ink', null, null],
          [null, 2, null, 'Bunsen burner', uoms.rows[0]?.code ?? 'NOS'],
        ],
      });
      return {
        filename: 'indent-items.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /**
   * The filled item sheet read into indent lines (nothing is saved): each row an item from the list
   * (by the code in brackets, the code, or the exact name) or one in words with its unit; the rows that
   * cannot be read come back with their row number and why.
   */
  async readItemSheet(ctx: RequestContext, dto: IndentSheetDto) {
    const rows = await readSheet(dto.file, ['Item', 'Quantity'], ['Note', 'Description', 'Unit']);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const items = (
        await c.query<{ id: string; code: string; name: string; decimals: boolean }>(
          `SELECT i.id::text, i.code, i.name, u.decimals FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id
            WHERE i.status = 'active'`,
        )
      ).rows;
      const byCode = new Map(items.map((i) => [i.code.toUpperCase(), i]));
      const names = new Map<string, typeof items>();
      for (const i of items)
        names.set(i.name.toLowerCase(), [...(names.get(i.name.toLowerCase()) ?? []), i]);
      const uoms = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, code FROM purchase_uoms WHERE status = 'active'`,
          )
        ).rows.map((u) => [u.code.toUpperCase(), u.id]),
      );
      const lines: Array<{
        itemId?: string;
        freeText?: string;
        uomId?: string;
        quantity: number;
        note?: string;
      }> = [];
      const errors: Array<{ row: number; message: string }> = [];
      for (const r of rows) {
        const cell = r.cells;
        const said = (cell.Item ?? '').trim();
        const qty = Number((cell.Quantity ?? '').replace(/,/g, ''));
        const note = (cell.Note ?? '').trim();
        if (!said && !(cell.Description ?? '').trim() && !cell.Quantity) continue;
        if (!Number.isFinite(qty) || qty <= 0 || qty > 999999) {
          errors.push({ row: r.row, message: 'Quantity: a number more than 0' });
          continue;
        }
        if (note.length > 300) {
          errors.push({ row: r.row, message: 'Note: at most 300 letters' });
          continue;
        }
        if (said) {
          const code = /\(([^()]+)\)\s*$/.exec(said)?.[1]?.trim().toUpperCase();
          const byName = names.get(said.toLowerCase());
          const it =
            (code ? byCode.get(code) : undefined) ??
            byCode.get(said.toUpperCase()) ??
            (byName?.length === 1 ? byName[0] : undefined);
          if (!it) {
            errors.push({
              row: r.row,
              message: `“${said}” is not in the item list: pick it from the drop-down, or leave Item empty and fill Description and Unit`,
            });
            continue;
          }
          if (!it.decimals && !Number.isInteger(qty)) {
            errors.push({ row: r.row, message: `${it.name}: a whole number` });
            continue;
          }
          lines.push({ itemId: it.id, quantity: qty, ...(note ? { note } : {}) });
        } else {
          const words = (cell.Description ?? '').trim();
          const uomId = uoms.get((cell.Unit ?? '').trim().toUpperCase());
          if (words.length < 2 || words.length > 300) {
            errors.push({ row: r.row, message: 'Pick an item, or describe one not in the list' });
            continue;
          }
          if (!uomId) {
            errors.push({
              row: r.row,
              message: 'Unit: pick the unit of an item described in words',
            });
            continue;
          }
          lines.push({ freeText: words, uomId, quantity: qty, ...(note ? { note } : {}) });
        }
      }
      if (lines.length > 200)
        throw new DomainError('validation-failed', 'At most 200 lines on an indent', {
          status: 400,
        });
      return { lines, errors };
    });
  }

  /** A line's document, sent as the request body: a PDF or a photo up to 5 MB (any raiser may attach). */
  async uploadLineFile(ctx: RequestContext, bytes: unknown, contentType: string, name: string) {
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      throw new DomainError('validation-failed', 'Send the file as the request body', {
        status: 400,
      });
    const type = contentType.split(';')[0]!.trim().toLowerCase();
    const magic =
      type === 'application/pdf'
        ? bytes.subarray(0, 4).toString('latin1') === '%PDF'
        : type === 'image/png'
          ? bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
          : type === 'image/jpeg'
            ? bytes[0] === 0xff && bytes[1] === 0xd8
            : false;
    if (!magic)
      throw new DomainError('validation-failed', 'A PDF or a photo (JPEG, PNG)', { status: 400 });
    if (bytes.length > 5_242_880)
      throw new DomainError('file.too_large', 'Up to 5 MB', { status: 413 });
    const clean =
      name
        .replace(/[\u0000-\u001f/\\]+/g, ' ')
        .trim()
        .slice(0, 200) || 'document';
    return this.files.storeBytes(ctx, {
      bytes,
      contentType: type,
      fileName: clean,
      ownerEntityType: 'purchase_indent_line',
    });
  }

  /** A line's document, for anyone who may see the indent. */
  async lineFile(ctx: RequestContext, id: string, lineId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.load(c, ctx, id);
      const f = (
        await c.query<{ object_key: string; content_type: string; original_name: string }>(
          `SELECT f.object_key, f.content_type, f.original_name FROM purchase_indent_lines l
             JOIN files f ON f.id = l.file_id AND f.deleted_at IS NULL
            WHERE l.id = $1 AND l.indent_id = $2`,
          [lineId, id],
        )
      ).rows[0];
      if (!f) throw new DomainError('not-found', 'No document on this line', { status: 404 });
      return {
        bytes: await this.storage.read(f.object_key),
        contentType: f.content_type,
        filename: f.original_name,
      };
    });
  }

  // ---- the printed PI ------------------------------------------------------------------------------
  /**
   * The PI as a PDF, once sent (docs/design/83, "As built — the printed PI"): its lines with the stock
   * when raised, the rates for those who see them, the approval trail and boxes to sign.
   */
  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pi = await this.load(c, ctx, id);
      if (!pi.number)
        throw new DomainError(
          'purchase.indent_draft',
          'A draft is printed once it is sent for approval',
          { status: 409 },
        );
      const sees = this.officeRates(ctx) || pi.approver;
      const lines = await this.linesOf(c, id);
      const steps = pi.workflow_instance_id
        ? (
            await c.query<{
              name: string;
              status: string;
              who: string | null;
              waiting: string | null;
              at: string | null;
              note: string | null;
            }>(
              // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
              `SELECT s.name, s.status::text, ${PERSON('u')} AS who,
                      (SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au WHERE au.id = ANY(s.assignee_user_ids)) AS waiting,
                      (s.acted_at AT TIME ZONE 'Asia/Kolkata')::date::text AS at, s.note
                 FROM workflow_steps s LEFT JOIN users u ON u.id = s.acted_by
                WHERE s.instance_id = $1 ORDER BY s.level`,
              [pi.workflow_instance_id],
            )
          ).rows
        : [];
      const STEP: Record<string, string> = {
        pending: 'Waiting',
        approved: 'Approved',
        rejected: 'Rejected',
        skipped: 'Passed on',
        cancelled: 'Closed',
      };
      const head = await purchaseHead(c, this.storage);
      const STATUS: Record<IndentDbRow['status'], string> = {
        draft: 'Draft',
        submitted: `Waiting for approval${pi.waiting_with ? `: ${pi.waiting_with}` : ''}`,
        approved: `Approved${pi.decided_at ? ` on ${istDay(pi.decided_at)}` : ''}`,
        rejected: `Rejected${pi.decision_note ? `: ${pi.decision_note}` : ''}`,
        sent_back: `Sent back for changes${pi.decision_note ? `: ${pi.decision_note}` : ''}`,
        cancelled: `Withdrawn${pi.decision_note ? `: ${pi.decision_note}` : ''}`,
      };
      const bytes = await purchaseIndentPdf({
        school: { name: head.school, address: head.address || null },
        logo: head.logo,
        generatedOn: head.generatedOn,
        watermark:
          pi.status === 'approved'
            ? null
            : pi.status === 'rejected'
              ? 'REJECTED'
              : pi.status === 'cancelled'
                ? 'WITHDRAWN'
                : 'NOT APPROVED',
        number: pi.number,
        sentOn: pi.submitted_at ? istDay(pi.submitted_at) : '-',
        department: pi.department,
        raisedBy: `${pi.raised_by_name}${pi.on_behalf ? ` for ${pi.on_behalf}` : ''}`,
        purpose: pi.purpose,
        priority: pi.priority,
        requiredBy: pi.required_by ? dmy(pi.required_by) : null,
        status: STATUS[pi.status],
        showRates: sees,
        lines: lines.map((l) => ({
          seq: l.seq,
          description: `${l.item ?? l.free_text ?? ''}${l.item_code ? ` (${l.item_code})` : ''}${l.item_id ? '' : ' - not in the item list'}`,
          note: l.note,
          quantity: Number(l.quantity),
          uom: l.uom,
          stockFree: l.stock_free === null ? null : Number(l.stock_free),
          stockUom: l.stock_uom,
          stockStores: l.stock_stores,
          stockReason: l.stock_reason,
          document: l.file_id !== null,
          rate: sees ? Number(l.est_rate) : null,
          amount: sees ? Math.round(Number(l.quantity) * Number(l.est_rate) * 100) / 100 : null,
        })),
        estimate: sees ? Number(pi.estimate) : null,
        approvals: steps.map((s) => ({
          level: s.name,
          status: STEP[s.status] ?? s.status,
          who: s.who ?? (s.status === 'pending' ? (s.waiting ?? 'Nobody') : '-'),
          at: s.at ? dmy(s.at) : '',
          note: s.note,
        })),
        printedOn: istDay(new Date()),
      });
      return { bytes, filename: `${pi.number.replaceAll('/', '-')}.pdf` };
    });
  }

  // ---- purchase-only delegation -------------------------------------------------------------------
  async delegations(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const all = ctx.permissions?.has(PURCHASE.settingsManage) ?? false;
      const r = await c.query<{
        id: string;
        from_name: string;
        to_name: string;
        starts_at: Date;
        ends_at: Date;
        reason: string;
        revoked_at: Date | null;
        mine: boolean;
        active: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT d.id::text, ${PERSON('fu')} AS from_name, ${PERSON('tu')} AS to_name, d.starts_at, d.ends_at, d.reason, d.revoked_at,
                (d.from_user_id = app.current_user_id()) AS mine,
                (d.revoked_at IS NULL AND now() BETWEEN d.starts_at AND d.ends_at) AS active
           FROM delegations d JOIN users fu ON fu.id = d.from_user_id JOIN users tu ON tu.id = d.to_user_id
          WHERE (d.scope = 'purchase' OR d.role_id IS NOT NULL)
            AND ($1 OR d.from_user_id = app.current_user_id() OR d.to_user_id = app.current_user_id())
            AND d.ends_at > now() - INTERVAL '30 days'
          ORDER BY d.starts_at DESC LIMIT 200`,
        [all],
      );
      const staff = await c.query<{
        id: string;
        userId: string;
        code: string;
        name: string;
        designation: string | null;
      }>(
        `SELECT e.id::text, e.user_id::text AS "userId", e.employee_code AS code, e.display_name AS name, e.designation FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.user_id IS NOT NULL AND e.user_id <> app.current_user_id()
          ORDER BY e.display_name LIMIT 3000`,
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          from: x.from_name,
          to: x.to_name,
          startsAt: x.starts_at.toISOString(),
          endsAt: x.ends_at.toISOString(),
          reason: x.reason,
          revoked: x.revoked_at !== null,
          active: x.active,
          mine: x.mine,
        })),
        staff: staff.rows,
        canForOthers: all,
      };
    });
  }

  async delegate(ctx: RequestContext, dto: PurchaseDelegationDto) {
    const forOther = dto.fromUserId && dto.fromUserId !== String(ctx.user.id);
    if (forOther && !ctx.permissions?.has(PURCHASE.settingsManage))
      throw new DomainError(
        'permission-denied',
        'Only the school admin hands over someone else’s approvals',
        { status: 403 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const to = await c.query<{ user_id: string | null; name: string }>(
        `SELECT user_id::text, display_name AS name FROM employees WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [dto.toEmployeeId],
      );
      const toUser = to.rows[0]?.user_id;
      if (!toUser)
        throw new DomainError('validation-failed', 'Pick a colleague who can sign in', {
          status: 400,
        });
      const from = forOther ? dto.fromUserId! : String(ctx.user.id);
      if (toUser === from)
        throw new DomainError('validation-failed', 'Hand them to someone else', { status: 400 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO delegations (school_id, from_user_id, to_user_id, role_id, scope, starts_at, ends_at, reason, created_by)
         VALUES (app.current_school_id(), $1, $2, NULL, 'purchase', ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata',
                 (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 second', $5, app.current_user_id())
         RETURNING id::text`,
        [from, toUser, dto.startsOn, dto.endsOn, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.delegation.create',
        entityType: 'delegations',
        entityId: r.rows[0]!.id,
        after: { from, to: toUser, startsOn: dto.startsOn, endsOn: dto.endsOn, reason: dto.reason },
      });
      return { id: r.rows[0]!.id, to: to.rows[0]!.name };
    });
  }

  async revokeDelegation(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE delegations SET revoked_at = now(), updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1 AND scope = 'purchase' AND revoked_at IS NULL AND ($2 OR from_user_id = app.current_user_id())`,
        [id, ctx.permissions?.has(PURCHASE.settingsManage) ?? false],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Delegation not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'purchase.delegation.revoke',
        entityType: 'delegations',
        entityId: id,
      });
      return { revoked: true };
    });
  }
}
