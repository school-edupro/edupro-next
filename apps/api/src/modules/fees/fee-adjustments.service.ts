import { WAITING_WITH, startFeeApproval } from './fee-approval';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { assertPeriodOpen } from '../ops/ops.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { SETTINGS_CATALOGUE } from '../platform/settings.catalogue';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { FeeSetupService } from './fee-setup.service';
import type {
  StudentDiscountInput,
  StudentOptionalHeadInput,
  DecideAdjustmentDto,
  ListAdjustmentsQueryDto,
  ListMiscReceiptsQueryDto,
  ListProfileChangesQueryDto,
  PostMiscReceiptDto,
  RequestAdjustmentDto,
  RequestProfileChangeDto,
  RequestWaiversDto,
} from './fees.dto';

export interface AdjustmentRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  kind: 'waiver' | 'reversal' | 'bounce';
  demandId: string | null;
  demandLabel: string | null;
  paymentId: string | null;
  receiptNo: string | null;
  receiptAmount: string | null;
  amount: string;
  charge: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Waiver lines sent together share a batch and one approval. */
  batchId: string | null;
  workflowInstanceId: string | null;
  waitingWith: string | null;
  /** An approved waiver being taken back: pending, approved (taken back) or rejected. */
  undoStatus: 'pending' | 'approved' | 'rejected' | null;
  undoReason: string | null;
  undoneAt: string | null;
  undoWaitingWith: string | null;
}

export interface ProfileChangeRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  changes: Record<string, unknown>;
  before: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** What was asked, in words (from the approval's subject). */
  summary: string | null;
  /** The level it waits at and the people who can approve it; null once decided. */
  waitingWith: string | null;
}

export interface MiscReceiptRow {
  id: string;
  receiptNo: string;
  payerKind: string;
  studentId: string | null;
  employeeId: string | null;
  payerName: string;
  payerMobile: string | null;
  headId: string;
  headCode: string;
  headName: string;
  amount: string;
  receivedOn: string;
  mode: string;
  reference: string | null;
  instrumentNo: string | null;
  bankName: string | null;
  remarks: string | null;
  status: string;
  receivedBy: string | null;
}

export interface ReconciliationRow {
  id: string;
  runDate: string;
  asOf: string;
  onlineReceipts: number;
  onlineAmount: string;
  settledReceipts: number;
  settledAmount: string;
  unsettledReceipts: number;
  unsettledAmount: string;
  agedUnsettled: number;
  unmatchedLines: number;
  mismatchedLines: number;
  succeededWithoutReceipt: number;
  variance: string;
  ranAt: string;
}

/** The approval a fee waiver rides; its levels mirror the fee change approval. */
export const FEE_WAIVER_FLOW = 'fee_waiver';
export const FEE_WAIVER_UNDO_FLOW = 'fee_waiver_undo';
const FEE_WAIVER_NAME = 'Fee waiver, receipt cancellation and cheque bounce';

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const ADJ_SELECT = `SELECT a.id::text, a.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo", a.kind::text,
        a.demand_id::text AS "demandId", CASE WHEN d.id IS NOT NULL THEN h.name || ' · ' || fp.name END AS "demandLabel",
        a.payment_id::text AS "paymentId", p.receipt_no AS "receiptNo", p.amount::text AS "receiptAmount",
        a.amount::text, a.charge::text, a.reason, a.status::text, ru.display_name AS "requestedBy", a.requested_at AS "requestedAt",
        du.display_name AS "decidedBy", a.decided_at AS "decidedAt", a.decision_note AS "decisionNote",
        a.batch_id::text AS "batchId", a.workflow_instance_id::text AS "workflowInstanceId", ${WAITING_WITH('a.workflow_instance_id')} AS "waitingWith",
        a.undo_status AS "undoStatus", a.undo_reason AS "undoReason", a.undone_at::text AS "undoneAt", ${WAITING_WITH('a.undo_workflow_instance_id')} AS "undoWaitingWith"
   FROM fee_adjustments a JOIN students s ON s.id = a.student_id
   LEFT JOIN fee_demands d ON d.id = a.demand_id LEFT JOIN fee_heads h ON h.id = d.head_id LEFT JOIN fee_periods fp ON fp.id = d.period_id
   LEFT JOIN fee_payments p ON p.id = a.payment_id
   LEFT JOIN users ru ON ru.id = a.requested_by LEFT JOIN users du ON du.id = a.decided_by`;

const CHANGE_SELECT = `SELECT c.id::text, c.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo", c.changes, c.before, c.reason, c.status::text,
        ru.display_name AS "requestedBy", c.requested_at AS "requestedAt", c.workflow_instance_id::text AS "workflowInstanceId", du.display_name AS "decidedBy", c.decided_at AS "decidedAt", c.decision_note AS "decisionNote",
        (SELECT regexp_replace(i.subject, '^Fee change: [^:]*: ', '') FROM workflow_instances i WHERE i.id = c.workflow_instance_id) AS "summary",
        (SELECT st.name || ' (' || COALESCE((SELECT string_agg(au.display_name, ', ' ORDER BY au.display_name) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody holds this role yet') || ')'
           FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
          WHERE i.id = c.workflow_instance_id AND i.status = 'pending') AS "waitingWith"
   FROM fee_profile_changes c JOIN students s ON s.id = c.student_id LEFT JOIN users ru ON ru.id = c.requested_by LEFT JOIN users du ON du.id = c.decided_by`;

