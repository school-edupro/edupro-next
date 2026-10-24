import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { AccessService } from '../../access/access.service';
import { settleWithdrawalFees } from '../../fees/withdrawal-fees';
import { WorkflowService, type InstanceRow } from '../../workflow/workflow.service';
import { describeLevels, ensureCorrectionFlow, type CorrectionFlow } from '../correction-flows';
import type { AdmissionCancelDto } from './admission-cancellations.dto';

export const CANCEL_FLOW: CorrectionFlow = {
  code: 'admission_cancellation',
  entityType: 'admission_cancellation',
  name: 'Admission cancellation',
};

type Settlement = 'refund' | 'retain';
export interface CancelOutcome {
  student: {
    id: string;
    name: string;
    admissionNo: string;
    classSection: string;
    admittedOn: string | null;
  };
  settlement: Settlement;
  fee: {
    before: { charged: number; paid: number; due: number };
    after: { charged: number; paid: number; due: number };
    /** Unpaid fee cancelled. */
    cancelled: number;
    /** Refunds raised for the refund approvers (refund only). */
    refunds: number;
    refundTotal: number;
    /** Kept by the school (retain): what was paid. */
    retained: number;
  };
  /** The admission fee of an online admission: refunded less the session's deduction, or kept. */
  admissionFee: { paid: number; deduction: number; refund: number } | null;
  logins: { student: boolean; parents: number };
  hostelBed: boolean;
}
export interface CancelRow {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  settlement: Settlement;
  reason: string;
  preview: CancelOutcome;
  result: CancelOutcome | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  waitingAt: string | null;
  mine: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Admitted by mistake (docs/design/37, part 4): "Cancel admission" with the money settled (refunded
 * through the refund approvals, or kept), decided by the approval levels. On approval it is a completed
 * withdrawal of its own kind: the unpaid fee of the year is cancelled, the enrolment ends as
 * "cancelled" (out of strength, attendance and result reports; marks and attendance stay on the
 * record), the pupil's and the parents' logins stop (a parent with another child here keeps it), a
 * hostel bed is given up, and an online admission's registration is cancelled with its admission fee.
 */
@Injectable()
export class AdmissionCancellationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly access: AccessService,
  ) {}

  private yearOf(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('validation-failed', 'Choose the working year first', { status: 400 });
    return y;
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const flow = await ensureCorrectionFlow(c, CANCEL_FLOW);
      return { definitionId: flow.id, levels: await describeLevels(c, flow.levels) };
    });
  }

  private async feeTotals(c: PoolClient, studentId: string, yearId: string) {
    const r = await c.query<{ charged: string; paid: string }>(
      `SELECT COALESCE(sum(net), 0)::text AS charged, COALESCE(sum(paid), 0)::text AS paid FROM fee_demands
        WHERE student_id = $1 AND academic_year_id = $2 AND status NOT IN ('cancelled', 'carried')`,
      [studentId, yearId],
    );
    const charged = r2(Number(r.rows[0]!.charged));
    const paid = r2(Number(r.rows[0]!.paid));
    return { charged, paid, due: r2(charged - paid) };
  }

  /** The admission fee of the online registration the pupil was admitted from, if any. */
  private async admissionFee(c: PoolClient, studentId: string) {
    const r = await c.query<{
      id: string;
      receipt_id: string | null;
      amount: string | null;
      pct: string | null;
    }>(
      `SELECT a.id::text, a.admission_receipt_id::text AS receipt_id, m.amount::text, y.refund_deduction_pct::text AS pct
         FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id
         LEFT JOIN misc_receipts m ON m.id = a.admission_receipt_id AND m.status = 'posted'
        WHERE a.student_id = $1 AND a.status = 'admitted' ORDER BY a.id DESC LIMIT 1`,
      [studentId],
    );
    const x = r.rows[0];
    if (!x) return null;
    const paid = Number(x.amount ?? 0);
    const deduction = Math.round(paid * Number(x.pct ?? 0)) / 100;
    return {
      applicationId: x.id,
      receiptId: x.receipt_id,
      paid,
      pct: Number(x.pct ?? 0),
      deduction,
      refund: r2(paid - deduction),
    };
  }

  /** The cancellation in the caller's transaction (the preview rolls it back). */
  private async run(
    c: PoolClient,
    ctx: RequestContext,
    input: { studentId: string; yearId: string; settlement: Settlement; reason: string },
  ): Promise<CancelOutcome & { withdrawalId: string }> {
    const { studentId, yearId, settlement, reason } = input;
    const s = await c.query<{
      name: string;
      admission_no: string;
      status: string;
      admitted_on: string | null;
      section: string | null;
    }>(
      `SELECT s.display_name AS name, s.admission_no, s.status::text, s.admitted_on::text,
              (SELECT k.name || ' ' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active') AS section
         FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [studentId, yearId],
    );
    const st = s.rows[0];
    if (!st) throw new DomainError('not-found', 'Student not found', { status: 404 });
    if (st.status !== 'active' || !st.section)
      throw new DomainError(
        'people.cancel_not_enrolled',
        'Only a pupil studying in the working year can have the admission cancelled',
        { status: 409 },
      );
    const open = await c.query(
      `SELECT 1 FROM student_withdrawals WHERE student_id = $1 AND status IN ('requested', 'cleared')`,
      [studentId],
    );
    if (open.rowCount)
      throw new DomainError(
        'people.cancel_withdrawal_open',
        'A withdrawal of this pupil is in progress: cancel it first',
        { status: 409 },
      );
    const before = await this.feeTotals(c, studentId, yearId);
    const af = await this.admissionFee(c, studentId);

    // a completed withdrawal of its own kind: enrolment ended, pupil inactive, pupil's login stopped
    const w = await c.query<{ id: string }>(
      `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, requested_on, initiated_on, leaving_on, reason, status, requested_by, kind)
       VALUES (app.current_school_id(), $1, $2, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, $3, 'requested', app.current_user_id(), 'admission_cancelled')
       RETURNING id::text`,
      [studentId, yearId, `Admission cancelled: ${reason}`.slice(0, 500)],
    );
    const withdrawalId = w.rows[0]!.id;
    const studentUser = await c.query<{ user_id: string | null }>(
      `SELECT user_id::text FROM students WHERE id = $1`,
      [studentId],
    );
    await c.query(`SELECT app.complete_withdrawal($1)`, [withdrawalId]);
    await c.query(
      `UPDATE enrolments SET status = 'cancelled', remarks = 'Admission cancelled', updated_at = now(), updated_by = app.current_user_id()
        WHERE student_id = $1 AND academic_year_id = $2 AND status = 'withdrawn'`,
      [studentId, yearId],
    );
    const bed = await c.query(
      `UPDATE hostel_allotments SET to_date = GREATEST(from_date, CURRENT_DATE), end_reason = 'withdrawn',
              end_remarks = 'Admission cancelled', ended_at = now(), ended_by = app.current_user_id()
        WHERE student_id = $1 AND (to_date IS NULL OR to_date > CURRENT_DATE)`,
      [studentId],
    );
    await c.query(
      `UPDATE hostel_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Admission cancelled', updated_at = now()
        WHERE student_id = $1 AND status IN ('requested', 'cleared')`,
      [studentId],
    );

    // the fee of every month of the year: unpaid cancelled; what was paid refunded or kept
    const first = await c.query<{ d: string }>(
      `SELECT (min(make_date(year, month, 1)) - 1)::text AS d FROM fee_periods WHERE academic_year_id = $1`,
      [yearId],
    );
    const fee = first.rows[0]?.d
      ? await settleWithdrawalFees(
          this.workflow,
          c,
          ctx,
          {
            id: withdrawalId,
            studentId,
            leavingOn: first.rows[0].d,
            yearId,
            label: `Admission cancelled: ${reason}`.slice(0, 300),
          },
          settlement === 'refund',
        )
      : null;

    // an online admission: the registration is cancelled; its admission fee refunded less the deduction
    if (af) {
      if (settlement === 'refund' && af.receiptId && af.refund > 0)
        await c.query(
          `INSERT INTO admission_refunds (school_id, application_id, receipt_id, paid_amount, deduction_pct, deduction, amount, reason, requested_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id())`,
          [
            af.applicationId,
            af.receiptId,
            af.paid.toFixed(2),
            af.pct,
            af.deduction.toFixed(2),
            af.refund.toFixed(2),
            `Admission cancelled: ${reason}`.slice(0, 500),
          ],
        );
      await c.query(
        `UPDATE applications SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [af.applicationId, reason.slice(0, 500)],
      );
      await c.query(
        `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
         VALUES (app.current_school_id(), $1, 'admitted', 'cancelled', $2, app.current_user_id())`,
        [af.applicationId, `Admission cancelled on the student page: ${reason}`.slice(0, 500)],
      );
    }

    // a parent keeps the login while another child of theirs still studies here
    const parents = await c.query<{ user_id: string }>(
      `SELECT DISTINCT g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM student_guardians sg2 JOIN students s2 ON s2.id = sg2.student_id
                           WHERE sg2.guardian_id = g.id AND s2.id <> $1 AND s2.status = 'active' AND s2.deleted_at IS NULL)`,
      [studentId],
    );
    if (parents.rows.length)
      await c.query(
        `UPDATE user_school_memberships SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id() AND person_type = 'guardian' AND user_id = ANY($1::bigint[])`,
        [parents.rows.map((p) => p.user_id)],
      );

    const after = await this.feeTotals(c, studentId, yearId);
    return {
      withdrawalId,
      student: {
        id: studentId,
        name: st.name,
        admissionNo: st.admission_no,
        classSection: st.section,
        admittedOn: st.admitted_on,
      },
      settlement,
      fee: {
        before,
        after,
        cancelled: r2(Number(fee?.cancelled ?? 0)),
        refunds: fee?.refunds ?? 0,
        refundTotal: r2(Number(fee?.refundTotal ?? 0)),
        retained: settlement === 'retain' ? before.paid : 0,
      },
      admissionFee: af
        ? {
            paid: af.paid,
            deduction: settlement === 'refund' ? af.deduction : af.paid,
            refund: settlement === 'refund' ? af.refund : 0,
          }
        : null,
      logins: { student: Boolean(studentUser.rows[0]?.user_id), parents: parents.rows.length },
      hostelBed: (bed.rowCount ?? 0) > 0,
    };
  }

  private async dryRun(
    c: PoolClient,
    ctx: RequestContext,
    input: { studentId: string; yearId: string; settlement: Settlement; reason: string },
  ): Promise<CancelOutcome> {
    await c.query('SAVEPOINT cancel_preview');
    try {
      const { withdrawalId: _w, ...out } = await this.run(c, ctx, input);
      return out;
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT cancel_preview');
    }
  }

  async preview(ctx: RequestContext, studentId: string, dto: AdmissionCancelDto) {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.dryRun(c, ctx, {
        studentId,
        yearId,
        settlement: dto.settlement,
        reason: dto.reason ?? 'preview',
      }),
    );
  }

  private async rows(c: PoolClient, where: string, params: unknown[]): Promise<CancelRow[]> {
    const r = await c.query<{
      id: string;
      status: CancelRow['status'];
      settlement: Settlement;
      reason: string;
      preview: CancelOutcome;
      result: CancelOutcome | null;
      requested_by: string | null;
      requested_by_id: string | null;
      requested_at: Date;
      decided_by: string | null;
      decided_at: Date | null;
      decision_note: string | null;
      apply_error: string | null;
      waiting_at: string | null;
      me: string | null;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- where is a fixed condition; values are bound parameters
      `SELECT k.id::text, k.status, k.settlement, k.reason, k.preview, k.result, ru.display_name AS requested_by,
              k.requested_by::text AS requested_by_id, k.requested_at, du.display_name AS decided_by, k.decided_at, k.decision_note,
              k.apply_error, app.current_user_id()::text AS me,
              (SELECT s.name FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                WHERE s.instance_id = k.workflow_instance_id AND s.level = i.current_level AND i.status = 'pending' LIMIT 1) AS waiting_at
         FROM admission_cancellations k LEFT JOIN users ru ON ru.id = k.requested_by LEFT JOIN users du ON du.id = k.decided_by
        WHERE ${where} ORDER BY k.requested_at DESC, k.id DESC`,
      params,
    );
    return r.rows.map((x) => ({
      id: x.id,
      status: x.status,
      settlement: x.settlement,
      reason: x.reason,
      preview: x.preview,
      result: x.result,
      requestedBy: x.requested_by,
      requestedAt: x.requested_at.toISOString(),
      decidedBy: x.decided_by,
      decidedAt: x.decided_at?.toISOString() ?? null,
      note: x.decision_note,
      applyError: x.apply_error,
      waitingAt: x.waiting_at,
      mine: x.requested_by_id !== null && x.requested_by_id === x.me,
    }));
  }

  async list(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: await this.rows(c, 'k.student_id = $1', [studentId]),
    }));
  }

  async request(ctx: RequestContext, studentId: string, dto: AdmissionCancelDto) {
    const yearId = this.yearOf(ctx);
    if (!dto.reason)
      throw new DomainError('validation-failed', 'Give the reason', {
        status: 400,
        extra: { errors: { reason: 'is required' } },
      });
    const reason = dto.reason;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const preview = await this.dryRun(c, ctx, {
        studentId,
        yearId,
        settlement: dto.settlement,
        reason,
      });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO admission_cancellations (school_id, student_id, academic_year_id, reason, settlement, preview, requested_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, app.current_user_id()) RETURNING id::text`,
          [studentId, yearId, reason, dto.settlement, JSON.stringify(preview)],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'people.cancel_open',
            'A cancellation of this admission is already waiting for approval',
            { status: 409 },
          );
        throw error;
      }
      await ensureCorrectionFlow(c, CANCEL_FLOW);
      const p = preview;
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: CANCEL_FLOW.code,
        entityType: CANCEL_FLOW.entityType,
        entityId: id,
        subject:
          `Cancel admission: ${p.student.name} (${p.student.admissionNo}), ${p.student.classSection}`.slice(
            0,
            240,
          ),
        payload: {
          studentId,
          student: p.student,
          settlement: p.settlement,
          fee: p.fee,
          admissionFee: p.admissionFee,
          logins: p.logins,
          reason,
        },
      });
      await c.query(`UPDATE admission_cancellations SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.admission_cancel.request',
        entityType: 'students',
        entityId: studentId,
        after: { cancellationId: id, settlement: dto.settlement, reason },
      });
      return (await this.rows(c, 'k.id = $1', [id]))[0]!;
    });
  }

  async withdraw(ctx: RequestContext, studentId: string, id: string, reason?: string) {
    const instanceId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status, workflow_instance_id::text FROM admission_cancellations WHERE id = $1 AND student_id = $2`,
        [id, studentId],
      );
      const row = r.rows[0];
      if (!row) throw new DomainError('not-found', 'Cancellation not found', { status: 404 });
      if (row.status !== 'pending' || !row.workflow_instance_id)
        throw new DomainError('people.correction_decided', 'This request is already decided', {
          status: 409,
        });
      return row.workflow_instance_id;
    });
    await this.workflow.cancel(ctx, instanceId, { reason: reason || 'Withdrawn by the requester' });
    return this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.rows(c, 'k.id = $1', [id]))[0]!,
    );
  }

  /** The last level decided (or withdrawn): cancel the admission now, or close the request. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const r = await c.query<{
      student_id: string;
      academic_year_id: string;
      settlement: Settlement;
      reason: string;
    }>(
      `SELECT student_id::text, academic_year_id::text, settlement, reason
         FROM admission_cancellations WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [instance.entityId],
    );
    const row = r.rows[0];
    if (!row) return;
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending' && s.note)
        .map((s) => s.note)
        .join(' · ') || null;
    const close = (
      status: string,
      result: CancelOutcome | null,
      withdrawalId: string | null,
      error: string | null = null,
    ) =>
      c.query(
        `UPDATE admission_cancellations SET status = $2, result = $3::jsonb, withdrawal_id = $4, decided_by = app.current_user_id(),
                decided_at = now(), decision_note = $5, apply_error = $6 WHERE id = $1`,
        [
          instance.entityId,
          status,
          result ? JSON.stringify(result) : null,
          withdrawalId,
          note,
          error,
        ],
      );
    if (outcome === 'rejected') {
      const st = await c.query<{ status: string }>(
        `SELECT status::text FROM workflow_instances WHERE id = $1`,
        [instance.id],
      );
      await close(st.rows[0]?.status === 'cancelled' ? 'withdrawn' : 'rejected', null, null);
      return;
    }
    await c.query('SAVEPOINT cancel_apply');
    try {
      const { withdrawalId, ...result } = await this.run(c, ctx, {
        studentId: row.student_id,
        yearId: row.academic_year_id,
        settlement: row.settlement,
        reason: row.reason,
      });
      await c.query('RELEASE SAVEPOINT cancel_apply');
      await close('applied', result, withdrawalId);
      await this.audit.stage(ctx, c, {
        action: 'people.admission_cancel.applied',
        entityType: 'students',
        entityId: row.student_id,
        after: { withdrawalId, settlement: row.settlement, fee: result.fee },
      });
      // the pupil's and the parents' rights changed: cached sets are dropped once this is saved
      const sc = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
      const schoolId = sc.rows[0]!.id;
      setTimeout(() => void this.access.invalidateSchool(schoolId).catch(() => undefined), 500);
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT cancel_apply');
      const msg = error instanceof Error ? error.message : String(error);
      await close('rejected', null, null, `Not done: ${msg}`.slice(0, 500));
    }
  }
}
