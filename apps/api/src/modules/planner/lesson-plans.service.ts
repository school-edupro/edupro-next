import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type { CreateLessonPlanDto, ListLessonPlansDto, UpdateLessonPlanDto } from './planner.dto';

export interface LessonPlanRow {
  id: string;
  employeeId: string;
  teacher: string;
  classSectionId: string;
  section: string;
  subjectId: string;
  subject: string;
  weekStart: string;
  title: string;
  objectives: string | null;
  topics: Array<{
    day: number;
    topic: string;
    activities?: string;
    resources?: string;
    homework?: string;
    topicId?: string;
  }>;
  assessment: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'returned';
  workflowInstanceId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  updatedAt: string;
}

const SELECT = `SELECT lp.id::text, lp.employee_id::text, e.display_name AS teacher, lp.class_section_id::text, k.code || '-' || cs.name AS section, lp.subject_id::text, s.name AS subject,
        lp.week_start::text, lp.title, lp.objectives, lp.topics, lp.assessment, lp.status::text, lp.workflow_instance_id::text, lp.submitted_at, lp.decided_at, lp.decision_note, lp.updated_at
   FROM lesson_plans lp JOIN employees e ON e.id = lp.employee_id JOIN class_sections cs ON cs.id = lp.class_section_id JOIN classes k ON k.id = cs.class_id JOIN subjects s ON s.id = lp.subject_id`;

/**
 * Lesson planner (S11): a teacher writes a weekly plan per section and subject, submits it into the
 * `lesson_plan_approval` workflow (coordinator → vice principal → principal), and sees the decision.
 */