const MISC_SELECT = `SELECT m.id::text, m.receipt_no AS "receiptNo", m.payer_kind::text AS "payerKind", m.student_id::text AS "studentId", m.employee_id::text AS "employeeId",
        m.payer_name AS "payerName", m.payer_mobile AS "payerMobile", m.head_id::text AS "headId", h.code AS "headCode", h.name AS "headName", m.amount::text,
        m.received_on::text AS "receivedOn", m.mode, m.reference, m.instrument_no AS "instrumentNo", m.bank_name AS "bankName", m.remarks, m.status, u.display_name AS "receivedBy"
   FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id LEFT JOIN users u ON u.id = m.received_by`;

const stamp = <T extends { requestedAt: unknown; decidedAt?: unknown }>(x: T): T => ({
  ...x,
  requestedAt: (x.requestedAt as Date).toISOString(),
  decidedAt: x.decidedAt ? (x.decidedAt as Date).toISOString() : null,
});

/** PL/pgSQL exceptions of the adjustment procedures become domain errors with the same code. */
const translate = (error: unknown): unknown => {
  const e = error as { message?: string; detail?: string };
  const known: Record<string, [string, number]> = {
    'fees.nothing_to_waive': ['Nothing is left to waive on this row', 409],
    'fees.already_reversed': ['The receipt is already reversed or bounced', 409],
    'fees.reversal_after_refund': ['A receipt with a refund cannot be reversed', 409],
    'fees.no_bounce_head': ['Set fees.bounce_charge_head to a misc fee head first', 409],
    'fees.demand_not_found': ['Demand row not found', 404],
    'fees.payment_not_found': ['Receipt not found', 404],
    'year.closed': ['The session is closed for fees', 409],
    'year.stage_locked': ['Fees are locked for this session', 409],
  };
  const hit = e.message ? known[e.message] : undefined;
  if (!hit) return error;
  let extra: Record<string, unknown> | undefined;
  try {
    extra = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : undefined;
  } catch {
    extra = undefined;
  }
  return new DomainError(e.message!, hit[0], { status: hit[1], extra });
};

/**
 * Sprint 14: adjustments (waiver, receipt reversal, cheque bounce with charge) requested by the desk and
 * decided by an administrator with step-up MFA; category, discount and hostel changes through the
 * `fee_profile_change` workflow with regeneration on approval; misc receipts on the misc ledger for
 * students, employees, vendors and others; the daily reconciliation of online receipts against settlements.
 */
