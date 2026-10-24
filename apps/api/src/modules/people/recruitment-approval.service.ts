import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WAITING_WITH } from '../fees/fee-approval';
import { WorkflowService, type Level } from '../workflow/workflow.service';
import type { RecruitmentApprovalDto } from './recruitment.dto';
import { PEOPLE } from './people.permissions';
import { buildLevels, setupLists, toSetup } from './approval-levels';

/** The approval of a vacancy: the levels set in Recruitment set-up (0197, 0201). */
export const VACANCY_FLOW = { code: 'vacancy_approval', entityType: 'vacancy' } as const;

/** The level a school starts with until it sets its own: the school admin (the Principal's sign-in). */
export const VACANCY_DEFAULT_LEVELS: Level[] = [
  {
    level: 1,
    name: 'Principal approval',
    resolver: { kind: 'role', roleCode: 'school_admin' },
    slaHours: 72,
    autoSkip: true,
  },
];

export type { SetupLevel } from './approval-levels';

/**
 * Recruitment, part 5 (docs/design/34-recruitment.md): who approves a vacancy, set level by level in
 * Recruitment set-up (named employees, everyone holding a designation, or the HOD of the vacancy's
 * department) and kept in the workflow engine. A vacancy waiting for approval follows the set-up at once:
 * its steps are worked out again whenever the levels, a department's HOD or an employee's record change.
 * The approver acts on the vacancy page (and sees it in the header approvals) without needing the
 * recruitment rights.
 */
