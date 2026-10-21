import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { loadEmployeeLists } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PushService } from '../comms/push.service';
import { WAITING_WITH } from '../fees/fee-approval';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type {
  RecruitmentStagesDto,
  VacancyDto,
  VacancyListDto,
  VacancyNoteDto,
  VacancyPublishDto,
} from './recruitment.dto';
import { RecruitmentApprovalService, VACANCY_FLOW } from './recruitment-approval.service';
import { PEOPLE } from './people.permissions';
import { vacancyPosterPdf } from './vacancy-poster';
import { qrPng } from '../engagement/visitor-card';

export { VACANCY_FLOW } from './recruitment-approval.service';

/** A moment as people in the school read it: 30-10-2026, 5:00 pm (India time). */
export const istText = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(d)
    .replace(/\//g, '-')
    .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);

type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'closed' | 'cancelled';
interface VacancyRow {
  id: string;
  code: string;
  title: string;
  designation: string | null;
  department: string | null;
  subject: string | null;
  employee_type: string | null;
  campus_id: string | null;
  campus: string | null;
  posts: number;
  qualification: string | null;
  experience: string | null;
  pay_band: string | null;
  description: string | null;
  stage_ids: string[];
  status: Status;
  opens_at: Date | null;
  closes_at: Date | null;
  workflow_instance_id: string | null;
  decision_note: string | null;
  raised_by: string | null;
  raised_by_name: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  published_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  waiting_with: string | null;
}

// eslint-disable-next-line no-restricted-syntax -- a fixed fragment (who an approval waits with)
const VACANCY_COLS = `SELECT v.id::text, v.code, v.title, v.designation, v.department, v.subject, v.employee_type,
       v.campus_id::text, cp.name AS campus, v.posts, v.qualification, v.experience, v.pay_band, v.description,
       v.stage_ids::text[] AS stage_ids, v.status, v.opens_at, v.closes_at, v.workflow_instance_id::text,
       v.decision_note, v.raised_by::text, v.raised_by_name, v.submitted_at, v.decided_at, v.published_at, v.closed_at,
       v.created_at, ${WAITING_WITH('v.workflow_instance_id')} AS waiting_with
  FROM vacancies v LEFT JOIN campuses cp ON cp.id = v.campus_id`;

/** The stages a school starts with; it renames, reorders, adds or switches them off. */
const STARTER_STAGES: Array<{ name: string; kind: string; maxMarks: number | null }> = [
  { name: 'Shortlisting', kind: 'shortlist', maxMarks: null },
  { name: 'Written test', kind: 'test', maxMarks: 50 },
  { name: 'Demo class', kind: 'test', maxMarks: 20 },
  { name: 'Interview', kind: 'interview', maxMarks: 30 },
  { name: 'Final round', kind: 'final', maxMarks: null },
];

