import { Injectable } from '@nestjs/common';
import { refreshCompleteness, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { describeLevels, ensureCorrectionFlow, type CorrectionFlow } from './correction-flows';
import {
  MERGE_AREA_LABEL,
  MERGE_BLOCKERS,
  MERGE_RULES,
  type MergeArea,
  type MergeRule,
} from './merge-rules';
import type { StudentMergeDto } from './student-merges.dto';
import { StudentProfileService } from './student-profile.service';

export const MERGE_FLOW: CorrectionFlow = {
  code: 'student_merge',
  entityType: 'student_merge',
  name: 'Duplicate student merge',
};

export interface MergeSide {
  id: string;
  name: string;
  admissionNo: string;
  dob: string | null;
  father: string | null;
  mother: string | null;
  classSection: string | null;
  admittedOn: string | null;
  due: number;
}
export interface MergeOutcome {
  keep: MergeSide;
  duplicate: MergeSide;
  moved: Array<{ area: MergeArea; label: string; count: number }>;
  /** Where both held a record of the same thing and the kept record's stayed. */
  clashes: Array<{ area: MergeArea; label: string; rule: string; count: number }>;
  fee: {
    receipts: number;
    dueAfter: number;
    /** Paid on the duplicate's lines that the kept record also had, set against the kept record's dues. */
    freed: number;
    setAgainst: number;
    advance: number;
  };
  logins: 'moved' | 'stopped' | 'none';
}
export interface MergeRow {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  keep: { id: string; name: string; admissionNo: string };
  duplicate: { id: string; name: string; admissionNo: string };
  reason: string;
  preview: MergeOutcome;
  result: MergeOutcome | null;
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
const at = (expr: string, alias: string) => expr.replaceAll('{a}', alias);

/**
 * The SQL a rule runs: the duplicate's clashing rows out (keep), then the rest moved. Table, column and
 * condition fragments come only from the constant MERGE_RULES; the ids are bound parameters.
 */
/* eslint-disable no-restricted-syntax */
function ruleSql(r: MergeRule): { clash: string | null; move: string } {
  const where = (alias: string) => (r.where ? at(r.where, alias) : 'TRUE');
  const scope = (alias: string) => (r.scope ? at(r.scope, alias) : 'TRUE');
  let clash: string | null = null;
  if (r.how === 'keep') {
    const same = (r.key ?? [])
      .map((k) =>
        k.includes('{a}')
          ? `${at(k, 'k')} IS NOT DISTINCT FROM ${at(k, 'd')}`
          : `k.${k} IS NOT DISTINCT FROM d.${k}`,
      )
      .join(' AND ');
    const cond =
      r.clash ??
      `EXISTS (SELECT 1 FROM ${r.table} k WHERE k.${r.col} = $1 AND ${where('k')} AND ${scope('k')}${same ? ` AND ${same}` : ''})`;
    clash = `DELETE FROM ${r.table} d WHERE d.${r.col} = $2 AND ${where('d')} AND ${scope('d')} AND ${cond}`;
  }
  return {
    clash,
    move: `UPDATE ${r.table} AS d SET ${r.col} = $1 WHERE d.${r.col} = $2 AND ${where('d')}`,
  };
}
/* eslint-enable no-restricted-syntax */

/**
 * Merge duplicates (docs/design/37, part 3): the same child admitted twice. Once the approval levels
 * approve, every record of the duplicate moves to the record kept in one transaction (see
 * merge-rules.ts); the duplicate is closed as "merged into" the kept one and its admission number is
 * retired but still finds the pupil. A merge cannot be undone.
 */
@Injectable()
export class StudentMergesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly profiles: StudentProfileService,
  ) {}

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const flow = await ensureCorrectionFlow(c, MERGE_FLOW);
      return { definitionId: flow.id, levels: await describeLevels(c, flow.levels) };
    });
  }

  private async side(c: PoolClient, id: string): Promise<MergeSide & { merged: boolean }> {
    const r = await c.query<{
      id: string;
      name: string;
      admission_no: string;
      dob: string | null;
      father: string | null;
      mother: string | null;
      section: string | null;
      admitted_on: string | null;
      due: string;
      merged: boolean;
    }>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no, s.dob::text, s.admitted_on::text,
              (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.relation = 'father' LIMIT 1) AS father,
              (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.relation = 'mother' LIMIT 1) AS mother,
              (SELECT k.name || ' ' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                 JOIN academic_years y ON y.id = e.academic_year_id WHERE e.student_id = s.id ORDER BY y.start_date DESC LIMIT 1) AS section,
              (SELECT COALESCE(sum(d.net - d.paid), 0)::text FROM fee_demands d WHERE d.student_id = s.id AND d.status NOT IN ('cancelled', 'carried')) AS due,
              (s.deleted_at IS NOT NULL OR s.merged_into_id IS NOT NULL) AS merged
         FROM students s WHERE s.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Student not found', { status: 404 });
    return {
      id: x.id,
      name: x.name,
      admissionNo: x.admission_no,
      dob: x.dob,
      father: x.father,
      mother: x.mother,
      classSection: x.section,
      admittedOn: x.admitted_on,
      due: r2(Number(x.due)),
      merged: x.merged,
    };
  }

  /** Why the two cannot be merged now (empty: they can). */
  private async blockers(c: PoolClient, keepId: string, dupId: string): Promise<string[]> {
    if (keepId === dupId) return ['Choose two different records'];
    const out: string[] = [];
    for (const id of [keepId, dupId]) {
      const s = await this.side(c, id);
      if (s.merged) out.push(`${s.name} (${s.admissionNo}) is already merged or removed`);
    }
    const open = await c.query(
      `SELECT 1 FROM student_merges WHERE status = 'pending' AND (keep_id = ANY($1::bigint[]) OR duplicate_id = ANY($1::bigint[]))`,
      [[keepId, dupId]],
    );
    if (open.rowCount) out.push('One of the records is already in a merge waiting for approval');
    for (const b of MERGE_BLOCKERS) {
      // both ids typed, whichever of them the check names
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- b.sql is a constant of MERGE_BLOCKERS; the ids are bound
        `SELECT 1 FROM (SELECT $1::bigint AS k, $2::bigint AS d) p WHERE EXISTS (${b.sql})`,
        [keepId, dupId],
      );
      if (r.rowCount) out.push(b.why);
    }
    return out;
  }

  /** The merge itself, in the caller's transaction (the preview rolls it back). */
  private async run(c: PoolClient, keepId: string, dupId: string): Promise<MergeOutcome> {
    const blocked = await this.blockers(c, keepId, dupId);
    if (blocked.length)
      throw new DomainError('people.merge_blocked', blocked.join('. '), {
        status: 409,
        extra: { blockers: blocked },
      });
    const keep = await this.side(c, keepId);
    const duplicate = await this.side(c, dupId);
    const moved = new Map<MergeArea, number>();
    const clashes = new Map<string, { area: MergeArea; rule: string; count: number }>();
    const addMoved = (area: MergeArea, n: number) => {
      if (n > 0) moved.set(area, (moved.get(area) ?? 0) + n);
    };
    const addClash = (area: MergeArea, rule: string, n: number) => {
      if (n <= 0) return;
      const k = `${area}|${rule}`;
      const cur = clashes.get(k) ?? { area, rule, count: 0 };
      cur.count += n;
      clashes.set(k, cur);
    };

    // fee lines: where both were charged for the same month and head the kept record's line stays and
    // what was paid on the duplicate's goes to the kept record's dues; the other lines and every receipt move
    const freed = new Map<string, number>();
    const twins = await c.query<{ id: string }>(
      `SELECT d.id::text FROM fee_demands d
        WHERE d.student_id = $2 AND EXISTS (SELECT 1 FROM fee_demands k WHERE k.student_id = $1 AND k.academic_year_id = d.academic_year_id
                                              AND k.period_id = d.period_id AND k.head_id = d.head_id)`,
      [keepId, dupId],
    );
    for (const t of twins.rows) {
      const allocs = await c.query<{ payment_id: string; amount: string }>(
        `SELECT payment_id::text, amount::text FROM fee_payment_allocations WHERE demand_id = $1`,
        [t.id],
      );
      for (const a of allocs.rows)
        freed.set(a.payment_id, r2((freed.get(a.payment_id) ?? 0) + Number(a.amount)));
      await c.query(`DELETE FROM fee_payment_allocations WHERE demand_id = $1`, [t.id]);
      await c.query(`DELETE FROM fee_demands WHERE id = $1`, [t.id]);
    }
    addClash(
      'fees',
      'the kept record’s fee line of a month (money paid on the duplicate’s goes to the kept record’s dues)',
      twins.rows.length,
    );
    addMoved(
      'fees',
      (
        await c.query(`UPDATE fee_demands SET student_id = $1 WHERE student_id = $2`, [
          keepId,
          dupId,
        ])
      ).rowCount ?? 0,
    );
    const receipts =
      (
        await c.query(`UPDATE fee_payments SET student_id = $1 WHERE student_id = $2`, [
          keepId,
          dupId,
        ])
      ).rowCount ?? 0;
    addMoved('fees', receipts);

    // the kept record's main parent stays the main one
    const primary = await c.query<{ id: string }>(
      `SELECT id::text FROM student_guardians WHERE student_id = $1 AND is_primary ORDER BY created_at, id LIMIT 1`,
      [keepId],
    );

    for (const r of MERGE_RULES) {
      if (r.how !== 'move' && r.how !== 'keep') continue;
      const sql = ruleSql(r);
      if (sql.clash)
        addClash(
          r.area,
          r.rule ?? 'the kept record’s',
          (await c.query(sql.clash, [keepId, dupId])).rowCount ?? 0,
        );
      addMoved(r.area, (await c.query(sql.move, [keepId, dupId])).rowCount ?? 0);
    }

    if (primary.rows[0])
      await c.query(
        `UPDATE student_guardians SET is_primary = false WHERE student_id = $1 AND is_primary AND id <> $2`,
        [keepId, primary.rows[0].id],
      );

    // money taken off the duplicate's twin lines: to the dues in date order, the rest as advance
    let setAgainst = 0;
    for (const [paymentId, amount] of freed) {
      const m = await c.query<{ v: string }>(
        `SELECT app.allocate_free_to_dues($1, $2)::text AS v`,
        [paymentId, amount.toFixed(2)],
      );
      setAgainst = r2(setAgainst + Number(m.rows[0]!.v));
    }
    const freedTotal = r2([...freed.values()].reduce((s, x) => s + x, 0));

    // logins: the duplicate's moves when the kept record has none; otherwise it is stopped
    const users = await c.query<{ keep_user: string | null; dup_user: string | null }>(
      `SELECT (SELECT user_id::text FROM students WHERE id = $1) AS keep_user, (SELECT user_id::text FROM students WHERE id = $2) AS dup_user`,
      [keepId, dupId],
    );
    let logins: MergeOutcome['logins'] = 'none';
    const u = users.rows[0]!;
    if (u.dup_user && !u.keep_user) {
      await c.query(`UPDATE students SET user_id = NULL WHERE id = $1`, [dupId]);
      await c.query(`UPDATE students SET user_id = $2 WHERE id = $1`, [keepId, u.dup_user]);
      await c.query(
        `UPDATE user_school_memberships SET person_ref_id = $1, updated_at = now() WHERE person_type = 'student' AND person_ref_id = $2`,
        [keepId, dupId],
      );
      logins = 'moved';
    } else {
      const stopped = await c.query(
        `UPDATE user_school_memberships SET status = 'inactive', deleted_at = now(), updated_at = now()
          WHERE person_type = 'student' AND person_ref_id = $1 AND deleted_at IS NULL`,
        [dupId],
      );
      if (u.dup_user || stopped.rowCount) logins = 'stopped';
    }

    // the duplicate closes: merged into the kept record, its number retired and still finding the pupil
    await c.query(`SELECT set_config('app.status_reason', $1, true)`, [
      `Merged into ${keep.admissionNo}`,
    ]);
    const tag = await c.query<{ rfid: string | null; photo: string | null }>(
      `SELECT rfid_tag AS rfid, photo_file_id::text AS photo FROM students WHERE id = $1`,
      [dupId],
    );
    await c.query(
      `UPDATE students SET status = 'inactive', merged_into_id = $1, merged_at = now(), deleted_at = now(), user_id = NULL,
              rfid_tag = NULL, updated_at = now(), updated_by = app.current_user_id()
        WHERE id = $2`,
      [keepId, dupId],
    );
    // a tag card and a photo the kept record lacks come over
    await c.query(
      `UPDATE students SET rfid_tag = COALESCE(rfid_tag, $2), photo_file_id = COALESCE(photo_file_id, $3::bigint),
              updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
      [keepId, tag.rows[0]?.rfid ?? null, tag.rows[0]?.photo ?? null],
    );
    await c.query(
      `INSERT INTO admission_no_changes (school_id, student_id, old_no, new_no, reason, changed_by)
       VALUES (app.current_school_id(), $1, $2, $3, 'Duplicate record merged', app.current_user_id())`,
      [keepId, duplicate.admissionNo, keep.admissionNo],
    );
    await refreshCompleteness(c, keepId);
    const after = await this.side(c, keepId);

    return {
      keep,
      duplicate,
      moved: [...moved.entries()].map(([area, count]) => ({
        area,
        label: MERGE_AREA_LABEL[area],
        count,
      })),
      clashes: [...clashes.values()].map((x) => ({ ...x, label: MERGE_AREA_LABEL[x.area] })),
      fee: {
        receipts,
        dueAfter: after.due,
        freed: freedTotal,
        setAgainst,
        advance: r2(freedTotal - setAgainst),
      },
      logins,
    };
  }

  private async dryRun(c: PoolClient, keepId: string, dupId: string) {
    await c.query('SAVEPOINT merge_preview');
    try {
      return await this.run(c, keepId, dupId);
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT merge_preview');
    }
  }

  /** What the merge would do, or why it cannot be done now. */
  async preview(ctx: RequestContext, dto: StudentMergeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, dto.keepId);
      const blockers = await this.blockers(c, dto.keepId, dto.duplicateId);
      if (blockers.length) {
        const sides = await Promise.all(
          [dto.keepId, dto.duplicateId].map((id) => this.side(c, id).catch(() => null)),
        );
        return { blockers, keep: sides[0], duplicate: sides[1], outcome: null };
      }
      try {
        const outcome = await this.dryRun(c, dto.keepId, dto.duplicateId);
        return { blockers: [], keep: outcome.keep, duplicate: outcome.duplicate, outcome };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        // a record this merge cannot move yet: shown as a blocker, nothing changed
        return {
          blockers: [`The merge cannot be done as it stands: ${(error as Error).message}`],
          keep: await this.side(c, dto.keepId),
          duplicate: await this.side(c, dto.duplicateId),
          outcome: null,
        };
      }
    });
  }

  private async rows(c: PoolClient, where: string, params: unknown[]): Promise<MergeRow[]> {
    const r = await c.query<{
      id: string;
      status: MergeRow['status'];
      keep_id: string;
      keep_name: string;
      keep_no: string;
      dup_id: string;
      dup_name: string;
      dup_no: string;
      reason: string;
      preview: MergeOutcome;
      result: MergeOutcome | null;
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
      `SELECT m.id::text, m.status, ks.id::text AS keep_id, ks.display_name AS keep_name, ks.admission_no AS keep_no,
              ds.id::text AS dup_id, ds.display_name AS dup_name, ds.admission_no AS dup_no, m.reason, m.preview, m.result,
              ru.display_name AS requested_by, m.requested_by::text AS requested_by_id, m.requested_at, du.display_name AS decided_by,
              m.decided_at, m.decision_note, m.apply_error, app.current_user_id()::text AS me,
              (SELECT s.name FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                WHERE s.instance_id = m.workflow_instance_id AND s.level = i.current_level AND i.status = 'pending' LIMIT 1) AS waiting_at
         FROM student_merges m JOIN students ks ON ks.id = m.keep_id JOIN students ds ON ds.id = m.duplicate_id
         LEFT JOIN users ru ON ru.id = m.requested_by LEFT JOIN users du ON du.id = m.decided_by
        WHERE ${where} ORDER BY m.requested_at DESC, m.id DESC`,
      params,
    );
    return r.rows.map((x) => ({
      id: x.id,
      status: x.status,
      keep: { id: x.keep_id, name: x.keep_name, admissionNo: x.keep_no },
      duplicate: { id: x.dup_id, name: x.dup_name, admissionNo: x.dup_no },
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

  /** The merges a record took part in, and the record it was merged into (for a merged one's page). */
  async list(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const into = await c.query<{ id: string; name: string; admission_no: string }>(
        `SELECT k.id::text, k.display_name AS name, k.admission_no FROM students s JOIN students k ON k.id = s.merged_into_id WHERE s.id = $1`,
        [studentId],
      );
      if (!into.rows[0]) await this.profiles.assertVisible(ctx, c, studentId);
      const m = into.rows[0];
      return {
        mergedInto: m ? { id: m.id, name: m.name, admissionNo: m.admission_no } : null,
        data: await this.rows(c, '(m.keep_id = $1 OR m.duplicate_id = $1)', [studentId]),
      };
    });
  }

  async request(ctx: RequestContext, dto: StudentMergeDto) {
    if (!dto.reason)
      throw new DomainError('validation-failed', 'Give the reason', {
        status: 400,
        extra: { errors: { reason: 'is required' } },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.profiles.assertVisible(ctx, c, dto.keepId);
      const preview = await this.dryRun(c, dto.keepId, dto.duplicateId);
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO student_merges (school_id, keep_id, duplicate_id, reason, preview, requested_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id()) RETURNING id::text`,
          [dto.keepId, dto.duplicateId, dto.reason, JSON.stringify(preview)],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'people.merge_open',
            'One of the records is already in a merge waiting for approval',
            { status: 409 },
          );
        throw error;
      }
      await ensureCorrectionFlow(c, MERGE_FLOW);
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: MERGE_FLOW.code,
        entityType: MERGE_FLOW.entityType,
        entityId: id,
        subject:
          `Merge duplicate: ${preview.duplicate.name} (${preview.duplicate.admissionNo}) into ${preview.keep.name} (${preview.keep.admissionNo})`.slice(
            0,
            240,
          ),
        payload: {
          keep: preview.keep,
          duplicate: preview.duplicate,
          moved: preview.moved,
          clashes: preview.clashes,
          fee: preview.fee,
          reason: dto.reason,
        },
      });
      await c.query(`UPDATE student_merges SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.student.merge.request',
        entityType: 'students',
        entityId: dto.keepId,
        after: { mergeId: id, duplicateId: dto.duplicateId, reason: dto.reason },
      });
      return (await this.rows(c, 'm.id = $1', [id]))[0]!;
    });
  }

  async withdraw(ctx: RequestContext, id: string, reason?: string) {
    const instanceId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status, workflow_instance_id::text FROM student_merges WHERE id = $1`,
        [id],
      );
      const row = r.rows[0];
      if (!row) throw new DomainError('not-found', 'Merge not found', { status: 404 });
      if (row.status !== 'pending' || !row.workflow_instance_id)
        throw new DomainError('people.correction_decided', 'This merge is already decided', {
          status: 409,
        });
      return row.workflow_instance_id;
    });
    await this.workflow.cancel(ctx, instanceId, { reason: reason || 'Withdrawn by the requester' });
    return this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.rows(c, 'm.id = $1', [id]))[0]!,
    );
  }

  /** The last level decided (or withdrawn): merge now, or close the request. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const r = await c.query<{ keep_id: string; duplicate_id: string }>(
      `SELECT keep_id::text, duplicate_id::text FROM student_merges WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [instance.entityId],
    );
    const row = r.rows[0];
    if (!row) return;
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending' && s.note)
        .map((s) => s.note)
        .join(' · ') || null;
    const close = (status: string, result: MergeOutcome | null, error: string | null = null) =>
      c.query(
        `UPDATE student_merges SET status = $2, result = $3::jsonb, decided_by = app.current_user_id(), decided_at = now(),
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
    // the merge request itself would block its own run: it is taken out of the way first
    await c.query(`UPDATE student_merges SET status = 'applied' WHERE id = $1`, [
      instance.entityId,
    ]);
    await c.query('SAVEPOINT merge_apply');
    try {
      const result = await this.run(c, row.keep_id, row.duplicate_id);
      await c.query('RELEASE SAVEPOINT merge_apply');
      await close('applied', result);
      await this.audit.stage(ctx, c, {
        action: 'people.student.merge.applied',
        entityType: 'students',
        entityId: row.keep_id,
        before: { duplicate: result.duplicate },
        after: { keep: result.keep.admissionNo, moved: result.moved, clashes: result.clashes },
      });
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT merge_apply');
      const msg = error instanceof Error ? error.message : String(error);
      await close('rejected', null, `Not merged: ${msg}`.slice(0, 500));
    }
  }
}
