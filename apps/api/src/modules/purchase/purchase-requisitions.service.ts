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
import { purchaseHead } from './purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from './purchase-list-file';
import { purchaseRequisitionPdf, type RequisitionPdfData } from './purchase-requisition-pdf';
import {
  issuedAgainst,
  releaseRequisition,
  reserveRequisition,
  storeProblems,
} from './purchase-stock-core';
import { itemSheetBytes, readItemRows, type SheetKind } from './purchase-item-sheet';
import {
  draftOrdersFor,
  LINE_ORDERING,
  orderingWords,
  type LineOrderingRow,
} from './purchase-order-core';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  PURCHASE,
  type CertificateDto,
  type ChoicesDto,
  type CreateRequisitionDto,
  type RequisitionSheetDto,
  type IndentDecisionDto,
  type QuoteDto,
  type ReasonDto,
  type RequisitionFileDto,
  type RequisitionExportQueryDto,
  type RequisitionListQueryDto,
  type SignDto,
  type TenderDto,
  type UpdateRequisitionDto,
} from './purchase.dto';

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A rate with its GST: what the school pays per unit (the comparative statement ranks on it). */
const landed = (rate: number, gst: number) => round2(rate * (1 + gst / 100));
const PR_STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  sourcing: 'Sourcing',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back for changes',
  cancelled: 'Cancelled',
  part_ordered: 'Partly ordered',
  ordered: 'Ordered',
};
const TIER_WORDS: Record<string, string> = {
  none: 'No sourcing needed',
  direct: 'Direct purchase',
  committee: 'Purchase committee',
  tender: 'Tender',
};
const PR_RULE_WORDS: Record<string, string> = {
  rate_contract: 'rate contract',
  under_limit: 'under the limit',
};
const OPEN = ['draft', 'sourcing', 'sent_back'] as const;
type Tier = 'none' | 'direct' | 'committee' | 'tender';

/** The GFR 2017 rule 154 certificate, offered as the starting text. */
export const PRICE_CERTIFICATE =
  'I am personally satisfied that the goods purchased are of the requisite quality and specification and have been purchased from a reliable supplier at a reasonable price.';

/** A user's name as staff know it: their employee record's, else the account's. */
const PERSON = (u: 'au' | 'cu' | 'u' | 'su') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases above
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

interface PrRow {
  id: string;
  number: string;
  department_id: string | null;
  department: string | null;
  combined: boolean;
  purpose: string | null;
  required_by: string | null;
  status: string;
  tier: Tier | null;
  auto_rule: string | null;
  auto_note: string | null;
  estimate: string;
  price_certificate: string | null;
  certified_by: string | null;
  certified_at: Date | null;
  tender_ref: string | null;
  tender_note: string | null;
  workflow_instance_id: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  approved_at: Date | null;
  decision_note: string | null;
  revision: number;
  no_approval_note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  waiting_with: string | null;
  lines: number;
  quotes: number;
}

// eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
const SELECT = `
  SELECT r.id::text, r.number, r.department_id::text, d.name AS department, r.combined, r.purpose, r.required_by::text,
         r.status, r.tier, r.auto_rule, r.auto_note, r.estimate::text, r.price_certificate,
         (SELECT ${PERSON('cu')} FROM users cu WHERE cu.id = r.certified_by) AS certified_by, r.certified_at,
         r.tender_ref, r.tender_note, r.workflow_instance_id::text, r.submitted_at, r.decided_at, r.approved_at,
         r.decision_note, r.revision, r.no_approval_note, r.created_by::text,
         (SELECT ${PERSON('u')} FROM users u WHERE u.id = r.created_by) AS created_by_name, r.created_at,
         (SELECT st.name || ' (' || COALESCE((SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody') || ')'
            FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
           WHERE i.id = r.workflow_instance_id AND i.status = 'pending') AS waiting_with,
         (SELECT count(*)::int FROM purchase_requisition_lines l WHERE l.requisition_id = r.id) AS lines,
         (SELECT count(*)::int FROM purchase_quotes q WHERE q.requisition_id = r.id) AS quotes
    FROM purchase_requisitions r
    LEFT JOIN departments d ON d.id = r.department_id`;

/** The step of an instance the signed-in user may act on now (as an approver or someone's delegate). */
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;

/** I am on the purchase committee. */
const ON_COMMITTEE = `EXISTS (SELECT 1 FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
    WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL)`;
const PARTICIPANT = `EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances wi ON wi.id = s.instance_id
    WHERE wi.entity_type = 'purchase_requisition' AND wi.entity_id = r.id
      AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()
           OR EXISTS (SELECT 1 FROM delegations dl WHERE dl.to_user_id = app.current_user_id() AND dl.from_user_id = ANY(s.assignee_user_ids)
                        AND dl.revoked_at IS NULL)))`;
/** I raised (or am the colleague of) one of its indents: I follow it, read-only. */
const RAISER = `EXISTS (SELECT 1 FROM purchase_requisition_lines rl JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
    JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
    WHERE rl.requisition_id = r.id AND (pi.raised_by = app.current_user_id()
      OR EXISTS (SELECT 1 FROM employees e WHERE e.id = pi.on_behalf_employee_id AND e.user_id = app.current_user_id())))`;
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is the engine's fixed fragment
const WAITING = `EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
    WHERE i.id = r.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'
      AND ${WorkflowService.MAY_ACT})`;
// eslint-disable-next-line no-restricted-syntax -- ON_COMMITTEE is a fixed fragment
const TO_SIGN = `(r.status IN ('draft', 'sourcing', 'sent_back') AND r.tier = 'committee' AND ${ON_COMMITTEE}
    AND EXISTS (SELECT 1 FROM purchase_quotes q WHERE q.requisition_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM purchase_cs_signoffs so JOIN employees e ON e.id = so.employee_id
                     WHERE so.requisition_id = r.id AND e.user_id = app.current_user_id()))`;

interface LineRow {
  id: string;
  seq: number;
  item_id: string | null;
  item_code: string | null;
  item: string | null;
  free_text: string | null;
  quantity: string;
  uom_id: string;
  uom: string;
  decimals: boolean;
  est_rate: string;
  fulfil: 'buy' | 'store';
  store_note: string | null;
  store_id: string | null;
  store: string | null;
  stock_tracked: boolean;
  per_unit: string;
  in_store: string | null;
  reserved_in_store: string | null;
  held: string;
  issued: string;
  note: string | null;
  vendor_id: string | null;
  vendor: string | null;
  vendor_status: string | null;
  rate: string | null;
  gst_rate: string | null;
  choice_reason: string | null;
  contract_id: string | null;
  item_gst: string | null;
  /** the rate contract the line is bought on is still in force (true when on none) */
  contract_ok: boolean;
}

/** An item's rate contract in force: its vendor (active), rate, the GST the vendor charges, landed cost. */
export interface ContractInForce {
  id: string;
  vendorId: string;
  vendor: string;
  vendorCode: string;
  rate: number;
  gstRate: number;
  landed: number;
  validTo: string;
}

/**
 * The Purchase Requisition (docs/design/83, part 3): the purchase office combines approved indents (the
 * same item's lines added up, each indent line kept as the source) or raises its own; marks lines bought
 * or issued from the store; sources them by the tier of the PR's value — direct (one vendor and the
 * reasonable-price certificate), the committee (quotes, the comparative statement with L1 marked, a
 * reason for a dearer choice, the committee's signatures) or a tender (its reference and documents);
 * then the department's PR levels approve it (the purchase office's department for a combined PR).
 * Purchase orders from approved PRs are part 4.
 */
const REQUISITION_SHEET: SheetKind = {
  sheet: 'Requisition items',
  file: 'requisition-items.xlsx',
  on: 'the requisition',
  rate: true,
  merge: true,
};

