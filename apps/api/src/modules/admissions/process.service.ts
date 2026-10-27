import { messageTag } from './message-tag';
import { Injectable } from '@nestjs/common';
import {
  LAYOUT_TYPES,
  admissionWaitingFor,
  levelDeciders,
  pointsTotal,
  type AdmissionAnswers,
  type PointLine,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { classPointsMax } from './points-rules';
import { WorkflowService } from '../workflow/workflow.service';
import { AdmissionCoreService, type AppRow } from './admission-core.service';
import { ADMISSIONS } from './admissions.dto';
import {
  IN_PROCESS,
  journey,
  place,
  refreshMerit,
  slotOf,
  stagesById,
  startProcess,
  type ProcessLevel,
  type ProcessStep,
  type StageKind,
} from './process-engine';
import { checkParts, marksOf, papersIn, storeMarks } from './part-marks';
import type {
  BulkDecideDto,
  DecideDto,
  WaitingQueryDto,
  ProcessDto,
  RegistrationsQueryDto,
  OfficeCorrectDto,
  PointsCheckDto,
  SendBackDto,
  StagesDto,
  UndoDto,
} from './process.dto';

const DEFAULT_STAGES: Array<{ name: string; kind: StageKind; maxMarks: number | null }> = [
  { name: 'Document check', kind: 'document_check', maxMarks: null },
  { name: 'Written test', kind: 'test', maxMarks: 100 },
  { name: 'Interview', kind: 'interview', maxMarks: 50 },
  { name: 'Interaction', kind: 'interaction', maxMarks: null },
  { name: 'Selection', kind: 'selection', maxMarks: null },
];

const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);

export const ADMISSION_DECIDE = 'admissions.application.decide';
export const ADMISSION_SCHEDULE = 'admissions.schedule.manage';
export const ADMISSION_SETUP_MANAGE = 'admissions.setup.manage';

/**
 * The approval process of online admission (docs/design/39, part 4): the school's stages, processes
 * (stages with approval levels) assigned to classes — a change that reaches applications in progress
 * needs a confirmation —, and the office's work on a registration: approve, reject, hold, record marks,
 * confirm the fee category at Document check, send back for correction, offer or wait-list at
 * Selection, and undo.
 */