@Injectable()
export class RecruitmentApprovalService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  /** The definition, made with the starting level when the school has none yet. */
  async ensureFlow(c: PoolClient): Promise<Level[]> {
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by, updated_by)
       SELECT app.current_school_id(), $1, 'Vacancy approval', $2, $3::jsonb, app.current_user_id(), app.current_user_id()
        WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
      [VACANCY_FLOW.code, VACANCY_FLOW.entityType, JSON.stringify(VACANCY_DEFAULT_LEVELS)],
    );
    // a definition switched off under Workflow is used again: vacancies have no other way to be approved
    await c.query(
      `UPDATE workflow_definitions SET status = 'active', updated_at = now()
        WHERE code = $1 AND deleted_at IS NULL AND status <> 'active'`,
      [VACANCY_FLOW.code],
    );
    const r = await c.query<{ levels: Level[] }>(
      `SELECT levels FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL`,
      [VACANCY_FLOW.code],
    );
    return r.rows[0]!.levels;
  }

  /** The levels as the set-up shows them, with what it picks from and how many vacancies wait. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const levels = await this.ensureFlow(c);
      const lists = await setupLists(c);
      const open = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vacancies WHERE status = 'pending'`,
      );
      return {
        levels: levels.map((l) => toSetup(l, lists.staffRows)),
        staff: lists.staff,
        designations: lists.designations,
        departments: lists.departments,
        roles: lists.roles,
        waiting: open.rows[0]!.n,
        can: { manage: ctx.permissions?.has(PEOPLE.recruitmentManage) ?? false },
      };
    });
  }

  /**
   * The levels, saved at once: each level must have somebody who can sign in (an HOD level is checked
   * per vacancy: a department without its HOD is skipped). The vacancies waiting move to the new people.
   */
  async save(ctx: RequestContext, dto: RecruitmentApprovalDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureFlow(c);
      const levels = await buildLevels(c, dto.levels, { allowManager: false });
      await c.query(
        `UPDATE workflow_definitions SET levels = $2::jsonb, status = 'active', updated_at = now(), updated_by = app.current_user_id()
          WHERE code = $1 AND deleted_at IS NULL`,
        [VACANCY_FLOW.code, JSON.stringify(levels)],
      );
      const r = await this.followSetup(c, ctx);
      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.approval_levels',
        entityType: 'workflow_definitions',
        entityId: VACANCY_FLOW.code,
        after: { levels: levels.length, moved: r.moved.length, approved: r.approved.length },
      });
      return { saved: levels.length, moved: r.moved.length, approved: r.approved.length };
    });
  }

  /**
   * The vacancies waiting for approval follow the set-up as it is now (the levels, the departments'
   * HODs, the staff records): the ones whose waiting level changed people say so in their steps.
   */
  async followSetup(c: PoolClient, ctx: RequestContext) {
    const r = await this.workflow.refreshOpen(c, ctx, VACANCY_FLOW.code);
    for (const id of r.moved) {
      const w = await c.query<{ w: string | null }>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed fragment (who an approval waits with)
        `SELECT ${WAITING_WITH('v.workflow_instance_id')} AS w FROM vacancies v WHERE v.id = $1`,
        [id],
      );
      await c.query(
        `INSERT INTO vacancy_events (school_id, vacancy_id, what, note, by_user, by_name)
         VALUES (app.current_school_id(), $1, 'approval_moved', $2, app.current_user_id(), $3)`,
        [id, w.rows[0]?.w ? `Now with ${w.rows[0].w}` : null, ctx.user.displayName],
      );
    }
    return r;
  }

  /** The same, in a transaction of its own (a department's HOD or an employee's record changed). */
  async refresh(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.followSetup(c, ctx));
  }

  /** The step of the vacancy's approval waiting with the signed-in person (or one they stand in for). */
  async myStep(c: PoolClient, instanceId: string | null): Promise<string | null> {
    if (!instanceId) return null;
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
      `SELECT s.id::text FROM workflow_instances i
         JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
        WHERE i.id = $1 AND i.status = 'pending' AND ${WorkflowService.MAY_ACT}`,
      [instanceId],
    );
    return r.rows[0]?.id ?? null;
  }

  /** May the signed-in person open the vacancy without the recruitment rights: a part in its approval. */
  async takesPart(c: PoolClient, vacancyId: string): Promise<boolean> {
    const r = await c.query(
      // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
      `SELECT 1 FROM workflow_instances i JOIN workflow_steps s ON s.instance_id = i.id
        WHERE i.entity_type = 'vacancy' AND i.entity_id = $1::bigint
          AND (${WorkflowService.MAY_ACT} OR s.acted_by = app.current_user_id()) LIMIT 1`,
      [vacancyId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Vacancies waiting at the signed-in person's level (the header approvals). */
  async toApprove(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        title: string;
        department: string | null;
        posts: number;
        level: string;
        raised_by_name: string | null;
        since: Date;
        due_at: Date | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
        `SELECT v.id::text, v.code, v.title, v.department, v.posts, s.name AS level, v.raised_by_name,
                COALESCE(v.submitted_at, i.requested_at) AS since, s.due_at
           FROM workflow_instances i
           JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
           JOIN vacancies v ON v.workflow_instance_id = i.id AND v.status = 'pending'
          WHERE i.status = 'pending' AND i.entity_type = 'vacancy' AND ${WorkflowService.MAY_ACT}
          ORDER BY since`,
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          code: x.code,
          title: x.title,
          department: x.department,
          posts: x.posts,
          level: x.level,
          raisedBy: x.raised_by_name,
          since: x.since.toISOString(),
          overdue: x.due_at !== null && x.due_at.getTime() < Date.now(),
        })),
      };
    });
  }

  /** The approver's decision on the vacancy waiting with them, through the engine. */
  async decide(
    ctx: RequestContext,
    vacancyId: string,
    outcome: 'approved' | 'rejected',
    note: string | undefined,
  ) {
    if (!/^\d{1,18}$/.test(vacancyId))
      throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query<{ status: string; instance: string | null }>(
        `SELECT status, workflow_instance_id::text AS instance FROM vacancies WHERE id = $1`,
        [vacancyId],
      );
      if (!v.rows[0]) throw new DomainError('not-found', 'Vacancy not found', { status: 404 });
      if (v.rows[0].status !== 'pending')
        throw new DomainError(
          'recruitment.not_pending',
          'The vacancy is not waiting for approval',
          {
            status: 409,
          },
        );
      return this.myStep(c, v.rows[0].instance);
    });
    if (!step)
      throw new DomainError('recruitment.not_with_you', 'This vacancy is not waiting with you', {
        status: 403,
      });
    const instance = await this.workflow.act(ctx, step, outcome, { note });
    return {
      status:
        instance.status === 'approved'
          ? 'approved'
          : instance.status === 'rejected'
            ? 'rejected'
            : 'pending',
    };
  }
}
