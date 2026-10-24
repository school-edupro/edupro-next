import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { WorkflowService, type Level } from '../../workflow/workflow.service';
import { buildLevels, setupLists, toSetup } from '../approval-levels';
import { PEOPLE } from '../people.permissions';
import type { ClearanceApprover } from './exit-clearance.service';
import {
  EMPLOYEE_TYPES,
  type EmployeeType,
  type ExitApprovalDto,
  type ExitSetupDto,
} from './exits.dto';

export const EMPLOYEE_TYPE_LABEL: Record<EmployeeType, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
};
export const EXIT_ENTITY = 'employee_exit';
export const exitFlowCode = (type: EmployeeType) => `employee_exit_${type}`;

/** A school starts with the employee's HOD, then the principal; a level nobody holds is skipped. */
const DEFAULT_LEVELS: Level[] = [
  {
    level: 1,
    name: 'HOD review',
    resolver: { kind: 'staff', by: 'hod', employeeIds: [] },
    slaHours: 72,
    autoSkip: true,
  },
  {
    level: 2,
    name: 'Principal approval',
    resolver: { kind: 'role', roleCode: 'school_admin' },
    slaHours: 72,
    autoSkip: true,
  },
];
const DEFAULT_TYPES = [
  ['resignation', 'Resignation', true, true],
  ['termination', 'Termination', false, false],
  ['retirement', 'Retirement', false, false],
  ['contract_end', 'Contract end', false, false],
] as const;
const DEFAULT_NOTICE: Record<EmployeeType, number> = {
  teaching: 90,
  non_teaching: 30,
  contract: 30,
  visiting: 0,
};
const OFFICE: ClearanceApprover[] = [{ kind: 'office' }];
const DEFAULT_DEPARTMENTS: Array<
  [string, string, 'library' | 'assets' | null, ClearanceApprover[]]
> = [
  ['library', 'Library', 'library', [{ kind: 'role', code: 'librarian' }, ...OFFICE]],
  ['accounts', 'Accounts', null, [{ kind: 'role', code: 'accountant' }, ...OFFICE]],
  ['it_assets', 'IT and assets', 'assets', OFFICE],
  ['admin', 'Admin and ID card', null, OFFICE],
  ['hod', 'HOD (hand-over)', null, [{ kind: 'hod' }, ...OFFICE]],
  ['transport', 'Transport', null, OFFICE],
  ['hostel', 'Hostel', null, OFFICE],
];

/**
 * Employee exit set-up (docs/design/38, part 5): the exit types (which ones staff may ask for, which
 * count the notice period), the notice period per employee type, the clearance departments (used by
 * part 6), and the approval levels per employee type kept in the workflow engine.
 */