/**
 * Recruitment, part 1 (docs/design/34-recruitment.md): vacancies raised by the office or an HOD, approved
 * through the levels set in Recruitment set-up (workflow "vacancy_approval", one level, the Principal,
 * until the school changes it; part 5), published on the careers page from one minute to another,
 * closed or cancelled; the school's screening stages, from which each vacancy picks the ones it uses.
 */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly approval: RecruitmentApprovalService,
    private readonly push: PushService,
  ) {}

  private can(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }

  private async seedStages(c: PoolClient) {
    const n = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM recruitment_stages');
    if (n.rows[0]!.n) return;
    for (const [i, s] of STARTER_STAGES.entries())
      await c.query(
        `INSERT INTO recruitment_stages (school_id, name, kind, max_marks, sort_order)
         VALUES (app.current_school_id(), $1, $2, $3, $4)`,
        [s.name, s.kind, s.maxMarks, (i + 1) * 10],
      );
  }

  private async event(c: PoolClient, ctx: RequestContext, id: string, what: string, note?: string) {
    await c.query(
      `INSERT INTO vacancy_events (school_id, vacancy_id, what, note, by_user, by_name)
       VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4)`,
      [id, what, note ?? null, ctx.user.displayName],
    );
  }

  private stagesOf(c: PoolClient) {
    return c.query<{
      id: string;
      name: string;
      kind: string;
      max_marks: string | null;
      sort_order: number;
      active: boolean;
      email_scheduled: boolean;
      email_result: boolean;
    }>(
      `SELECT id::text, name, kind, max_marks::text, sort_order, active, email_scheduled, email_result
         FROM recruitment_stages ORDER BY sort_order, id`,
    );
  }

  /** The set-up: the stage list and what the vacancy form picks from. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seedStages(c);
      await c.query(`SELECT app.staff_masters_seed(app.current_school_id())`);
      const [stages, lists, subjects, campuses] = await Promise.all([
        this.stagesOf(c),
        loadEmployeeLists(c),
        c.query<{ name: string }>(
          `SELECT DISTINCT name FROM subjects WHERE deleted_at IS NULL AND status = 'active' ORDER BY name LIMIT 500`,
        ),
        c.query<{ id: string; name: string }>(
          `SELECT id::text, name FROM campuses WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`,
        ),
      ]);
      return {
        stages: stages.rows.map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          maxMarks: x.max_marks === null ? null : Number(x.max_marks),
          active: x.active,
          emailScheduled: x.email_scheduled,
          emailResult: x.email_result,
        })),
        departments: lists.Department ?? [],
        designations: lists.Designation ?? [],
        employeeTypes: lists.EmployeeType ?? [],
        subjects: subjects.rows.map((x) => x.name),
        campuses: campuses.rows,
        can: {
          raise: this.can(ctx, PEOPLE.recruitmentRaise),
          manage: this.can(ctx, PEOPLE.recruitmentManage),
        },
      };
    });
  }

  /** The stage list, saved at once: a stage with an id changes, new ones are added, the rest switch off. */
  async saveStages(ctx: RequestContext, dto: RecruitmentStagesDto) {
    const names = dto.stages.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length)
      throw new DomainError('validation-failed', 'Each stage needs its own name', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seedStages(c);
      const keep: string[] = [];
      // names are unique: move the ones kept out of the way before renaming
      await c.query(`UPDATE recruitment_stages SET name = name || ' ·' || id::text`);
      for (const [i, s] of dto.stages.entries()) {
        const order = (i + 1) * 10;
        if (s.id) {
          const u = await c.query(
            `UPDATE recruitment_stages SET name = $2, kind = $3, max_marks = $4, sort_order = $5, active = $6,
                    email_scheduled = $7, email_result = $8 WHERE id = $1`,
            [
              s.id,
              s.name,
              s.kind,
              s.maxMarks ?? null,
              order,
              s.active,
              s.emailScheduled,
              s.emailResult,
            ],
          );
          if (u.rowCount) {
            keep.push(s.id);
            continue;
          }
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO recruitment_stages (school_id, name, kind, max_marks, sort_order, active, email_scheduled, email_result)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
          [s.name, s.kind, s.maxMarks ?? null, order, s.active, s.emailScheduled, s.emailResult],
        );
        keep.push(r.rows[0]!.id);
      }
      // stages left out switch off; their names come back
      await c.query(
        `UPDATE recruitment_stages SET active = false, name = regexp_replace(name, ' ·[0-9]+$', '')
          WHERE NOT (id = ANY($1::bigint[]))`,
        [keep],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.stages',
        entityType: 'recruitment_stages',
        entityId: requireTenant(ctx).schoolId,
        after: { stages: keep.length },
      });
      return { saved: keep.length };
    });
  }

  private async load(c: PoolClient, id: string): Promise<VacancyRow> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
    // eslint-disable-next-line no-restricted-syntax -- a fixed fragment; the id is bound
    const r = await c.query<VacancyRow>(`${VACANCY_COLS} WHERE v.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
    return r.rows[0];
  }

  private out(v: VacancyRow, stageName: Map<string, string>) {
    return {
      id: v.id,
      code: v.code,
      title: v.title,
      designation: v.designation,
      department: v.department,
      subject: v.subject,
      employeeType: v.employee_type,
      campusId: v.campus_id,
      campus: v.campus,
      posts: v.posts,
      qualification: v.qualification,
      experience: v.experience,
      payBand: v.pay_band,
      description: v.description,
      stageIds: v.stage_ids,
      stages: v.stage_ids.map((x) => stageName.get(x) ?? '').filter(Boolean),
      status: v.status,
      opensAt: v.opens_at?.toISOString() ?? null,
      closesAt: v.closes_at?.toISOString() ?? null,
      waitingWith: v.status === 'pending' ? v.waiting_with : null,
      decisionNote: v.decision_note,
      raisedBy: v.raised_by_name,
      submittedAt: v.submitted_at?.toISOString() ?? null,
      decidedAt: v.decided_at?.toISOString() ?? null,
      publishedAt: v.published_at?.toISOString() ?? null,
      closedAt: v.closed_at?.toISOString() ?? null,
      createdAt: v.created_at.toISOString(),
    };
  }

  async list(ctx: RequestContext, q: VacancyListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seedStages(c);
      await this.closeLapsed(c);
      // the vacancies waiting for approval follow the set-up and the records as they are now
      await this.approval.followSetup(c, ctx);
      const stages = await this.stagesOf(c);
      const stageName = new Map(stages.rows.map((x) => [x.id, x.name]));
      const rows = await c.query<VacancyRow>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed fragment; the filter is bound
        `${VACANCY_COLS} WHERE ($1::text IS NULL OR v.status = $1) ORDER BY v.created_at DESC, v.id DESC`,
        [q.status ?? null],
      );
      const counts = await c.query<{ status: Status; n: number }>(
        `SELECT status, count(*)::int AS n FROM vacancies GROUP BY status`,
      );
      return {
        data: rows.rows.map((v) => this.out(v, stageName)),
        counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])),
      };
    });
  }

  /** Published vacancies past their last date and time close by themselves. */
  private async closeLapsed(c: PoolClient) {
    await c.query(
      `UPDATE vacancies SET status = 'closed', closed_at = closes_at, updated_at = now()
        WHERE status = 'published' AND closes_at <= now()`,
    );
  }

  /** The careers page of the school, or of one vacancy on it. */
  private async careersUrl(c: PoolClient, base: string, id?: string) {
    const r = await c.query<{ code: string }>(
      `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
    );
    return `${base.replace(/\/$/, '')}/${r.rows[0]!.code}/careers${id ? `/${id}` : ''}`;
  }

  /**
   * One vacancy with its steps and approval, and what the signed-in person may do. Its approvers open
   * it without the recruitment rights (to decide on it).
   */
  async view(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const viewer = this.can(ctx, PEOPLE.recruitmentView);
      if (!/^\d{1,18}$/.test(id) || (!viewer && !(await this.approval.takesPart(c, id))))
        throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
      await this.closeLapsed(c);
      let v = await this.load(c, id);
      if (v.status === 'pending') {
        await this.approval.followSetup(c, ctx);
        v = await this.load(c, id);
      }
      const stages = await this.stagesOf(c);
      const stageName = new Map(stages.rows.map((x) => [x.id, x.name]));
      const events = await c.query<{
        at: Date;
        what: string;
        note: string | null;
        by_name: string | null;
      }>(
        `SELECT at, what, note, by_name FROM vacancy_events WHERE vacancy_id = $1 ORDER BY at, id`,
        [id],
      );
      const editable = v.status === 'draft' || v.status === 'rejected';
      const raise = this.can(ctx, PEOPLE.recruitmentRaise);
      const manage = this.can(ctx, PEOPLE.recruitmentManage);
      const instance = v.workflow_instance_id
        ? await this.workflow.instanceWith(c, v.workflow_instance_id)
        : null;
      const mine =
        v.status === 'pending' ? await this.approval.myStep(c, v.workflow_instance_id) : null;
      return {
        ...this.out(v, stageName),
        events: events.rows.map((e) => ({ ...e, at: e.at.toISOString() })),
        approval: instance
          ? {
              status: instance.status,
              steps: instance.steps.map((s) => ({
                level: s.level,
                name: s.name,
                status: s.status,
                people: s.assignees.map((a) => a.name),
                actedBy: s.actedBy,
                actedAt: s.actedAt,
                note: s.note,
                current:
                  instance.status === 'pending' &&
                  s.level === instance.currentLevel &&
                  s.status === 'pending',
                overdue: s.overdue,
              })),
            }
          : null,
        share:
          viewer && v.status === 'published'
            ? {
                url: await this.careersUrl(c, base, v.id),
                open: (v.opens_at?.getTime() ?? 0) <= Date.now(),
              }
            : null,
        can: {
          view: viewer,
          edit: editable && (raise || manage),
          submit: editable && (raise || manage),
          publish: manage && ['approved', 'closed', 'published'].includes(v.status),
          close: manage && v.status === 'published',
          cancel: manage && !['closed', 'cancelled'].includes(v.status),
          approve: mine !== null,
        },
      };
    });
  }

  /** Checks the stages named are the school's and active; keeps them in the school's order. */
  private async checkStages(c: PoolClient, ids: string[]) {
    if (!ids.length) return [];
    const ok = await c.query<{ id: string }>(
      `SELECT id::text FROM recruitment_stages WHERE id = ANY($1::bigint[]) AND active ORDER BY sort_order, id`,
      [ids],
    );
    if (ok.rows.length !== new Set(ids).size)
      throw new DomainError('validation-failed', 'A stage named is not in the set-up', {
        status: 400,
      });
    return ok.rows.map((x) => x.id);
  }

  private async nextCode(c: PoolClient) {
    const y = new Date().getFullYear();
    const r = await c.query<{ n: number }>(
      `SELECT COALESCE(max(substring(code FROM '([0-9]+)$')::int), 0) + 1 AS n FROM vacancies WHERE code LIKE $1`,
      [`VAC-${String(y)}-%`],
    );
    return `VAC-${String(y)}-${String(r.rows[0]!.n).padStart(3, '0')}`;
  }

  async create(ctx: RequestContext, dto: VacancyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seedStages(c);
      const stageIds = await this.checkStages(c, dto.stageIds);
      const r = await c.query<{ id: string }>(
        `INSERT INTO vacancies (school_id, code, title, designation, department, subject, employee_type, campus_id, posts,
                                qualification, experience, pay_band, description, stage_ids, raised_by, raised_by_name)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::bigint[],
                 app.current_user_id(), $14) RETURNING id::text`,
        [
          await this.nextCode(c),
          dto.title,
          dto.designation ?? null,
          dto.department ?? null,
          dto.subject ?? null,
          dto.employeeType ?? null,
          dto.campusId ?? null,
          dto.posts,
          dto.qualification ?? null,
          dto.experience ?? null,
          dto.payBand ?? null,
          dto.description ?? null,
          stageIds,
          ctx.user.displayName,
        ],
      );
      const id = r.rows[0]!.id;
      await this.event(c, ctx, id, 'raised');
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.vacancy.create',
        entityType: 'vacancies',
        entityId: id,
      });
      return { id };
    });
  }

  async update(ctx: RequestContext, id: string, dto: VacancyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, id);
      if (v.status !== 'draft' && v.status !== 'rejected')
        throw new DomainError(
          'recruitment.not_editable',
          'Only a draft or a vacancy sent back can be changed',
          { status: 409 },
        );
      const stageIds = await this.checkStages(c, dto.stageIds);
      await c.query(
        `UPDATE vacancies SET title = $2, designation = $3, department = $4, subject = $5, employee_type = $6,
                campus_id = $7, posts = $8, qualification = $9, experience = $10, pay_band = $11, description = $12,
                stage_ids = $13::bigint[], updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.title,
          dto.designation ?? null,
          dto.department ?? null,
          dto.subject ?? null,
          dto.employeeType ?? null,
          dto.campusId ?? null,
          dto.posts,
          dto.qualification ?? null,
          dto.experience ?? null,
          dto.payBand ?? null,
          dto.description ?? null,
          stageIds,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.vacancy.update',
        entityType: 'vacancies',
        entityId: id,
      });
      return { id };
    });
  }

  /**
   * Sends the vacancy for approval through the school's levels. A school that has not set them gets one
   * level, the Principal; the levels are changed under Workflow like any other approval.
   */
  async submit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, id);
      if (v.status !== 'draft' && v.status !== 'rejected')
        throw new DomainError('recruitment.not_editable', 'The vacancy is already sent', {
          status: 409,
        });
      if (!v.stage_ids.length)
        throw new DomainError(
          'validation-failed',
          'Tick the screening stages this vacancy uses before sending it',
          { status: 400 },
        );
      await this.approval.ensureFlow(c);
      const instance = await this.workflow
        .start(c, ctx, {
          definitionCode: VACANCY_FLOW.code,
          entityType: VACANCY_FLOW.entityType,
          entityId: id,
          subject: `Vacancy ${v.code} · ${v.title}${v.department ? ` · ${v.department}` : ''} · ${String(v.posts)} post${v.posts > 1 ? 's' : ''}`,
          payload: { department: v.department },
        })
        .catch((e: unknown) => {
          if (e instanceof DomainError && e.type === 'workflow.no_assignee')
            throw new DomainError(
              'recruitment.no_approver',
              'Nobody is set to approve vacancies: set the approval levels in Recruitment set-up',
              { status: 409 },
            );
          throw e;
        });
      // every level was the raiser's own: approved as it is sent
      const status = instance.status === 'approved' ? 'approved' : 'pending';
      await c.query(
        `UPDATE vacancies SET status = $3, workflow_instance_id = $2, submitted_at = now(), decision_note = NULL,
                decided_at = CASE WHEN $3 = 'approved' THEN now() END, updated_at = now() WHERE id = $1`,
        [id, instance.id, status],
      );
      await this.event(c, ctx, id, 'submitted');
      if (status === 'approved')
        await this.event(
          c,
          ctx,
          id,
          'approved',
          'Raised by its approver: no other level to wait for',
        );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.vacancy.submit',
        entityType: 'vacancies',
        entityId: id,
        after: { workflowInstanceId: instance.id, status },
      });
      return { status };
    });
  }

  /** The last level decided: approved, or sent back with the approvers' notes. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending')
        .map((s) => s.note)
        .filter(Boolean)
        .join(' · ') || null;
    const u = await c.query<{ raised_by: string | null; code: string; title: string }>(
      `UPDATE vacancies SET status = $2, decided_at = now(), decision_note = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING raised_by::text, code, title`,
      [instance.entityId, outcome === 'approved' ? 'approved' : 'rejected', note],
    );
    const v = u.rows[0];
    if (!v) return;
    await this.event(
      c,
      ctx,
      instance.entityId,
      outcome === 'approved' ? 'approved' : 'sent_back',
      note ?? undefined,
    );
    // the person who raised it hears the outcome (in the teacher app, where they have it)
    if (v.raised_by && v.raised_by !== ctx.user.id)
      await this.push.send(c, ctx, {
        userIds: [v.raised_by],
        title: outcome === 'approved' ? 'Vacancy approved' : 'Vacancy sent back',
        body: `${v.code} · ${v.title}${outcome === 'rejected' && note ? ` · ${note}` : ''}`.slice(
          0,
          240,
        ),
        link: '/',
        event: null,
      });
  }

  /**
   * Publish on the careers page from one minute to another (India time), or change the window of a
   * published vacancy. The opening is not in the past (a published vacancy keeps the one it has), the
   * last date and time are later than now and at least an hour after the opening, within a year.
   */
  async publish(ctx: RequestContext, id: string, dto: VacancyPublishDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.closeLapsed(c);
      const v = await this.load(c, id);
      if (!['approved', 'closed', 'published'].includes(v.status))
        throw new DomainError('recruitment.not_approved', 'Only an approved vacancy is published', {
          status: 409,
        });
      const opens = new Date(dto.opensAt);
      const closes = new Date(dto.closesAt);
      const now = Date.now();
      const bad = (path: string, message: string): never => {
        throw new DomainError('validation-failed', message, {
          status: 400,
          extra: { errors: [{ path, message }] },
        });
      };
      const kept = v.status === 'published' && v.opens_at?.getTime() === opens.getTime();
      // a minute's grace for the time it takes to press Publish
      if (!kept && opens.getTime() < now - 5 * 60_000)
        bad('opensAt', 'Open from: the time has passed; pick now or later');
      if (closes.getTime() <= now)
        bad('closesAt', 'Last date: the time has passed; pick a later one');
      if (closes.getTime() - opens.getTime() < 3_600_000)
        bad('closesAt', 'Last date: keep the vacancy open for at least an hour');
      if (closes.getTime() - opens.getTime() > 366 * 86_400_000)
        bad('closesAt', 'Last date: keep the vacancy open for a year at most');
      const again = v.status === 'published';
      await c.query(
        `UPDATE vacancies SET status = 'published', opens_at = $2, closes_at = $3,
                published_at = CASE WHEN status = 'published' THEN published_at ELSE now() END, closed_at = NULL,
                updated_at = now() WHERE id = $1`,
        [id, opens, closes],
      );
      await this.event(
        c,
        ctx,
        id,
        again ? 'rescheduled' : 'published',
        `${istText(opens)} to ${istText(closes)}`,
      );
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.vacancy.publish',
        entityType: 'vacancies',
        entityId: id,
        after: dto,
      });
      return { status: 'published' };
    });
  }

  async close(ctx: RequestContext, id: string, dto: VacancyNoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, id);
      if (v.status !== 'published')
        throw new DomainError('recruitment.not_published', 'Only a published vacancy is closed', {
          status: 409,
        });
      await c.query(
        `UPDATE vacancies SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.event(c, ctx, id, 'closed', dto.note);
      return { status: 'closed' };
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: VacancyNoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, id);
      if (v.status === 'closed' || v.status === 'cancelled')
        throw new DomainError('recruitment.done', 'The vacancy is already closed', { status: 409 });
      // a vacancy waiting for approval: the approval is withdrawn as the engine does it
      if (v.status === 'pending' && v.workflow_instance_id) {
        await c.query(
          `UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = $1 AND status = 'pending'`,
          [v.workflow_instance_id],
        );
        await c.query(
          `UPDATE workflow_instances SET status = 'cancelled', cancel_reason = $2, completed_at = now(),
                  completed_by = app.current_user_id(), updated_at = now() WHERE id = $1 AND status = 'pending'`,
          [v.workflow_instance_id, dto.note ?? 'Vacancy cancelled'],
        );
      }
      await c.query(
        `UPDATE vacancies SET status = 'cancelled', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.event(c, ctx, id, 'cancelled', dto.note);
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.vacancy.cancel',
        entityType: 'vacancies',
        entityId: id,
      });
      return { status: 'cancelled' };
    });
  }

  // ---- part 5: sharing a vacancy -------------------------------------------------------------------

  /** A published vacancy, for its link, QR and poster. */
  private async published(c: PoolClient, id: string) {
    await this.closeLapsed(c);
    const v = await this.load(c, id);
    if (v.status !== 'published')
      throw new DomainError('recruitment.not_published', 'The vacancy is not on the careers page', {
        status: 409,
      });
    return v;
  }

  /** The QR of the careers page of one vacancy (PNG). */
  async qr(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.published(c, id);
      const url = await this.careersUrl(c, base, v.id);
      return {
        url,
        filename: `${v.code}-qr.png`,
        contentType: 'image/png',
        base64: (await qrPng(url)).toString('base64'),
      };
    });
  }

  /** The careers page of the school (every open vacancy): the link and its QR. */
  async careers(ctx: RequestContext, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const url = await this.careersUrl(c, base);
      const open = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vacancies WHERE status = 'published' AND opens_at <= now() AND closes_at > now()`,
      );
      return {
        url,
        open: open.rows[0]!.n,
        filename: 'careers-qr.png',
        contentType: 'image/png',
        base64: (await qrPng(url)).toString('base64'),
      };
    });
  }

  /** The A4 poster of a published vacancy (PDF): the post, the last date and time, the QR and link. */
  async poster(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.published(c, id);
      const s = (
        await c.query<{ name: string; address: string | null; contact: string | null }>(
          `SELECT name,
                  NULLIF(concat_ws(', ', NULLIF(address->>'line1', ''), NULLIF(address->>'line2', ''), NULLIF(address->>'city', ''),
                         NULLIF(address->>'state', ''), NULLIF(COALESCE(address->>'pincode', address->>'pin'), '')), '') AS address,
                  NULLIF(concat_ws(' · ', NULLIF('Phone ' || NULLIF(contact->>'phone', ''), ''), NULLIF(contact->>'email', ''),
                         NULLIF(contact->>'website', '')), '') AS contact
             FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!;
      const campus = v.campus;
      const bytes = await vacancyPosterPdf({
        school: s.name,
        address: s.address,
        contact: s.contact,
        code: v.code,
        title: v.title,
        subline: [
          v.designation,
          v.department,
          v.subject,
          `${String(v.posts)} post${v.posts > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(' · '),
        rows: [
          ['Employee type', v.employee_type],
          ['Campus', campus],
          ['Qualifications', v.qualification],
          ['Experience', v.experience],
          ['Pay band / grade', v.pay_band],
        ],
        description: v.description,
        closes: v.closes_at ? istText(v.closes_at) : '',
        url: await this.careersUrl(c, base, v.id),
      });
      return {
        filename: `${v.code}-poster.pdf`,
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }
}
