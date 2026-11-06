import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { syncFlow } from './purchase-flow';
import { draftOrdersFor } from './purchase-order-core';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  PURCHASE,
  type CertificateDto,
  type ChoicesDto,
  type CreateRequisitionDto,
  type IndentDecisionDto,
  type QuoteDto,
  type ReasonDto,
  type RequisitionFileDto,
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
         r.decision_note, r.revision, r.created_by::text,
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
  note: string | null;
  vendor_id: string | null;
  vendor: string | null;
  vendor_status: string | null;
  rate: string | null;
  gst_rate: string | null;
  choice_reason: string | null;
  contract_id: string | null;
  item_gst: string | null;
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
@Injectable()
export class PurchaseRequisitionsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
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
      }>(
        `SELECT direct_limit::text, committee_limit::text, committee_quotes, committee_signatures, purchase_department_id::text
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
   * estimate, of the lines bought) and the tier of the larger of that and the estimated total.
   */
  private async refresh(c: PoolClient, id: string) {
    const s = await this.settings(c);
    const f = (
      await c.query<{ est: string; chosen: string; buy: number }>(
        `SELECT COALESCE(sum(quantity * est_rate) FILTER (WHERE fulfil = 'buy'), 0)::text AS est,
                COALESCE(sum(quantity * COALESCE(rate, est_rate)) FILTER (WHERE fulfil = 'buy'), 0)::text AS chosen,
                (count(*) FILTER (WHERE fulfil = 'buy'))::int AS buy
           FROM purchase_requisition_lines WHERE requisition_id = $1`,
        [id],
      )
    ).rows[0]!;
    const chosen = round2(Number(f.chosen));
    const tier = this.tierOf(Math.max(Number(f.est), chosen), f.buy, s);
    await c.query(
      `UPDATE purchase_requisitions SET estimate = $2, tier = $3, updated_at = now() WHERE id = $1`,
      [id, chosen, tier],
    );
    return { estimate: chosen, value: Math.max(Number(f.est), chosen), tier };
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
  async list(ctx: RequestContext, q: RequisitionListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      const where = `WHERE ($1::text IS NULL OR r.status = $1)
          AND ($2::text IS NULL OR r.number ILIKE $2 OR r.purpose ILIKE $2)
          AND CASE $3 WHEN 'waiting' THEN ${WAITING}
                      WHEN 'sign' THEN ${TO_SIGN}
                      ELSE ($4 OR ${PARTICIPANT} OR ${RAISER} OR (r.tier = 'committee' AND ${ON_COMMITTEE})) END`;
      const args = [q.status ?? null, q.q ? `%${q.q}%` : null, q.view, this.seesAll(ctx)];
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM purchase_requisitions r ${where}`,
        args,
      );
      const rows = await c.query<PrRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY COALESCE(r.submitted_at, r.created_at) DESC LIMIT $5 OFFSET $6`,
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
                l.vendor_id::text, v.legal_name AS vendor, v.status AS vendor_status, l.rate::text, l.gst_rate::text,
                l.choice_reason, l.contract_id::text,
                COALESCE(i.gst_rate, h.gst_rate)::text AS item_gst
           FROM purchase_requisition_lines l
           LEFT JOIN purchase_items i ON i.id = l.item_id
           LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN vendors v ON v.id = l.vendor_id
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
    if (lines.some((l) => l.fulfil === 'store'))
      add(
        'store',
        'Every line issued from the store says what is issued',
        lines.filter((l) => l.fulfil === 'store').every((l) => !!l.store_note),
      );
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
      const fromQuote = buy.every(
        (l) =>
          !l.vendor_id ||
          quotes.some((q) => q.vendor_id === l.vendor_id && q.lines.some((x) => x.lineId === l.id)),
      );
      add('from_quote', 'Every chosen vendor from its quote', fromQuote);
      const dearer = buy.filter((l) => {
        const lo = low.get(l.id);
        return l.vendor_id && lo && !lo.vendorIds.includes(l.vendor_id) && !l.choice_reason;
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

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pr = await this.load(c, ctx, id);
      const s = await this.settings(c);
      const lines = await this.linesOf(c, id);
      const sources = await c.query<{
        line_id: string;
        indent_id: string;
        number: string;
        department: string;
        quantity: string;
        raised_by: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
        `SELECT src.requisition_line_id::text AS line_id, pi.id::text AS indent_id, pi.number, d.name AS department, src.quantity::text,
                ${PERSON('u')} AS raised_by
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
      return {
        ...this.shape(pr),
        limits: {
          direct: Number(s.direct_limit),
          committee: Number(s.committee_limit),
          quotes: s.committee_quotes,
        },
        value: round2(
          Math.max(
            lines
              .filter((l) => l.fulfil === 'buy')
              .reduce((a, l) => a + Number(l.quantity) * Number(l.est_rate), 0),
            Number(pr.estimate),
          ),
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
            note: l.note,
            vendorId: l.vendor_id,
            vendor: l.vendor,
            rate: l.rate === null ? null : Number(l.rate),
            gstRate: l.gst_rate === null ? null : Number(l.gst_rate),
            amount: round2(Number(l.quantity) * Number(l.rate ?? l.est_rate)),
            choiceReason: l.choice_reason,
            fromContract: l.contract_id !== null,
            itemGst: l.item_gst === null ? null : Number(l.item_gst),
            l1:
              lo === undefined
                ? null
                : {
                    landed: lo.landed,
                    vendorIds: lo.vendorIds,
                  },
            dearer: lo !== undefined && l.vendor_id !== null && !lo.vendorIds.includes(l.vendor_id),
            sources: sources.rows
              .filter((x) => x.line_id === l.id)
              .map((x) => ({
                indentId: x.indent_id,
                number: x.number,
                department: x.department,
                raisedBy: x.raised_by,
                quantity: Number(x.quantity),
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
      `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, free_text, quantity, uom_id, est_rate, fulfil, store_note, note)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
                    vendor_id = CASE WHEN $8::text = 'store' THEN NULL ELSE vendor_id END,
                    rate = CASE WHEN $8::text = 'store' THEN NULL ELSE rate END,
                    gst_rate = CASE WHEN $8::text = 'store' THEN NULL ELSE gst_rate END,
                    choice_reason = CASE WHEN $8::text = 'store' THEN NULL ELSE choice_reason END
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
            ],
          );
        } else await this.insertLine(c, id, seq, l);
      }
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
      for (const ch of dto.lines) {
        const line = lines.find((x) => x.id === ch.lineId);
        if (!line) throw new DomainError('not-found', 'A line was not found', { status: 404 });
        const name = line.item ?? line.free_text ?? `Line ${String(line.seq)}`;
        if (line.fulfil !== 'buy')
          throw new DomainError('validation-failed', `${name} is issued from the store`, {
            status: 400,
          });
        if (!ch.vendorId) {
          await c.query(
            `UPDATE purchase_requisition_lines SET vendor_id = NULL, rate = NULL, gst_rate = NULL, choice_reason = NULL, contract_id = NULL WHERE id = $1`,
            [line.id],
          );
          continue;
        }
        const v = await this.activeVendor(c, ch.vendorId);
        const quoted = quotes
          .find((q) => q.vendor_id === ch.vendorId)
          ?.lines.find((l) => l.lineId === line.id);
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
        await c.query(
          `UPDATE purchase_requisition_lines SET vendor_id = $2, rate = $3, gst_rate = $4, choice_reason = $5, contract_id = NULL WHERE id = $1`,
          [line.id, ch.vendorId, rate, gst, dearer ? ch.reason : null],
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
      return { id: prId, number: pr.number, tier: f.tier };
    });
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
      return;
    }
    await c.query(
      `UPDATE purchase_requisitions SET status = 'approved', decided_at = now(), approved_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
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
      [id, `Issued from the store (${pr.number})`],
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
      // its draft POs are dropped; new ones are drafted when it is approved again
      await c.query(
        `UPDATE purchase_orders SET status = 'cancelled', decision_note = 'The requisition was reopened', updated_at = now()
          WHERE requisition_id = $1 AND status IN ('draft', 'sent_back')`,
        [prId],
      );
      await c.query(
        `UPDATE purchase_requisitions SET status = 'draft', revision = revision + 1, decision_note = $2, approved_at = NULL,
                updated_at = now() WHERE id = $1`,
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
      }>(
        `SELECT i.id::text, i.code, i.name, c.name AS category, u.id::text AS uom_id, u.code AS uom, u.decimals,
                COALESCE((SELECT rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                           WHERE rc.item_id = i.id AND rc.status = 'active'
                             AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to LIMIT 1),
                         i.last_purchase_rate)::text AS rate,
                COALESCE(i.gst_rate, h.gst_rate)::text AS gst
           FROM purchase_items i JOIN purchase_item_categories c ON c.id = i.category_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
          WHERE i.status = 'active' ORDER BY c.name, i.name LIMIT 5000`,
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