@Injectable()
export class LessonPlansService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly workflow: WorkflowService,
  ) {}

  async list(ctx: RequestContext, q: ListLessonPlansDto) {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, 'academics.lesson_plan.view');
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [];
      const where: string[] = ['lp.deleted_at IS NULL'];
      if (v.kind === 'staff' && v.sectionIds) {
        params.push(v.sectionIds);
        where.push(`lp.class_section_id = ANY($${params.length}::bigint[])`);
      }
      if (q.status) {
        params.push(q.status);
        where.push(`lp.status = $${params.length}::lesson_plan_status`);
      }
      if (q.classSectionId) {
        params.push(q.classSectionId);
        where.push(`lp.class_section_id = $${params.length}`);
      }
      if (q.employeeId) {
        params.push(q.employeeId);
        where.push(`lp.employee_id = $${params.length}`);
      }
      if (q.weekStart) {
        params.push(q.weekStart);
        where.push(`lp.week_start = $${params.length}::date`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql holds fixed fragments with numbered placeholders; values are bound parameters
        `SELECT count(*)::text AS n FROM lesson_plans lp WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY lp.week_start DESC, lp.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: r.rows.map(toRow),
        page: { number: q.page, size: q.size, total: Number(total.rows[0]!.n) },
      };
    });
  }

  /** The signed-in teacher's own plans. */
  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${SELECT} WHERE lp.deleted_at IS NULL AND e.user_id = app.current_user_id() ORDER BY lp.week_start DESC LIMIT 100`,
      );
      return { data: r.rows.map(toRow) };
    });
  }

  async get(ctx: RequestContext, id: string): Promise<LessonPlanRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
  }

  async create(ctx: RequestContext, dto: CreateLessonPlanDto): Promise<LessonPlanRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, 'academics.lesson_plan.manage');
    if (!v.employeeId)
      throw new DomainError(
        'planner.not_staff',
        'Only staff with an employee record write lesson plans',
        { status: 409 },
      );
    if (v.sectionIds && !v.sectionIds.includes(dto.classSectionId))
      throw new DomainError('scope-denied', 'This section is outside your assigned scope', {
        status: 403,
      });
    return this.db.tenant(tenant, async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO lesson_plans (school_id, academic_year_id, employee_id, class_section_id, subject_id, week_start, title, objectives, topics, assessment, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8::jsonb, $9, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            yearId,
            v.employeeId,
            dto.classSectionId,
            dto.subjectId,
            dto.weekStart,
            dto.title,
            dto.objectives ?? null,
            JSON.stringify(dto.topics),
            dto.assessment ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505')
          throw new DomainError(
            'planner.duplicate',
            'A plan for this section, subject and week already exists',
            { status: 409 },
          );
        if (code === '23514')
          throw new DomainError('planner.week_start', 'weekStart must be a Monday', {
            status: 422,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'planner.plan.create',
        entityType: 'lesson_plans',
        entityId: id,
        after: { title: dto.title, weekStart: dto.weekStart, sectionId: dto.classSectionId },
      });
      if (dto.submit) await this.submitWith(c, ctx, id);
      return this.find(c, id);
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateLessonPlanDto): Promise<LessonPlanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      await this.assertOwner(c, before);
      if (!['draft', 'returned', 'rejected'].includes(before.status))
        throw new DomainError('planner.locked', `A ${before.status} plan cannot be edited`, {
          status: 409,
        });
      await c.query(
        `UPDATE lesson_plans SET title = COALESCE($2, title), objectives = COALESCE($3, objectives), topics = COALESCE($4::jsonb, topics), assessment = COALESCE($5, assessment), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [
          id,
          dto.title ?? null,
          dto.objectives ?? null,
          dto.topics ? JSON.stringify(dto.topics) : null,
          dto.assessment ?? null,
        ],
      );
      if (dto.submit) await this.submitWith(c, ctx, id);
      await this.audit.stage(ctx, c, {
        action: 'planner.plan.update',
        entityType: 'lesson_plans',
        entityId: id,
        after: { submit: !!dto.submit },
      });
      return this.find(c, id);
    });
  }

  async submit(ctx: RequestContext, id: string): Promise<LessonPlanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      await this.assertOwner(c, before);
      await this.submitWith(c, ctx, id);
      return this.find(c, id);
    });
  }

  private async submitWith(c: PoolClient, ctx: RequestContext, id: string) {
    const plan = await this.find(c, id);
    if (!['draft', 'returned', 'rejected'].includes(plan.status))
      throw new DomainError(
        'planner.already_submitted',
        'The plan is already under approval or decided',
        { status: 409 },
      );
    if (plan.topics.length === 0)
      throw new DomainError('planner.empty', 'Add at least one day’s topic before submitting', {
        status: 422,
      });
    const instance = await this.workflow.start(c, ctx, {
      definitionCode: 'lesson_plan_approval',
      entityType: 'lesson_plan',
      entityId: id,
      subject: `${plan.title} · ${plan.section} · ${plan.subject} · week of ${plan.weekStart}`,
      payload: { employeeId: plan.employeeId, classSectionId: plan.classSectionId },
    });
    await c.query(
      `UPDATE lesson_plans SET status = 'submitted', workflow_instance_id = $2, submitted_at = now(), decision_note = NULL, updated_at = now() WHERE id = $1`,
      [id, instance.id],
    );
    await this.audit.stage(ctx, c, {
      action: 'planner.plan.submit',
      entityType: 'lesson_plans',
      entityId: id,
      after: { workflowInstanceId: instance.id },
    });
  }

  /** Workflow completion: the last level decides; a rejection returns the plan to the teacher for changes. */
  async onDecision(
    c: PoolClient,
    _ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending')
        .map((s) => s.note)
        .filter(Boolean)
        .join(' · ') || null;
    await c.query(
      `UPDATE lesson_plans SET status = $2::lesson_plan_status, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $1 AND status = 'submitted'`,
      [instance.entityId, outcome === 'approved' ? 'approved' : 'returned', note],
    );
  }

  private async assertOwner(c: PoolClient, plan: LessonPlanRow) {
    const r = await c.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM employees WHERE id = $1 AND user_id = app.current_user_id()) AS ok`,
      [plan.employeeId],
    );
    if (!r.rows[0]?.ok)
      throw new DomainError('planner.not_owner', 'Only the plan’s author edits or submits it', {
        status: 403,
      });
  }

  private async find(c: PoolClient, id: string): Promise<LessonPlanRow> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${SELECT} WHERE lp.id = $1 AND lp.deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Lesson plan not found', { status: 404 });
    return toRow(r.rows[0]);
  }
}

const toRow = (x: Record<string, unknown>): LessonPlanRow => {
  const d = (k: string) => (x[k] ? (x[k] as Date).toISOString() : null);
  return {
    id: x.id as string,
    employeeId: x.employee_id as string,
    teacher: x.teacher as string,
    classSectionId: x.class_section_id as string,
    section: x.section as string,
    subjectId: x.subject_id as string,
    subject: x.subject as string,
    weekStart: x.week_start as string,
    title: x.title as string,
    objectives: (x.objectives as string) ?? null,
    topics: (x.topics as LessonPlanRow['topics']) ?? [],
    assessment: (x.assessment as string) ?? null,
    status: x.status as LessonPlanRow['status'],
    workflowInstanceId: (x.workflow_instance_id as string) ?? null,
    submittedAt: d('submitted_at'),
    decidedAt: d('decided_at'),
    decisionNote: (x.decision_note as string) ?? null,
    updatedAt: d('updated_at')!,
  };
};
