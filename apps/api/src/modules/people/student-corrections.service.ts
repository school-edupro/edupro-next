import { Injectable } from '@nestjs/common';
import {
  CORRECTION_KEYS,
  PROFILE_FIELD_BY_KEY,
  ProfileWriteError,
  loadProfileLists,
  readStudentProfile,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { describeLevels, ensureCorrectionFlow, type CorrectionFlow } from './correction-flows';
import type { CorrectionRequestDto } from './student-corrections.dto';
import { StudentProfileService } from './student-profile.service';

export const CORRECTION_FLOW: CorrectionFlow = {
  code: 'student_correction',
  entityType: 'student_correction',
  name: 'Student detail correction',
};
const KEYS: readonly string[] = CORRECTION_KEYS;

export interface CorrectionChange {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
}
export interface CorrectionRow {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  changes: CorrectionChange[];
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  workflowInstanceId: string | null;
  /** The level it waits at, while pending. */
  waitingAt: string | null;
  mine: boolean;
}

const asText = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

/**
 * Detail corrections (docs/design/37, part 1): a student's name parts, date of birth, gender and parents'
 * names change only by a request the school's approval levels decide; the request keeps the old and new
 * values and the change is written when the last level approves.
 */
@Injectable()
export class StudentCorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly profiles: StudentProfileService,
  ) {}

  /** The approval levels, made with the principal at one level the first time they are needed. */
  ensureFlow(c: PoolClient) {
    return ensureCorrectionFlow(c, CORRECTION_FLOW);
  }

  /** Who decides, level by level (shown beside "Correct details"; changed under Workflow). */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const flow = await this.ensureFlow(c);
      return {
        definitionId: flow.id,
        fields: KEYS.map((k) => ({ key: k, label: PROFILE_FIELD_BY_KEY.get(k)!.label })),
        levels: await describeLevels(c, flow.levels),
      };
    });
  }

  private async rows(c: PoolClient, where: string, params: unknown[]): Promise<CorrectionRow[]> {
    const r = await c.query<{
      id: string;
      status: CorrectionRow['status'];
      changes: Record<string, { from: unknown; to: unknown }>;
      reason: string;
      requested_by: string | null;
      requested_by_id: string | null;
      requested_at: string;
      decided_by: string | null;
      decided_at: string | null;
      decision_note: string | null;
      apply_error: string | null;
      workflow_instance_id: string | null;
      waiting_at: string | null;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- where is a fixed condition; values are bound parameters
      `SELECT k.id::text, k.status, k.changes, k.reason, ru.display_name AS requested_by, k.requested_by::text AS requested_by_id, k.requested_at,
              du.display_name AS decided_by, k.decided_at, k.decision_note, k.apply_error, k.workflow_instance_id::text,
              (SELECT s.name FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                WHERE s.instance_id = k.workflow_instance_id AND s.level = i.current_level AND i.status = 'pending' LIMIT 1) AS waiting_at
         FROM student_corrections k LEFT JOIN users ru ON ru.id = k.requested_by LEFT JOIN users du ON du.id = k.decided_by
        WHERE ${where} ORDER BY k.requested_at DESC, k.id DESC`,
      params,
    );
    const me = await c.query<{ id: string | null }>(`SELECT app.current_user_id()::text AS id`);
    return r.rows.map((x) => ({
      id: x.id,
      status: x.status,
      changes: Object.entries(x.changes).map(([key, v]) => ({
        key,
        label: PROFILE_FIELD_BY_KEY.get(key)?.label ?? key,
        from: asText(v.from),
        to: asText(v.to),
      })),
      reason: x.reason,
      requestedBy: x.requested_by,
      requestedAt: new Date(x.requested_at).toISOString(),
      decidedBy: x.decided_by,
      decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null,
      note: x.decision_note,
      applyError: x.apply_error,
      workflowInstanceId: x.workflow_instance_id,
      waitingAt: x.waiting_at,
      mine: x.requested_by_id !== null && x.requested_by_id === me.rows[0]?.id,
    }));
  }

  /** The correction history of a student, newest first. */
  async list(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, studentId);
      return { data: await this.rows(c, 'k.student_id = $1', [studentId]) };
    });
  }

  /** Ask for a correction: only the values that differ from the record go for approval. */
  async request(
    ctx: RequestContext,
    studentId: string,
    dto: CorrectionRequestDto,
  ): Promise<CorrectionRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, studentId);
      const other = Object.keys(dto.values).filter((k) => !KEYS.includes(k));
      if (other.length)
        throw new DomainError(
          'people.correction_fields',
          'Only the name, date of birth, gender and parents’ names are corrected this way; save the other details directly',
          { status: 400, extra: { fields: other } },
        );
      const lists = await loadProfileLists(c);
      const { values, errors } = validateChanges(dto.values, lists);
      if (values.first_name === null) errors.first_name ??= 'is required';
      if (values.dob === null) errors.dob ??= 'is required';
      if (values.gender === null) errors.gender ??= 'is required';
      if (Object.keys(errors).length)
        throw new DomainError('validation-failed', 'Some values are not valid', {
          status: 400,
          extra: { errors },
        });
      const snap = await readStudentProfile(c, studentId, { showSensitive: false });
      if (!snap) throw new DomainError('not-found', 'Student not found');
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      for (const [k, to] of Object.entries(values)) {
        const from = asText(snap.values[k]);
        if (from === asText(to)) continue;
        changes[k] = { from, to: asText(to) };
      }
      if (!Object.keys(changes).length)
        throw new DomainError('people.correction_nothing', 'Nothing differs from the record', {
          status: 400,
        });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO student_corrections (school_id, student_id, changes, reason, requested_by)
           VALUES (app.current_school_id(), $1, $2::jsonb, $3, app.current_user_id()) RETURNING id::text`,
          [studentId, JSON.stringify(changes), dto.reason],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'people.correction_open',
            'A correction for this student is already waiting for approval',
            { status: 409 },
          );
        throw error;
      }
      await this.ensureFlow(c);
      const listed = Object.entries(changes).map(([k, v]) => ({
        key: k,
        label: PROFILE_FIELD_BY_KEY.get(k)!.label,
        ...v,
      }));
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: CORRECTION_FLOW.code,
        entityType: CORRECTION_FLOW.entityType,
        entityId: id,
        subject:
          `Correct details: ${snap.displayName}${snap.admissionNo ? ` (${snap.admissionNo})` : ''}: ${listed.map((x) => x.label).join(', ')}`.slice(
            0,
            240,
          ),
        payload: {
          studentId,
          student: snap.displayName,
          admissionNo: snap.admissionNo,
          changes: listed,
          reason: dto.reason,
        },
      });
      await c.query(`UPDATE student_corrections SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.student.correction.request',
        entityType: 'students',
        entityId: studentId,
        after: { correctionId: id, changes, reason: dto.reason },
      });
      return (await this.rows(c, 'k.id = $1', [id]))[0]!;
    });
  }

  /** The requester (or a workflow manager) takes back a request still waiting. */
  async withdraw(ctx: RequestContext, studentId: string, id: string, reason?: string) {
    const instanceId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status, workflow_instance_id::text FROM student_corrections WHERE id = $1 AND student_id = $2`,
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
    // the engine's cancel tells onDecision, which marks the request withdrawn
    await this.workflow.cancel(ctx, instanceId, { reason: reason || 'Withdrawn by the requester' });
    return this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.rows(c, 'k.id = $1', [id]))[0]!,
    );
  }

  /** The last level decided (or the request was withdrawn): write the new values, or close it. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const r = await c.query<{
      student_id: string;
      changes: Record<string, { from: string | null; to: string | null }>;
    }>(
      `SELECT student_id::text, changes FROM student_corrections WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [instance.entityId],
    );
    const row = r.rows[0];
    if (!row) return;
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending' && s.note)
        .map((s) => s.note)
        .join(' · ') || null;
    const close = (status: string, error: string | null = null) =>
      c.query(
        `UPDATE student_corrections SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, apply_error = $4
          WHERE id = $1`,
        [instance.entityId, status, note, error],
      );
    if (outcome === 'rejected') {
      const cancelled = await c.query<{ status: string }>(
        `SELECT status::text FROM workflow_instances WHERE id = $1`,
        [instance.id],
      );
      await close(cancelled.rows[0]?.status === 'cancelled' ? 'withdrawn' : 'rejected');
      return;
    }
    const values = Object.fromEntries(Object.entries(row.changes).map(([k, v]) => [k, v.to]));
    const lists = await loadProfileLists(c);
    const checked = validateChanges(values, lists);
    let failed: string | null = Object.keys(checked.errors).length
      ? Object.entries(checked.errors)
          .map(([k, m]) => `${PROFILE_FIELD_BY_KEY.get(k)?.label ?? k} ${m}`)
          .join('; ')
      : null;
    if (!failed) {
      // a value that no longer fits leaves the record as it was; the approval itself stands
      await c.query('SAVEPOINT student_correction');
      try {
        await writeStudentProfile(c, row.student_id, checked.values);
        await refreshCompleteness(c, row.student_id);
        await c.query('RELEASE SAVEPOINT student_correction');
      } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT student_correction');
        if (!(error instanceof ProfileWriteError)) throw error;
        failed = Object.entries(error.errors)
          .map(([k, m]) => `${PROFILE_FIELD_BY_KEY.get(k)?.label ?? k} ${m}`)
          .join('; ');
      }
    }
    await close(failed ? 'rejected' : 'applied', failed ? `Not applied: ${failed}` : null);
    await this.audit.stage(ctx, c, {
      action: failed ? 'people.student.correction.failed' : 'people.student.correction.applied',
      entityType: 'students',
      entityId: row.student_id,
      before: Object.fromEntries(Object.entries(row.changes).map(([k, v]) => [k, v.from])),
      after: failed ? { error: failed } : values,
    });
  }
}