@Injectable()
export class PurchaseRequisitionsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('purchase_requisition', (c, ctx, instance, outcome) =>
      this.onDecided(c, ctx, instance, outcome),
    );
  }

  private manages(ctx: RequestContext) {
    return ctx.permissions?.has(PURCHASE.requisitionManage) ?? false;
  }
  private seesAll(ctx: RequestContext) {
    return this.manages(ctx) || (ctx.permissions?.has(PURCHASE.indentView) ?? false);
  }
  private mustManage(ctx: RequestContext) {
    if (!this.manages(ctx))
      throw new DomainError('permission-denied', 'Only the purchase office makes requisitions', {
        status: 403,
      });
  }

  private async settings(c: PoolClient) {
    await PurchaseVendorsService.seed(c);
    return (
      await c.query<{
        direct_limit: string;
        committee_limit: string;
        committee_quotes: number;
        committee_signatures: number | null;
        purchase_department_id: string | null;
        direct_pr_limit: string;
        split_window_days: number;
      }>(
        `SELECT direct_limit::text, committee_limit::text, committee_quotes, committee_signatures, purchase_department_id::text,
                direct_pr_limit::text, split_window_days
           FROM purchase_settings WHERE school_id = app.current_school_id()`,
      )
    ).rows[0]!;
  }

  private tierOf(
    value: number,
    buyLines: number,
    s: { direct_limit: string; committee_limit: string },
  ): Tier {
    if (!buyLines) return 'none';
    if (value <= Number(s.direct_limit)) return 'direct';
    if (value <= Number(s.committee_limit)) return 'committee';
    return 'tender';
  }

  /**
   * The PR's figures again after a change: the estimate (what it will cost: the chosen rate, else the
   * estimate, of the lines bought) and the tier of the larger of the band's estimated and chosen totals.
   * A line bought on its rate contract is left out of the band (the contract was already won
   * competitively: it needs no quotes); a PR of only such lines (and lines from the store) is 'none'.
   */
  private async refresh(c: PoolClient, id: string) {
    const s = await this.settings(c);
    const f = (
      await c.query<{ est: string; band_chosen: string; chosen: string; buy: number }>(
        `SELECT COALESCE(sum(quantity * est_rate) FILTER (WHERE fulfil = 'buy' AND contract_id IS NULL), 0)::text AS est,
                COALESCE(sum(quantity * COALESCE(rate, est_rate)) FILTER (WHERE fulfil = 'buy' AND contract_id IS NULL), 0)::text AS band_chosen,
                COALESCE(sum(quantity * COALESCE(rate, est_rate)) FILTER (WHERE fulfil = 'buy'), 0)::text AS chosen,
                (count(*) FILTER (WHERE fulfil = 'buy' AND contract_id IS NULL))::int AS buy
           FROM purchase_requisition_lines WHERE requisition_id = $1`,
        [id],
      )
    ).rows[0]!;
    const chosen = round2(Number(f.chosen));
    const value = Math.max(Number(f.est), Number(f.band_chosen));
    const tier = this.tierOf(value, f.buy, s);
    await c.query(
      `UPDATE purchase_requisitions SET estimate = $2, tier = $3, updated_at = now() WHERE id = $1`,
      [id, chosen, tier],
    );
    return { estimate: chosen, value: round2(value), tier };
  }

  /**
   * The rate contracts in force for these items: the active vendor's, the lowest rate if several; the
   * GST the vendor charges (a regular vendor: the item's rate; others none), and the landed cost.
   */
  private async contractsFor(c: PoolClient, itemIds: string[]) {
    const out = new Map<string, ContractInForce>();
    if (!itemIds.length) return out;
    const r = await c.query<{
      item_id: string;
      id: string;
      vendor_id: string;
      vendor: string;
      vendor_code: string;
      gst_status: string;
      rate: string;
      valid_to: string;
      item_gst: string | null;
    }>(
      `SELECT DISTINCT ON (rc.item_id) rc.item_id::text, rc.id::text, rc.vendor_id::text, v.legal_name AS vendor, v.code AS vendor_code,
              v.gst_status, rc.rate::text, rc.valid_to::text, COALESCE(i.gst_rate, h.gst_rate)::text AS item_gst
         FROM purchase_rate_contracts rc
         JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
         JOIN purchase_items i ON i.id = rc.item_id
         LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
        WHERE rc.item_id = ANY($1::bigint[]) AND rc.status = 'active'
          AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to
        ORDER BY rc.item_id, rc.rate, rc.valid_to DESC`,
      [itemIds],
    );
    for (const x of r.rows) {
      const gst = x.gst_status === 'regular' ? Number(x.item_gst ?? 0) : 0;
      out.set(x.item_id, {
        id: x.id,
        vendorId: x.vendor_id,
        vendor: x.vendor,
        vendorCode: x.vendor_code,
        rate: Number(x.rate),
        gstRate: gst,
        landed: landed(Number(x.rate), gst),
        validTo: x.valid_to,
      });
    }
    return out;
  }

  /**
   * The lines bought with no vendor chosen yet start on their item's rate contract (its vendor and
   * rate); the purchase officer may change it (another vendor dearer than the contract needs a reason).
   */
  private async fillContracts(c: PoolClient, prId: string) {
    const open = (
      await c.query<{ id: string; item_id: string }>(
        `SELECT id::text, item_id::text FROM purchase_requisition_lines
          WHERE requisition_id = $1 AND fulfil = 'buy' AND item_id IS NOT NULL AND vendor_id IS NULL`,
        [prId],
      )
    ).rows;
    const contracts = await this.contractsFor(c, [...new Set(open.map((l) => l.item_id))]);
    for (const l of open) {
      const k = contracts.get(l.item_id);
      if (!k) continue;
      await c.query(
        `UPDATE purchase_requisition_lines SET vendor_id = $2, rate = $3, gst_rate = $4, contract_id = $5, choice_reason = NULL
          WHERE id = $1 AND vendor_id IS NULL`,
        [l.id, k.vendorId, k.rate, k.gstRate, k.id],
      );
    }
  }

  /** The comparative statement changed: the committee's signatures no longer hold. */
  private async clearSignatures(c: PoolClient, ctx: RequestContext, id: string, why: string) {
    const r = await c.query(`DELETE FROM purchase_cs_signoffs WHERE requisition_id = $1`, [id]);
    if (r.rowCount)
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.signatures_cleared',
        entityType: 'purchase_requisitions',
        entityId: id,
        after: { why, signatures: r.rowCount },
      });
    return r.rowCount ?? 0;
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string): Promise<PrRow> {
    const r = await c.query<PrRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE r.id = $1 AND ($2 OR ${PARTICIPANT} OR ${RAISER} OR (r.tier = 'committee' AND ${ON_COMMITTEE}))`,
      [id, this.seesAll(ctx)],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Requisition not found', { status: 404 });
    return r.rows[0];
  }

  private async mustBeOpen(c: PoolClient, ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    const pr = await this.load(c, ctx, id);
    if (!(OPEN as readonly string[]).includes(pr.status))
      throw new DomainError(
        'purchase.requisition_closed',
        pr.status === 'approved'
          ? 'It is approved: reopen it to change it (it is approved again)'
          : 'This requisition cannot be changed now',
        { status: 409 },
      );
    if (pr.auto_rule)
      throw new DomainError(
        'purchase.requisition_closed',
        'Made and approved by the system under a bypass rule: it is not changed',
        { status: 409 },
      );
    return pr;
  }

  private shape(r: PrRow) {
    return {
      id: r.id,
      number: r.number,
      departmentId: r.department_id,
      department: r.department,
      combined: r.combined,
      purpose: r.purpose,
      requiredBy: r.required_by,
      status: r.status,
      tier: r.tier,
      autoRule: r.auto_rule,
      autoNote: r.auto_note,
      /** a direct PR approved by the system within the limit (Purchase settings) */
      noApprovalNote: r.no_approval_note,
      estimate: Number(r.estimate),
      workflowInstanceId: r.workflow_instance_id,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      approvedAt: r.approved_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      revision: r.revision,
      createdBy: r.created_by_name,
      createdAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      lines: r.lines,
      quotes: r.quotes,
    };
  }

  // ---- lists -------------------------------------------------------------------------------------
  /** The list's filters as SQL ($1-$9), the same for the screen and its file. */
  private filterOf(ctx: RequestContext, q: RequisitionExportQueryDto | RequisitionListQueryDto) {
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
    const where = `WHERE ($1::text IS NULL OR r.status = $1)
          AND ($2::text IS NULL OR r.number ILIKE $2 OR r.purpose ILIKE $2)
          AND CASE $3 WHEN 'waiting' THEN ${WAITING}
                      WHEN 'sign' THEN ${TO_SIGN}
                      ELSE ($4 OR ${PARTICIPANT} OR ${RAISER} OR (r.tier = 'committee' AND ${ON_COMMITTEE})) END
          AND ($5::bigint IS NULL OR r.department_id = $5::bigint OR EXISTS (
                SELECT 1 FROM purchase_requisition_lines rl JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
                  JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                 WHERE rl.requisition_id = r.id AND pi.department_id = $5::bigint))
          AND ($6::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $6::date)
          AND ($7::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $7::date)
          AND ($8::text IS NULL OR EXISTS (
                SELECT 1 FROM purchase_requisition_lines rl JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
                  JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                 WHERE rl.requisition_id = r.id AND pi.number ILIKE $8))
          AND ($9::bigint IS NULL OR EXISTS (SELECT 1 FROM purchase_requisition_lines rl WHERE rl.requisition_id = r.id AND rl.vendor_id = $9::bigint))`;
    const args = [
      q.status ?? null,
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

  async list(ctx: RequestContext, q: RequisitionListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = this.filterOf(ctx, q);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM purchase_requisitions r ${where}`,
        args,
      );
      const rows = await c.query<PrRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY COALESCE(r.submitted_at, r.created_at) DESC LIMIT $10 OFFSET $11`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const counts = (
        await c.query<{ waiting: number; sign: number; to_requisition: number }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments
          `SELECT (SELECT count(*)::int FROM purchase_requisitions r WHERE r.status = 'submitted' AND ${WAITING}) AS waiting,
                  (SELECT count(*)::int FROM purchase_requisitions r WHERE ${TO_SIGN}) AS sign,
                  (SELECT count(*)::int FROM purchase_indents WHERE status = 'approved' AND route = 'to_requisition') AS to_requisition`,
        )
      ).rows[0]!;
      return {
        data: rows.rows.map((r) => this.shape(r)),
        total: total.rows[0]!.n,
        page: q.page,
        size: q.size,
        waitingForMe: counts.waiting,
        toSign: counts.sign,
        toRequisition: this.seesAll(ctx) ? counts.to_requisition : 0,
      };
    });
  }

  /**
   * The list as on screen (its filters, every page) as Excel or PDF, with the letterhead; the Excel adds
   * a sheet of the item lines (vendor, rate, GST, on rate contract, the indents) (docs/design/83).
   */
  async exportList(ctx: RequestContext, q: RequisitionExportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { where, args } = this.filterOf(ctx, q);
      const rows = (
        await c.query<PrRow>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `${SELECT} ${where} ORDER BY r.created_at DESC LIMIT $10`,
          [...args, LIST_LIMIT],
        )
      ).rows;
      checkListSize(rows.length, 'requisitions');
      const ids = rows.map((r) => r.id);
      const extra = new Map(
        (
          await c.query<{ id: string; indents: string | null; vendors: string | null }>(
            `SELECT r.id::text,
                    (SELECT string_agg(DISTINCT pi.number, ', ') FROM purchase_requisition_lines rl
                       JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
                       JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                      WHERE rl.requisition_id = r.id) AS indents,
                    (SELECT string_agg(DISTINCT v.legal_name, ', ') FROM purchase_requisition_lines rl JOIN vendors v ON v.id = rl.vendor_id
                      WHERE rl.requisition_id = r.id) AS vendors
               FROM purchase_requisitions r WHERE r.id = ANY($1::bigint[])`,
            [ids],
          )
        ).rows.map((x) => [x.id, x]),
      );
      const day = (t: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);
      const list = {
        columns: [
          { label: 'Requisition', width: 2.2 },
          { label: 'Date', type: 'date' as const },
          { label: 'Department', width: 2.2 },
          { label: 'Purpose', width: 3.2 },
          { label: 'From indents', width: 2.4 },
          { label: 'Sourcing', width: 2 },
          { label: 'Lines', type: 'number' as const, width: 0.9 },
          { label: 'Vendors chosen', width: 3 },
          { label: 'Value (₹)', type: 'money' as const },
          { label: 'Status', width: 1.8 },
          { label: 'Where it is', width: 2.6 },
        ],
        rows: rows.map((r) => [
          r.number,
          day(r.created_at),
          `${r.department ?? ''}${r.combined ? ' (combined)' : ''}`,
          r.purpose,
          extra.get(r.id)?.indents ?? '',
          r.auto_rule
            ? `By the system: ${PR_RULE_WORDS[r.auto_rule] ?? r.auto_rule}`
            : r.tier
              ? (TIER_WORDS[r.tier] ?? r.tier)
              : '',
          r.lines,
          extra.get(r.id)?.vendors ?? '',
          Number(r.estimate),
          PR_STATUS_WORDS[r.status] ?? r.status,
          r.status === 'submitted' && r.waiting_with
            ? `With ${r.waiting_with}`
            : r.approved_at
              ? `Approved ${day(r.approved_at).split('-').reverse().join('-')}`
              : (r.decision_note ?? ''),
        ]),
      };
      let lines;
      if (q.format === 'xlsx' && ids.length) {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const l = await c.query<{
          requisition_id: string;
          seq: number;
          code: string | null;
          item: string;
          quantity: string;
          uom: string;
          fulfil: 'buy' | 'store';
          store: string | null;
          vendor: string | null;
          rate: string | null;
          est_rate: string;
          gst_rate: string | null;
          contract: boolean;
          indents: string | null;
        }>(
          `SELECT l.requisition_id::text, l.seq, i.code, COALESCE(i.name, l.free_text) AS item, l.quantity::text, u.code AS uom,
                  l.fulfil, st.name AS store, v.legal_name AS vendor, l.rate::text, l.est_rate::text, l.gst_rate::text,
                  l.contract_id IS NOT NULL AS contract,
                  (SELECT string_agg(DISTINCT pi.number, ', ') FROM purchase_requisition_sources src
                     JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
                    WHERE src.requisition_line_id = l.id) AS indents
             FROM purchase_requisition_lines l
             LEFT JOIN purchase_items i ON i.id = l.item_id
             JOIN purchase_uoms u ON u.id = l.uom_id
             LEFT JOIN vendors v ON v.id = l.vendor_id
             LEFT JOIN stores st ON st.id = l.store_id
            WHERE l.requisition_id = ANY($1::bigint[]) ORDER BY l.requisition_id DESC, l.seq`,
          [ids],
        );
        lines = {
          columns: [
            { label: 'Requisition', width: 2.2 },
            { label: '#', type: 'number' as const, width: 0.6 },
            { label: 'Item code', width: 2 },
            { label: 'Item', width: 3.4 },
            { label: 'Quantity', type: 'number' as const },
            { label: 'Unit', width: 1 },
            { label: 'Buy or from the store', width: 2.2 },
            { label: 'Vendor', width: 3 },
            { label: 'Rate (₹)', type: 'money' as const },
            { label: 'GST %', type: 'number' as const, width: 1 },
            { label: 'Amount before GST (₹)', type: 'money' as const },
            { label: 'On rate contract', width: 1.4 },
            { label: 'From indents', width: 2.4 },
          ],
          rows: l.rows.map((x) => {
            const rate = x.fulfil === 'store' ? null : Number(x.rate ?? x.est_rate);
            return [
              byId.get(x.requisition_id)!.number,
              x.seq,
              x.code,
              x.item,
              Number(x.quantity),
              x.uom,
              x.fulfil === 'store' ? `From the store${x.store ? `: ${x.store}` : ''}` : 'Buy',
              x.vendor,
              rate,
              x.gst_rate === null ? null : Number(x.gst_rate),
              rate === null ? null : Math.round(Number(x.quantity) * rate * 100) / 100,
              x.contract ? 'Yes' : '',
              x.indents,
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
          q.view === 'waiting' ? 'Waiting for me' : q.view === 'sign' ? 'To sign' : null,
          dept ? `Department: ${dept}` : null,
          q.from && q.to
            ? `${dmy(q.from)} to ${dmy(q.to)}`
            : q.from
              ? `From ${dmy(q.from)}`
              : q.to
                ? `Up to ${dmy(q.to)}`
                : null,
          q.status ? `Status: ${PR_STATUS_WORDS[q.status] ?? q.status}` : null,
          q.indent ? `Indent: ${q.indent}` : null,
          vendor ? `Vendor: ${vendor}` : null,
          q.q ? `Search: ${q.q}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'All requisitions';
      return purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: 'Purchase Requisitions',
        slug: 'Purchase-Requisitions',
        words,
        list,
        sum: [8],
        ...(lines ? { lines } : {}),
      });
    });
  }

  /**
   * The printed PR (docs/design/83): its details, the lines with the vendor chosen (on rate contract,
   * dearer with the reason), the comparative statement, the certificate or tender, the approvals and
   * boxes to sign for the purchase officer, the committee and each approval level.
   */
  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, id);
      const lines = await this.linesOf(c, id);
      const quotes = await this.quotesOf(c, id);
      const low = this.lowest(quotes);
      const contracts = await this.contractsFor(c, [
        ...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x)),
      ]);
      const committee = pr.tier === 'committee' ? await this.committeeOf(c, id) : [];
      const indents = (
        await c.query<{ number: string }>(
          `SELECT DISTINCT pi.number FROM purchase_requisition_lines rl
             JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
             JOIN purchase_indent_lines il ON il.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = il.indent_id
            WHERE rl.requisition_id = $1 ORDER BY pi.number`,
          [id],
        )
      ).rows.map((x) => x.number);
      const steps = pr.workflow_instance_id
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
              [pr.workflow_instance_id],
            )
          ).rows
        : [];
      const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
      const day = (t: Date) =>
        dmy(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t));
      const STEP: Record<string, string> = {
        pending: 'Waiting',
        approved: 'Approved',
        rejected: 'Rejected',
        skipped: 'Passed on',
        cancelled: 'Closed',
      };
      const head = await purchaseHead(c, this.storage);
      const buy = lines.filter((l) => l.fulfil === 'buy');
      const data: RequisitionPdfData = {
        school: { name: head.school, address: head.address || null },
        logo: head.logo,
        generatedOn: head.generatedOn,
        watermark: ['approved', 'part_ordered', 'ordered'].includes(pr.status)
          ? null
          : pr.status === 'rejected'
            ? 'REJECTED'
            : pr.status === 'cancelled'
              ? 'CANCELLED'
              : 'NOT APPROVED',
        number: `${pr.number}${pr.revision > 1 ? ` (revision ${String(pr.revision)})` : ''}`,
        facts: [
          ['Made on', day(pr.created_at)],
          ['Department', `${pr.department ?? ''}${pr.combined ? ' (combined)' : ''}`],
          ['Purpose', pr.purpose ?? ''],
          ['Needed by', pr.required_by ? dmy(pr.required_by) : 'Not given'],
          ...(indents.length
            ? ([['From indents', indents.join(', ')]] as Array<[string, string]>)
            : []),
          [
            'Sourcing',
            pr.auto_rule
              ? `Made and approved by the system (${PR_RULE_WORDS[pr.auto_rule] ?? pr.auto_rule})`
              : pr.tier
                ? (TIER_WORDS[pr.tier] ?? pr.tier)
                : '',
          ],
          [
            'Status',
            `${PR_STATUS_WORDS[pr.status] ?? pr.status}${
              pr.status === 'submitted' && pr.waiting_with
                ? `: ${pr.waiting_with}`
                : pr.approved_at
                  ? ` on ${day(pr.approved_at)}`
                  : pr.decision_note
                    ? `: ${pr.decision_note}`
                    : ''
            }`,
          ],
          ['Made by', pr.created_by_name ?? ''],
        ],
        lines: lines.map((l) => {
          const k = l.item_id ? contracts.get(l.item_id) : undefined;
          const lo = low.get(l.id);
          const rate = l.rate === null ? null : Number(l.rate);
          const gst = l.gst_rate === null ? null : Number(l.gst_rate);
          const cost = rate === null ? null : landed(rate, gst ?? 0);
          const above = !!k && !l.contract_id && cost !== null && cost > k.landed + 0.004;
          const dearer =
            !!lo &&
            !!l.vendor_id &&
            !lo.vendorIds.includes(l.vendor_id) &&
            cost !== null &&
            cost > lo.landed + 0.004;
          const store = l.fulfil === 'store';
          return {
            seq: l.seq,
            description: `${l.item ?? l.free_text ?? ''}${l.item_code ? ` (${l.item_code})` : ''}`,
            notes: [
              store
                ? `From the store${l.store ? `: ${l.store}` : ''}${l.store_note ? ` · ${l.store_note}` : ''}`
                : null,
              l.contract_id ? 'On rate contract' : null,
              above
                ? `Above the rate contract (Rs ${k.landed.toFixed(2)} with GST): ${l.choice_reason ?? ''}`
                : null,
              !above && dearer ? `Not the lowest: ${l.choice_reason ?? ''}` : null,
              l.note,
            ].filter((x): x is string => !!x),
            quantity: Number(l.quantity),
            uom: l.uom,
            vendor: store ? 'From the store' : (l.vendor ?? 'Not chosen'),
            rate: store ? null : (rate ?? Number(l.est_rate)),
            gstRate: store ? null : gst,
            amount: store ? null : round2(Number(l.quantity) * (rate ?? Number(l.est_rate))),
          };
        }),
        value: Number(pr.estimate),
        statement: quotes.length
          ? {
              vendors: quotes.map((q) => ({
                code: q.vendor_code,
                name: q.vendor,
                ref: [
                  q.quote_ref,
                  q.quote_date ? dmy(q.quote_date) : null,
                  q.valid_until ? `valid until ${dmy(q.valid_until)}` : null,
                ]
                  .filter(Boolean)
                  .join(', '),
              })),
              rows: buy.map((l) => ({
                line: `${String(l.seq)}. ${l.item ?? l.free_text ?? ''} (${String(Number(l.quantity))} ${l.uom})`,
                cells: quotes.map((q) => {
                  const x = q.lines.find((ql) => ql.lineId === l.id);
                  return {
                    landed: x ? x.landed : null,
                    l1: !!x && !!low.get(l.id)?.vendorIds.includes(q.vendor_id),
                  };
                }),
                chosen: l.contract_id
                  ? `Rate contract: ${l.vendor ?? ''}`
                  : (l.vendor ?? 'Not chosen'),
              })),
            }
          : null,
        certificate: pr.price_certificate
          ? {
              text: pr.price_certificate,
              by: pr.certified_by ?? '',
              at: pr.certified_at ? day(pr.certified_at) : '',
            }
          : null,
        tender: pr.tender_ref
          ? `Reference ${pr.tender_ref}${pr.tender_note ? ` · ${pr.tender_note}` : ''}`
          : null,
        approvals: steps.map((s) => ({
          level: s.name,
          status: STEP[s.status] ?? s.status,
          who: s.who ?? (s.status === 'pending' ? (s.waiting ?? 'Nobody') : '-'),
          at: s.at ? dmy(s.at) : '',
          note: s.note,
        })),
        signatures: [
          { as: 'Purchase officer', name: pr.created_by_name ?? '' },
          ...committee.map((m) => ({
            as: m.role ? `Committee: ${m.role}` : 'Committee member',
            name: m.name,
          })),
          ...steps.map((s) => ({ as: s.name, name: s.status === 'approved' ? (s.who ?? '') : '' })),
        ],
      };
      return {
        bytes: await purchaseRequisitionPdf(data),
        filename: `${pr.number.replaceAll('/', '-')}.pdf`,
      };
    });
  }

  /** The document of an indent line the PR came from, for anyone who may see the PR. */
  async indentDocument(ctx: RequestContext, id: string, indentLineId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.load(c, ctx, id);
      const f = (
        await c.query<{ object_key: string; content_type: string; original_name: string }>(
          `SELECT f.object_key, f.content_type, f.original_name
             FROM purchase_requisition_lines rl
             JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
             JOIN purchase_indent_lines il ON il.id = src.indent_line_id
             JOIN files f ON f.id = il.file_id AND f.deleted_at IS NULL
            WHERE rl.requisition_id = $1 AND il.id = $2 LIMIT 1`,
          [id, indentLineId],
        )
      ).rows[0];
      if (!f) throw new DomainError('not-found', 'No document on that line', { status: 404 });
      return {
        bytes: await this.storage.read(f.object_key),
        contentType: f.content_type,
        filename: f.original_name,
      };
    });
  }

  /** The approved indents waiting for a PR, with their lines (Make a requisition). */
  async candidates(ctx: RequestContext) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pis = await c.query<{
        id: string;
        number: string;
        department_id: string;
        department: string;
        purpose: string;
        required_by: string | null;
        priority: string;
        estimate: string;
        decided_at: Date | null;
        bypass_note: string | null;
        raised_by: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT pi.id::text, pi.number, pi.department_id::text, d.name AS department, pi.purpose, pi.required_by::text, pi.priority,
                pi.estimate::text, pi.decided_at, pi.bypass_note, ${PERSON('u')} AS raised_by
           FROM purchase_indents pi JOIN departments d ON d.id = pi.department_id JOIN users u ON u.id = pi.raised_by
          WHERE pi.status = 'approved' AND pi.route = 'to_requisition'
          ORDER BY pi.priority = 'urgent' DESC, pi.required_by NULLS LAST, pi.decided_at`,
      );
      const lines = await c.query<{
        indent_id: string;
        item: string;
        quantity: string;
        uom: string;
        in_catalogue: boolean;
      }>(
        `SELECT l.indent_id::text, COALESCE(i.name, l.free_text) AS item, l.quantity::text, u.code AS uom, l.item_id IS NOT NULL AS in_catalogue
           FROM purchase_indent_lines l LEFT JOIN purchase_items i ON i.id = l.item_id JOIN purchase_uoms u ON u.id = l.uom_id
          WHERE l.indent_id = ANY($1::bigint[]) ORDER BY l.indent_id, l.seq`,
        [pis.rows.map((p) => p.id)],
      );
      const s = await this.settings(c);
      return {
        purchaseDepartmentId: s.purchase_department_id,
        data: pis.rows.map((p) => ({
          id: p.id,
          number: p.number,
          departmentId: p.department_id,
          department: p.department,
          purpose: p.purpose,
          requiredBy: p.required_by,
          priority: p.priority,
          estimate: Number(p.estimate),
          approvedAt: p.decided_at?.toISOString() ?? null,
          note: p.bypass_note,
          raisedBy: p.raised_by,
          lines: lines.rows
            .filter((l) => l.indent_id === p.id)
            .map((l) => ({
              item: l.item,
              quantity: Number(l.quantity),
              uom: l.uom,
              inCatalogue: l.in_catalogue,
            })),
        })),
      };
    });
  }

  // ---- the detail ----------------------------------------------------------------------------------
  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<LineRow>(
        `SELECT l.id::text, l.seq, l.item_id::text, i.code AS item_code, i.name AS item, l.free_text, l.quantity::text,
                l.uom_id::text, u.code AS uom, u.decimals, l.est_rate::text, l.fulfil, l.store_note, l.note,
                l.store_id::text, st.name AS store, COALESCE(i.stock_tracked, false) AS stock_tracked,
                COALESCE(i.stock_per_unit, 1)::text AS per_unit, sb.qty::text AS in_store, sb.reserved::text AS reserved_in_store,
                COALESCE((SELECT sum(r.qty - r.issued_qty) FROM stock_reservations r WHERE r.requisition_line_id = l.id AND r.status = 'open'), 0)::text AS held,
                COALESCE((SELECT sum(r.issued_qty) FROM stock_reservations r WHERE r.requisition_line_id = l.id), 0)::text AS issued,
                l.vendor_id::text, v.legal_name AS vendor, v.status AS vendor_status, l.rate::text, l.gst_rate::text,
                l.choice_reason, l.contract_id::text,
                COALESCE(i.gst_rate, h.gst_rate)::text AS item_gst,
                (l.contract_id IS NULL OR EXISTS (SELECT 1 FROM purchase_rate_contracts rc WHERE rc.id = l.contract_id AND rc.status = 'active'
                   AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to)) AS contract_ok
           FROM purchase_requisition_lines l
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN vendors v ON v.id = l.vendor_id
           LEFT JOIN stores st ON st.id = l.store_id
           LEFT JOIN stock_balances sb ON sb.store_id = l.store_id AND sb.item_id = l.item_id
          WHERE l.requisition_id = $1 ORDER BY l.seq`,
        [id],
      )
    ).rows;
  }

  private async quotesOf(c: PoolClient, id: string) {
    const q = await c.query<{
      id: string;
      vendor_id: string;
      vendor: string;
      vendor_code: string;
      vendor_status: string;
      gst_status: string;
      msme_type: string | null;
      quote_ref: string | null;
      quote_date: string | null;
      valid_until: string | null;
      delivery_days: number | null;
      file_id: string | null;
      note: string | null;
    }>(
      `SELECT q.id::text, q.vendor_id::text, v.legal_name AS vendor, v.code AS vendor_code, v.status AS vendor_status, v.gst_status,
              v.msme_type, q.quote_ref, q.quote_date::text, q.valid_until::text, q.delivery_days, q.file_id::text, q.note
         FROM purchase_quotes q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.requisition_id = $1 ORDER BY q.created_at, q.id`,
      [id],
    );
    const ql = await c.query<{
      quote_id: string;
      line_id: string;
      rate: string;
      gst_rate: string;
      note: string | null;
    }>(
      `SELECT ql.quote_id::text, ql.requisition_line_id::text AS line_id, ql.rate::text, ql.gst_rate::text, ql.note
         FROM purchase_quote_lines ql JOIN purchase_quotes q ON q.id = ql.quote_id WHERE q.requisition_id = $1`,
      [id],
    );
    return q.rows.map((x) => ({
      ...x,
      lines: ql.rows
        .filter((l) => l.quote_id === x.id)
        .map((l) => ({
          lineId: l.line_id,
          rate: Number(l.rate),
          gstRate: Number(l.gst_rate),
          landed: landed(Number(l.rate), Number(l.gst_rate)),
          note: l.note,
        })),
    }));
  }

  /** Per line: the lowest landed rate among the quotes and the vendors who gave it (L1). */
  private lowest(quotes: Awaited<ReturnType<PurchaseRequisitionsService['quotesOf']>>) {
    const m = new Map<string, { landed: number; vendorIds: string[] }>();
    for (const q of quotes)
      for (const l of q.lines) {
        const cur = m.get(l.lineId);
        if (!cur || l.landed < cur.landed - 0.004)
          m.set(l.lineId, { landed: l.landed, vendorIds: [q.vendor_id] });
        else if (Math.abs(l.landed - cur.landed) <= 0.004) cur.vendorIds.push(q.vendor_id);
      }
    return m;
  }

  private async committeeOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        employee_id: string;
        name: string;
        designation: string | null;
        role: string | null;
        user_id: string | null;
        signed_at: Date | null;
        note: string | null;
        me: boolean;
      }>(
        `SELECT e.id::text AS employee_id, e.display_name AS name, e.designation, m.role, e.user_id::text,
                so.signed_at, so.note, COALESCE(e.user_id = app.current_user_id(), false) AS me
           FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
           LEFT JOIN purchase_cs_signoffs so ON so.requisition_id = $1 AND so.employee_id = e.id
          WHERE e.deleted_at IS NULL ORDER BY m.created_at, e.display_name`,
        [id],
      )
    ).rows;
  }

  /** What the PR's tier still needs before it can go for approval (each with whether it is met). */
  private async requirements(c: PoolClient, id: string) {
    const s = await this.settings(c);
    const pr = (
      await c.query<{
        tier: Tier | null;
        price_certificate: string | null;
        tender_ref: string | null;
        files: number;
      }>(
        `SELECT r.tier, r.price_certificate, r.tender_ref,
                (SELECT count(*)::int FROM purchase_requisition_files f WHERE f.requisition_id = r.id AND f.kind = 'tender') AS files
           FROM purchase_requisitions r WHERE r.id = $1`,
        [id],
      )
    ).rows[0]!;
    const lines = await this.linesOf(c, id);
    const quotes = await this.quotesOf(c, id);
    const low = this.lowest(quotes);
    const committee = await this.committeeOf(c, id);
    const buy = lines.filter((l) => l.fulfil === 'buy');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const out: Array<{ key: string; label: string; met: boolean }> = [];
    const add = (key: string, label: string, met: boolean) => out.push({ key, label, met });
    add('lines', 'At least one line', lines.length > 0);
    if (lines.some((l) => l.fulfil === 'store')) {
      add(
        'store',
        'Every line issued from the store names its store (or, for an item not kept in stock, says what is issued)',
        lines
          .filter((l) => l.fulfil === 'store')
          .every((l) => (l.stock_tracked ? !!l.store_id : !!l.store_id || !!l.store_note)),
      );
      const short = await storeProblems(c, id);
      add(
        'stock',
        short.length
          ? `Enough free stock for the lines from the store (${short.join('; ')})`
          : 'Enough free stock for the lines from the store (it is reserved when sent)',
        short.length === 0,
      );
    }
    if (buy.length) {
      const unpriced = buy.filter((l) => !l.vendor_id || l.rate === null);
      add(
        'chosen',
        unpriced.length
          ? `A vendor and rate on every line bought (${String(unpriced.length)} not yet)`
          : 'A vendor and rate on every line bought',
        !unpriced.length,
      );
      add(
        'active',
        'Every chosen vendor approved and active',
        buy.every((l) => !l.vendor_id || l.vendor_status === 'active'),
      );
      if (buy.some((l) => l.contract_id))
        add(
          'contracts',
          'The rate contracts the lines are bought on still in force',
          buy.every((l) => l.contract_ok),
        );
    }
    const tier = pr.tier ?? 'none';
    if (tier === 'direct')
      add('certificate', 'The reasonable-price certificate recorded', !!pr.price_certificate);
    if (tier === 'committee') {
      const quoting = quotes.filter((q) => q.lines.length > 0).length;
      add(
        'quotes',
        `At least ${String(s.committee_quotes)} quotes (${String(quoting)} entered)`,
        quoting >= s.committee_quotes,
      );
      // a line on its rate contract needs no quote
      const fromQuote = buy.every(
        (l) =>
          !l.vendor_id ||
          !!l.contract_id ||
          quotes.some((q) => q.vendor_id === l.vendor_id && q.lines.some((x) => x.lineId === l.id)),
      );
      add('from_quote', 'Every chosen vendor from its quote (or the rate contract)', fromQuote);
      const dearer = buy.filter((l) => {
        const lo = low.get(l.id);
        return (
          l.vendor_id &&
          !l.contract_id &&
          lo &&
          !lo.vendorIds.includes(l.vendor_id) &&
          !l.choice_reason
        );
      });
      add('reasons', 'A reason for every choice dearer than the lowest (L1)', !dearer.length);
      const chosenQuotes = quotes.filter((q) => buy.some((l) => l.vendor_id === q.vendor_id));
      add(
        'valid',
        'The chosen quotes still valid',
        chosenQuotes.every((q) => !q.valid_until || q.valid_until >= today),
      );
      const members = committee.length;
      const need = Math.min(s.committee_signatures ?? members, members);
      const signed = committee.filter((m) => m.signed_at).length;
      add(
        'signatures',
        members
          ? `The comparative statement signed by ${String(need)} of the ${String(members)} committee members (${String(signed)} signed)`
          : 'The purchase committee named (Purchase settings) and its signatures',
        members > 0 && signed >= need,
      );
    }
    if (tier === 'tender') {
      add('tender_ref', 'The tender reference recorded', !!pr.tender_ref);
      add('tender_files', 'The tender documents attached', pr.files > 0);
    }
    return out;
  }

  /** The direct requisition's item sheet: items as a drop-down, quantity, est. rate, note. */
  async itemSheet(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => itemSheetBytes(c, REQUISITION_SHEET));
  }

  /**
   * The filled sheet read into requisition lines (nothing is saved): the same item twice becomes one
   * line, the quantities added; bad rows by row number.
   */
  async readItemSheet(ctx: RequestContext, dto: RequisitionSheetDto) {
    return this.db.tenant(requireTenant(ctx), (c) => readItemRows(c, dto.file, REQUISITION_SHEET));
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, id);
      const s = await this.settings(c);
      const lines = await this.linesOf(c, id);
      // what became of each line once approved: ordered, part ordered with the rest closed or waiting
      const ordering = new Map(
        (
          await c.query<LineOrderingRow & { line_id: string }>(
            // eslint-disable-next-line no-restricted-syntax -- LINE_ORDERING is a fixed fragment
            `SELECT rl.id::text AS line_id, ${LINE_ORDERING} FROM purchase_requisition_lines rl
              WHERE rl.requisition_id = $1
                AND EXISTS (SELECT 1 FROM purchase_requisitions r WHERE r.id = $1 AND r.status IN ('approved', 'part_ordered', 'ordered'))`,
            [id],
          )
        ).rows.map((o) => [o.line_id, o]),
      );
      const sources = await c.query<{
        line_id: string;
        indent_id: string;
        number: string;
        department: string;
        quantity: string;
        raised_by: string;
        indent_line_id: string;
        has_file: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT src.requisition_line_id::text AS line_id, pi.id::text AS indent_id, pi.number, d.name AS department, src.quantity::text,
                ${PERSON('u')} AS raised_by, il.id::text AS indent_line_id, il.file_id IS NOT NULL AS has_file
           FROM purchase_requisition_sources src
           JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
           JOIN purchase_indent_lines il ON il.id = src.indent_line_id
           JOIN purchase_indents pi ON pi.id = il.indent_id
           JOIN departments d ON d.id = pi.department_id
           JOIN users u ON u.id = pi.raised_by
          WHERE rl.requisition_id = $1 ORDER BY pi.number`,
        [id],
      );
      const quotes = await this.quotesOf(c, id);
      const low = this.lowest(quotes);
      const committee = await this.committeeOf(c, id);
      const files = await c.query<{
        id: string;
        file_id: string;
        kind: string;
        uploaded_at: Date;
      }>(
        `SELECT id::text, file_id::text, kind, uploaded_at FROM purchase_requisition_files WHERE requisition_id = $1 ORDER BY uploaded_at`,
        [id],
      );
      const instance = pr.workflow_instance_id
        ? await this.workflow.instanceWith(c, pr.workflow_instance_id)
        : null;
      const history = (
        await c.query<{
          kind: string;
          actor: string | null;
          note: string | null;
          at: Date;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
          `SELECT e.kind, ${PERSON('u')} AS actor, e.note, e.occurred_at AS at
             FROM workflow_events e LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.instance_id IN (SELECT id FROM workflow_instances WHERE entity_type = 'purchase_requisition' AND entity_id = $1)
            ORDER BY e.occurred_at, e.id`,
          [id],
        )
      ).rows;
      const mine = pr.workflow_instance_id
        ? await c.query<{ id: string }>(MY_STEP, [pr.workflow_instance_id])
        : { rows: [] };
      const orders = await c.query<{
        id: string;
        number: string;
        revision: number;
        status: string;
        total: string;
        vendor: string;
      }>(
        `SELECT po.id::text, po.number, po.revision, po.status, po.total::text, v.legal_name AS vendor
           FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
          WHERE po.requisition_id = $1 ORDER BY po.number, po.revision`,
        [id],
      );
      const manage = this.manages(ctx);
      const open = (OPEN as readonly string[]).includes(pr.status) && !pr.auto_rule;
      const approvedYet = instance?.steps.some((x) => x.status === 'approved') ?? false;
      const req = open ? await this.requirements(c, id) : [];
      const meOnCommittee = committee.find((m) => m.me);
      const allChosen = lines.every(
        (l) => l.fulfil === 'store' || (l.vendor_id && l.rate !== null),
      );
      const contracts = await this.contractsFor(c, [
        ...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x)),
      ]);
      // the band: the lines bought, not on a rate contract
      const band = lines.filter((l) => l.fulfil === 'buy' && !l.contract_id);
      return {
        ...this.shape(pr),
        limits: {
          direct: Number(s.direct_limit),
          committee: Number(s.committee_limit),
          quotes: s.committee_quotes,
        },
        value: round2(
          Math.max(
            band.reduce((a, l) => a + Number(l.quantity) * Number(l.est_rate), 0),
            band.reduce((a, l) => a + Number(l.quantity) * Number(l.rate ?? l.est_rate), 0),
          ),
        ),
        /** what the lines bought on rate contracts come to (left out of the band) */
        contractValue: round2(
          lines
            .filter((l) => l.fulfil === 'buy' && l.contract_id)
            .reduce((a, l) => a + Number(l.quantity) * Number(l.rate ?? l.est_rate), 0),
        ),
        certificate: pr.price_certificate
          ? {
              text: pr.price_certificate,
              by: pr.certified_by,
              at: pr.certified_at?.toISOString() ?? null,
            }
          : null,
        certificateText: PRICE_CERTIFICATE,
        tender: { ref: pr.tender_ref, note: pr.tender_note },
        files: files.rows.map((f) => ({
          id: f.id,
          fileId: f.file_id,
          kind: f.kind,
          uploadedAt: f.uploaded_at.toISOString(),
        })),
        lineItems: lines.map((l) => {
          const lo = low.get(l.id);
          return {
            id: l.id,
            seq: l.seq,
            itemId: l.item_id,
            itemCode: l.item_code,
            item: l.item ?? l.free_text,
            inCatalogue: l.item_id !== null,
            quantity: Number(l.quantity),
            uomId: l.uom_id,
            uom: l.uom,
            decimals: l.decimals,
            estRate: Number(l.est_rate),
            fulfil: l.fulfil,
            storeNote: l.store_note,
            storeId: l.store_id,
            store: l.store,
            stockTracked: l.stock_tracked,
            /** in the store unit: in hand, reserved (by everyone), held for this line, issued against it */
            stock:
              l.fulfil === 'store' && l.store_id
                ? {
                    perUnit: Number(l.per_unit),
                    inStore: Number(l.in_store ?? 0),
                    reserved: Number(l.reserved_in_store ?? 0),
                    held: Number(l.held),
                    issued: Number(l.issued),
                  }
                : null,
            note: l.note,
            vendorId: l.vendor_id,
            vendor: l.vendor,
            rate: l.rate === null ? null : Number(l.rate),
            gstRate: l.gst_rate === null ? null : Number(l.gst_rate),
            amount: round2(Number(l.quantity) * Number(l.rate ?? l.est_rate)),
            choiceReason: l.choice_reason,
            fromContract: l.contract_id !== null,
            /** the item's rate contract in force: offered first, filled in when nothing is chosen */
            contract: (l.item_id ? contracts.get(l.item_id) : undefined) ?? null,
            contractInForce: l.contract_ok,
            /** another vendor chosen, dearer (with GST) than the item's rate contract: its reason shows */
            aboveContract: (() => {
              const k = l.item_id ? contracts.get(l.item_id) : undefined;
              return (
                !!k &&
                l.contract_id === null &&
                l.vendor_id !== null &&
                l.rate !== null &&
                landed(Number(l.rate), Number(l.gst_rate ?? 0)) > k.landed + 0.004
              );
            })(),
            itemGst: l.item_gst === null ? null : Number(l.item_gst),
            ordered: ordering.has(l.id) ? orderingWords(ordering.get(l.id)!, l.uom) : null,
            l1:
              lo === undefined
                ? null
                : {
                    landed: lo.landed,
                    vendorIds: lo.vendorIds,
                  },
            // not the lowest quote's vendor and dearer than it (a cheaper agreed rate is not flagged)
            dearer:
              lo !== undefined &&
              l.vendor_id !== null &&
              !lo.vendorIds.includes(l.vendor_id) &&
              l.rate !== null &&
              landed(Number(l.rate), Number(l.gst_rate ?? 0)) > lo.landed + 0.004,
            sources: sources.rows
              .filter((x) => x.line_id === l.id)
              .map((x) => ({
                indentId: x.indent_id,
                number: x.number,
                department: x.department,
                raisedBy: x.raised_by,
                quantity: Number(x.quantity),
                // the indent line's document (viewed through the PR)
                indentLineId: x.indent_line_id,
                hasDocument: x.has_file,
              })),
          };
        }),
        quotes: quotes.map((q) => ({
          id: q.id,
          vendorId: q.vendor_id,
          vendor: q.vendor,
          vendorCode: q.vendor_code,
          vendorStatus: q.vendor_status,
          gstStatus: q.gst_status,
          msmeType: q.msme_type,
          quoteRef: q.quote_ref,
          quoteDate: q.quote_date,
          validUntil: q.valid_until,
          deliveryDays: q.delivery_days,
          fileId: q.file_id,
          note: q.note,
          lines: q.lines,
          total: round2(
            q.lines.reduce((a, x) => {
              const l = lines.find((y) => y.id === x.lineId);
              return a + (l ? Number(l.quantity) * x.landed : 0);
            }, 0),
          ),
          quotedAll: lines
            .filter((l) => l.fulfil === 'buy')
            .every((l) => q.lines.some((x) => x.lineId === l.id)),
        })),
        committee: {
          required: Math.min(s.committee_signatures ?? committee.length, committee.length),
          members: committee.map((m) => ({
            employeeId: m.employee_id,
            name: m.name,
            designation: m.designation,
            role: m.role,
            signsIn: m.user_id !== null,
            signedAt: m.signed_at?.toISOString() ?? null,
            note: m.note,
            me: m.me,
          })),
        },
        requirements: req,
        orders: orders.rows.map((o) => ({
          id: o.id,
          label: o.revision ? `${o.number}-R${String(o.revision)}` : o.number,
          status: o.status,
          total: Number(o.total),
          vendor: o.vendor,
        })),
        steps: instance?.steps ?? [],
        history: history.map((h) => ({
          kind: h.kind,
          actor: h.actor,
          note: h.note,
          at: h.at.toISOString(),
        })),
        /** a direct PR (no line from an indent): within the limit, sending approves it by the system */
        direct: sources.rows.length === 0,
        noApproval: {
          limit: Number(s.direct_pr_limit),
          applies:
            sources.rows.length === 0 &&
            open &&
            (ctx.permissions?.has(PURCHASE.requisitionDirect) ?? false) &&
            Number(s.direct_pr_limit) > 0 &&
            Number(pr.estimate) <= Number(s.direct_pr_limit) + 0.004,
        },
        can: {
          edit: manage && open,
          submit: manage && open,
          cancel: manage && !pr.auto_rule && (open || (pr.status === 'submitted' && !approvedYet)),
          reopen: manage && pr.status === 'approved' && !pr.auto_rule,
          decide: mine.rows.length > 0 && pr.created_by !== String(ctx.user.id),
          sign:
            open &&
            pr.tier === 'committee' &&
            !!meOnCommittee &&
            !meOnCommittee.signed_at &&
            quotes.length > 0 &&
            allChosen,
          unsign: open && !!meOnCommittee?.signed_at,
        },
      };
    });
  }

  // ---- make and change -----------------------------------------------------------------------------
  /** A line's estimate when none is typed: the item's rate contract, else its last purchase rate. */
  private async listRate(c: PoolClient, itemId: string) {
    const r = await c.query<{
      uom_id: string;
      decimals: boolean;
      name: string;
      rate: string | null;
    }>(
      `SELECT i.uom_id::text, u.decimals, i.name,
              COALESCE((SELECT rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                         WHERE rc.item_id = i.id AND rc.status = 'active'
                           AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1),
                       i.last_purchase_rate)::text AS rate
         FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id WHERE i.id = $1 AND i.status = 'active'`,
      [itemId],
    );
    if (!r.rows[0])
      throw new DomainError('validation-failed', 'An item is not in the catalogue (or inactive)', {
        status: 400,
      });
    return r.rows[0];
  }

  async create(ctx: RequestContext, dto: CreateRequisitionDto) {
    this.mustManage(ctx);
    if (!dto.indentIds.length && !(ctx.permissions?.has(PURCHASE.requisitionDirect) ?? false))
      throw new DomainError(
        'permission-denied',
        'A direct requisition (not from indents) is made by the purchase office',
        { status: 403 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const pis = dto.indentIds.length
        ? (
            await c.query<{
              id: string;
              number: string;
              department_id: string;
              status: string;
              route: string | null;
              required_by: string | null;
            }>(
              `SELECT id::text, number, department_id::text, status, route, required_by::text FROM purchase_indents
                WHERE id = ANY($1::bigint[]) FOR UPDATE`,
              [dto.indentIds],
            )
          ).rows
        : [];
      if (pis.length !== new Set(dto.indentIds).size)
        throw new DomainError('not-found', 'An indent was not found', { status: 404 });
      const notReady = pis.filter((p) => p.status !== 'approved' || p.route !== 'to_requisition');
      if (notReady.length)
        throw new DomainError(
          'purchase.indent_not_waiting',
          `Not waiting for a requisition: ${notReady.map((p) => p.number).join(', ')}`,
          { status: 409 },
        );
      const deps = [
        ...new Set([
          ...pis.map((p) => p.department_id),
          ...(dto.departmentId ? [dto.departmentId] : []),
        ]),
      ];
      const combined = deps.length > 1;
      const departmentId = combined ? s.purchase_department_id : deps[0]!;
      if (!departmentId)
        throw new DomainError(
          'purchase.no_purchase_department',
          'This requisition combines departments: set the department whose levels approve such requisitions (Purchase settings)',
          { status: 409 },
        );
      const dep = await c.query(`SELECT 1 FROM departments WHERE id = $1 AND status = 'active'`, [
        departmentId,
      ]);
      if (!dep.rowCount)
        throw new DomainError('not-found', 'Department not found', { status: 404 });
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('requisition') AS n`)
      ).rows[0]!.n;
      const requiredBy =
        dto.requiredBy ??
        pis
          .map((p) => p.required_by)
          .filter((x): x is string => !!x)
          .sort()[0] ??
        null;
      const purpose =
        dto.purpose ??
        (pis.length
          ? `From ${pis.map((p) => p.number).join(', ')}`
          : 'The purchase office’s own requisition');
      const pr = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_requisitions (school_id, number, department_id, combined, purpose, required_by, status, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'draft', app.current_user_id()) RETURNING id::text`,
          [number, departmentId, combined, purpose, requiredBy],
        )
      ).rows[0]!.id;
      let seq = 0;
      if (pis.length) {
        // the indents' lines, the same catalogue item (and unit) added up; lines in words stay apart
        const il = await c.query<{
          id: string;
          item_id: string | null;
          free_text: string | null;
          quantity: string;
          uom_id: string;
          est_rate: string;
          contract_id: string | null;
          note: string | null;
        }>(
          `SELECT l.id::text, l.item_id::text, l.free_text, l.quantity::text, l.uom_id::text, l.est_rate::text, l.contract_id::text, l.note
             FROM purchase_indent_lines l JOIN purchase_indents pi ON pi.id = l.indent_id
            WHERE l.indent_id = ANY($1::bigint[])
              AND NOT EXISTS (SELECT 1 FROM purchase_requisition_sources src WHERE src.indent_line_id = l.id)
            ORDER BY pi.number, l.seq`,
          [pis.map((p) => p.id)],
        );
        const groups = new Map<string, typeof il.rows>();
        for (const l of il.rows) {
          const key = l.item_id ? `${l.item_id}:${l.uom_id}` : `free:${l.id}`;
          groups.set(key, [...(groups.get(key) ?? []), l]);
        }
        for (const g of groups.values()) {
          const qty = g.reduce((a, l) => a + Number(l.quantity), 0);
          const amount = g.reduce((a, l) => a + Number(l.quantity) * Number(l.est_rate), 0);
          const first = g[0]!;
          const notes = [...new Set(g.map((l) => l.note).filter(Boolean))].join('; ').slice(0, 300);
          seq += 1;
          const rl = (
            await c.query<{ id: string }>(
              `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, free_text, quantity, uom_id, est_rate, note)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
              [
                pr,
                seq,
                first.item_id,
                first.free_text,
                qty,
                first.uom_id,
                qty ? round2(amount / qty) : 0,
                notes || null,
              ],
            )
          ).rows[0]!.id;
          for (const l of g)
            await c.query(
              `INSERT INTO purchase_requisition_sources (school_id, requisition_line_id, indent_line_id, quantity)
               VALUES (app.current_school_id(), $1, $2, $3)`,
              [rl, l.id, l.quantity],
            );
        }
        await c.query(
          `UPDATE purchase_indents SET route = 'in_requisition', updated_at = now() WHERE id = ANY($1::bigint[])`,
          [pis.map((p) => p.id)],
        );
      }
      for (const l of dto.lines) {
        seq += 1;
        await this.insertLine(c, pr, seq, l);
      }
      await this.fillContracts(c, pr);
      await this.refresh(c, pr);
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.create',
        entityType: 'purchase_requisitions',
        entityId: pr,
        after: { number, indents: pis.map((p) => p.number), lines: seq, combined },
      });
      return { id: pr, number };
    });
  }

  private async insertLine(
    c: PoolClient,
    pr: string,
    seq: number,
    l: CreateRequisitionDto['lines'][number],
  ) {
    let uom = l.uomId;
    let rate = l.estRate;
    if (l.itemId) {
      const it = await this.listRate(c, l.itemId);
      if (!it.decimals && !Number.isInteger(l.quantity))
        throw new DomainError('validation-failed', `${it.name}: a whole number`, { status: 400 });
      uom = uom ?? it.uom_id;
      rate = rate ?? Number(it.rate ?? 0);
    } else if (!uom)
      throw new DomainError('validation-failed', 'Pick the unit of an item described in words', {
        status: 400,
      });
    await c.query(
      `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, free_text, quantity, uom_id, est_rate, fulfil, store_note, note,
                                               store_id)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        pr,
        seq,
        l.itemId ?? null,
        l.itemId ? null : (l.freeText ?? null),
        l.quantity,
        uom,
        rate ?? 0,
        l.fulfil,
        l.fulfil === 'store' ? (l.storeNote ?? null) : null,
        l.note ?? null,
        l.fulfil === 'store' ? (l.storeId ?? null) : null,
      ],
    );
  }

  /** The header and lines changed (a line from an indent stays; its item may be matched, its quantity changed). */
  async update(ctx: RequestContext, id: string, dto: UpdateRequisitionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, id);
      await c.query(
        `UPDATE purchase_requisitions SET purpose = $2, required_by = $3, updated_at = now() WHERE id = $1`,
        [id, dto.purpose, dto.requiredBy ?? null],
      );
      const have = await c.query<{
        id: string;
        sourced: boolean;
        free_text: string | null;
        note: string | null;
      }>(
        `SELECT l.id::text, EXISTS (SELECT 1 FROM purchase_requisition_sources s WHERE s.requisition_line_id = l.id) AS sourced,
                l.free_text, l.note
           FROM purchase_requisition_lines l WHERE l.requisition_id = $1`,
        [id],
      );
      const kept = new Set(dto.lines.map((l) => l.id).filter(Boolean));
      for (const h of have.rows)
        if (!kept.has(h.id)) {
          if (h.sourced)
            throw new DomainError(
              'validation-failed',
              'A line from an indent stays on the requisition: mark it issued from the store, or change its quantity',
              { status: 400 },
            );
          await c.query(`DELETE FROM purchase_requisition_lines WHERE id = $1`, [h.id]);
        }
      // renumber after the lines kept: new lines go to the end
      await c.query(
        `UPDATE purchase_requisition_lines SET seq = seq + 250 WHERE requisition_id = $1`,
        [id],
      );
      let seq = 0;
      for (const l of dto.lines) {
        seq += 1;
        if (l.id) {
          const h = have.rows.find((x) => x.id === l.id);
          if (!h) throw new DomainError('not-found', 'A line was not found', { status: 404 });
          let itemId: string | null = null;
          let uom = l.uomId ?? null;
          if (l.itemId) {
            const it = await this.listRate(c, l.itemId);
            if (!it.decimals && !Number.isInteger(l.quantity))
              throw new DomainError('validation-failed', `${it.name}: a whole number`, {
                status: 400,
              });
            itemId = l.itemId;
            uom = uom ?? it.uom_id;
          }
          // a line in words matched to a catalogue item keeps its words as the note
          const note =
            l.note ?? (itemId && h.free_text ? `Asked as: ${h.free_text}`.slice(0, 300) : null);
          await c.query(
            `UPDATE purchase_requisition_lines
                SET seq = $2, item_id = COALESCE($3::bigint, item_id),
                    free_text = CASE WHEN $3::bigint IS NOT NULL THEN NULL ELSE COALESCE($4::text, free_text) END,
                    quantity = $5, uom_id = COALESCE($6::bigint, uom_id), est_rate = COALESCE($7::numeric, est_rate), fulfil = $8::text,
                    store_note = CASE WHEN $8::text = 'store' THEN $9::text END, note = $10::text,
                    store_id = CASE WHEN $8::text = 'store' THEN $11::bigint END,
                    -- issued from the store, or matched to another item: the vendor chosen no longer holds
                    vendor_id = CASE WHEN $8::text = 'store' OR ($3::bigint IS NOT NULL AND item_id IS DISTINCT FROM $3::bigint) THEN NULL ELSE vendor_id END,
                    rate = CASE WHEN $8::text = 'store' OR ($3::bigint IS NOT NULL AND item_id IS DISTINCT FROM $3::bigint) THEN NULL ELSE rate END,
                    gst_rate = CASE WHEN $8::text = 'store' OR ($3::bigint IS NOT NULL AND item_id IS DISTINCT FROM $3::bigint) THEN NULL ELSE gst_rate END,
                    choice_reason = CASE WHEN $8::text = 'store' OR ($3::bigint IS NOT NULL AND item_id IS DISTINCT FROM $3::bigint) THEN NULL ELSE choice_reason END,
                    contract_id = CASE WHEN $8::text = 'store' OR ($3::bigint IS NOT NULL AND item_id IS DISTINCT FROM $3::bigint) THEN NULL ELSE contract_id END
              WHERE id = $1`,
            [
              l.id,
              seq,
              itemId,
              l.freeText ?? null,
              l.quantity,
              uom,
              l.estRate ?? null,
              l.fulfil,
              l.storeNote ?? null,
              note,
              l.storeId ?? null,
            ],
          );
        } else await this.insertLine(c, id, seq, l);
      }
      await this.fillContracts(c, id);
      await this.clearSignatures(c, ctx, id, 'lines changed');
      const f = await this.refresh(c, id);
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.update',
        entityType: 'purchase_requisitions',
        entityId: id,
        after: { lines: dto.lines.length, tier: f.tier },
      });
      return { id, ...f };
    });
  }

  // ---- sourcing ------------------------------------------------------------------------------------
  private async checkFile(c: PoolClient, fileId: string) {
    const f = await c.query(
      `SELECT 1 FROM files WHERE id = $1 AND status = 'ready' AND created_by = app.current_user_id()
          AND size_bytes <= 5242880 AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$'`,
      [fileId],
    );
    if (!f.rowCount)
      throw new DomainError(
        'validation-failed',
        'Upload a PDF or a photo (JPEG, PNG) of up to 5 MB first',
        {
          status: 400,
        },
      );
  }

  private async activeVendor(c: PoolClient, vendorId: string) {
    const v = await c.query<{ legal_name: string; status: string; gst_status: string }>(
      `SELECT legal_name, status, gst_status FROM vendors WHERE id = $1`,
      [vendorId],
    );
    const x = v.rows[0];
    if (!x) throw new DomainError('not-found', 'Vendor not found', { status: 404 });
    if (x.status !== 'active')
      throw new DomainError(
        'purchase.vendor_not_active',
        x.status === 'pending'
          ? `${x.legal_name} waits for approval: it cannot be used yet`
          : `${x.legal_name} is ${x.status}: it cannot be used`,
        { status: 409 },
      );
    return x;
  }

  /** A line chosen from this vendor follows its quote (the rate changed, or the line no longer quoted). */
  private async followQuote(c: PoolClient, prId: string, vendorId: string) {
    await c.query(
      `UPDATE purchase_requisition_lines l SET rate = ql.rate, gst_rate = ql.gst_rate
         FROM purchase_quotes q JOIN purchase_quote_lines ql ON ql.quote_id = q.id
        WHERE l.requisition_id = $1 AND l.vendor_id = $2 AND q.requisition_id = $1 AND q.vendor_id = $2
          AND ql.requisition_line_id = l.id`,
      [prId, vendorId],
    );
    await c.query(
      `UPDATE purchase_requisition_lines l SET vendor_id = NULL, rate = NULL, gst_rate = NULL, choice_reason = NULL
        WHERE l.requisition_id = $1 AND l.vendor_id = $2 AND l.contract_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM purchase_quotes q JOIN purchase_quote_lines ql ON ql.quote_id = q.id
                           WHERE q.requisition_id = $1 AND q.vendor_id = $2 AND ql.requisition_line_id = l.id)
          AND EXISTS (SELECT 1 FROM purchase_quotes q WHERE q.requisition_id = $1 AND q.vendor_id = $2)`,
      [prId, vendorId],
    );
  }

  async saveQuote(ctx: RequestContext, prId: string, quoteId: string | null, dto: QuoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      const v = await this.activeVendor(c, dto.vendorId);
      if (dto.fileId) await this.checkFile(c, dto.fileId);
      const lines = await this.linesOf(c, prId);
      for (const l of dto.lines) {
        const line = lines.find((x) => x.id === l.lineId);
        if (!line) throw new DomainError('not-found', 'A line was not found', { status: 404 });
        if (line.fulfil !== 'buy')
          throw new DomainError(
            'validation-failed',
            `Line ${String(line.seq)} is issued from the store`,
            {
              status: 400,
            },
          );
      }
      let id = quoteId;
      if (id) {
        const r = await c.query(
          `UPDATE purchase_quotes SET vendor_id = $3, quote_ref = $4, quote_date = $5, valid_until = $6, delivery_days = $7,
                  file_id = COALESCE($8, file_id), note = $9, updated_at = now()
            WHERE id = $1 AND requisition_id = $2`,
          [
            id,
            prId,
            dto.vendorId,
            dto.quoteRef ?? null,
            dto.quoteDate ?? null,
            dto.validUntil ?? null,
            dto.deliveryDays ?? null,
            dto.fileId ?? null,
            dto.note ?? null,
          ],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'Quote not found', { status: 404 });
        await c.query(`DELETE FROM purchase_quote_lines WHERE quote_id = $1`, [id]);
      } else {
        const dup = await c.query(
          `SELECT 1 FROM purchase_quotes WHERE requisition_id = $1 AND vendor_id = $2`,
          [prId, dto.vendorId],
        );
        if (dup.rowCount)
          throw new DomainError(
            'conflict',
            `${v.legal_name} has a quote on this requisition: change it`,
            {
              status: 409,
            },
          );
        id = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_quotes (school_id, requisition_id, vendor_id, quote_ref, quote_date, valid_until, delivery_days, file_id, note, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id()) RETURNING id::text`,
            [
              prId,
              dto.vendorId,
              dto.quoteRef ?? null,
              dto.quoteDate ?? null,
              dto.validUntil ?? null,
              dto.deliveryDays ?? null,
              dto.fileId ?? null,
              dto.note ?? null,
            ],
          )
        ).rows[0]!.id;
      }
      // no GST from an unregistered or composition vendor; else the line's typed rate, else the item's
      for (const l of dto.lines) {
        const line = lines.find((x) => x.id === l.lineId)!;
        const gst = v.gst_status === 'regular' ? (l.gstRate ?? Number(line.item_gst ?? 0)) : 0;
        await c.query(
          `INSERT INTO purchase_quote_lines (school_id, quote_id, requisition_line_id, rate, gst_rate, note)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [id, l.lineId, l.rate, gst, l.note ?? null],
        );
      }
      await this.followQuote(c, prId, dto.vendorId);
      await c.query(
        `UPDATE purchase_requisitions SET status = CASE WHEN status = 'draft' THEN 'sourcing' ELSE status END WHERE id = $1`,
        [prId],
      );
      await this.clearSignatures(c, ctx, prId, 'a quote changed');
      await this.refresh(c, prId);
      await this.audit.stage(ctx, c, {
        action: quoteId ? 'purchase.quote.update' : 'purchase.quote.create',
        entityType: 'purchase_quotes',
        entityId: id,
        after: { requisition: prId, vendor: v.legal_name, lines: dto.lines.length },
      });
      return { id };
    });
  }

  async removeQuote(ctx: RequestContext, prId: string, quoteId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      const q = await c.query<{ vendor_id: string }>(
        `DELETE FROM purchase_quotes WHERE id = $1 AND requisition_id = $2 RETURNING vendor_id::text`,
        [quoteId, prId],
      );
      if (!q.rows[0]) throw new DomainError('not-found', 'Quote not found', { status: 404 });
      // lines chosen from this quote lose their vendor
      await c.query(
        `UPDATE purchase_requisition_lines SET vendor_id = NULL, rate = NULL, gst_rate = NULL, choice_reason = NULL
          WHERE requisition_id = $1 AND vendor_id = $2 AND contract_id IS NULL`,
        [prId, q.rows[0].vendor_id],
      );
      await this.clearSignatures(c, ctx, prId, 'a quote removed');
      await this.refresh(c, prId);
      await this.audit.stage(ctx, c, {
        action: 'purchase.quote.remove',
        entityType: 'purchase_quotes',
        entityId: quoteId,
        after: { requisition: prId },
      });
      return { removed: true };
    });
  }

  /**
   * The vendor and rate per line: a vendor that quoted the line takes its quoted rate and GST (a dearer
   * one than the lowest needs a reason); without a quote (direct, tender) the agreed rate is given.
   */
  async choose(ctx: RequestContext, prId: string, dto: ChoicesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      const lines = await this.linesOf(c, prId);
      const quotes = await this.quotesOf(c, prId);
      const low = this.lowest(quotes);
      const contracts = await this.contractsFor(c, [
        ...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x)),
      ]);
      for (const ch of dto.lines) {
        const line = lines.find((x) => x.id === ch.lineId);
        if (!line) throw new DomainError('not-found', 'A line was not found', { status: 404 });
        const name = line.item ?? line.free_text ?? `Line ${String(line.seq)}`;
        if (line.fulfil !== 'buy')
          throw new DomainError('validation-failed', `${name} is issued from the store`, {
            status: 400,
          });
        const k = line.item_id ? contracts.get(line.item_id) : undefined;
        const quoted = ch.vendorId
          ? quotes.find((q) => q.vendor_id === ch.vendorId)?.lines.find((l) => l.lineId === line.id)
          : undefined;
        // the rate contract: asked for, or its vendor named at its rate (or with no rate) without a quote
        const onContract =
          ch.useContract === true ||
          (!!k &&
            ch.vendorId === k.vendorId &&
            !quoted &&
            (ch.rate === undefined || Math.abs(ch.rate - k.rate) < 0.005));
        if (onContract) {
          if (!k)
            throw new DomainError(
              'validation-failed',
              `${name}: no rate contract in force for it — pick a vendor and enter the rate`,
              { status: 400 },
            );
          await c.query(
            `UPDATE purchase_requisition_lines SET vendor_id = $2, rate = $3, gst_rate = $4, choice_reason = NULL, contract_id = $5 WHERE id = $1`,
            [line.id, k.vendorId, k.rate, k.gstRate, k.id],
          );
          continue;
        }
        if (!ch.vendorId) {
          await c.query(
            `UPDATE purchase_requisition_lines SET vendor_id = NULL, rate = NULL, gst_rate = NULL, choice_reason = NULL, contract_id = NULL WHERE id = $1`,
            [line.id],
          );
          continue;
        }
        const v = await this.activeVendor(c, ch.vendorId);
        let rate: number;
        let gst: number;
        if (quoted) {
          rate = quoted.rate;
          gst = quoted.gstRate;
        } else {
          if (ch.rate === undefined)
            throw new DomainError(
              'validation-failed',
              `${name}: ${v.legal_name} has not quoted it — enter the agreed rate`,
              { status: 400 },
            );
          rate = ch.rate;
          gst = v.gst_status === 'regular' ? (ch.gstRate ?? Number(line.item_gst ?? 0)) : 0;
        }
        const lo = low.get(line.id);
        const dearer = lo !== undefined && landed(rate, gst) > lo.landed + 0.004;
        if (dearer && !ch.reason)
          throw new DomainError(
            'purchase.choice_reason',
            `${name}: ${v.legal_name} is dearer than the lowest quote (${rupees(lo.landed)} with GST) — give the reason`,
            { status: 400 },
          );
        // dearer than the item's rate contract: the reason too (the approvers see it)
        const aboveContract = !!k && landed(rate, gst) > k.landed + 0.004;
        if (aboveContract && !ch.reason)
          throw new DomainError(
            'purchase.choice_reason',
            `${name}: ${v.legal_name} at ${rupees(landed(rate, gst))} with GST is dearer than the rate contract (${rupees(k.landed)} with ${k.vendor}) — give the reason`,
            { status: 400 },
          );
        await c.query(
          `UPDATE purchase_requisition_lines SET vendor_id = $2, rate = $3, gst_rate = $4, choice_reason = $5, contract_id = NULL WHERE id = $1`,
          [line.id, ch.vendorId, rate, gst, dearer || aboveContract ? ch.reason : null],
        );
      }
      await this.clearSignatures(c, ctx, prId, 'the vendors chosen changed');
      const f = await this.refresh(c, prId);
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.choose',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { lines: dto.lines.length, estimate: f.estimate },
      });
      return { id: prId, ...f };
    });
  }

  async certify(ctx: RequestContext, prId: string, dto: CertificateDto | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      await c.query(
        `UPDATE purchase_requisitions SET price_certificate = $2, certified_by = CASE WHEN $2::text IS NULL THEN NULL ELSE app.current_user_id() END,
                certified_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, updated_at = now() WHERE id = $1`,
        [prId, dto?.text ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: dto ? 'purchase.requisition.certify' : 'purchase.requisition.uncertify',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { certificate: dto?.text ?? null },
      });
      return { id: prId };
    });
  }

  async saveTender(ctx: RequestContext, prId: string, dto: TenderDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      await c.query(
        `UPDATE purchase_requisitions SET tender_ref = $2, tender_note = $3, updated_at = now() WHERE id = $1`,
        [prId, dto.tenderRef, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.tender',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { tenderRef: dto.tenderRef },
      });
      return { id: prId };
    });
  }

  async addFile(ctx: RequestContext, prId: string, dto: RequisitionFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      await this.checkFile(c, dto.fileId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO purchase_requisition_files (school_id, requisition_id, kind, file_id, uploaded_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) RETURNING id::text`,
        [prId, dto.kind, dto.fileId],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.file_add',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { kind: dto.kind, fileId: dto.fileId },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removeFile(ctx: RequestContext, prId: string, fileRowId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustBeOpen(c, ctx, prId);
      const r = await c.query(
        `DELETE FROM purchase_requisition_files WHERE id = $1 AND requisition_id = $2`,
        [fileRowId, prId],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'File not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.file_remove',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { file: fileRowId },
      });
      return { removed: true };
    });
  }

  /** A committee member signs the comparative statement (once every line bought has its vendor). */
  async sign(ctx: RequestContext, prId: string, dto: SignDto | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, prId);
      if (!(OPEN as readonly string[]).includes(pr.status))
        throw new DomainError(
          'purchase.requisition_closed',
          'It has gone for approval: signing is over',
          {
            status: 409,
          },
        );
      const me = await c.query<{ employee_id: string }>(
        `SELECT e.id::text AS employee_id FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id
          WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL LIMIT 1`,
      );
      if (!me.rows[0])
        throw new DomainError(
          'permission-denied',
          'Only the purchase committee signs comparative statements',
          {
            status: 403,
          },
        );
      if (!dto) {
        const r = await c.query(
          `DELETE FROM purchase_cs_signoffs WHERE requisition_id = $1 AND employee_id = $2`,
          [prId, me.rows[0].employee_id],
        );
        if (!r.rowCount)
          throw new DomainError('not-found', 'You have not signed it', { status: 404 });
        return { signed: false };
      }
      if (pr.tier !== 'committee' || !pr.quotes)
        throw new DomainError(
          'validation-failed',
          'There is no comparative statement to sign yet',
          {
            status: 400,
          },
        );
      const open = await c.query(
        `SELECT 1 FROM purchase_requisition_lines WHERE requisition_id = $1 AND fulfil = 'buy' AND (vendor_id IS NULL OR rate IS NULL)`,
        [prId],
      );
      if (open.rowCount)
        throw new DomainError(
          'validation-failed',
          'Not every line has its vendor chosen yet: sign once the statement is complete',
          { status: 400 },
        );
      await c.query(
        `INSERT INTO purchase_cs_signoffs (school_id, requisition_id, employee_id, user_id, note)
         VALUES (app.current_school_id(), $1, $2, app.current_user_id(), $3)
         ON CONFLICT (requisition_id, employee_id) DO NOTHING`,
        [prId, me.rows[0].employee_id, dto.note ?? null],
      );
      return { signed: true };
    });
  }

  // ---- approval ------------------------------------------------------------------------------------
  async submit(ctx: RequestContext, prId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.mustBeOpen(c, ctx, prId);
      const f = await this.refresh(c, prId);
      const missing = (await this.requirements(c, prId)).filter((r) => !r.met);
      if (missing.length)
        throw new DomainError(
          'purchase.sourcing_incomplete',
          `Not ready for approval: ${missing.map((m) => m.label).join('; ')}`,
          { status: 409, extra: { missing } },
        );
      // a direct requisition within the limit (Purchase settings) sent by the purchase office: approved
      // by the system, its draft POs made at once (docs/design/83)
      const direct = await this.directApproval(c, ctx, prId, f.estimate);
      if (direct.approve) {
        await reserveRequisition(c, prId);
        await c.query(
          `UPDATE purchase_requisitions SET status = 'approved', submitted_at = now(), decided_at = now(), approved_at = now(),
                  decision_note = NULL, no_approval_note = $2, updated_at = now() WHERE id = $1`,
          [prId, direct.note],
        );
        await this.audit.stage(ctx, c, {
          action: 'purchase.requisition.approved_direct',
          entityType: 'purchase_requisitions',
          entityId: prId,
          after: { number: pr.number, estimate: f.estimate, note: direct.note },
        });
        await this.approvedEffects(c, ctx, prId, pr.number);
        return {
          id: prId,
          number: pr.number,
          tier: f.tier,
          approvedBySystem: true,
          note: direct.note,
        };
      }
      if (!pr.department_id)
        throw new DomainError('purchase.no_approvers', 'The requisition has no department', {
          status: 409,
        });
      const flow = await syncFlow(c, 'requisition', pr.department_id);
      if (!flow.levels)
        throw new DomainError(
          'purchase.no_approvers',
          `Who approves ${flow.department}'s Purchase Requisitions is not set: ask the school admin (Purchase → Who approves)`,
          { status: 409 },
        );
      // what comes from the store is held for it while it is decided
      await reserveRequisition(c, prId);
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: flow.code,
        entityType: 'purchase_requisition',
        entityId: prId,
        subject: `${pr.number} · ${flow.department}${pr.combined ? ' (combined)' : ''} · ${rupees(f.estimate)}`,
        payload: {
          department: flow.department,
          departmentId: pr.department_id,
          amount: f.estimate,
          number: pr.number,
          tier: f.tier,
        },
      });
      await c.query(
        `UPDATE purchase_requisitions SET status = 'submitted', workflow_instance_id = $2, submitted_at = now(), decision_note = NULL,
                updated_at = now() WHERE id = $1`,
        [prId, instance.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.submit',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { number: pr.number, tier: f.tier, estimate: f.estimate, instance: instance.id },
      });
      return {
        id: prId,
        number: pr.number,
        tier: f.tier,
        approvedBySystem: false,
        note: direct.note,
      };
    });
  }

  /**
   * Whether a requisition is approved by the system when sent: a direct one (no line from an indent),
   * sent by someone with the direct right, worth (before GST) up to the limit in Purchase settings, and
   * — the split check (GFR 2017 rule 157) — not over it together with the direct requisitions approved
   * this way in the split window that share an item category with it. The note says why either way.
   */
  private async directApproval(c: PoolClient, ctx: RequestContext, prId: string, estimate: number) {
    const no = (note: string | null) => ({ approve: false, note });
    if (!(ctx.permissions?.has(PURCHASE.requisitionDirect) ?? false)) return no(null);
    const sourced = await c.query(
      `SELECT 1 FROM purchase_requisition_lines rl JOIN purchase_requisition_sources src ON src.requisition_line_id = rl.id
        WHERE rl.requisition_id = $1 LIMIT 1`,
      [prId],
    );
    if (sourced.rowCount) return no(null);
    const s = await this.settings(c);
    const limit = Number(s.direct_pr_limit);
    if (!(limit > 0)) return no(null);
    if (estimate > limit + 0.004)
      return no(
        `Sent for approval: ${rupees(estimate)} is over the limit of ${rupees(limit)} for a direct requisition without approval`,
      );
    const earlier = await c.query<{ number: string; estimate: string }>(
      `SELECT r.number, r.estimate::text FROM purchase_requisitions r
        WHERE r.id <> $1 AND r.no_approval_note IS NOT NULL AND r.status IN ('approved', 'part_ordered', 'ordered')
          AND r.approved_at >= now() - make_interval(days => $2::int)
          AND EXISTS (SELECT 1 FROM purchase_requisition_lines a JOIN purchase_items ia ON ia.id = a.item_id
                        JOIN purchase_requisition_lines b ON b.requisition_id = $1 JOIN purchase_items ib ON ib.id = b.item_id
                       WHERE a.requisition_id = r.id AND ia.category_id = ib.category_id)
        ORDER BY r.approved_at`,
      [prId, s.split_window_days],
    );
    const together = earlier.rows.reduce((a, r) => a + Number(r.estimate), estimate);
    if (earlier.rows.length && together > limit + 0.004)
      return no(
        `Sent for approval: with ${earlier.rows.map((r) => r.number).join(', ')} of the last ${String(s.split_window_days)} days, the direct purchases of these categories come to ${rupees(together)}, over the limit of ${rupees(limit)}`,
      );
    return {
      approve: true,
      note: `Approved by the system: a direct requisition by the purchase office, ${rupees(estimate)} within the limit of ${rupees(limit)}`,
    };
  }

  async decide(ctx: RequestContext, prId: string, dto: IndentDecisionDto) {
    if (dto.action !== 'approve' && (dto.note ?? '').length < 3)
      throw new DomainError(
        'validation-failed',
        dto.action === 'reject' ? 'Give the reason for rejecting' : 'Say what to change',
        { status: 400 },
      );
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, prId);
      if (pr.status !== 'submitted' || !pr.workflow_instance_id)
        throw new DomainError(
          'purchase.not_waiting',
          'This requisition is not waiting for approval',
          {
            status: 409,
          },
        );
      if (pr.created_by === String(ctx.user.id))
        throw new DomainError(
          'workflow.self_approval',
          'You made this requisition: another approver decides it',
          { status: 403 },
        );
      const s = await c.query<{ id: string }>(MY_STEP, [pr.workflow_instance_id]);
      if (!s.rows[0])
        throw new DomainError('workflow.not_assignee', 'This requisition is not waiting for you', {
          status: 403,
        });
      if (dto.action === 'send_back') {
        await this.workflow.cancelIn(c, ctx, pr.workflow_instance_id, `Sent back: ${dto.note!}`);
        await c.query(
          `UPDATE purchase_requisitions SET status = 'sent_back', decision_note = $2, decided_at = now(), updated_at = now() WHERE id = $1`,
          [prId, dto.note],
        );
        await releaseRequisition(c, prId, `${pr.number} was sent back`);
        await this.audit.stage(ctx, c, {
          action: 'purchase.requisition.send_back',
          entityType: 'purchase_requisitions',
          entityId: prId,
          after: { note: dto.note },
        });
      }
      return s.rows[0].id;
    });
    if (dto.action !== 'send_back')
      await this.workflow.act(ctx, step, dto.action === 'approve' ? 'approved' : 'rejected', {
        note: dto.note,
      });
    return this.get(ctx, prId);
  }

  /** Its indents go back to "Waiting for the PR" (the purchase office makes another, or closes them). */
  private async release(c: PoolClient, prId: string, why: string) {
    const pis = await c.query<{ id: string }>(
      `SELECT DISTINCT il.indent_id::text AS id FROM purchase_requisition_sources src
         JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
         JOIN purchase_indent_lines il ON il.id = src.indent_line_id
        WHERE rl.requisition_id = $1`,
      [prId],
    );
    await c.query(
      `DELETE FROM purchase_requisition_sources src USING purchase_requisition_lines rl
        WHERE rl.id = src.requisition_line_id AND rl.requisition_id = $1`,
      [prId],
    );
    if (pis.rows.length)
      await c.query(
        `UPDATE purchase_indents SET route = 'to_requisition', bypass_note = $2, updated_at = now()
          WHERE id = ANY($1::bigint[]) AND route = 'in_requisition'`,
        [pis.rows.map((p) => p.id), why],
      );
    return pis.rows.length;
  }

  private async onDecided(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    if (instance.status === 'cancelled') return;
    const id = instance.entityId;
    const pr = (
      await c.query<{ number: string }>(`SELECT number FROM purchase_requisitions WHERE id = $1`, [
        id,
      ])
    ).rows[0]!;
    if (outcome === 'rejected') {
      const note = [...instance.steps].reverse().find((s) => s.status === 'rejected')?.note ?? null;
      await c.query(
        `UPDATE purchase_requisitions SET status = 'rejected', decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, note],
      );
      await this.release(c, id, `${pr.number} was rejected${note ? `: ${note}` : ''}`);
      await releaseRequisition(c, id, `${pr.number} was rejected`);
      return;
    }
    await c.query(
      `UPDATE purchase_requisitions SET status = 'approved', decided_at = now(), approved_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.approvedEffects(c, ctx, id, pr.number);
  }

  /**
   * What an approved requisition sets going (its levels' last approval, or the system for a direct one
   * within the limit): its indents all from the store closed, one draft PO per chosen vendor.
   */
  private async approvedEffects(c: PoolClient, ctx: RequestContext, id: string, number: string) {
    const pr = { number };
    // an indent all of whose lines are issued from the store (on approved requisitions) is closed
    await c.query(
      `UPDATE purchase_indents pi SET route = 'closed', bypass_note = $2, updated_at = now()
        WHERE pi.route = 'in_requisition'
          AND EXISTS (SELECT 1 FROM purchase_indent_lines il JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
                       JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id WHERE rl.requisition_id = $1 AND il.indent_id = pi.id)
          AND NOT EXISTS (SELECT 1 FROM purchase_indent_lines il
                           LEFT JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
                           LEFT JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
                           LEFT JOIN purchase_requisitions r ON r.id = rl.requisition_id
                           WHERE il.indent_id = pi.id AND (rl.fulfil IS DISTINCT FROM 'store' OR r.status <> 'approved'))`,
      [id, `From the store on ${pr.number}`],
    );
    // the draft POs: one per chosen vendor, made in the name of the requisition's maker
    const maker = (
      await c.query<{ created_by: string | null }>(
        `SELECT created_by::text FROM purchase_requisitions WHERE id = $1`,
        [id],
      )
    ).rows[0]!.created_by;
    const orders = await draftOrdersFor(c, id, maker);
    await this.audit.stage(ctx, c, {
      action: 'purchase.requisition.approved',
      entityType: 'purchase_requisitions',
      entityId: id,
      after: { number: pr.number, draftOrders: orders.map((o) => o.number) },
    });
  }

  async cancel(ctx: RequestContext, prId: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, prId);
      if (pr.auto_rule)
        throw new DomainError(
          'purchase.requisition_closed',
          'Made by the system under a bypass rule',
          {
            status: 409,
          },
        );
      if (pr.status === 'submitted' && pr.workflow_instance_id) {
        const done = await c.query(
          `SELECT 1 FROM workflow_steps WHERE instance_id = $1 AND status = 'approved'`,
          [pr.workflow_instance_id],
        );
        if (done.rowCount)
          throw new DomainError(
            'purchase.requisition_closed',
            'An approver has approved it already: ask them to send it back',
            { status: 409 },
          );
        await this.workflow.cancelIn(c, ctx, pr.workflow_instance_id, `Cancelled: ${dto.reason}`);
      } else if (!(OPEN as readonly string[]).includes(pr.status))
        throw new DomainError(
          'purchase.requisition_closed',
          'This requisition cannot be cancelled',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE purchase_requisitions SET status = 'cancelled', decision_note = $2, updated_at = now() WHERE id = $1`,
        [prId, dto.reason],
      );
      const released = await this.release(c, prId, `${pr.number} was cancelled: ${dto.reason}`);
      await releaseRequisition(c, prId, `${pr.number} was cancelled`);
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.cancel',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { reason: dto.reason, indentsReleased: released },
      });
      return { cancelled: true, indentsReleased: released };
    });
  }

  /** An approved PR (no order yet) changed: back to draft, approved again when sent. */
  async reopen(ctx: RequestContext, prId: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, prId);
      if (pr.status !== 'approved' || pr.auto_rule)
        throw new DomainError(
          'purchase.requisition_closed',
          'Only an approved requisition with no order is reopened',
          {
            status: 409,
          },
        );
      const placed = await c.query(
        `SELECT 1 FROM purchase_orders WHERE requisition_id = $1 AND status NOT IN ('draft', 'sent_back', 'rejected', 'cancelled')`,
        [prId],
      );
      if (placed.rowCount)
        throw new DomainError(
          'purchase.requisition_closed',
          'A purchase order of it has gone for approval or to the vendor: amend or cancel that order instead',
          { status: 409 },
        );
      if (await issuedAgainst(c, prId))
        throw new DomainError(
          'purchase.requisition_closed',
          'The store has issued against it already: raise another requisition for the change',
          { status: 409 },
        );
      await releaseRequisition(c, prId, `${pr.number} was reopened`);
      // its draft POs are dropped; new ones are drafted when it is approved again
      await c.query(
        `UPDATE purchase_orders SET status = 'cancelled', decision_note = 'The requisition was reopened', updated_at = now()
          WHERE requisition_id = $1 AND status IN ('draft', 'sent_back')`,
        [prId],
      );
      await c.query(
        `UPDATE purchase_requisitions SET status = 'draft', revision = revision + 1, decision_note = $2, approved_at = NULL,
                no_approval_note = NULL, updated_at = now() WHERE id = $1`,
        [prId, `Reopened: ${dto.reason}`],
      );
      // the indents closed as issued from the store wait on it again
      await c.query(
        `UPDATE purchase_indents pi SET route = 'in_requisition', updated_at = now()
          WHERE pi.route = 'closed' AND EXISTS (SELECT 1 FROM purchase_indent_lines il JOIN purchase_requisition_sources src ON src.indent_line_id = il.id
                       JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id WHERE rl.requisition_id = $1 AND il.indent_id = pi.id)`,
        [prId],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.requisition.reopen',
        entityType: 'purchase_requisitions',
        entityId: prId,
        after: { reason: dto.reason, revision: pr.revision + 1 },
      });
      return { id: prId, revision: pr.revision + 1 };
    });
  }

  /** The purchase office closes an approved indent it will not buy (bought otherwise, no longer needed). */
  async closeIndent(ctx: RequestContext, indentId: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ number: string }>(
        `UPDATE purchase_indents SET route = 'closed', bypass_note = $2, updated_at = now()
          WHERE id = $1 AND status = 'approved' AND route = 'to_requisition' RETURNING number`,
        [indentId, `Closed by the purchase office: ${dto.reason}`],
      );
      if (!r.rows[0])
        throw new DomainError(
          'purchase.indent_not_waiting',
          'This indent is not waiting for a requisition',
          {
            status: 409,
          },
        );
      await this.audit.stage(ctx, c, {
        action: 'purchase.indent.close',
        entityType: 'purchase_indents',
        entityId: indentId,
        after: { reason: dto.reason },
      });
      return { closed: true };
    });
  }

  /** What the requisition form picks from: departments, the catalogue with its rates, units, vendors. */
  async formLists(ctx: RequestContext) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const deps = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const items = await c.query<{
        id: string;
        code: string;
        name: string;
        category: string;
        uom_id: string;
        uom: string;
        decimals: boolean;
        rate: string | null;
        gst: string | null;
        stock_tracked: boolean;
        per_unit: string;
        store_uom: string | null;
      }>(
        `SELECT i.id::text, i.code, i.name, c.name AS category, u.id::text AS uom_id, u.code AS uom, u.decimals,
                COALESCE((SELECT rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                           WHERE rc.item_id = i.id AND rc.status = 'active'
                             AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1),
                         i.last_purchase_rate)::text AS rate,
                COALESCE(i.gst_rate, h.gst_rate)::text AS gst, i.stock_tracked, i.stock_per_unit::text AS per_unit,
                su.code AS store_uom
           FROM purchase_items i JOIN purchase_item_categories c ON c.id = i.category_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE i.status = 'active' ORDER BY c.name, i.name LIMIT 5000`,
      );
      // the stores and what each holds (in the store unit), for lines issued from the store
      const stores = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM stores WHERE status = 'active' ORDER BY (kind = 'main') DESC, name`,
      );
      const stock = await c.query<{
        store_id: string;
        item_id: string;
        qty: string;
        reserved: string;
      }>(
        `SELECT store_id::text, item_id::text, qty::text, reserved::text FROM stock_balances WHERE qty > 0 OR reserved > 0`,
      );
      const uoms = await c.query<{ id: string; code: string; name: string; decimals: boolean }>(
        `SELECT id::text, code, name, decimals FROM purchase_uoms WHERE status = 'active' ORDER BY code`,
      );
      const vendors = await c.query<{
        id: string;
        code: string;
        name: string;
        gst_status: string;
        msme_type: string | null;
      }>(
        `SELECT id::text, code, legal_name AS name, gst_status, msme_type FROM vendors WHERE status = 'active' ORDER BY legal_name LIMIT 5000`,
      );
      return {
        departments: deps.rows,
        items: items.rows.map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          category: x.category,
          uomId: x.uom_id,
          uom: x.uom,
          decimals: x.decimals,
          rate: x.rate === null ? null : Number(x.rate),
          gstRate: x.gst === null ? null : Number(x.gst),
          stockTracked: x.stock_tracked,
          perUnit: Number(x.per_unit),
          storeUom: x.store_uom ?? x.uom,
        })),
        stores: stores.rows,
        stock: stock.rows.map((b) => ({
          storeId: b.store_id,
          itemId: b.item_id,
          qty: Number(b.qty),
          reserved: Number(b.reserved),
        })),
        uoms: uoms.rows,
        vendors: vendors.rows.map((v) => ({
          id: v.id,
          code: v.code,
          name: v.name,
          gstStatus: v.gst_status,
          msmeType: v.msme_type,
        })),
      };
    });
  }
}
