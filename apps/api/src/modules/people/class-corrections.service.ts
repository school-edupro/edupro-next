import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { describeLevels, ensureCorrectionFlow, type CorrectionFlow } from './correction-flows';
import type { ClassCorrectionDto } from './class-corrections.dto';
import { StudentProfileService } from './student-profile.service';

export const CLASS_FLOW: CorrectionFlow = {
  code: 'class_correction',
  entityType: 'class_correction',
  name: 'Student class correction',
};

interface Line {
  id: string;
  key: string;
  period: string;
  head: string;
  ledger: string;
  source: string;
  status: string;
  gross: number;
  discount: number;
  net: number;
  paid: number;
  due_on: string;
  period_id: string;
  head_id: string;
  starts: string;
}
/** What a class correction does (the preview) or did (applied). */
export interface ClassOutcome {
  from: { sectionId: string; label: string };
  to: { sectionId: string; label: string };
  rollNo: number;
  effectiveFrom: string;
  fee: {
    /** The fee lines that change: before and after (null: not there), with what is paid on them now. */
    lines: Array<{
      period: string;
      head: string;
      ledger: string;
      before: number | null;
      after: number | null;
      paid: number;
    }>;
    before: { charged: number; paid: number; due: number };
    after: { charged: number; paid: number; due: number };
    /** Paid on the old class's lines from the date, taken off them. */
    freed: number;
    /** Of that, set against the new dues. */
    setAgainst: number;
    /** Left on the receipts as advance (given back on request through a refund). */
    advance: number;
    /** Paid lines left as they are, and why. */
    kept: Array<{ period: string; head: string; why: string }>;
  };
}
export interface ClassCorrectionRow {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  from: string;
  to: string;
  effectiveFrom: string;
  reason: string;
  preview: ClassOutcome;
  result: ClassOutcome | null;
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
const totals = (lines: Line[]) => {
  const charged = r2(lines.reduce((s, l) => s + l.net, 0));
  const paid = r2(lines.reduce((s, l) => s + l.paid, 0));
  return { charged, paid, due: r2(charged - paid) };
};

/**
 * Wrong class (docs/design/37, part 2): the year's enrolment moves to the right class-section from a
 * date (the admission date by default) once the approval levels approve. Attendance and marks stay on
 * the student. Fee lines from that date are made again at the new class's rates; money paid on them is
 * set against the new dues and what is left stays as advance on the receipt (refund on request).
 */
@Injectable()
export class ClassCorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly profiles: StudentProfileService,
  ) {}

  private yearOf(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('validation-failed', 'Choose the working year first', { status: 400 });
    return y;
  }

  /** Who decides, level by level, and the sections of the working year to choose from. */
  async setup(ctx: RequestContext) {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const flow = await ensureCorrectionFlow(c, CLASS_FLOW);
      const sections = await c.query<{ id: string; label: string; class_id: string }>(
        `SELECT cs.id::text, k.name || ' ' || cs.name AS label, k.id::text AS class_id
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND k.deleted_at IS NULL
          ORDER BY k.display_order, k.name, cs.name`,
        [yearId],
      );
      return {
        definitionId: flow.id,
        levels: await describeLevels(c, flow.levels),
        sections: sections.rows.map((s) => ({ id: s.id, label: s.label, classId: s.class_id })),
      };
    });
  }

  private async lines(c: PoolClient, studentId: string, yearId: string): Promise<Line[]> {
    const r = await c.query<
      Omit<Line, 'gross' | 'discount' | 'net' | 'paid'> & {
        gross: string;
        discount: string;
        net: string;
        paid: string;
      }
    >(
      `SELECT d.id::text, d.period_id::text || '|' || d.head_id::text AS key, p.name AS period, h.name AS head, d.ledger::text, d.source,
              d.status::text, d.gross::text, d.discount::text, d.net::text, d.paid::text, d.due_on::text, d.period_id::text, d.head_id::text,
              make_date(p.year, p.month, 1)::text AS starts
         FROM fee_demands d JOIN fee_periods p ON p.id = d.period_id JOIN fee_heads h ON h.id = d.head_id
        WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status NOT IN ('cancelled', 'carried')
        ORDER BY p.sequence, h.sort_order, h.name`,
      [studentId, yearId],
    );
    return r.rows.map((x) => ({
      ...x,
      gross: Number(x.gross),
      discount: Number(x.discount),
      net: Number(x.net),
      paid: Number(x.paid),
    }));
  }

  /**
   * Does the correction in the caller's transaction. The preview runs it inside a savepoint and rolls
   * it back, so what it shows is exactly what approval will do (as long as nothing changes meanwhile).
   */
  private async run(
    c: PoolClient,
    input: {
      studentId: string;
      yearId: string;
      toSectionId: string;
      effectiveFrom?: string | null;
    },
  ): Promise<ClassOutcome> {
    const { studentId, yearId, toSectionId } = input;
    const e = await c.query<{
      section_id: string;
      class_id: string;
      label: string;
      joined_on: string;
      starts: string;
      ends: string;
      admitted: string;
    }>(
      `SELECT e.class_section_id::text AS section_id, cs.class_id::text, k.name || ' ' || cs.name AS label, e.joined_on::text,
              y.start_date::text AS starts, y.end_date::text AS ends,
              -- the admission date, or the start of the year for a pupil admitted in an earlier one
              GREATEST(y.start_date, LEAST(COALESCE(st.admitted_on, y.start_date), y.end_date))::text AS admitted
         FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
         JOIN academic_years y ON y.id = e.academic_year_id JOIN students st ON st.id = e.student_id
        WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'`,
      [studentId, yearId],
    );
    const cur = e.rows[0];
    if (!cur)
      throw new DomainError(
        'people.class_not_enrolled',
        'The student is not in a class in the working year',
        { status: 409 },
      );
    const t = await c.query<{ id: string; class_id: string; label: string }>(
      `SELECT cs.id::text, cs.class_id::text, k.name || ' ' || cs.name AS label
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL`,
      [toSectionId, yearId],
    );
    const to = t.rows[0];
    if (!to)
      throw new DomainError('not-found', 'That section is not in the working year', {
        status: 404,
      });
    if (to.class_id === cur.class_id)
      throw new DomainError(
        'people.class_same',
        'This is a section of the same class: move it under Roll numbers and sections (fees do not change)',
        { status: 409 },
      );
    const effectiveFrom = input.effectiveFrom ?? cur.admitted;
    if (effectiveFrom < cur.starts || effectiveFrom > cur.ends)
      throw new DomainError(
        'validation-failed',
        `The date must fall in the year (${cur.starts} to ${cur.ends})`,
        { status: 400 },
      );
    const month = `${effectiveFrom.slice(0, 7)}-01`;
    const before = await this.lines(c, studentId, yearId);

    // the enrolment of the year moves (same record: attendance and marks stay with the student)
    const roll = (
      await c.query<{ n: number }>(
        `SELECT COALESCE(max(roll_no), 0)::int + 1 AS n FROM enrolments WHERE class_section_id = $1 AND status = 'active'`,
        [toSectionId],
      )
    ).rows[0]!.n;
    await c.query(`SELECT app.enrol_student($1, $2, $3, $4, $5::date)`, [
      studentId,
      yearId,
      toSectionId,
      roll,
      cur.joined_on,
    ]);

    // money paid on the old class's lines from the date is taken off them, to be set again below; a
    // line with a waiver, or paid by a receipt with a refund, is left as it is
    const kept: ClassOutcome['fee']['kept'] = [];
    const freed = new Map<string, number>();
    for (const l of before.filter(
      (x) => x.source === 'structure' && x.paid > 0 && x.starts >= month,
    )) {
      const blocked = await c.query<{ why: string }>(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM fee_adjustments a WHERE (a.demand_id = $1 OR a.charge_demand_id = $1) AND a.status = 'approved')
                       THEN 'a waiver or adjustment is on it'
                     WHEN EXISTS (SELECT 1 FROM fee_payment_allocations x JOIN fee_refunds f ON f.payment_id = x.payment_id
                                   WHERE x.demand_id = $1 AND f.status IN ('draft', 'requested', 'approved', 'paid'))
                       THEN 'its receipt has a refund' END AS why`,
        [l.id],
      );
      const why = blocked.rows[0]?.why;
      if (why) {
        kept.push({ period: l.period, head: l.head, why });
        continue;
      }
      const allocs = await c.query<{ id: string; payment_id: string; amount: string }>(
        `SELECT id::text, payment_id::text, amount::text FROM fee_payment_allocations WHERE demand_id = $1`,
        [l.id],
      );
      for (const a of allocs.rows)
        freed.set(a.payment_id, r2((freed.get(a.payment_id) ?? 0) + Number(a.amount)));
      await c.query(`DELETE FROM fee_payment_allocations WHERE demand_id = $1`, [l.id]);
      await c.query(
        `UPDATE fee_demands SET paid = 0, status = 'pending', updated_at = now() WHERE id = $1`,
        [l.id],
      );
    }

    // the year's lines made again at the new class's rates (unpaid ones are dropped and made again)
    const run = await c.query<{ run_id: string }>(
      `SELECT o_run_id::text AS run_id FROM app.generate_fee_demand($1, $2)`,
      [studentId, yearId],
    );
    const runId = run.rows[0]!.run_id;
    await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [studentId, yearId, runId]);

    // before the date the old class's charges stand: its unpaid lines come back as they were
    const early = before.filter(
      (x) => x.source === 'structure' && x.paid === 0 && x.status === 'pending' && x.starts < month,
    );
    await c.query(
      `DELETE FROM fee_demands d USING fee_periods p
        WHERE p.id = d.period_id AND d.student_id = $1 AND d.academic_year_id = $2 AND d.source = 'structure'
          AND d.paid = 0 AND d.status = 'pending' AND make_date(p.year, p.month, 1) < $3::date
          AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE a.demand_id = d.id OR a.charge_demand_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM fee_payment_allocations x WHERE x.demand_id = d.id)`,
      [studentId, yearId, month],
    );
    for (const l of early)
      await c.query(
        `INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::date, 'structure', $9, $10::ledger_type)
         ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING`,
        [
          studentId,
          yearId,
          l.period_id,
          l.head_id,
          l.gross.toFixed(2),
          l.discount.toFixed(2),
          l.net.toFixed(2),
          l.due_on,
          runId,
          l.ledger,
        ],
      );

    // the money taken off goes to the dues in date order, ledger by ledger; the rest stays as advance
    let setAgainst = 0;
    for (const [paymentId, amount] of freed) {
      const m = await c.query<{ v: string }>(
        `SELECT app.allocate_free_to_dues($1, $2)::text AS v`,
        [paymentId, amount.toFixed(2)],
      );
      setAgainst = r2(setAgainst + Number(m.rows[0]!.v));
    }
    const freedTotal = r2([...freed.values()].reduce((s, x) => s + x, 0));

    const after = await this.lines(c, studentId, yearId);
    const keys = [...new Set([...before.map((x) => x.key), ...after.map((x) => x.key)])];
    const lines = keys
      .map((k) => {
        const b = before.find((x) => x.key === k);
        const a = after.find((x) => x.key === k);
        const x = (a ?? b)!;
        return {
          period: x.period,
          head: x.head,
          ledger: x.ledger,
          before: b ? b.net : null,
          after: a ? a.net : null,
          paid: a ? a.paid : 0,
          starts: x.starts,
        };
      })
      .filter((x) => x.before !== x.after)
      .sort((p, q) => p.starts.localeCompare(q.starts) || p.head.localeCompare(q.head))
      .map(({ starts: _s, ...x }) => x);
    return {
      from: { sectionId: cur.section_id, label: cur.label },
      to: { sectionId: to.id, label: to.label },
      rollNo: roll,
      effectiveFrom,
      fee: {
        lines,
        before: totals(before),
        after: totals(after),
        freed: freedTotal,
        setAgainst,
        advance: r2(freedTotal - setAgainst),
        kept,
      },
    };
  }

  /** What the correction would do, worked out and rolled back. */
  private async dryRun(
    c: PoolClient,
    input: {
      studentId: string;
      yearId: string;
      toSectionId: string;
      effectiveFrom?: string | null;
    },
  ): Promise<ClassOutcome> {
    await c.query('SAVEPOINT class_preview');
    try {
      return await this.run(c, input);
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT class_preview');
    }
  }

  async preview(ctx: RequestContext, studentId: string, dto: ClassCorrectionDto) {
    const yearId = this.yearOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, studentId);
      return this.dryRun(c, {
        studentId,
        yearId,
        toSectionId: dto.toSectionId,
        effectiveFrom: dto.effectiveFrom ?? null,
      });
    });
  }

  private async rows(c: PoolClient, where: string, params: unknown[]) {
    const r = await c.query<{
      id: string;
      status: ClassCorrectionRow['status'];
      from_label: string;
      to_label: string;
      effective_from: string;
      reason: string;
      preview: ClassOutcome;
      result: ClassOutcome | null;
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
      `SELECT k.id::text, k.status, fk.name || ' ' || fs.name AS from_label, tk.name || ' ' || ts.name AS to_label, k.effective_from::text,
              k.reason, k.preview, k.result, ru.display_name AS requested_by, k.requested_by::text AS requested_by_id, k.requested_at,
              du.display_name AS decided_by, k.decided_at, k.decision_note, k.apply_error, app.current_user_id()::text AS me,
              (SELECT s.name FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                WHERE s.instance_id = k.workflow_instance_id AND s.level = i.current_level AND i.status = 'pending' LIMIT 1) AS waiting_at
         FROM class_corrections k
         JOIN class_sections fs ON fs.id = k.from_section_id JOIN classes fk ON fk.id = fs.class_id
         JOIN class_sections ts ON ts.id = k.to_section_id JOIN classes tk ON tk.id = ts.class_id
         LEFT JOIN users ru ON ru.id = k.requested_by LEFT JOIN users du ON du.id = k.decided_by
        WHERE ${where} ORDER BY k.requested_at DESC, k.id DESC`,
      params,
    );
    return r.rows.map((x): ClassCorrectionRow => ({
      id: x.id,
      status: x.status,
      from: x.from_label,
      to: x.to_label,
      effectiveFrom: x.effective_from,
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
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, studentId);
      return { data: await this.rows(c, 'k.student_id = $1', [studentId]) };
    });
  }

  /** Ask for the correction: the preview is kept with the request and goes to the approvers. */
  async request(ctx: RequestContext, studentId: string, dto: ClassCorrectionDto) {
    const yearId = this.yearOf(ctx);
    if (!dto.reason)
      throw new DomainError('validation-failed', 'Give the reason', {
        status: 400,
        extra: { errors: { reason: 'is required' } },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, studentId);
      const preview = await this.dryRun(c, {
        studentId,
        yearId,
        toSectionId: dto.toSectionId,
        effectiveFrom: dto.effectiveFrom ?? null,
      });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO class_corrections (school_id, student_id, academic_year_id, from_section_id, to_section_id, effective_from, reason, preview, requested_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7::jsonb, app.current_user_id()) RETURNING id::text`,
          [
            studentId,
            yearId,
            preview.from.sectionId,
            preview.to.sectionId,
            preview.effectiveFrom,
            dto.reason,
            JSON.stringify(preview),
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'people.class_correction_open',
            'A class correction for this student is already waiting for approval',
            { status: 409 },
          );
        throw error;
      }
      const s = await c.query<{ name: string; admission_no: string }>(
        `SELECT display_name AS name, admission_no FROM students WHERE id = $1`,
        [studentId],
      );
      const who = s.rows[0]!;
      await ensureCorrectionFlow(c, CLASS_FLOW);
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: CLASS_FLOW.code,
        entityType: CLASS_FLOW.entityType,
        entityId: id,
        subject:
          `Correct class: ${who.name} (${who.admission_no}): ${preview.from.label} → ${preview.to.label}`.slice(
            0,
            240,
          ),
        payload: {
          studentId,
          student: who.name,
          admissionNo: who.admission_no,
          from: preview.from.label,
          to: preview.to.label,
          effectiveFrom: preview.effectiveFrom,
          rollNo: preview.rollNo,
          fee: {
            before: preview.fee.before,
            after: preview.fee.after,
            advance: preview.fee.advance,
            lines: preview.fee.lines.length,
          },
          reason: dto.reason,
        },
      });
      await c.query(`UPDATE class_corrections SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.student.class_correction.request',
        entityType: 'students',
        entityId: studentId,
        after: {
          correctionId: id,
          from: preview.from.label,
          to: preview.to.label,
          effectiveFrom: preview.effectiveFrom,
          reason: dto.reason,
        },
      });
      return (await this.rows(c, 'k.id = $1', [id]))[0]!;
    });
  }

  async withdraw(ctx: RequestContext, studentId: string, id: string, reason?: string) {
    const instanceId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status, workflow_instance_id::text FROM class_corrections WHERE id = $1 AND student_id = $2`,
        [id, studentId],
      );
      const row = r.rows[0];
      if (!row) throw new DomainError('not-found', 'Correction not found', { status: 404 });
      if (row.status !== 'pending' || !row.workflow_instance_id)
        throw new DomainError('people.correction_decided', 'This correction is already decided', {
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

  /** The last level decided (or the request was withdrawn): do the move, or close it. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const r = await c.query<{
      student_id: string;
      academic_year_id: string;
      to_section_id: string;
      effective_from: string;
    }>(
      `SELECT student_id::text, academic_year_id::text, to_section_id::text, effective_from::text
         FROM class_corrections WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [instance.entityId],
    );
    const row = r.rows[0];
    if (!row) return;
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending' && s.note)
        .map((s) => s.note)
        .join(' · ') || null;
    const close = (status: string, result: ClassOutcome | null, error: string | null = null) =>
      c.query(
        `UPDATE class_corrections SET status = $2, result = $3::jsonb, decided_by = app.current_user_id(), decided_at = now(),
                decision_note = $4, apply_error = $5 WHERE id = $1`,
        [instance.entityId, status, result ? JSON.stringify(result) : null, note, error],
      );
    if (outcome === 'rejected') {
      const st = await c.query<{ status: string }>(
        `SELECT status::text FROM workflow_instances WHERE id = $1`,
        [instance.id],
      );
      await close(st.rows[0]?.status === 'cancelled' ? 'withdrawn' : 'rejected', null);
      return;
    }
    // something that changed meanwhile (a year locked, a section removed) leaves the record as it was
    await c.query('SAVEPOINT class_apply');
    try {
      const result = await this.run(c, {
        studentId: row.student_id,
        yearId: row.academic_year_id,
        toSectionId: row.to_section_id,
        effectiveFrom: row.effective_from,
      });
      await c.query('RELEASE SAVEPOINT class_apply');
      await close('applied', result);
      await this.audit.stage(ctx, c, {
        action: 'people.student.class_correction.applied',
        entityType: 'students',
        entityId: row.student_id,
        before: { section: result.from.label },
        after: {
          section: result.to.label,
          rollNo: result.rollNo,
          effectiveFrom: result.effectiveFrom,
          due: result.fee.after.due,
          advance: result.fee.advance,
        },
      });
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT class_apply');
      const msg = error instanceof Error ? error.message : String(error);
      await close('rejected', null, `Not applied: ${msg}`.slice(0, 500));
    }
  }
}
