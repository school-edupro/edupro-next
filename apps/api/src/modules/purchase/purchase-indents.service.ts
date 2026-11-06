import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { syncFlow } from './purchase-flow';
import { PurchaseVendorsService } from './purchase-vendors.service';
import {
  PURCHASE,
  type IndentDecisionDto,
  type IndentDto,
  type IndentListQueryDto,
  type PurchaseDelegationDto,
  type ReasonDto,
} from './purchase.dto';

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;

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
}

/** A user's name as staff know it: their employee record's, else the account's. */
const PERSON = (u: 'au' | 'ru' | 'fu' | 'tu' | 'u') =>
  // eslint-disable-next-line no-restricted-syntax -- u is one of the fixed table aliases above
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

// eslint-disable-next-line no-restricted-syntax -- PERSON is a fixed fragment
const SELECT = `
  SELECT pi.id::text, pi.number, pi.department_id::text, d.name AS department, pi.raised_by::text, ${PERSON('ru')} AS raised_by_name,
         pi.on_behalf_employee_id::text, ob.display_name AS on_behalf, pi.purpose, pi.required_by::text, pi.priority, pi.status,
         pi.route, pi.bypass_rule, pi.bypass_note, pi.estimate::text, pi.workflow_instance_id::text, pi.submitted_at, pi.decided_at,
         pi.decision_note, pi.created_at,
         (SELECT st.name || ' (' || COALESCE((SELECT string_agg(${PERSON('au')}, ', ' ORDER BY ${PERSON('au')}) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody') || ')'
            FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
           WHERE i.id = pi.workflow_instance_id AND i.status = 'pending') AS waiting_with,
         (SELECT count(*)::int FROM purchase_indent_lines l WHERE l.indent_id = pi.id) AS lines
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

  private shape(r: IndentDbRow) {
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
      bypassNote: r.bypass_note,
      estimate: Number(r.estimate),
      workflowInstanceId: r.workflow_instance_id,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionNote: r.decision_note,
      createdAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      lines: r.lines,
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

  async list(ctx: RequestContext, q: IndentListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
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
                      OR ${PurchaseIndentsService.PARTICIPANT}) END`;
      const args = [
        q.status ?? null,
        q.route ?? null,
        q.departmentId ?? null,
        q.q ? `%${q.q}%` : null,
        q.view,
        all,
        deps,
      ];
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM purchase_indents pi ${where}`,
        args,
      );
      const rows = await c.query<IndentDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY pi.priority = 'urgent' DESC, COALESCE(pi.submitted_at, pi.created_at) DESC LIMIT $8 OFFSET $9`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const waiting = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed fragment
        `SELECT count(*)::int AS n FROM purchase_indents pi WHERE pi.status = 'submitted' AND ${PurchaseIndentsService.WAITING}`,
      );
      return {
        data: rows.rows.map((r) => this.shape(r)),
        total: total.rows[0]!.n,
        page: q.page,
        size: q.size,
        waitingForMe: waiting.rows[0]!.n,
      };
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

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pi = await this.load(c, ctx, id);
      const lines = await c.query<{
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
        rate_source: string;
        contract_id: string | null;
        contract_vendor: string | null;
        note: string | null;
      }>(
        `SELECT l.id::text, l.seq, l.item_id::text, i.code AS item_code, i.name AS item, l.free_text, l.quantity::text,
                u.code AS uom, l.uom_id::text, l.est_rate::text, l.rate_source, l.contract_id::text, v.legal_name AS contract_vendor, l.note
           FROM purchase_indent_lines l
           LEFT JOIN purchase_items i ON i.id = l.item_id
           JOIN purchase_uoms u ON u.id = l.uom_id
           LEFT JOIN purchase_rate_contracts rc ON rc.id = l.contract_id
           LEFT JOIN vendors v ON v.id = rc.vendor_id
          WHERE l.indent_id = $1 ORDER BY l.seq`,
        [id],
      );
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
        ...this.shape(pi),
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
          estRate: Number(l.est_rate),
          amount: Math.round(Number(l.quantity) * Number(l.est_rate) * 100) / 100,
          rateSource: l.rate_source,
          contractVendor: l.contract_vendor,
          note: l.note,
        })),
        departmentSpendThisYear: Number(spend.rows[0]!.total),
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
        },
      };
    });
  }

  /** What the indent form picks from: the departments, the catalogue (with its rates), units, staff. */
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
      }>(
        `SELECT i.id::text, i.code, i.name, c.name AS category, u.id::text AS uom_id, u.code AS uom, u.decimals,
                i.last_purchase_rate::text AS last, rc.rate::text AS contract_rate, rc.vendor AS contract_vendor
           FROM purchase_items i JOIN purchase_item_categories c ON c.id = i.category_id JOIN purchase_uoms u ON u.id = i.uom_id
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
      return {
        departments: deps,
        myDepartmentIds: mine.map((d) => d.id),
        anyDepartment: any,
        items: items.rows.map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          category: x.category,
          uomId: x.uom_id,
          uom: x.uom,
          decimals: x.decimals,
          lastRate: x.last === null ? null : Number(x.last),
          contractRate: x.contract_rate === null ? null : Number(x.contract_rate),
          contractVendor: x.contract_vendor,
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

  /** The lines checked and priced: the rate contract's rate, else the last purchase rate, unless typed. */
  private async priceLines(c: PoolClient, lines: IndentDto['lines']) {
    const out: Array<{
      itemId: string | null;
      freeText: string | null;
      quantity: number;
      uomId: string;
      estRate: number;
      rateSource: 'contract' | 'last' | 'typed';
      contractId: string | null;
      note: string | null;
    }> = [];
    for (const l of lines) {
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
          l.estRate !== undefined
            ? 'typed'
            : x.contract_rate
              ? 'contract'
              : x.last
                ? 'last'
                : 'typed';
        out.push({
          itemId: l.itemId,
          freeText: null,
          quantity: l.quantity,
          uomId: l.uomId ?? x.uom_id,
          estRate: l.estRate ?? Number(x.contract_rate ?? x.last ?? 0),
          rateSource: source,
          contractId: x.contract_id,
          note: l.note ?? null,
        });
      } else {
        out.push({
          itemId: null,
          freeText: l.freeText!,
          quantity: l.quantity,
          uomId: l.uomId!,
          estRate: l.estRate ?? 0,
          rateSource: 'typed',
          contractId: null,
          note: l.note ?? null,
        });
      }
    }
    return out;
  }

  private async writeLines(c: PoolClient, indentId: string, lines: IndentDto['lines']) {
    const priced = await this.priceLines(c, lines);
    await c.query(`DELETE FROM purchase_indent_lines WHERE indent_id = $1`, [indentId]);
    let estimate = 0;
    for (const [i, l] of priced.entries()) {
      await c.query(
        `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, free_text, quantity, uom_id, est_rate, rate_source, contract_id, note)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        ],
      );
      estimate += Math.round(l.quantity * l.estRate * 100) / 100;
    }
    await c.query(`UPDATE purchase_indents SET estimate = $2, updated_at = now() WHERE id = $1`, [
      indentId,
      Math.round(estimate * 100) / 100,
    ]);
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
      await this.writeLines(c, id, dto.lines);
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
      await this.writeLines(c, id, dto.lines);
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
      let number = pi.number;
      if (!number)
        number = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('indent') AS n`))
          .rows[0]!.n;
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: flow.code,
        entityType: 'purchase_indent',
        entityId: id,
        subject: `${number} · ${flow.department} · ${rupees(Number(pi.estimate))}${pi.priority === 'urgent' ? ' · urgent' : ''}`,
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
    await this.audit.stage(ctx, c, {
      action: 'purchase.requisition.auto_approve',
      entityType: 'purchase_requisitions',
      entityId: pr.rows[0]!.id,
      after: { indent: pi.number, rule, note },
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