@Injectable()
export class FeeAdjustmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly setup: FeeSetupService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  // ---- adjustments -------------------------------------------------------------------------------
  async adjustments(ctx: RequestContext, q: ListAdjustmentsQueryDto): Promise<AdjustmentRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<AdjustmentRow>(
        // eslint-disable-next-line no-restricted-syntax -- ADJ_SELECT is a constant; values are bound parameters
        `${ADJ_SELECT} WHERE a.academic_year_id = $1 AND ($2::workflow_status IS NULL OR a.status = $2::workflow_status)
           AND ($3::bigint IS NULL OR a.student_id = $3) AND ($4::fee_adjustment_kind IS NULL OR a.kind = $4::fee_adjustment_kind)
          ORDER BY (a.status = 'pending') DESC, a.requested_at DESC LIMIT 300`,
        [yearId, q.status ?? null, q.studentId ?? null, q.kind ?? null],
      );
      return r.rows.map(stamp);
    });
  }

  private async findAdjustment(c: PoolClient, id: string): Promise<AdjustmentRow> {
    const r = await c.query<AdjustmentRow>(
      // eslint-disable-next-line no-restricted-syntax -- ADJ_SELECT is a constant; the id is a bound parameter
      `${ADJ_SELECT} WHERE a.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Adjustment not found', { status: 404 });
    return stamp(r.rows[0]);
  }

  /**
   * Several fee lines of one pupil waived in one request (the head-by-month grid). The lines share a
   * batch and one approval through the fee approval levels; they are approved or rejected together.
   */
  async requestWaivers(ctx: RequestContext, dto: RequestWaiversDto): Promise<AdjustmentRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const st = await c.query<{ name: string }>(
        `SELECT display_name AS name FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [dto.studentId],
      );
      if (!st.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const ids = dto.lines.map((l) => l.demandId);
      if (new Set(ids).size !== ids.length)
        throw new DomainError('validation-failed', 'A fee line is given twice', { status: 422 });
      const rows = await c.query<{ id: string; label: string; balance: string }>(
        `SELECT d.id::text, h.name || ' · ' || fp.name AS label, (d.net - d.paid)::text AS balance
           FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
          WHERE d.id = ANY($1::bigint[]) AND d.student_id = $2 AND d.academic_year_id = $3`,
        [ids, dto.studentId, yearId],
      );
      const byId = new Map(rows.rows.map((r) => [r.id, r]));
      let total = 0;
      for (const l of dto.lines) {
        const d = byId.get(l.demandId);
        if (!d)
          throw new DomainError('not-found', 'A fee line is not of this pupil and year', {
            status: 404,
          });
        if (l.amount > Number(d.balance) + 0.005)
          throw new DomainError(
            'fees.waiver_exceeds_balance',
            `Only ₹${Number(d.balance).toFixed(2)} is outstanding on ${d.label}`,
            { status: 409 },
          );
        total += l.amount;
      }
      const batch = await c.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
      const made: string[] = [];
      try {
        for (const l of dto.lines) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO fee_adjustments (school_id, student_id, academic_year_id, kind, demand_id, amount, charge, reason, requested_by, request_id, batch_id)
             VALUES (app.current_school_id(), $1, $2, 'waiver', $3, $4, 0, $5, app.current_user_id(), app.current_request_id(), $6::uuid) RETURNING id::text`,
            [dto.studentId, yearId, l.demandId, l.amount.toFixed(2), dto.reason, batch.rows[0]!.id],
          );
          made.push(r.rows[0]!.id);
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'fees.adjustment_open',
            'A waiver is already waiting on one of these fee lines',
            { status: 409 },
          );
        throw error;
      }
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: FEE_WAIVER_FLOW, name: FEE_WAIVER_NAME },
        made[0]!,
        `Fee waiver: ${st.rows[0].name}: ${made.length} fee line${made.length === 1 ? '' : 's'}, Rs. ${total.toFixed(2)}`,
        {
          batchId: batch.rows[0]!.id,
          lines: made.length,
          total: total.toFixed(2),
          reason: dto.reason,
        },
      );
      if (instanceId)
        await c.query(
          `UPDATE fee_adjustments SET workflow_instance_id = $2 WHERE batch_id = $1::uuid`,
          [batch.rows[0]!.id, instanceId],
        );
      await this.audit.stage(ctx, c, {
        action: 'fees.adjustment.request',
        entityType: 'fee_adjustments',
        entityId: made[0]!,
        after: { kind: 'waiver', studentId: dto.studentId, lines: dto.lines, reason: dto.reason },
      });
      const out: AdjustmentRow[] = [];
      for (const id of made) out.push(await this.findAdjustment(c, id));
      return out;
    });
  }

  /**
   * An approved waiver is taken back: its lines (all the lines sent together) go for approval through
   * the fee levels, and on approval the waived amounts are due again. Where the school has no levels in
   * force it needs the fee approve right and is applied at once.
   */
  async requestWaiverUndo(
    ctx: RequestContext,
    id: string,
    reason: string,
  ): Promise<AdjustmentRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const one = await this.findAdjustment(c, id);
      if (one.kind !== 'waiver' || one.status !== 'approved')
        throw new DomainError(
          'fees.not_an_approved_waiver',
          'Only an approved fee waiver can be taken back',
          {
            status: 409,
          },
        );
      const rows = await c.query<{
        id: string;
        amount: string;
        undo_status: string | null;
        undone: boolean;
      }>(
        `SELECT a.id::text, a.amount::text, a.undo_status, a.undone_at IS NOT NULL AS undone FROM fee_adjustments a
          WHERE a.kind = 'waiver' AND a.status = 'approved' AND (a.id = $1 OR (a.batch_id IS NOT NULL AND a.batch_id = $2::uuid))
          ORDER BY a.id FOR UPDATE`,
        [id, one.batchId],
      );
      const open = rows.rows.filter((r) => !r.undone);
      if (open.length === 0)
        throw new DomainError(
          'fees.waiver_already_undone',
          'This waiver has already been taken back',
          {
            status: 409,
          },
        );
      if (open.some((r) => r.undo_status === 'pending'))
        throw new DomainError(
          'fees.waiver_undo_open',
          'Taking this waiver back is already waiting for approval',
          {
            status: 409,
          },
        );
      const ids = open.map((r) => r.id);
      const total = open.reduce((a, r) => a + Number(r.amount), 0);
      await c.query(
        `UPDATE fee_adjustments SET undo_status = 'pending', undo_reason = $2, undo_requested_by = app.current_user_id(),
                undo_requested_at = now(), undo_workflow_instance_id = NULL WHERE id = ANY($1::bigint[])`,
        [ids, reason],
      );
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: FEE_WAIVER_UNDO_FLOW, name: 'Fee waiver taken back' },
        ids[0]!,
        `Take back fee waiver: ${one.studentName}: ${ids.length} fee line${ids.length === 1 ? '' : 's'}, Rs. ${total.toFixed(2)} due again`,
        { reason, lines: ids.length, total: total.toFixed(2) },
      );
      if (instanceId)
        await c.query(
          `UPDATE fee_adjustments SET undo_workflow_instance_id = $2 WHERE id = ANY($1::bigint[]) AND undo_status = 'pending'`,
          [ids, instanceId],
        );
      else {
        if (!ctx.permissions?.has('fees.adjustment.approve'))
          throw new DomainError(
            'fees.approval_required',
            'Taking a waiver back needs approval: set the levels under Fee setup → Approval levels',
            { status: 403 },
          );
        await this.applyWaiverUndo(c, ids[0]!, 'approved');
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.waiver.undo_request',
        entityType: 'fee_adjustments',
        entityId: ids[0]!,
        after: { reason, lines: ids.length, total: total.toFixed(2), appliedAtOnce: !instanceId },
      });
      const out: AdjustmentRow[] = [];
      for (const x of ids) out.push(await this.findAdjustment(c, x));
      return out;
    });
  }

  /** Every line of the waiver that waits to be taken back: put back on the bill, or left as it is. */
  private async applyWaiverUndo(
    c: PoolClient,
    firstId: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const rows = await c.query<{ id: string; demand_id: string | null; amount: string }>(
      `SELECT a.id::text, a.demand_id::text, a.amount::text FROM fee_adjustments a
        WHERE a.undo_status = 'pending' AND a.kind = 'waiver'
          AND (a.id = $1 OR (a.batch_id IS NOT NULL AND a.batch_id = (SELECT batch_id FROM fee_adjustments WHERE id = $1)))
        ORDER BY a.id FOR UPDATE`,
      [firstId],
    );
    for (const r of rows.rows) {
      if (outcome === 'approved') {
        if (r.demand_id)
          await c.query(`SELECT app.unwaive_demand($1, $2)`, [r.demand_id, r.amount]);
        await c.query(
          `UPDATE fee_adjustments SET undo_status = 'approved', undone_at = now(), undone_by = app.current_user_id() WHERE id = $1`,
          [r.id],
        );
      } else
        await c.query(`UPDATE fee_adjustments SET undo_status = 'rejected' WHERE id = $1`, [r.id]);
    }
  }

  async onWaiverUndoComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    await this.applyWaiverUndo(c, instance.entityId, outcome);
    await this.audit.stage(ctx, c, {
      action: `fees.waiver.undo_${outcome}`,
      entityType: 'fee_adjustments',
      entityId: instance.entityId,
      after: { workflowInstanceId: instance.id },
    });
  }

  /**
   * The last level approved (or a level rejected): every line of the waiver, or the receipt
   * cancellation / cheque bounce, is applied or closed.
   */
  async onWaiverComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((s) => s.status === outcome)?.note ?? undefined;
    const lines = await c.query<{ id: string }>(
      `SELECT id::text FROM fee_adjustments WHERE workflow_instance_id = $1 AND status = 'pending' ORDER BY id`,
      [instance.id],
    );
    // the instance id is written after start(): a request approved at once (level 1 by itself) is found by its first line
    const ids = lines.rows.length
      ? lines.rows.map((r) => r.id)
      : (
          await c.query<{ id: string }>(
            `SELECT a.id::text FROM fee_adjustments a
              WHERE a.status = 'pending'
                AND (a.id = $1 OR a.batch_id = (SELECT batch_id FROM fee_adjustments WHERE id = $1)) ORDER BY a.id`,
            [instance.entityId],
          )
        ).rows.map((r) => r.id);
    for (const id of ids) await this.decideWith(c, ctx, id, { outcome, note });
  }

  async requestAdjustment(ctx: RequestContext, dto: RequestAdjustmentDto): Promise<AdjustmentRow> {
    // one fee line is a waiver request of one line: it rides the approval levels like the grid
    if (dto.kind === 'waiver') {
      const d = await this.db.tenant(requireTenant(ctx), (c) =>
        c.query<{ student_id: string }>(`SELECT student_id::text FROM fee_demands WHERE id = $1`, [
          dto.demandId,
        ]),
      );
      if (!d.rows[0])
        throw new DomainError('not-found', 'Demand row not found in the working year', {
          status: 404,
        });
      const rows = await this.requestWaivers(ctx, {
        studentId: d.rows[0].student_id,
        reason: dto.reason,
        lines: [{ demandId: dto.demandId!, amount: dto.amount! }],
      });
      return rows[0]!;
    }
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let studentId: string;
      let amount: number;
      let charge = 0;
      if (dto.kind === 'waiver') {
        const d = await c.query<{ student_id: string; net: string; paid: string; year: string }>(
          `SELECT student_id::text, net::text, paid::text, academic_year_id::text AS year FROM fee_demands WHERE id = $1`,
          [dto.demandId],
        );
        if (!d.rows[0] || d.rows[0].year !== yearId)
          throw new DomainError('not-found', 'Demand row not found in the working year', {
            status: 404,
          });
        const balance = Number(d.rows[0].net) - Number(d.rows[0].paid);
        if (balance <= 0)
          throw new DomainError('fees.nothing_to_waive', 'The row is already settled', {
            status: 409,
          });
        if (dto.amount! > balance + 0.005)
          throw new DomainError(
            'fees.waiver_exceeds_balance',
            `Only ₹${balance.toFixed(2)} is outstanding on this row`,
            {
              status: 409,
              extra: { balance: balance.toFixed(2) },
            },
          );
        studentId = d.rows[0].student_id;
        amount = dto.amount!;
      } else {
        const p = await c.query<{
          student_id: string;
          amount: string;
          status: string;
          year: string;
          mode: string;
          refunded: string;
        }>(
          `SELECT student_id::text, amount::text, status, academic_year_id::text AS year, mode, refunded::text FROM fee_payments WHERE id = $1`,
          [dto.paymentId],
        );
        const pay = p.rows[0];
        if (!pay || pay.year !== yearId)
          throw new DomainError('not-found', 'Receipt not found in the working year', {
            status: 404,
          });
        if (pay.status === 'reversed' || pay.status === 'bounced')
          throw new DomainError(
            'fees.already_reversed',
            'The receipt is already reversed or bounced',
            { status: 409 },
          );
        if (Number(pay.refunded) > 0)
          throw new DomainError(
            'fees.reversal_after_refund',
            'A receipt with a refund cannot be reversed',
            { status: 409 },
          );
        if (dto.kind === 'bounce' && !['cheque', 'dd'].includes(pay.mode))
          throw new DomainError(
            'fees.bounce_needs_instrument',
            'Only cheque and DD receipts bounce; reverse the receipt instead',
            {
              status: 409,
            },
          );
        studentId = pay.student_id;
        amount = Number(pay.amount);
        if (dto.kind === 'bounce') {
          const setting = await c.query<{ v: string | null }>(
            `SELECT app.setting('fees.bounce_charge') #>> '{}' AS v`,
          );
          // the class's own charge when it has one, else the school's
          charge =
            dto.charge ??
            (await this.setup.bounceChargeFor(c, studentId, yearId)) ??
            Number(setting.rows[0]?.v ?? SETTINGS_CATALOGUE['fees.bounce_charge']!.default);
        }
      }
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_adjustments (school_id, student_id, academic_year_id, kind, demand_id, payment_id, amount, charge, reason, requested_by, request_id)
           VALUES (app.current_school_id(), $1, $2, $3::fee_adjustment_kind, $4, $5, $6, $7, $8, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
          [
            studentId,
            yearId,
            dto.kind,
            dto.kind === 'waiver' ? dto.demandId : null,
            dto.kind === 'waiver' ? null : dto.paymentId,
            amount.toFixed(2),
            charge.toFixed(2),
            dto.reason,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'fees.adjustment_open',
            'An adjustment is already waiting on this row or receipt',
            { status: 409 },
          );
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.adjustment.request',
        entityType: 'fee_adjustments',
        entityId: id,
        after: { ...dto, studentId, amount, charge },
      });
      // a receipt cancellation or a cheque bounce rides the fee approval levels, like a waiver
      const made = await this.findAdjustment(c, id);
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: FEE_WAIVER_FLOW, name: FEE_WAIVER_NAME },
        id,
        dto.kind === 'bounce'
          ? `Cheque bounced: receipt ${made.receiptNo ?? ''} of ${made.studentName}, Rs. ${made.receiptAmount ?? ''}; bounce charge Rs. ${charge.toFixed(2)}`
          : `Cancel receipt ${made.receiptNo ?? ''} of ${made.studentName}, Rs. ${made.receiptAmount ?? ''}`,
        { kind: dto.kind, reason: dto.reason, charge: charge.toFixed(2) },
      );
      if (instanceId)
        await c.query(`UPDATE fee_adjustments SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instanceId,
        ]);
      return this.findAdjustment(c, id);
    });
  }

  /** Approval applies the adjustment inside the same transaction (the route requires step-up MFA). */
  async decideAdjustment(
    ctx: RequestContext,
    id: string,
    dto: DecideAdjustmentDto,
  ): Promise<AdjustmentRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findAdjustment(c, id);
      if (row.status === 'pending' && row.workflowInstanceId)
        throw new DomainError(
          'fees.adjustment_in_workflow',
          'This request goes through the approval levels: approve it from My approvals',
          { status: 409 },
        );
      return this.decideWith(c, ctx, id, dto);
    });
  }

  private async decideWith(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    dto: { outcome: 'approved' | 'rejected'; note?: string },
  ): Promise<AdjustmentRow> {
    {
      const before = await this.findAdjustment(c, id);
      if (before.status !== 'pending')
        throw new DomainError(
          'fees.adjustment_decided',
          'This adjustment has already been decided',
          { status: 409 },
        );
      let applied: Record<string, unknown> = {};
      if (dto.outcome === 'approved') {
        try {
          if (before.kind === 'waiver') {
            const w = await c.query<{ v: string }>(`SELECT app.waive_demand($1, $2)::text AS v`, [
              before.demandId,
              before.amount,
            ]);
            applied = { waived: w.rows[0]!.v };
          } else {
            let headId: string | null = null;
            if (before.kind === 'bounce' && Number(before.charge) > 0)
              headId = await this.bounceHead(c);
            const r = await c.query<{ v: string | null }>(
              `SELECT app.reverse_fee_payment($1, $2, $3, $4, $5)::text AS v`,
              [
                before.paymentId,
                before.kind === 'bounce' ? 'bounced' : 'reversed',
                before.reason,
                before.charge,
                headId,
              ],
            );
            applied = { chargeDemandId: r.rows[0]?.v ?? null };
            if (r.rows[0]?.v)
              await c.query(`UPDATE fee_adjustments SET charge_demand_id = $2 WHERE id = $1`, [
                id,
                r.rows[0].v,
              ]);
          }
        } catch (error) {
          throw translate(error);
        }
      }
      await c.query(
        `UPDATE fee_adjustments SET status = $2::workflow_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3 WHERE id = $1`,
        [id, dto.outcome, dto.note ?? null],
      );
      const after = await this.findAdjustment(c, id);
      await this.audit.stage(ctx, c, {
        action: `fees.adjustment.${dto.outcome}`,
        entityType: 'fee_adjustments',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status, note: dto.note, ...applied },
      });
      return after;
    }
  }

  /** The misc head that carries bounce charges (setting fees.bounce_charge_head), created when missing. */
  private async bounceHead(c: PoolClient): Promise<string> {
    const code =
      (
        await c.query<{ v: string | null }>(
          `SELECT app.setting('fees.bounce_charge_head') #>> '{}' AS v`,
        )
      ).rows[0]?.v ?? 'BOUNCE';
    const r = await c.query<{ id: string }>(
      `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
       VALUES (app.current_school_id(), $1, 'Cheque bounce charge', 'misc', 'school', 900, app.current_user_id(), app.current_user_id())
       ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
      [code],
    );
    return r.rows[0]!.id;
  }

  // ---- profile changes (workflow) ----------------------------------------------------------------
  async profileChanges(
    ctx: RequestContext,
    q: ListProfileChangesQueryDto,
  ): Promise<ProfileChangeRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<ProfileChangeRow>(
        // eslint-disable-next-line no-restricted-syntax -- CHANGE_SELECT is a constant; values are bound parameters
        `${CHANGE_SELECT} WHERE c.academic_year_id = $1 AND ($2::workflow_status IS NULL OR c.status = $2::workflow_status) AND ($3::bigint IS NULL OR c.student_id = $3)
          ORDER BY (c.status = 'pending') DESC, c.requested_at DESC LIMIT 300`,
        [yearId, q.status ?? null, q.studentId ?? null],
      );
      return r.rows.map(stamp);
    });
  }

  private async findChange(c: PoolClient, id: string): Promise<ProfileChangeRow> {
    const r = await c.query<ProfileChangeRow>(
      // eslint-disable-next-line no-restricted-syntax -- CHANGE_SELECT is a constant; the id is a bound parameter
      `${CHANGE_SELECT} WHERE c.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Profile change not found', { status: 404 });
    return stamp(r.rows[0]);
  }

  async requestProfileChange(
    ctx: RequestContext,
    studentId: string,
    dto: RequestProfileChangeDto,
  ): Promise<ProfileChangeRow> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ name: string }>(
        `SELECT display_name AS name FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [studentId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const before = await c.query<Record<string, unknown>>(
        `SELECT fee_group AS "feeGroup", pay_plan AS "payPlan", opening_balance::text AS "openingBalance", discount_id::text AS "discountId", hosteller, transport_slab_id::text AS "transportSlabId", transport_disabled AS "transportDisabled"
           FROM student_fee_profiles WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, yearId],
      );
      const { reason, ...changes } = dto;
      const beforeDiscounts =
        dto.discounts === undefined
          ? undefined
          : (await this.setup.studentDiscountsWith(c, studentId, yearId)).map((d) => ({
              discountId: d.discountId,
              name: d.name,
              fromSeq: d.fromSeq,
              toSeq: d.toSeq,
            }));
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_profile_changes (school_id, student_id, academic_year_id, changes, before, reason, requested_by, request_id)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4::jsonb, $5, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
          [
            studentId,
            yearId,
            JSON.stringify(changes),
            JSON.stringify({
              ...(before.rows[0] ?? {}),
              ...(beforeDiscounts ? { discounts: beforeDiscounts } : {}),
            }),
            reason,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'fees.profile_change_open',
            'A change for this student is already waiting for approval',
            { status: 409 },
          );
        throw error;
      }
      const def = await c.query<{ code: string }>(
        `SELECT code FROM workflow_definitions WHERE entity_type = 'fee_profile_change' AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      );
      if (def.rows[0]) {
        const instance = await this.workflow.start(c, ctx, {
          definitionCode: def.rows[0].code,
          entityType: 'fee_profile_change',
          entityId: id,
          subject: `Fee change: ${s.rows[0].name}: ${await this.describeChange(c, changes)}`.slice(
            0,
            240,
          ),
          payload: { changes, reason },
        });
        await c.query(`UPDATE fee_profile_changes SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instance.id,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.profile_change.request',
        entityType: 'fee_profile_changes',
        entityId: id,
        after: { studentId, ...dto },
      });
      return this.findChange(c, id);
    });
  }

  /** Direct decision when no workflow is installed; otherwise the inbox decides. */
  async decideProfileChange(
    ctx: RequestContext,
    id: string,
    dto: DecideAdjustmentDto,
  ): Promise<ProfileChangeRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findChange(c, id);
      if (before.status !== 'pending')
        throw new DomainError(
          'fees.profile_change_decided',
          'This change has already been decided',
          { status: 409 },
        );
      if (before.workflowInstanceId) {
        const open = await c.query(
          `SELECT 1 FROM workflow_instances WHERE id = $1 AND status = 'pending'`,
          [before.workflowInstanceId],
        );
        if (open.rowCount)
          throw new DomainError(
            'fees.profile_change_in_workflow',
            'This change is in the approval inbox; decide it there',
            { status: 409 },
          );
      }
      await this.applyChange(c, id, dto.outcome, dto.note ?? null);
      const after = await this.findChange(c, id);
      await this.audit.stage(ctx, c, {
        action: `fees.profile_change.${dto.outcome}`,
        entityType: 'fee_profile_changes',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status, note: dto.note },
      });
      return after;
    });
  }

  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((s) => s.status === outcome)?.note ?? null;
    await this.applyChange(c, instance.entityId, outcome, note);
    await this.audit.stage(ctx, c, {
      action: `fees.profile_change.${outcome}`,
      entityType: 'fee_profile_changes',
      entityId: instance.entityId,
      after: { workflowInstanceId: instance.id },
    });
  }

  /** Approval writes the profile and regenerates the demand (paid rows are kept, as always). */
  /** One line for the approver: what the request would change. */
  private async describeChange(c: PoolClient, ch: Record<string, unknown>): Promise<string> {
    const parts: string[] = [];
    if (ch.feeGroup !== undefined)
      parts.push(`fee group ${String(ch.feeGroup).replace(/_/g, ' ')}`);
    if (ch.openingBalance !== undefined) {
      const v = Number(ch.openingBalance);
      parts.push(
        v > 0
          ? `opening balance Rs. ${v.toFixed(2)} dues (Dr)`
          : v < 0
            ? `opening balance Rs. ${(-v).toFixed(2)} advance (Cr)`
            : 'no opening balance',
      );
    }
    if (ch.payPlan !== undefined)
      parts.push(
        ch.payPlan ? `pay plan ${String(ch.payPlan).replace(/_/g, '-')}` : 'pay plan as the class',
      );
    if (ch.hosteller !== undefined) parts.push(ch.hosteller ? 'hosteller' : 'not a hosteller');
    if (ch.discountId !== undefined) {
      const d = ch.discountId
        ? await c.query<{ name: string }>(`SELECT name FROM fee_discounts WHERE id = $1`, [
            ch.discountId,
          ])
        : null;
      parts.push(d?.rows[0] ? `discount ${d.rows[0].name}` : 'no discount');
    }
    if (Array.isArray(ch.discounts)) {
      const ids = (ch.discounts as Array<{ discountId: string }>).map((x) => x.discountId);
      const d = await c.query<{ name: string }>(
        `SELECT name FROM fee_discounts WHERE id = ANY($1::bigint[]) ORDER BY name`,
        [ids],
      );
      parts.push(
        ids.length
          ? `discounts by month: ${d.rows.map((x) => x.name).join(', ')}`
          : 'no month-wise discount',
      );
    }
    if (Array.isArray(ch.optionalHeads)) {
      const ids = (ch.optionalHeads as Array<{ headId: string }>).map((x) => x.headId);
      const h = await c.query<{ name: string }>(
        `SELECT name FROM fee_heads WHERE id = ANY($1::bigint[]) ORDER BY name`,
        [ids],
      );
      parts.push(
        ids.length ? `optional heads: ${h.rows.map((x) => x.name).join(', ')}` : 'no optional head',
      );
    }
    return parts.join('; ') || 'change';
  }

  private async applyChange(
    c: PoolClient,
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ): Promise<void> {
    const q = await c.query<{
      student_id: string;
      academic_year_id: string;
      changes: Record<string, unknown>;
      status: string;
    }>(
      `SELECT student_id::text, academic_year_id::text, changes, status::text FROM fee_profile_changes WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = q.rows[0];
    if (!r) throw new DomainError('not-found', 'Profile change not found', { status: 404 });
    if (r.status !== 'pending') return;
    let runId: string | null = null;
    if (outcome === 'approved') {
      const ch = r.changes;
      await c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, fee_group, student_type, pay_plan, discount_id, hosteller, transport_slab_id, transport_disabled, opening_balance, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, COALESCE($3, 'general'), 'old', $4, $5, COALESCE($6, false), $7, COALESCE($8, false), COALESCE($12::numeric, 0), app.current_user_id(), app.current_user_id())
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET
           fee_group = COALESCE($3, student_fee_profiles.fee_group),
           pay_plan = CASE WHEN $11::boolean THEN $4 ELSE student_fee_profiles.pay_plan END,
           opening_balance = COALESCE($12::numeric, student_fee_profiles.opening_balance),
           instalments_override = CASE WHEN $11::boolean THEN NULL ELSE student_fee_profiles.instalments_override END,
           discount_id = CASE WHEN $9::boolean THEN $5 ELSE student_fee_profiles.discount_id END,
           hosteller = COALESCE($6, student_fee_profiles.hosteller),
           transport_slab_id = CASE WHEN $10::boolean THEN $7 ELSE student_fee_profiles.transport_slab_id END,
           transport_disabled = COALESCE($8, student_fee_profiles.transport_disabled),
           updated_at = now(), updated_by = app.current_user_id()`,
        [
          r.student_id,
          r.academic_year_id,
          (ch.feeGroup as string | undefined) ?? null,
          ch.payPlan === undefined ? null : ((ch.payPlan as string | null) ?? null),
          ch.discountId === undefined ? null : ((ch.discountId as string | null) ?? null),
          (ch.hosteller as boolean | undefined) ?? null,
          ch.transportSlabId === undefined ? null : ((ch.transportSlabId as string | null) ?? null),
          (ch.transportDisabled as boolean | undefined) ?? null,
          ch.discountId !== undefined,
          ch.transportSlabId !== undefined,
          ch.payPlan !== undefined,
          ch.openingBalance === undefined ? null : Number(ch.openingBalance),
        ],
      );
      if (Array.isArray(ch.optionalHeads))
        await this.setup.replaceStudentOptionalHeads(
          c,
          r.student_id,
          r.academic_year_id,
          ch.optionalHeads as StudentOptionalHeadInput[],
          id,
        );
      if (Array.isArray(ch.discounts))
        await this.setup.replaceStudentDiscounts(
          c,
          r.student_id,
          r.academic_year_id,
          ch.discounts as StudentDiscountInput[],
          id,
        );
      const gen = await c.query<{ run_id: string }>(
        `SELECT o_run_id::text AS run_id FROM app.generate_fee_demand($1, $2)`,
        [r.student_id, r.academic_year_id],
      );
      runId = gen.rows[0]!.run_id;
      await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
        r.student_id,
        r.academic_year_id,
        runId,
      ]);
    }
    await c.query(
      `UPDATE fee_profile_changes SET status = $2::workflow_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, regenerated_run_id = $4 WHERE id = $1`,
      [id, outcome, note, runId],
    );
  }

  // ---- misc receipts -----------------------------------------------------------------------------
  async miscReceipts(
    ctx: RequestContext,
    q: ListMiscReceiptsQueryDto,
  ): Promise<{ rows: MiscReceiptRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // only the working year's receipts
      const where = `WHERE ($1::date IS NULL OR m.received_on >= $1::date) AND ($2::date IS NULL OR m.received_on <= $2::date) AND ($3::payer_kind IS NULL OR m.payer_kind = $3::payer_kind)
        AND ($4::bigint IS NULL OR m.academic_year_id = $4::bigint)`;
      const params = [
        q.from ?? null,
        q.to ?? null,
        q.payerKind ?? null,
        requireTenant(ctx).academicYearId ?? null,
      ];
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM misc_receipts m ${where}`,
        params,
      );
      const r = await c.query<MiscReceiptRow>(
        // eslint-disable-next-line no-restricted-syntax -- MISC_SELECT and where are constants; values are bound parameters
        `${MISC_SELECT} ${where} ORDER BY m.received_on DESC, m.id DESC LIMIT $5 OFFSET $6`,
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows, total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  /** Active employees matching a name, code or mobile, for the payer picker of the misc form. */
  async lookupEmployees(ctx: RequestContext, q: string, limit: number) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        employee_code: string;
        display_name: string;
        designation: string | null;
      }>(
        `WITH q AS (SELECT app.search_text($1) AS text, regexp_replace($1, '\\D', '', 'g') AS digits)
         SELECT e.id::text, e.employee_code, e.display_name, e.designation
           FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active'
            AND (lower(e.employee_code) = (SELECT text FROM q)
                 OR ((SELECT digits FROM q) <> '' AND e.mobile = (SELECT digits FROM q))
                 OR e.search_text LIKE (SELECT text FROM q) || '%'
                 OR e.search_text LIKE '% ' || (SELECT text FROM q) || '%')
          ORDER BY e.display_name, e.id
          LIMIT $2`,
        [q, limit],
      );
      return r.rows.map((e) => ({
        id: e.id,
        employeeCode: e.employee_code,
        displayName: e.display_name,
        designation: e.designation,
      }));
    });
  }

  async postMiscReceipt(ctx: RequestContext, dto: PostMiscReceiptDto): Promise<MiscReceiptRow> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const head = await c.query<{ id: string; ledger: string }>(
        `SELECT id::text, ledger::text FROM fee_heads WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.headId],
      );
      if (!head.rows[0]) throw new DomainError('not-found', 'Fee head not found', { status: 404 });
      if (['cheque', 'dd'].includes(dto.mode) && !dto.instrumentNo)
        throw new DomainError(
          'fees.instrument_required',
          'Cheque and DD receipts need the instrument number',
          { status: 400 },
        );
      await this.setup.assertModeFields(c, dto);
      let payerName = dto.payerName ?? '';
      let payerMobile = dto.payerMobile ?? null;
      if (dto.payerKind === 'student') {
        const s = await c.query<{ name: string; mobile: string | null }>(
          `SELECT s.display_name AS name, (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS mobile
             FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
          [dto.studentId],
        );
        if (!s.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
        payerName = s.rows[0].name;
        payerMobile = payerMobile ?? s.rows[0].mobile;
      } else if (dto.payerKind === 'employee') {
        const e = await c.query<{ name: string; mobile: string | null }>(
          `SELECT display_name AS name, mobile FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [dto.employeeId],
        );
        if (!e.rows[0]) throw new DomainError('not-found', 'Employee not found', { status: 404 });
        payerName = e.rows[0].name;
        payerMobile = payerMobile ?? e.rows[0].mobile;
      }
      const fy = await c.query<{ fy: string | null }>(
        `SELECT app.financial_year_for(COALESCE($1::date, CURRENT_DATE))::text AS fy`,
        [dto.receivedOn ?? null],
      );
      if (!fy.rows[0]?.fy)
        throw new DomainError(
          'fees.no_financial_year',
          'No financial year covers the receipt date; create it under System → Years',
          {
            status: 409,
          },
        );
      await assertPeriodOpen(c, 'misc', dto.receivedOn ?? null); // Sprint 23 month-end lock
      const r = await c.query<{ id: string }>(
        `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, student_id, employee_id, payer_name, payer_mobile, head_id, amount, received_on, mode, reference, instrument_no, bank_name, remarks, received_by, request_id)
         VALUES (app.current_school_id(), $1, $2, app.next_receipt_no('misc', $2), $3::payer_kind, $4, $5, $6, $7, $8, $9, COALESCE($10::date, CURRENT_DATE), $11, $12, $13, $14, $15, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          yearId,
          fy.rows[0].fy,
          dto.payerKind,
          dto.payerKind === 'student' ? dto.studentId : null,
          dto.payerKind === 'employee' ? dto.employeeId : null,
          payerName,
          payerMobile,
          dto.headId,
          dto.amount.toFixed(2),
          dto.receivedOn ?? null,
          dto.mode,
          dto.reference ?? null,
          dto.instrumentNo ?? null,
          dto.bankName ?? null,
          dto.remarks ?? null,
        ],
      );
      const row = await c.query<MiscReceiptRow>(
        // eslint-disable-next-line no-restricted-syntax -- MISC_SELECT is a constant; the id is a bound parameter
        `${MISC_SELECT} WHERE m.id = $1`,
        [r.rows[0]!.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.misc.post',
        entityType: 'misc_receipts',
        entityId: r.rows[0]!.id,
        after: { ...dto, receiptNo: row.rows[0]!.receiptNo, payerName },
      });
      return row.rows[0]!;
    });
  }

  // ---- reconciliation ----------------------------------------------------------------------------
  async reconciliations(ctx: RequestContext): Promise<ReconciliationRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.reconciliationsWith(c));
  }

  private async reconciliationsWith(c: PoolClient): Promise<ReconciliationRow[]> {
    {
      const r = await c.query<ReconciliationRow>(
        `SELECT id::text, run_date::text AS "runDate", as_of::text AS "asOf", online_receipts AS "onlineReceipts", online_amount::text AS "onlineAmount",
                settled_receipts AS "settledReceipts", settled_amount::text AS "settledAmount", unsettled_receipts AS "unsettledReceipts", unsettled_amount::text AS "unsettledAmount",
                aged_unsettled AS "agedUnsettled", unmatched_lines AS "unmatchedLines", mismatched_lines AS "mismatchedLines", succeeded_without_receipt AS "succeededWithoutReceipt",
                variance::text, ran_at::text AS "ranAt"
           FROM payment_reconciliation_runs ORDER BY run_date DESC LIMIT 60`,
      );
      return r.rows;
    }
  }

  async reconcileNow(ctx: RequestContext): Promise<ReconciliationRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.reconcile_payments(CURRENT_DATE)`);
      await this.audit.stage(ctx, c, {
        action: 'payments.reconcile.run',
        entityType: 'payment_reconciliation_runs',
        entityId: 'today',
      });
      return (await this.reconciliationsWith(c))[0]!;
    });
  }
}