@Injectable()
export class AdmissionProcessService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
  ) {}

  // ---- set-up -----------------------------------------------------------------------------------
  async stagesWith(c: PoolClient) {
    const n = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM admission_stages`);
    if (!n.rows[0]?.n)
      for (const [i, s] of DEFAULT_STAGES.entries())
        await c.query(
          `INSERT INTO admission_stages (school_id, name, kind, max_marks, sort_order) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
          [s.name, s.kind, s.maxMarks, i],
        );
    const r = await c.query<{
      id: string;
      name: string;
      kind: StageKind;
      max_marks: string | null;
      status: string;
      used: boolean;
    }>(
      `SELECT s.id::text, s.name, s.kind, s.max_marks::text, s.status,
              EXISTS (SELECT 1 FROM admission_stage_results x WHERE x.stage_id = s.id) AS used
         FROM admission_stages s ORDER BY s.sort_order, s.id`,
    );
    return r.rows.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      maxMarks: s.max_marks !== null ? Number(s.max_marks) : null,
      status: s.status as 'active' | 'inactive',
      used: s.used,
    }));
  }

  private async processesWith(c: PoolClient) {
    const r = await c.query<{
      id: string;
      name: string;
      steps: ProcessStep[];
      class_ids: string[];
      class_names: string[];
    }>(
      `SELECT p.id::text, p.name, p.steps,
              COALESCE(array_agg(pc.class_id::text ORDER BY cl.display_order) FILTER (WHERE pc.class_id IS NOT NULL), '{}') AS class_ids,
              COALESCE(array_agg(cl.name ORDER BY cl.display_order) FILTER (WHERE pc.class_id IS NOT NULL), '{}') AS class_names
         FROM admission_processes p LEFT JOIN admission_process_classes pc ON pc.process_id = p.id
         LEFT JOIN classes cl ON cl.id = pc.class_id
        WHERE p.status = 'active' GROUP BY p.id ORDER BY p.name`,
    );
    return r.rows.map((p) => ({
      id: p.id,
      name: p.name,
      steps: p.steps,
      classIds: p.class_ids,
      classNames: p.class_names,
    }));
  }

  async setup(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const opts = await this.workflow.options(ctx);
    return this.db.tenant(tenant, async (c) => {
      const stages = await this.stagesWith(c);
      const processes = await this.processesWith(c);
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      );
      const employees = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || NULLIF(designation, ''), '') AS name
           FROM employees WHERE deleted_at IS NULL AND status = 'active' AND user_id IS NOT NULL ORDER BY display_name LIMIT 500`,
      );
      return {
        stages,
        processes,
        classes: classes.rows,
        roles: opts.roles,
        designations: opts.designations,
        employees: employees.rows,
      };
    });
  }

  async saveStages(ctx: RequestContext, dto: StagesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const names = new Set<string>();
      for (const s of dto.stages) {
        const k = s.name.toLowerCase();
        if (names.has(k))
          throw new DomainError('validation-failed', `Two stages are called ${s.name}`, {
            status: 400,
          });
        names.add(k);
        if ((s.kind === 'test' || s.kind === 'interview') && !s.maxMarks)
          throw new DomainError('validation-failed', `${s.name}: give the maximum marks`, {
            status: 400,
          });
      }
      const before = await this.stagesWith(c);
      const kept = new Set(dto.stages.map((s) => s.id).filter(Boolean));
      for (const old of before)
        if (!kept.has(old.id)) {
          const inUse = await c.query(
            `SELECT 1 FROM admission_processes WHERE status = 'active' AND steps @> jsonb_build_array(jsonb_build_object('stageId', $1::text)) LIMIT 1`,
            [old.id],
          );
          if (old.used || inUse.rows.length)
            await c.query(`UPDATE admission_stages SET status = 'inactive' WHERE id = $1`, [
              old.id,
            ]);
          else await c.query(`DELETE FROM admission_stages WHERE id = $1`, [old.id]);
        }
      for (const [i, s] of dto.stages.entries()) {
        if (s.id && before.some((b) => b.id === s.id))
          await c.query(
            `UPDATE admission_stages SET name = $2, kind = $3, max_marks = $4, status = $5, sort_order = $6 WHERE id = $1`,
            [s.id, s.name, s.kind, s.maxMarks ?? null, s.status, i],
          );
        else
          await c.query(
            `INSERT INTO admission_stages (school_id, name, kind, max_marks, status, sort_order) VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
            [s.name, s.kind, s.maxMarks ?? null, s.status, i],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.stages',
        entityType: 'admission_stages',
        entityId: '0',
        after: { stages: dto.stages.map((s) => s.name) },
      });
      return this.stagesWith(c);
    });
  }

  /** Saves a process (new: id null). A change reaching applications in progress needs `confirm`. */
  async saveProcess(ctx: RequestContext, id: string | null, dto: ProcessDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stages = await stagesById(c);
      const seen = new Set<string>();
      for (const [i, s] of dto.steps.entries()) {
        const st = stages.get(s.stageId);
        if (!st)
          throw new DomainError('validation-failed', 'A step has a stage that does not exist', {
            status: 400,
          });
        if (seen.has(s.stageId))
          throw new DomainError('validation-failed', `${st.name} is in the process twice`, {
            status: 400,
          });
        seen.add(s.stageId);
        if (st.kind === 'selection' && i !== dto.steps.length - 1)
          throw new DomainError(
            'validation-failed',
            `${st.name} (selection) must be the last step`,
            { status: 400 },
          );
      }
      let current: { name: string; steps: ProcessStep[]; classIds: string[] } | null = null;
      if (id) {
        const r = await c.query<{ name: string; steps: ProcessStep[]; class_ids: string[] }>(
          `SELECT p.name, p.steps, COALESCE(array_agg(pc.class_id::text) FILTER (WHERE pc.class_id IS NOT NULL), '{}') AS class_ids
             FROM admission_processes p LEFT JOIN admission_process_classes pc ON pc.process_id = p.id
            WHERE p.id = $1 AND p.status = 'active' GROUP BY p.id`,
          [id],
        );
        if (!r.rows[0]) throw new DomainError('not-found', 'Process not found', { status: 404 });
        current = { name: r.rows[0].name, steps: r.rows[0].steps, classIds: r.rows[0].class_ids };
      }
      const dup = await c.query(
        `SELECT 1 FROM admission_processes WHERE status = 'active' AND lower(name) = lower($1) AND ($2::bigint IS NULL OR id <> $2::bigint)`,
        [dto.name, id],
      );
      if (dup.rows.length)
        throw new DomainError('conflict', 'A process with this name exists', { status: 409 });
      const steps: ProcessStep[] = dto.steps.map((s) => ({
        stageId: s.stageId,
        levels: s.levels.map((l): ProcessLevel => ({
          name: l.name,
          by: l.by,
          roleCode: l.by === 'role' ? (l.roleCode ?? null) : null,
          designation: l.by === 'designation' ? (l.designation ?? null) : null,
          employeeIds: l.by === 'employees' ? (l.employeeIds ?? []) : [],
          // kept only when set, so a process saved before time limits compares unchanged
          ...(l.days ? { days: l.days } : {}),
        })),
      }));
      const stepsChanged = !current || JSON.stringify(current.steps) !== JSON.stringify(steps);
      const removed = (current?.classIds ?? []).filter((x) => !dto.classIds.includes(x));
      const added = dto.classIds.filter((x) => !(current?.classIds ?? []).includes(x));
      // the applications in progress the change reaches
      const touched = [...(stepsChanged ? dto.classIds : added), ...removed];
      const affected = touched.length
        ? await c.query<{
            id: string;
            class_id: string;
            number: string | null;
            candidate: string | null;
          }>(
            `SELECT a.id::text, a.class_id::text, a.application_no AS number, a.candidate_name AS candidate
               FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id
              WHERE a.class_id = ANY($1::bigint[]) AND a.status::text = ANY($2::text[]) AND y.deleted_at IS NULL
                AND a.application_no IS NOT NULL ORDER BY a.id`,
            [touched, [...IN_PROCESS]],
          )
        : {
            rows: [] as Array<{
              id: string;
              class_id: string;
              number: string | null;
              candidate: string | null;
            }>,
          };
      if (affected.rows.length && !dto.confirm)
        throw new DomainError(
          'admissions.confirm_process',
          `${affected.rows.length} registration${affected.rows.length === 1 ? '' : 's'} in progress will follow the changed process; decisions already taken stay`,
          {
            status: 409,
            extra: {
              affected: affected.rows.length,
              sample: affected.rows
                .slice(0, 10)
                .map((x) => `${x.number ?? x.id} ${x.candidate ?? ''}`.trim()),
            },
          },
        );
      let pid = id;
      if (pid)
        await c.query(
          `UPDATE admission_processes SET name = $2, steps = $3::jsonb, updated_at = now() WHERE id = $1`,
          [pid, dto.name, JSON.stringify(steps)],
        );
      else
        pid = (
          await c.query<{ id: string }>(
            `INSERT INTO admission_processes (school_id, name, steps) VALUES (app.current_school_id(), $1, $2::jsonb) RETURNING id::text`,
            [dto.name, JSON.stringify(steps)],
          )
        ).rows[0]!.id;
      await c.query(
        `DELETE FROM admission_process_classes WHERE process_id = $1 AND NOT (class_id = ANY($2::bigint[]))`,
        [pid, dto.classIds],
      );
      for (const cl of dto.classIds)
        await c.query(
          `INSERT INTO admission_process_classes (school_id, class_id, process_id) VALUES (app.current_school_id(), $1, $2)
           ON CONFLICT (school_id, class_id) DO UPDATE SET process_id = EXCLUDED.process_id`,
          [cl, pid],
        );
      // the applications in progress follow (or leave) the process; their decisions stay
      for (const a of affected.rows) {
        if (dto.classIds.includes(a.class_id))
          await c.query(
            `UPDATE applications SET process_id = $2, process_steps = $3::jsonb WHERE id = $1`,
            [a.id, pid, JSON.stringify(steps)],
          );
        else {
          await c.query(
            `UPDATE applications SET process_id = NULL, process_steps = NULL WHERE id = $1`,
            [a.id],
          );
          await startProcess(c, a.id);
        }
        await place(c, a.id);
      }
      // registrations of the classes that had no process yet start it now
      const waiting = await c.query<{ id: string }>(
        `SELECT a.id::text FROM applications a WHERE a.class_id = ANY($1::bigint[]) AND a.process_id IS NULL
            AND a.application_no IS NOT NULL AND a.status::text = ANY($2::text[])`,
        [dto.classIds, [...IN_PROCESS]],
      );
      for (const a of waiting.rows) await startProcess(c, a.id);
      await this.audit.stage(ctx, c, {
        action: id ? 'admissions.process.edit' : 'admissions.process.create',
        entityType: 'admission_processes',
        entityId: pid,
        before: current ? { name: current.name, classes: current.classIds } : undefined,
        after: {
          name: dto.name,
          steps: steps.length,
          classes: dto.classIds,
          affected: affected.rows.length,
        },
      });
      return { id: pid, affected: affected.rows.length, processes: await this.processesWith(c) };
    });
  }

  async archiveProcess(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM applications WHERE process_id = $1 AND status::text = ANY($2::text[])`,
        [id, [...IN_PROCESS]],
      );
      if (used.rows[0]!.n)
        throw new DomainError(
          'admissions.process_in_use',
          `${used.rows[0]!.n} registrations in progress follow this process; move their classes to another process first`,
          {
            status: 409,
          },
        );
      await c.query(`DELETE FROM admission_process_classes WHERE process_id = $1`, [id]);
      await c.query(
        `UPDATE admission_processes SET status = 'archived', updated_at = now() WHERE id = $1`,
        [id],
      );
      return { processes: await this.processesWith(c) };
    });
  }

  // ---- registrations ----------------------------------------------------------------------------
  async list(ctx: RequestContext, q: RegistrationsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = [`a.status <> 'draft'`, `a.form_id IS NOT NULL`];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (q.cycleId) add('a.cycle_id = ?', q.cycleId);
      if (q.classId) add('a.class_id = ?', q.classId);
      if (q.categoryId) add('a.category_id = ?', q.categoryId);
      if (q.status) add('a.status::text = ?', q.status);
      if (q.stageId)
        add(
          `(a.process_steps -> a.stage_no ->> 'stageId') = ?::text AND a.status::text IN ('registered', 'under_review', 'sent_back')`,
          q.stageId,
        );
      if (q.q)
        add(
          `(a.application_no ILIKE ? OR a.candidate_name ILIKE $${params.length + 1} OR a.contact_mobile ILIKE $${params.length + 1})`,
          `%${q.q}%`,
        );
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql holds fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n FROM applications a WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<{
        id: string;
        number: string | null;
        status: string;
        candidate: string | null;
        class_name: string;
        cycle_name: string;
        category: string | null;
        mobile: string | null;
        registered_at: Date | null;
        submitted_at: Date | null;
        stage: string | null;
        stage_kind: string | null;
        level_no: number | null;
        levels: number | null;
        merit: string | null;
        wait_rank: number | null;
        offer_expires_at: Date | null;
        fee: string | null;
        entered_by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql holds fixed fragments; values are bound parameters
        `SELECT a.id::text, a.application_no AS number, a.status::text, a.candidate_name AS candidate, cl.name AS class_name,
                y.name AS cycle_name, k.name AS category, a.contact_mobile AS mobile, a.registered_at, a.submitted_at,
                st.name AS stage, st.kind AS stage_kind, a.level_no, jsonb_array_length(a.process_steps -> a.stage_no -> 'levels') AS levels,
                a.merit::text, a.wait_rank, a.offer_expires_at, a.registration_fee::text AS fee, a.entered_by::text
           FROM applications a JOIN classes cl ON cl.id = a.class_id JOIN admission_cycles y ON y.id = a.cycle_id
           LEFT JOIN admission_fee_categories k ON k.id = a.category_id
           LEFT JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
          WHERE ${whereSql} ORDER BY a.registered_at DESC NULLS LAST, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        total: total.rows[0]?.n ?? 0,
        data: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          status: x.status,
          candidate: x.candidate,
          className: x.class_name,
          session: x.cycle_name,
          category: x.category,
          mobile: x.mobile,
          registeredAt: x.registered_at?.toISOString() ?? null,
          submittedAt: x.submitted_at?.toISOString() ?? null,
          stage: ['registered', 'under_review', 'sent_back'].includes(x.status) ? x.stage : null,
          stageKind: x.stage_kind,
          level: x.level_no && x.levels && x.levels > 1 ? `${x.level_no} of ${x.levels}` : null,
          merit: x.merit !== null ? Number(x.merit) : null,
          waitRank: x.wait_rank,
          offerExpiresAt: x.offer_expires_at?.toISOString() ?? null,
          feeDue:
            x.status === 'submitted' && !x.number && Number(x.fee ?? 0) > 0 ? Number(x.fee) : 0,
          byOffice: Boolean(x.entered_by),
        })),
      };
    });
  }

  /**
   * May this user decide at the level? Set-up managers may always; a level for "anyone" takes those with
   * the decide permission; otherwise being named in the level is enough (docs/design/50) — the same
   * people `app.admission_level_users` gives the queue and the morning email.
   */
  private async canAct(
    c: PoolClient,
    ctx: RequestContext,
    level: ProcessLevel | undefined,
  ): Promise<boolean> {
    if (!level) return false;
    if (ctx.permissions?.has(ADMISSION_SETUP_MANAGE)) return true;
    if (level.by === 'anyone') return ctx.permissions?.has(ADMISSION_DECIDE) ?? false;
    const r = await c.query<{ ok: boolean }>(
      `SELECT $2::bigint IN (SELECT app.admission_level_users($1::jsonb)) AS ok`,
      [JSON.stringify(level), ctx.user.id],
    );
    return r.rows[0]?.ok ?? false;
  }

  /** The paper of a test or interview for the class, and the marks by part entered so far. */
  private async paperAt(
    c: PoolClient,
    stage: { id: string; kind: string },
    appId: string,
    classId: string,
  ) {
    if (stage.kind !== 'test' && stage.kind !== 'interview')
      return { paper: null, partMarks: null };
    const paper = (await papersIn(c, stage.id)).get(classId) ?? null;
    if (!paper) return { paper: null, partMarks: null };
    const m = await marksOf(c, appId, stage.id);
    return {
      paper: { parts: paper.parts, total: paper.total, minPercent: paper.minPercent },
      partMarks: m ? { marks: m.marks, absent: m.absent } : null,
    };
  }

  /** A class's maximum for a stage: its paper's total (docs/design/57), else the stage's maximum. */
  private async classMax(c: PoolClient, stageId: string, classId: string): Promise<number | null> {
    const r = await c.query<{ m: string | null }>(
      `SELECT app.admission_stage_max($1, $2)::text AS m`,
      [stageId, classId],
    );
    return r.rows[0]?.m != null ? Number(r.rows[0].m) : null;
  }

  private async processRow(c: PoolClient, id: string) {
    const r = await c.query<{
      steps: ProcessStep[] | null;
      stage_no: number | null;
      level_no: number | null;
      merit: string | null;
      wait_rank: number | null;
      offered_at: Date | null;
      offer_expires_at: Date | null;
      admission_fee: string | null;
      offer_days: number;
    }>(
      `SELECT a.process_steps AS steps, a.stage_no, a.level_no, a.merit::text, a.wait_rank, a.offered_at, a.offer_expires_at,
              a.admission_fee::text, y.offer_days
         FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id WHERE a.id = $1`,
      [id],
    );
    return r.rows[0]!;
  }

  /** A registration as the office sees it: the form, the steps with decisions, what this user may do. */
  async detail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let a = await this.core.row(c, id);
      if (a.application_no && (IN_PROCESS as readonly string[]).includes(a.status)) {
        // a registration made before its class had a process starts it when opened
        if (await startProcess(c, a.id)) a = await this.core.row(c, id);
      }
      const view = await this.core.view(c, a, {
        maskSecrets: !ctx.permissions?.has('people.sensitive.view'),
      });
      const p = await this.processRow(c, id);
      const steps = await journey(c, id, { marks: true });
      const stages = await stagesById(c);
      const at = p.stage_no ?? 0;
      const step = p.steps?.[at];
      const level = step?.levels[(p.level_no ?? 1) - 1];
      const stage = step ? stages.get(step.stageId) : undefined;
      const open =
        (IN_PROCESS as readonly string[]).includes(a.status) &&
        a.status !== 'sent_back' &&
        Boolean(step);
      const canAct = open ? await this.canAct(c, ctx, level) : false;
      const corrections = await c.query<{
        id: string;
        fields: string[];
        remark: string;
        due_on: string | null;
        status: string;
        created_at: Date;
        resubmitted_at: Date | null;
        by: string | null;
      }>(
        `SELECT x.id::text, x.fields, x.remark, x.due_on::text, x.status, x.created_at, x.resubmitted_at, u.display_name AS by
           FROM admission_corrections x LEFT JOIN users u ON u.id = x.created_by WHERE x.application_id = $1 ORDER BY x.id DESC`,
        [id],
      );
      const events = await c.query<{
        id: string;
        to_status: string;
        note: string | null;
        actor: string | null;
        created_at: Date;
      }>(
        `SELECT e.id::text, e.to_status::text, e.note,
                COALESCE(u.display_name, CASE WHEN e.actor_applicant_id IS NOT NULL THEN 'Family' END) AS actor, e.created_at
           FROM application_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.application_id = $1 ORDER BY e.id DESC LIMIT 100`,
        [id],
      );
      const categories = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM admission_fee_categories WHERE status = 'active' ORDER BY sort_order, id`,
      );
      const answerChanges = await c.query<{
        id: string;
        label: string;
        old_value: string | null;
        new_value: string | null;
        reason: string;
        by: string | null;
        changed_at: Date;
      }>(
        `SELECT x.id::text, x.label, x.old_value, x.new_value, x.reason, u.display_name AS by, x.changed_at
           FROM application_answer_changes x LEFT JOIN users u ON u.id = x.changed_by
          WHERE x.application_id = $1 ORDER BY x.changed_at DESC, x.id DESC LIMIT 200`,
        [id],
      );
      const last = await c.query<{ decided_by: string | null }>(
        `SELECT decided_by::text FROM admission_stage_results WHERE application_id = $1 AND undone_at IS NULL ORDER BY decided_at DESC, id DESC LIMIT 1`,
        [id],
      );
      const undoable =
        ['registered', 'under_review', 'rejected', 'waitlisted', 'offered'].includes(a.status) &&
        Boolean(last.rows[0]) &&
        (ctx.permissions?.has(ADMISSION_SETUP_MANAGE) || last.rows[0]?.decided_by === ctx.user.id);
      return {
        ...view,
        process: {
          steps,
          stageNo: at,
          levelNo: p.level_no ?? 1,
          current:
            open && step && stage
              ? {
                  stageId: stage.id,
                  name: stage.name,
                  kind: stage.kind,
                  maxMarks: await this.classMax(c, stage.id, a.class_id),
                  // the class's paper, and the marks entered so far (docs/design/57)
                  ...(await this.paperAt(c, stage, a.id, a.class_id)),
                  level: p.level_no ?? 1,
                  levels: step.levels.length,
                  levelName: level?.name ?? '',
                  last: (p.level_no ?? 1) === step.levels.length,
                }
              : null,
          canAct,
          undoable,
          hasProcess: Boolean(p.steps?.length),
        },
        categoryId: a.category_id,
        categories: categories.rows,
        merit: p.merit !== null ? Number(p.merit) : null,
        points: await this.pointsOf(c, id),
        waitRank: p.wait_rank,
        offer: p.offered_at
          ? {
              offeredAt: p.offered_at.toISOString(),
              expiresAt: p.offer_expires_at?.toISOString() ?? null,
              admissionFee: Number(p.admission_fee ?? 0),
            }
          : null,
        slot: step ? await slotOf(c, id, step.stageId) : await slotOf(c, id),
        corrections: corrections.rows.map((x) => ({
          id: x.id,
          fields: x.fields,
          remark: x.remark,
          dueOn: x.due_on,
          status: x.status,
          at: x.created_at.toISOString(),
          resubmittedAt: x.resubmitted_at?.toISOString() ?? null,
          by: x.by,
        })),
        answerChanges: answerChanges.rows.map((x) => ({
          id: x.id,
          label: x.label,
          from: x.old_value,
          to: x.new_value,
          reason: x.reason,
          by: x.by,
          at: x.changed_at.toISOString(),
        })),
        canCorrect:
          ctx.permissions?.has(ADMISSIONS.applicationReview) === true &&
          !['draft', 'admitted', 'cancelled', 'withdrawn'].includes(a.status),
        events: events.rows.map((e) => ({
          id: e.id,
          status: e.to_status,
          note: e.note,
          actor: e.actor,
          at: e.created_at.toISOString(),
        })),
      };
    });
  }

  private async notify(
    c: PoolClient,
    a: AppRow,
    code: string,
    vars: Record<string, string>,
    title: string,
    intro: string,
    rows: Array<[string, string]>,
    note: string,
  ) {
    await c.query(
      `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8)`,
      [
        code,
        a.contact_mobile,
        a.contact_email,
        JSON.stringify({
          ...messageTag('status', { applicationId: a.id }),
          name: a.candidate_name ?? '',
          number: a.application_no ?? '',
          class: a.class_name,
          school: '',
          ...vars,
        }),
        title,
        intro,
        JSON.stringify(rows),
        note,
      ],
    );
  }

  /** The admission fee an offer asks: the class and category's, else the default category's. */
  private async offerFee(c: PoolClient, a: AppRow) {
    const fee = await c.query<{ fee: string | null }>(
      `SELECT COALESCE(
                (SELECT admission_fee FROM admission_fees WHERE cycle_id = $1 AND class_id = $2 AND category_id = $3),
                (SELECT f.admission_fee FROM admission_fees f JOIN admission_fee_categories k ON k.id = f.category_id AND k.is_default
                  WHERE f.cycle_id = $1 AND f.class_id = $2), 0)::text AS fee`,
      [a.cycle_id, a.class_id, a.category_id],
    );
    return Number(fee.rows[0]?.fee ?? 0);
  }

  /** The offer's notice: what the email, SMS and WhatsApp say (the email's words may be changed). */
  private offerMessage(a: AppRow, amount: number, due: string) {
    return {
      code: 'admission_offer',
      vars: { amount: amount.toLocaleString('en-IN'), due },
      title: 'Admission offered',
      intro: `${a.candidate_name ?? 'Your ward'} is offered admission to ${a.class_name}.`,
      rows: [
        ['Candidate', a.candidate_name ?? ''],
        ['Registration no.', a.application_no ?? ''],
        ['Class', a.class_name],
        ['Admission fee', `Rs ${amount.toLocaleString('en-IN')}`],
        ['Pay by', due],
      ] as Array<[string, string]>,
      note: 'Pay the admission fee in the admission portal or at the school office before the last date; the offer lapses after it.',
    };
  }

  private async varsOf(c: PoolClient, a: AppRow, extra: Record<string, string>) {
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    return {
      ...messageTag('status', { applicationId: a.id }),
      name: a.candidate_name ?? '',
      number: a.application_no ?? '',
      class: a.class_name,
      school: school.rows[0]?.name ?? '',
      ...extra,
    };
  }

  /**
   * The offer email before it goes (docs/design/56): the subject, the email as the family will see it,
   * and the SMS and WhatsApp texts (from the school's approved templates, not changed here).
   */
  async offerPreview(
    ctx: RequestContext,
    id: string,
    edits: { subject?: string; intro?: string; note?: string },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const amount = await this.offerFee(c, a);
      const days = await c.query<{ due: Date }>(
        `SELECT now() + make_interval(days => y.offer_days) AS due FROM admission_cycles y WHERE y.id = $1`,
        [a.cycle_id],
      );
      const m = this.offerMessage(a, amount, ist(days.rows[0]!.due));
      const vars = await this.varsOf(c, a, m.vars);
      await c.query(`SELECT app.admission_seed_templates(app.current_school_id())`);
      const t = await c.query<{
        channel: string;
        subject: string | null;
        body: string;
        status: string;
      }>(
        `SELECT channel::text, subject, body, status::text FROM comms_templates
          WHERE code = $1 AND deleted_at IS NULL`,
        [m.code],
      );
      const fill = (text: string | null) =>
        Object.entries(vars).reduce(
          (out, [k, v]) => out.split(`{{${k}}}`).join(String(v ?? '')),
          text ?? '',
        );
      const email = t.rows.find((x) => x.channel === 'email');
      // changed words may name the family with {{name}}, {{class}}, {{amount}}, {{due}} (a batch)
      const intro = edits.intro?.trim() ? fill(edits.intro.trim()) : m.intro;
      const note = edits.note !== undefined ? fill(edits.note.trim()) : m.note;
      const html = await c.query<{ html: string }>(
        `SELECT app.school_mail_html('Admissions', $1, $2, NULL, $3::jsonb, $4) AS html`,
        [m.title, intro, JSON.stringify(m.rows), note],
      );
      const mobileOk = /^[6-9][0-9]{9}$/.test(a.contact_mobile ?? '');
      const sms = t.rows.find((x) => x.channel === 'sms');
      const wa = t.rows.find((x) => x.channel === 'whatsapp');
      return {
        amount,
        // the words with the family's facts as {{…}}, for a batch of offers (docs/design/56)
        templates: {
          subject: email?.subject ?? m.title,
          intro: '{{name}} is offered admission to {{class}}.',
          note: m.note,
          fields: ['name', 'class', 'number', 'amount', 'due', 'school'],
        },
        email: {
          to: a.contact_email,
          on: Boolean(email && email.status === 'active' && a.contact_email),
          subject: fill(edits.subject?.trim() || email?.subject || m.title),
          intro,
          note,
          rows: m.rows,
          html: html.rows[0]!.html,
        },
        sms: {
          to: a.contact_mobile,
          on: Boolean(sms && sms.status === 'active' && mobileOk),
          text: fill(sms?.body ?? ''),
        },
        whatsapp: {
          to: a.contact_mobile,
          on: Boolean(wa && wa.status === 'active' && mobileOk),
          text: fill(wa?.body ?? ''),
        },
      };
    });
  }

  /** The offer: the admission fee of the class and category, open for the session's days, mailed. */
  async makeOffer(
    c: PoolClient,
    a: AppRow,
    actorUser: string | null,
    note = 'Admission offered',
    edits?: { subject?: string; intro?: string; note?: string },
  ) {
    const amount = await this.offerFee(c, a);
    const r = await c.query<{ expires: Date }>(
      `UPDATE applications a SET status = 'offered', offered_at = now(), wait_rank = NULL, admission_fee = $2,
              offer_expires_at = now() + make_interval(days => y.offer_days), decided_at = now(), decided_by = $3, updated_at = now()
         FROM admission_cycles y WHERE y.id = a.cycle_id AND a.id = $1 RETURNING a.offer_expires_at AS expires`,
      [a.id, amount.toFixed(2), actorUser],
    );
    await this.core.event(c, a.id, a.status, 'offered', note, { actorUser });
    const m = this.offerMessage(a, amount, ist(r.rows[0]!.expires));
    if (!edits || !(edits.subject || edits.intro || edits.note !== undefined)) {
      await this.notify(c, a, m.code, m.vars, m.title, m.intro, m.rows, m.note);
      return;
    }
    // the email as changed on the preview (docs/design/56); SMS and WhatsApp keep their templates
    const vars = await this.varsOf(c, a, m.vars);
    const fill = (text: string) =>
      Object.entries(vars).reduce(
        (out, [k, v]) => out.split(`{{${k}}}`).join(String(v ?? '')),
        text,
      );
    const mail = await c.query<{ id: string | null }>(
      `SELECT app.admission_mail($1, $2, $3::jsonb, $4, $5, NULL, $6::jsonb, $7)::text AS id`,
      [
        m.code,
        a.contact_email,
        JSON.stringify(vars),
        m.title,
        edits.intro?.trim() ? fill(edits.intro.trim()) : m.intro,
        JSON.stringify(m.rows),
        edits.note !== undefined ? fill(edits.note.trim()) : m.note,
      ],
    );
    const mailId = mail.rows[0]?.id;
    if (mailId && edits.subject?.trim())
      await c.query(`UPDATE comms_messages SET subject = $2 WHERE id = $1`, [
        mailId,
        fill(edits.subject.trim()).slice(0, 200),
      ]);
    if (/^[6-9][0-9]{9}$/.test(a.contact_mobile ?? ''))
      for (const ch of ['sms', 'whatsapp'])
        await c.query(`SELECT app.send_template($1, $2, $3, $4::jsonb)`, [
          m.code,
          ch,
          a.contact_mobile,
          JSON.stringify(vars),
        ]);
  }

  /** One decision at the level the registration waits at (used by the page, slots and selection). */
  async decideWith(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    dto: DecideDto,
    opts: { force?: boolean; note?: string } = {},
  ): Promise<void> {
    const a = await this.core.row(c, id);
    if (!(IN_PROCESS as readonly string[]).includes(a.status) || a.status === 'sent_back')
      throw new DomainError(
        'admissions.not_in_process',
        'This registration is not waiting for a decision',
        { status: 409 },
      );
    const p = await this.processRow(c, id);
    const step = p.steps?.[p.stage_no ?? 0];
    if (!step)
      throw new DomainError(
        'admissions.no_process',
        'No process is set for this class: set one in Admission set-up',
        { status: 409 },
      );
    const levelNo = p.level_no ?? 1;
    const level = step.levels[levelNo - 1];
    if (!opts.force && !(await this.canAct(c, ctx, level)))
      throw new DomainError(
        'permission-denied',
        `Only the people of "${level?.name ?? 'this level'}" decide here`,
        { status: 403 },
      );
    const stage = (await stagesById(c)).get(step.stageId)!;
    const lastLevel = levelNo === step.levels.length;
    const marksStage = stage.kind === 'test' || stage.kind === 'interview';
    if (dto.marks !== undefined && dto.marks !== null && !marksStage)
      throw new DomainError('validation-failed', `${stage.name} takes no marks`, { status: 400 });
    // the class's paper total when it has one (docs/design/57), else the stage's maximum
    const max = marksStage ? await this.classMax(c, stage.id, a.class_id) : null;
    if (dto.marks !== undefined && dto.marks !== null && max !== null && dto.marks > max)
      throw new DomainError('validation-failed', `Marks cannot be more than ${max}`, {
        status: 400,
      });
    // marks entered part by part on Test results (docs/design/57): the decision carries their total,
    // once per stage (another level of the stage that recorded marks keeps them; merit counts them once)
    let marks = dto.marks;
    let attendance = dto.attendance;
    if (dto.parts !== undefined) {
      // marks by part of the class's paper (docs/design/57): kept part by part, the total decided on
      if (!marksStage)
        throw new DomainError('validation-failed', `${stage.name} takes no marks`, { status: 400 });
      const paper = (await papersIn(c, stage.id)).get(a.class_id);
      if (!paper)
        throw new DomainError(
          'validation-failed',
          `${a.class_name} has no paper for ${stage.name}: give one marks figure`,
          { status: 400 },
        );
      checkParts(paper, dto.parts);
      const absent = dto.attendance === 'absent';
      const before = await marksOf(c, id, stage.id);
      const next = Object.fromEntries(
        paper.parts.map((pt) => [
          pt.id,
          dto.parts![pt.id] !== undefined ? dto.parts![pt.id]! : (before?.marks[pt.id] ?? null),
        ]),
      );
      const stored = await storeMarks(
        c,
        ctx.user.id,
        id,
        stage.id,
        paper,
        next,
        absent,
        before?.remark ?? null,
      );
      marks = stored.total;
    } else if (marksStage && dto.marks === undefined) {
      const sm = await c.query<{ total: string | null; absent: boolean; has: boolean }>(
        `SELECT m.total::text, m.absent,
                EXISTS (SELECT 1 FROM admission_stage_results x WHERE x.application_id = m.application_id
                          AND x.stage_id = m.stage_id AND x.level <> $3 AND x.undone_at IS NULL
                          AND x.marks IS NOT NULL) AS has
           FROM admission_stage_marks m WHERE m.application_id = $1 AND m.stage_id = $2`,
        [id, step.stageId, levelNo],
      );
      const x = sm.rows[0];
      if (x && !x.has) {
        marks = x.total !== null ? Number(x.total) : null;
        attendance = attendance ?? (x.absent ? 'absent' : null);
      }
    }
    if ((dto.decision === 'offer' || dto.decision === 'waitlist') && stage.kind !== 'selection')
      throw new DomainError(
        'validation-failed',
        'Offers and the waiting list are made at the Selection stage',
        { status: 400 },
      );
    if (dto.categoryId) {
      if (stage.kind !== 'document_check')
        throw new DomainError(
          'validation-failed',
          'The fee category is confirmed at Document check',
          { status: 400 },
        );
      const k = await c.query<{ name: string }>(
        `SELECT name FROM admission_fee_categories WHERE id = $1 AND status = 'active'`,
        [dto.categoryId],
      );
      if (!k.rows[0])
        throw new DomainError('validation-failed', 'Unknown fee category', { status: 400 });
      if (dto.categoryId !== a.category_id) {
        await c.query(
          `UPDATE applications SET category_id = $2, updated_at = now() WHERE id = $1`,
          [id, dto.categoryId],
        );
        await this.core.event(
          c,
          id,
          a.status,
          a.status === 'registered' ? 'under_review' : a.status,
          `Fee category set to ${k.rows[0].name}`,
          {
            actorUser: ctx.user.id,
          },
        );
      }
    }
    // at a level before the last of Selection, an offer or a place on the list is the level's approval
    const decision =
      dto.decision === 'approve'
        ? 'approved'
        : dto.decision === 'reject'
          ? 'rejected'
          : dto.decision === 'hold'
            ? 'hold'
            : !lastLevel
              ? 'approved'
              : dto.decision === 'offer'
                ? 'offered'
                : 'waitlisted';
    await c.query(
      `INSERT INTO admission_stage_results (school_id, application_id, stage_id, level, decision, attendance, marks, max_marks, remarks, decided_by, decided_by_name)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        step.stageId,
        levelNo,
        decision,
        attendance ?? null,
        marks ?? null,
        marksStage ? max : null,
        dto.remarks ?? null,
        ctx.user.id,
        ctx.user.displayName,
      ],
    );
    const label = `${stage.name}${step.levels.length > 1 ? ` (${level?.name ?? `level ${levelNo}`})` : ''}`;
    const extra = [
      attendance === 'absent' ? 'absent' : null,
      marks !== undefined && marks !== null ? `marks ${marks}${max ? `/${max}` : ''}` : null,
      dto.remarks ? dto.remarks : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const pl = await place(c, id);
    if (decision === 'rejected') {
      await c.query(
        `UPDATE applications SET status = 'rejected', decided_at = now(), decided_by = $2, updated_at = now() WHERE id = $1`,
        [id, ctx.user.id],
      );
      await this.core.event(
        c,
        id,
        a.status,
        'rejected',
        `${label}: not selected${extra ? ` · ${extra}` : ''}`,
        { actorUser: ctx.user.id },
      );
      await this.notify(
        c,
        a,
        'admission_result',
        { result: 'not selected' },
        'Admission result',
        `We regret that ${a.candidate_name ?? 'your ward'} could not be offered admission to ${a.class_name} this time.`,
        [
          ['Candidate', a.candidate_name ?? ''],
          ['Registration no.', a.application_no ?? ''],
          ['Class', a.class_name],
        ],
        'Thank you for your interest in the school.',
      );
      return;
    }
    if (decision === 'waitlisted') {
      await c.query(
        `UPDATE applications SET status = 'waitlisted', updated_at = now(),
                wait_rank = COALESCE((SELECT max(wait_rank) FROM applications WHERE cycle_id = $2 AND class_id = $3 AND status = 'waitlisted'), 0) + 1
          WHERE id = $1`,
        [id, a.cycle_id, a.class_id],
      );
      await this.core.event(
        c,
        id,
        a.status,
        'waitlisted',
        `${label}: on the waiting list${extra ? ` · ${extra}` : ''}${opts.note ? ` · ${opts.note}` : ''}`,
        {
          actorUser: ctx.user.id,
        },
      );
      await this.notify(
        c,
        a,
        'admission_result',
        { result: 'on the waiting list' },
        'On the waiting list',
        `${a.candidate_name ?? 'Your ward'} is on the waiting list for ${a.class_name}. We will write when a seat is offered.`,
        [
          ['Candidate', a.candidate_name ?? ''],
          ['Registration no.', a.application_no ?? ''],
          ['Class', a.class_name],
        ],
        'You do not need to do anything now.',
      );
      return;
    }
    const to = a.status === 'registered' || a.status === 'waitlisted' ? 'under_review' : a.status;
    if (to !== a.status)
      await c.query(
        `UPDATE applications SET status = $2::application_status, wait_rank = NULL, updated_at = now() WHERE id = $1`,
        [id, to],
      );
    const verb = decision === 'hold' ? 'on hold' : decision === 'offered' ? 'offered' : 'approved';
    await this.core.event(
      c,
      id,
      a.status,
      to,
      `${label}: ${verb}${extra ? ` · ${extra}` : ''}${opts.note ? ` · ${opts.note}` : ''}`,
      {
        actorUser: ctx.user.id,
      },
    );
    // every step done: the offer (a process ending at Selection offers there)
    if (pl.done)
      await this.makeOffer(c, await this.core.row(c, id), ctx.user.id, undefined, dto.offerMessage);
  }

  async decide(ctx: RequestContext, id: string, dto: DecideDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.decideWith(c, ctx, id, dto);
      await this.audit.stage(ctx, c, {
        action: `admissions.registration.${dto.decision}`,
        entityType: 'applications',
        entityId: id,
        after: {
          decision: dto.decision,
          marks: dto.marks ?? null,
          categoryId: dto.categoryId ?? null,
        },
      });
    });
    return this.detail(ctx, id);
  }

  /**
   * Waiting for me (docs/design/47): the registrations at a level this user may decide, the oldest
   * first, with how many are past their level's time limit — the header's approvals count reads it.
   */
  async waiting(ctx: RequestContext, q: WaitingQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...(await admissionWaitingFor(c, ctx.user.id))];
      if (!ids.length) return { total: 0, overdue: 0, data: [] };
      const r = await c.query<{
        id: string;
        number: string | null;
        candidate: string | null;
        class_name: string;
        stage: string | null;
        level_no: number;
        levels: number;
        level: Record<string, unknown>;
        level_since: Date | null;
        due_at: Date | null;
      }>(
        `SELECT w.id::text, w.application_no AS number, w.candidate_name AS candidate, cl.name AS class_name,
                st.name AS stage, w.level_no, w.levels, w.level, w.level_since, w.due_at
           FROM admission_waiting w JOIN classes cl ON cl.id = w.class_id
           LEFT JOIN admission_stages st ON st.id = (w.step ->> 'stageId')::bigint
          WHERE w.id = ANY($1::bigint[])
          ORDER BY (w.due_at < now()) DESC NULLS LAST, w.level_since NULLS LAST, w.id`,
        [ids],
      );
      const now = Date.now();
      const names = await levelDeciders(
        c,
        r.rows.slice(0, q.size).map((x) => x.level),
      );
      return {
        total: r.rows.length,
        overdue: r.rows.filter((x) => x.due_at && x.due_at.getTime() < now).length,
        data: r.rows.slice(0, q.size).map((x) => ({
          id: x.id,
          number: x.number,
          candidate: x.candidate,
          className: x.class_name,
          stage: x.stage,
          level:
            x.levels > 1
              ? `${String(x.level.name ?? `Level ${String(x.level_no)}`)} (${String(x.level_no)} of ${String(x.levels)})`
              : null,
          deciders: names.get(JSON.stringify(x.level)) ?? null,
          since: x.level_since?.toISOString() ?? null,
          dueAt: x.due_at?.toISOString() ?? null,
          overdue: Boolean(x.due_at && x.due_at.getTime() < now),
        })),
      };
    });
  }

  /**
   * Bulk decide (docs/design/47, part 3): registrations waiting at the same stage and level approved,
   * rejected or held with one remark — each as if opened (rights, the family's notice, the next level);
   * one that cannot be decided is reported and the others go on.
   */
  async bulkDecide(ctx: RequestContext, dto: BulkDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...new Set(dto.ids)];
      const at = await c.query<{
        id: string;
        number: string | null;
        stage: string;
        level_no: number;
      }>(
        `SELECT id::text, application_no AS number, step ->> 'stageId' AS stage, level_no
           FROM admission_waiting WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      const places = new Set(at.rows.map((x) => `${x.stage}:${String(x.level_no)}`));
      if (places.size > 1)
        throw new DomainError(
          'validation-failed',
          'Tick registrations waiting at the same stage and level to decide them together',
          { status: 400 },
        );
      const byId = new Map(at.rows.map((x) => [x.id, x]));
      const done: string[] = [];
      const failed: Array<{ id: string; number: string | null; reason: string }> = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          failed.push({ id, number: null, reason: 'Not waiting for a decision' });
          continue;
        }
        await c.query('SAVEPOINT bulk_decide');
        try {
          await this.decideWith(c, ctx, id, { decision: dto.decision, remarks: dto.remarks });
          await this.audit.stage(ctx, c, {
            action: `admissions.registration.${dto.decision}`,
            entityType: 'applications',
            entityId: id,
            after: { decision: dto.decision, bulk: true },
          });
          await c.query('RELEASE SAVEPOINT bulk_decide');
          done.push(id);
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT bulk_decide');
          if (!(e instanceof DomainError)) throw e;
          failed.push({ id, number: row.number, reason: e.message });
        }
      }
      return { done: done.length, failed };
    });
  }

  /** Observations sent to the family: only the marked answers open; back to the same level on resubmit. */
  /** The office's correction of the answers before Admit (docs/design/37, case 1b). */
  async officeCorrect(ctx: RequestContext, id: string, dto: OfficeCorrectDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const out = await this.core.officeCorrect(c, a, dto.answers as AdmissionAnswers, dto.reason, {
        maskSecrets: !ctx.permissions?.has('people.sensitive.view'),
      });
      if (Object.keys(out.errors).length)
        throw new DomainError('validation-failed', out.errors._ ?? 'Some answers need attention', {
          status: 400,
          extra: { errors: out.errors },
        });
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.correct',
        entityType: 'applications',
        entityId: id,
        after: { fields: out.changed.map((x) => x.key), reason: dto.reason },
      });
      return { changed: out.changed };
    });
  }

  /** The merit points of a registration as the office sees them (docs/design/40). */
  private async pointsOf(c: PoolClient, id: string) {
    const r = await c.query<{
      form_points: string | null;
      lines: PointLine[] | null;
      confirmed_at: Date | null;
      confirmed_by: string | null;
    }>(
      `SELECT a.form_points::text, a.points_breakdown AS lines, a.points_confirmed_at AS confirmed_at, u.display_name AS confirmed_by
         FROM applications a LEFT JOIN users u ON u.id = a.points_confirmed_by WHERE a.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x?.lines) return null;
    const app = await this.core.row(c, id);
    return {
      total: Number(x.form_points ?? 0),
      max: await classPointsMax(c, app.cycle_id, app.class_id),
      lines: x.lines,
      confirmedAt: x.confirmed_at?.toISOString() ?? null,
      confirmedBy: x.confirmed_by,
    };
  }

  /**
   * The office confirms the merit points at Document check, awarding a criterion differently with a
   * reason; confirmed points no longer follow criteria changes. "Recalculate" works them out again.
   */
  async checkPoints(ctx: RequestContext, id: string, dto: PointsCheckDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      if (['draft', 'admitted', 'cancelled', 'withdrawn'].includes(a.status))
        throw new DomainError(
          'admissions.points_closed',
          'Points can be checked on a submitted registration that is not admitted, cancelled or withdrawn',
          { status: 409 },
        );
      if (dto.action === 'recalculate') {
        await c.query(
          `UPDATE applications SET points_confirmed_at = NULL, points_confirmed_by = NULL WHERE id = $1`,
          [id],
        );
        await this.core.refreshPoints(c, id);
        const now = await this.pointsOf(c, id);
        await this.note(c, a, `Merit points worked out again: ${String(now?.total ?? 0)}`);
        await this.audit.stage(ctx, c, {
          action: 'admissions.application.points',
          entityType: 'applications',
          entityId: id,
          after: { recalculated: now?.total ?? null },
        });
        return now;
      }
      const have = await this.pointsOf(c, id);
      if (!have)
        throw new DomainError(
          'admissions.no_points',
          'The class of this registration has no merit points',
          { status: 409 },
        );
      const lines = have.lines.map((l) => ({ ...l }));
      const errors: string[] = [];
      for (const d of dto.lines) {
        const l = lines.find((x) => x.name === d.name);
        if (!l) {
          errors.push(`${d.name} is not a criterion of this registration`);
          continue;
        }
        l.points = d.points;
        l.reason = d.points !== l.auto ? (d.reason ?? '').trim() || null : null;
        if (d.points !== l.auto && (l.reason ?? '').length < 3)
          errors.push(`${l.name}: give the reason for awarding ${String(d.points)}`);
      }
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('. '), { status: 400 });
      const total = pointsTotal(lines, await classPointsMax(c, a.cycle_id, a.class_id));
      await c.query(
        `UPDATE applications SET form_points = $2, points_breakdown = $3::jsonb, points_confirmed_at = now(),
                points_confirmed_by = app.current_user_id() WHERE id = $1`,
        [id, total.toFixed(2), JSON.stringify(lines)],
      );
      await refreshMerit(c, id);
      const changed = lines.filter((l) => l.points !== l.auto);
      await this.note(
        c,
        a,
        `Merit points confirmed: ${String(total)}${changed.length ? ` (${changed.map((l) => `${l.name} ${String(l.points)} instead of ${String(l.auto)}: ${l.reason ?? ''}`).join('; ')})` : ''}`,
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.points',
        entityType: 'applications',
        entityId: id,
        before: { total: have.total },
        after: {
          total,
          changed: changed.map((l) => ({
            name: l.name,
            auto: l.auto,
            points: l.points,
            reason: l.reason,
          })),
        },
      });
      return this.pointsOf(c, id);
    });
  }

  /** A line in the registration's history without a change of status. */
  private async note(c: PoolClient, a: AppRow, text: string) {
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
       VALUES (app.current_school_id(), $1, $2::application_status, $2::application_status, $3, app.current_user_id())`,
      [a.id, a.status, text.slice(0, 500)],
    );
  }

  async sendBack(ctx: RequestContext, id: string, dto: SendBackDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      if (!['registered', 'under_review'].includes(a.status))
        throw new DomainError(
          'admissions.not_in_process',
          'Only a registration under review can be sent back',
          { status: 409 },
        );
      const p = await this.processRow(c, id);
      const step = p.steps?.[p.stage_no ?? 0];
      const level = step?.levels[(p.level_no ?? 1) - 1];
      if (!(await this.canAct(c, ctx, level)))
        throw new DomainError(
          'permission-denied',
          `Only the people of "${level?.name ?? 'this level'}" decide here`,
          { status: 403 },
        );
      const def = await this.core.defOf(c, a);
      const known = new Map(
        def.fields.filter((f) => !LAYOUT_TYPES.includes(f.type)).map((f) => [f.key, f.label]),
      );
      const bad = dto.fields.filter((f) => !known.has(f));
      if (bad.length)
        throw new DomainError('validation-failed', `Unknown fields: ${bad.join(', ')}`, {
          status: 400,
        });
      await c.query(
        `UPDATE admission_corrections SET status = 'cancelled' WHERE application_id = $1 AND status = 'open'`,
        [id],
      );
      await c.query(
        `INSERT INTO admission_corrections (school_id, application_id, stage_id, level, fields, remark, due_on, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          step?.stageId ?? null,
          p.level_no ?? 1,
          dto.fields,
          dto.remark,
          dto.dueOn ?? null,
          ctx.user.id,
        ],
      );
      await c.query(
        `UPDATE applications SET status = 'sent_back', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.core.event(
        c,
        id,
        a.status,
        'sent_back',
        `Sent to the family for correction: ${dto.remark}`,
        { actorUser: ctx.user.id },
      );
      const due = dto.dueOn ? ist(new Date(`${dto.dueOn}T00:00:00+05:30`)) : 'soon';
      await this.notify(
        c,
        a,
        'admission_correction',
        { due, remark: dto.remark },
        'Please correct the registration form',
        `The school asks you to correct the registration form of ${a.candidate_name ?? 'your ward'}.`,
        [
          ['Registration no.', a.application_no ?? ''],
          ['What to correct', dto.fields.map((f) => known.get(f) ?? f).join(', ')],
          ['Remark', dto.remark],
          ['Correct by', due],
        ],
        'Sign in to the admission portal: only the marked answers can be changed. Submit again when done.',
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.registration.send_back',
        entityType: 'applications',
        entityId: id,
        after: { fields: dto.fields, dueOn: dto.dueOn ?? null },
      });
    });
    return this.detail(ctx, id);
  }

  /** Undo the last decision, or go back to an earlier step (every decision from it undone), with a reason. */
  async undo(ctx: RequestContext, id: string, dto: UndoDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      if (!['registered', 'under_review', 'rejected', 'waitlisted', 'offered'].includes(a.status))
        throw new DomainError(
          'admissions.cannot_undo',
          'Decisions cannot be undone at this stage of the admission',
          { status: 409 },
        );
      // parts of the admission fee are paid (docs/design/53): cancel with a refund instead
      if ((await this.core.admissionPaid(c, id)).paid > 0)
        throw new DomainError(
          'admissions.cannot_undo',
          'Part of the admission fee is paid: cancel the registration (the parts are refunded) instead of undoing the selection',
          { status: 409 },
        );
      const p = await this.processRow(c, id);
      const admin = ctx.permissions?.has(ADMISSION_SETUP_MANAGE);
      let ids: string[];
      if (dto.toStep !== undefined) {
        if (!admin)
          throw new DomainError(
            'permission-denied',
            'Only admission set-up managers move a registration back',
            { status: 403 },
          );
        const back = (p.steps ?? []).slice(dto.toStep).map((s) => s.stageId);
        const r = await c.query<{ id: string }>(
          `SELECT id::text FROM admission_stage_results WHERE application_id = $1 AND undone_at IS NULL AND stage_id = ANY($2::bigint[])`,
          [id, back],
        );
        ids = r.rows.map((x) => x.id);
      } else {
        const r = await c.query<{ id: string; decided_by: string | null }>(
          `SELECT id::text, decided_by::text FROM admission_stage_results WHERE application_id = $1 AND undone_at IS NULL
            ORDER BY decided_at DESC, id DESC LIMIT 1`,
          [id],
        );
        if (r.rows[0] && !admin && r.rows[0].decided_by !== ctx.user.id)
          throw new DomainError(
            'permission-denied',
            'Only the person who decided (or a set-up manager) undoes it',
            { status: 403 },
          );
        ids = r.rows.map((x) => x.id);
      }
      if (!ids.length)
        throw new DomainError('admissions.cannot_undo', 'There is no decision to undo', {
          status: 409,
        });
      await c.query(
        `UPDATE admission_stage_results SET undone_at = now(), undone_by = $2, undo_reason = $3 WHERE id = ANY($1::bigint[])`,
        [ids, ctx.user.id, dto.reason],
      );
      await c.query(
        `UPDATE applications SET status = 'under_review', wait_rank = NULL, offered_at = NULL, offer_expires_at = NULL, admission_fee = NULL,
                decided_at = NULL, decided_by = NULL, updated_at = now() WHERE id = $1`,
        [id],
      );
      await place(c, id);
      await this.core.event(
        c,
        id,
        a.status,
        'under_review',
        `${dto.toStep !== undefined ? `Moved back to step ${dto.toStep + 1}` : 'Last decision undone'}: ${dto.reason}`,
        { actorUser: ctx.user.id },
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.registration.undo',
        entityType: 'applications',
        entityId: id,
        before: { status: a.status },
        after: { undone: ids.length, toStep: dto.toStep ?? null, reason: dto.reason },
      });
    });
    return this.detail(ctx, id);
  }
}