@Injectable()
export class ExitSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  /** A school's starting set-up, made the first time it is needed. */
  async seed(c: PoolClient) {
    const has = await c.query<{ types: boolean; departments: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM employee_exit_types) AS types, EXISTS (SELECT 1 FROM exit_clearance_departments) AS departments`,
    );
    if (!has.rows[0]!.types)
      for (const [i, [code, name, mayApply, notice]] of DEFAULT_TYPES.entries())
        await c.query(
          `INSERT INTO employee_exit_types (school_id, code, name, staff_may_apply, notice_applies, sort_order)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [code, name, mayApply, notice, i],
        );
    await c.query(
      `INSERT INTO employee_exit_settings (school_id, notice_days) VALUES (app.current_school_id(), $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(DEFAULT_NOTICE)],
    );
    if (!has.rows[0]!.departments)
      for (const [i, [code, name, auto, approvers]] of DEFAULT_DEPARTMENTS.entries())
        await c.query(
          `INSERT INTO exit_clearance_departments (school_id, code, name, auto, sort_order, approvers)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING`,
          [code, name, auto, i, JSON.stringify(approvers)],
        );
  }

  async typesWith(c: PoolClient) {
    await this.seed(c);
    const r = await c.query<{
      code: string;
      name: string;
      staff_may_apply: boolean;
      notice_applies: boolean;
      status: string;
    }>(
      `SELECT code, name, staff_may_apply, notice_applies, status::text FROM employee_exit_types ORDER BY sort_order, name`,
    );
    return r.rows.map((x) => ({
      code: x.code,
      name: x.name,
      staffMayApply: x.staff_may_apply,
      noticeApplies: x.notice_applies,
      active: x.status === 'active',
    }));
  }

  async noticeWith(c: PoolClient): Promise<Record<EmployeeType, number>> {
    await this.seed(c);
    const r = await c.query<{ notice_days: Partial<Record<EmployeeType, number>> }>(
      `SELECT notice_days FROM employee_exit_settings`,
    );
    return { ...DEFAULT_NOTICE, ...(r.rows[0]?.notice_days ?? {}) };
  }

  async get(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const types = await this.typesWith(c);
      const noticeDays = await this.noticeWith(c);
      const d = await c.query<{
        code: string;
        name: string;
        auto: string | null;
        status: string;
        approvers: ClearanceApprover[];
      }>(
        `SELECT code, name, auto, status::text, approvers FROM exit_clearance_departments ORDER BY sort_order, name`,
      );
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (code) code, name FROM roles WHERE school_id IS NULL OR school_id = app.current_school_id() ORDER BY code, school_id NULLS LAST`,
      );
      return {
        types,
        noticeDays,
        departments: d.rows.map((x) => ({
          code: x.code,
          name: x.name,
          auto: x.auto,
          active: x.status === 'active',
          approvers: x.approvers,
        })),
        roles: roles.rows,
        employeeTypes: EMPLOYEE_TYPES.map((t) => ({ code: t, name: EMPLOYEE_TYPE_LABEL[t] })),
        can: { manage: ctx.permissions?.has(PEOPLE.exitManage) ?? false },
      };
    });
  }

  /** Types and departments are kept by code: one left out is switched off, never removed. */
  async save(ctx: RequestContext, dto: ExitSetupDto) {
    const codes = (xs: Array<{ code: string }>) =>
      new Set(xs.map((x) => x.code)).size === xs.length;
    if (!codes(dto.types) || !codes(dto.departments))
      throw new DomainError('validation-failed', 'Each type and department needs its own code', {
        status: 400,
      });
    if (!dto.types.some((t) => t.active && t.staffMayApply))
      throw new DomainError(
        'validation-failed',
        'Keep at least one active type the staff may ask for (resignation)',
        { status: 400 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seed(c);
      for (const [i, t] of dto.types.entries())
        await c.query(
          `INSERT INTO employee_exit_types (school_id, code, name, staff_may_apply, notice_applies, sort_order, status)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::row_status)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, staff_may_apply = EXCLUDED.staff_may_apply,
             notice_applies = EXCLUDED.notice_applies, sort_order = EXCLUDED.sort_order, status = EXCLUDED.status`,
          [t.code, t.name, t.staffMayApply, t.noticeApplies, i, t.active ? 'active' : 'inactive'],
        );
      await c.query(
        `UPDATE employee_exit_types SET status = 'inactive' WHERE NOT (code = ANY($1::text[]))`,
        [dto.types.map((t) => t.code)],
      );
      for (const [i, d] of dto.departments.entries())
        await c.query(
          `INSERT INTO exit_clearance_departments (school_id, code, name, auto, sort_order, status, approvers)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::row_status, $6::jsonb)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, auto = EXCLUDED.auto,
             sort_order = EXCLUDED.sort_order, status = EXCLUDED.status, approvers = EXCLUDED.approvers`,
          [
            d.code,
            d.name,
            d.auto,
            i,
            d.active ? 'active' : 'inactive',
            JSON.stringify(d.approvers),
          ],
        );
      await c.query(
        `UPDATE exit_clearance_departments SET status = 'inactive' WHERE NOT (code = ANY($1::text[]))`,
        [dto.departments.map((d) => d.code)],
      );
      await c.query(
        `UPDATE employee_exit_settings SET notice_days = $1::jsonb, updated_at = now(), updated_by = app.current_user_id()`,
        [JSON.stringify({ ...DEFAULT_NOTICE, ...dto.noticeDays })],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.exit.setup',
        entityType: 'employee_exit_settings',
        entityId: 'school',
        after: dto,
      });
      return { saved: true };
    });
  }

  /** The flow of an employee type, made with the starting levels when the school has none yet. */
  async ensureFlow(c: PoolClient, type: EmployeeType): Promise<{ id: string; levels: Level[] }> {
    const code = exitFlowCode(type);
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by, updated_by)
       SELECT app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id(), app.current_user_id()
        WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
      [
        code,
        `Employee exit (${EMPLOYEE_TYPE_LABEL[type]})`,
        EXIT_ENTITY,
        JSON.stringify(DEFAULT_LEVELS),
      ],
    );
    // switched off under Workflow: exits have no other way to be decided
    await c.query(
      `UPDATE workflow_definitions SET status = 'active', updated_at = now()
        WHERE code = $1 AND deleted_at IS NULL AND status <> 'active'`,
      [code],
    );
    const r = await c.query<{ id: string; levels: Level[] }>(
      `SELECT id::text, levels FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return r.rows[0]!;
  }

  /** Who approves the exit of an employee type, level by level, and what the set-up picks from. */
  async approval(ctx: RequestContext, type: EmployeeType) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const flow = await this.ensureFlow(c, type);
      const lists = await setupLists(c);
      const open = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM employee_exits x JOIN employees e ON e.id = x.employee_id
          WHERE x.status = 'pending' AND e.employee_type::text = $1`,
        [type],
      );
      return {
        type,
        levels: flow.levels.map((l) => toSetup(l, lists.staffRows)),
        staff: lists.staff,
        designations: lists.designations,
        departments: lists.departments,
        roles: lists.roles,
        waiting: open.rows[0]!.n,
        can: { manage: ctx.permissions?.has(PEOPLE.exitManage) ?? false },
      };
    });
  }

  /** The levels saved at once; the exits of that type waiting move to the new people. */
  async saveApproval(ctx: RequestContext, type: EmployeeType, dto: ExitApprovalDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureFlow(c, type);
      const levels = await buildLevels(c, dto.levels, { allowManager: true });
      await c.query(
        `UPDATE workflow_definitions SET levels = $2::jsonb, status = 'active', updated_at = now(), updated_by = app.current_user_id()
          WHERE code = $1 AND deleted_at IS NULL`,
        [exitFlowCode(type), JSON.stringify(levels)],
      );
      const r = await this.workflow.refreshOpen(c, ctx, exitFlowCode(type));
      for (const id of r.moved)
        await c.query(
          `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
           SELECT app.current_school_id(), x.id, 'approval_moved', 'The approval levels changed', app.current_user_id(), $2
             FROM employee_exits x WHERE x.id = $1`,
          [id, ctx.user.displayName],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.exit.approval_levels',
        entityType: 'workflow_definitions',
        entityId: exitFlowCode(type),
        after: { levels: levels.length, moved: r.moved.length, approved: r.approved.length },
      });
      return { saved: levels.length, moved: r.moved.length, approved: r.approved.length };
    });
  }
}
