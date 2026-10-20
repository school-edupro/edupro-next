import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { loadEmployeeLists } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WAITING_WITH } from '../fees/fee-approval';
import type { Resolver } from '../workflow/workflow.dto';
import { WorkflowService, type Level } from '../workflow/workflow.service';
import type { RecruitmentApprovalDto } from './recruitment.dto';
import { PEOPLE } from './people.permissions';

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

type By = 'employees' | 'designation' | 'hod' | 'role';
export interface SetupLevel {
  name: string;
  by: By;
  employeeIds: string[];
  designation: string | null;
  roleCode: string | null;
  slaHours: number | null;
}
interface Staff {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  user_id: string | null;
}

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

  private staffOf(c: PoolClient) {
    return c.query<Staff>(
      `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department, e.user_id::text
         FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name, e.employee_code LIMIT 3000`,
    );
  }

  private toSetup(l: Level, staff: Staff[]): SetupLevel {
    const r = l.resolver;
    const base = {
      name: l.name,
      employeeIds: [] as string[],
      designation: null,
      roleCode: null,
      slaHours: l.slaHours ?? null,
    };
    if (r.kind === 'staff')
      return { ...base, by: r.by, employeeIds: r.employeeIds, designation: r.designation ?? null };
    if (r.kind === 'position') return { ...base, by: 'designation', designation: r.designation };
    const users = r.kind === 'named_user' ? [r.userId] : r.kind === 'any_of' ? r.userIds : [];
    if (users.length && !(r.kind === 'any_of' && r.roleCodes.length))
      return {
        ...base,
        by: 'employees',
        employeeIds: staff.filter((s) => s.user_id && users.includes(s.user_id)).map((s) => s.id),
      };
    const roleCode =
      r.kind === 'role' ? r.roleCode : r.kind === 'any_of' ? r.roleCodes[0] : undefined;
    return { ...base, by: 'role', roleCode: roleCode ?? 'school_admin' };
  }

  /** The levels as the set-up shows them, with what it picks from and how many vacancies wait. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const levels = await this.ensureFlow(c);
      await c.query(`SELECT app.staff_masters_seed(app.current_school_id())`);
      // one query at a time: the client runs them in turn
      const staff = await this.staffOf(c);
      const lists = await loadEmployeeLists(c);
      const holders = await c.query<{ d: string; n: number }>(
        `SELECT lower(designation) AS d, count(*)::int AS n FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND user_id IS NOT NULL AND designation <> '' GROUP BY 1`,
      );
      const departments = await c.query<{
        name: string;
        code: string | null;
        hod: string | null;
        signs_in: boolean | null;
      }>(
        `SELECT d.name, e.employee_code AS code, e.display_name AS hod, e.user_id IS NOT NULL AS signs_in
           FROM departments d LEFT JOIN employees e ON e.id = d.hod_employee_id AND e.deleted_at IS NULL AND e.status = 'active'
          WHERE d.status = 'active' ORDER BY d.sort_order, d.name`,
      );
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (r.code) r.code, r.name FROM roles r
          WHERE (r.school_id IS NULL OR r.school_id = app.current_school_id()) ORDER BY r.code, r.school_id NULLS LAST`,
      );
      const open = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vacancies WHERE status = 'pending'`,
      );
      const held = new Map(holders.rows.map((x) => [x.d, x.n]));
      return {
        levels: levels.map((l) => this.toSetup(l, staff.rows)),
        staff: staff.rows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          designation: s.designation,
          department: s.department,
          signsIn: s.user_id !== null,
        })),
        designations: (lists.Designation ?? []).map((d) => ({
          name: d,
          holders: held.get(d.toLowerCase()) ?? 0,
        })),
        departments: departments.rows.map((d) => ({
          name: d.name,
          hod: d.code ? { code: d.code, name: d.hod!, signsIn: d.signs_in === true } : null,
        })),
        roles: roles.rows,
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
      const staff = (await this.staffOf(c)).rows;
      const byId = new Map(staff.map((s) => [s.id, s]));
      const lists = await loadEmployeeLists(c);
      const designations = new Map((lists.Designation ?? []).map((d) => [d.toLowerCase(), d]));
      const bad = (n: number, text: string): never => {
        throw new DomainError('validation-failed', `Level ${String(n)}: ${text}`, { status: 400 });
      };
      const names = dto.levels.map((l) => l.name.toLowerCase());
      if (new Set(names).size !== names.length)
        throw new DomainError('validation-failed', 'Each level needs its own name', {
          status: 400,
        });
      const levels: Level[] = [];
      for (const [i, l] of dto.levels.entries()) {
        const n = i + 1;
        let resolver: Resolver;
        if (l.by === 'employees') {
          const ids = [...new Set(l.employeeIds)];
          if (!ids.length) bad(n, 'pick the employees who approve');
          const missing = ids.filter((x) => !byId.has(x));
          if (missing.length) bad(n, 'an employee picked is not on the staff');
          const cannot = ids.map((x) => byId.get(x)!).filter((s) => !s.user_id);
          if (cannot.length)
            bad(
              n,
              `${cannot.map((s) => `${s.name} (${s.code})`).join(', ')} cannot sign in, so cannot approve: give a sign-in first or pick someone else`,
            );
          resolver = { kind: 'staff', by: 'employees', employeeIds: ids };
        } else if (l.by === 'designation') {
          const d = designations.get((l.designation ?? '').trim().toLowerCase());
          if (!d) bad(n, 'pick a designation from the list');
          const holders = staff.filter(
            (s) => s.user_id && (s.designation ?? '').toLowerCase() === d!.toLowerCase(),
          );
          if (!holders.length) bad(n, `nobody who can sign in holds the designation ${d!}`);
          resolver = { kind: 'staff', by: 'designation', employeeIds: [], designation: d! };
        } else if (l.by === 'hod') {
          const any = await c.query(
            `SELECT 1 FROM departments d JOIN employees e ON e.id = d.hod_employee_id
              WHERE d.status = 'active' AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL LIMIT 1`,
          );
          if (!any.rowCount)
            bad(
              n,
              'no department has an HOD who can sign in yet: set the HODs in Masters → Departments first',
            );
          resolver = { kind: 'staff', by: 'hod', employeeIds: [] };
        } else {
          const role = await c.query(
            `SELECT 1 FROM roles WHERE code = $1 AND (school_id IS NULL OR school_id = app.current_school_id()) LIMIT 1`,
            [l.roleCode ?? ''],
          );
          if (!role.rowCount) bad(n, 'the role is not in the school’s list');
          resolver = { kind: 'role', roleCode: l.roleCode! };
        }
        levels.push({
          level: n,
          name: l.name,
          resolver,
          ...(l.slaHours ? { slaHours: l.slaHours } : {}),
          autoSkip: true,
        });
      }
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
