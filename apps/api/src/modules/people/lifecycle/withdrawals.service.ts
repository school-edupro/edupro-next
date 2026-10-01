import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { approverLabel, type Approver, type PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { FeeLedgerService } from '../../fees/fee-ledger.service';
import {
  LIFECYCLE,
  type BulkClearanceDto,
  type BulkTcDto,
  type BulkWithdrawalDto,
  type BypassDto,
  type CancelDto,
  type ClearanceDto,
  type DepartmentInput,
  type ListWithdrawalsQueryDto,
  type RequestWithdrawalDto,
  type SaveDepartmentsDto,
} from './lifecycle.dto';
import { TcService } from './tc.service';

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  step: number;
  approvers: Approver[];
  approverLabels: string[];
  autoCheck: 'none' | 'fees' | 'library';
  autoClear: boolean;
  bypassAllowed: boolean;
  documentRequired: boolean;
  gatesTc: boolean;
  active: boolean;
}

export interface ClearanceRow {
  id: string;
  department: string;
  departmentName: string;
  step: number;
  status: 'pending' | 'cleared' | 'hold';
  dues: string;
  remarks: string | null;
  bypassed: boolean;
  auto: boolean;
  check: { kind: string; due: number; detail: string } | null;
  documents: Array<{ fileId: string; name: string | null }>;
  approvers: string[];
  bypassAllowed: boolean;
  documentRequired: boolean;
  gatesTc: boolean;
  actedBy: string | null;
  actedAt: string | null;
  /** Filled per viewer: the department waits at the current step and this user may act on it. */
  canAct?: boolean;
}

export interface WithdrawalRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  initiatedOn: string;
  requestedOn: string;
  leavingOn: string;
  reason: string;
  remarks: string | null;
  documents: Array<{ fileId: string; name: string | null }>;
  status: 'requested' | 'cleared' | 'completed' | 'cancelled';
  currentStep: number | null;
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  tc: { id: string; tcNo: string; exportId: string | null } | null;
  clearances: ClearanceRow[];
  /** Per viewer: the TC may be issued now (the departments that gate it have cleared). */
  canIssueTc?: boolean;
}

interface Db {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  section: string | null;
  class_section_id: string | null;
  initiated_on: string;
  requested_on: string;
  leaving_on: string;
  reason: string;
  remarks: string | null;
  documents: WithdrawalRow['documents'];
  status: WithdrawalRow['status'];
  current_step: number | null;
  requested_by: string | null;
  completed_at: Date | null;
  cancel_reason: string | null;
  tc: WithdrawalRow['tc'];
  clearances: Array<Omit<ClearanceRow, 'approvers'> & { approverList: Approver[] }>;
}

interface Actor {
  userId: string;
  roleIds: Set<string>;
  sections: Set<string>;
  /** Holds people.withdrawal.manage: the office, and may act on (or bypass) any department. */
  manage: boolean;
}

const SELECT = `SELECT w.id::text, w.student_id::text, s.display_name AS student_name, s.admission_no,
        sec.label AS section, sec.class_section_id,
        COALESCE(w.initiated_on, w.requested_on)::text AS initiated_on, w.requested_on::text, w.leaving_on::text, w.reason, w.remarks, w.documents,
        w.status, w.current_step, u.display_name AS requested_by, w.completed_at, w.cancel_reason,
        CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id::text, 'tcNo', t.tc_no, 'exportId', t.export_id::text) END AS tc,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', x.id::text, 'department', x.department, 'departmentName', COALESCE(d.name, initcap(x.department)), 'step', x.step,
                    'status', x.status, 'dues', x.dues::text, 'remarks', x.remarks, 'bypassed', x.bypassed, 'auto', x.auto, 'check', x.check_result,
                    'documents', x.documents, 'approverList', COALESCE(d.approvers, '[{"kind":"office"}]'::jsonb),
                    'bypassAllowed', COALESCE(d.bypass_allowed, false), 'documentRequired', COALESCE(d.document_required, false),
                    'gatesTc', COALESCE(d.gates_tc, false),
                    'actedBy', (SELECT display_name FROM users WHERE id = x.acted_by), 'actedAt', x.acted_at) ORDER BY x.step, COALESCE(d.sort_order, 0), x.id)
                    FROM withdrawal_clearances x LEFT JOIN withdrawal_departments d ON d.id = x.department_id
                   WHERE x.withdrawal_id = w.id), '[]'::jsonb) AS clearances
   FROM student_withdrawals w JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.requested_by
   LEFT JOIN transfer_certificates t ON t.id = w.tc_id AND t.status = 'issued'
   LEFT JOIN LATERAL (SELECT c.code || '-' || cs.name AS label, e.class_section_id::text
                        FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
                       WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) sec ON true`;

/** The departments a school starts with; it may rename, re-order, add or switch them off. */
const DEFAULTS: Array<
  Omit<DepartmentInput, 'approvers'> & {
    approvers: Array<Approver | { kind: 'role_code'; code: string }>;
  }
> = [
  {
    code: 'fees',
    name: 'Fees and accounts',
    step: 1,
    approvers: [{ kind: 'role_code', code: 'accountant' }, { kind: 'office' }],
    autoCheck: 'fees',
    autoClear: true,
    bypassAllowed: false,
    documentRequired: false,
    gatesTc: true,
    active: true,
  },
  {
    code: 'library',
    name: 'Library',
    step: 1,
    approvers: [{ kind: 'office' }],
    autoCheck: 'library',
    autoClear: true,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'transport',
    name: 'Transport',
    step: 1,
    approvers: [{ kind: 'office' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'class_teacher',
    name: 'Class teacher',
    step: 2,
    approvers: [{ kind: 'class_teacher' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'principal',
    name: 'Principal',
    step: 3,
    approvers: [{ kind: 'role_code', code: 'school_admin' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: false,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
];

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Withdrawal (2026-10-01, replaces the S7 two-step flow): the office starts it with dates, reason and
 * documents; the school's departments clear it in steps (same step in parallel), each by its own
 * approvers, with automatic fee / library checks that clear by themselves when nothing is due, an
 * optional bypass, remarks, dues and documents. The TC can be issued once the departments that gate
 * it (fees) have cleared; completion ends the enrolment and revokes the student's login (and a parent's
 * when no other child studies here). The office may cancel until completion. Bulk start, bulk clear
 * and bulk TC serve the Class XII year end.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: FeeLedgerService,
    private readonly tcs: TcService,
  ) {}

  // ---- settings ------------------------------------------------------------------------------------
  private async ensureDepartments(c: PoolClient) {
    const has = await c.query(`SELECT 1 FROM withdrawal_departments LIMIT 1`);
    if (has.rowCount) return;
    const roles = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM roles WHERE school_id IS NULL AND code IN ('accountant', 'school_admin')`,
    );
    const byCode = new Map(roles.rows.map((r) => [r.code, r]));
    let order = 0;
    for (const d of DEFAULTS) {
      const approvers = d.approvers.flatMap((a): Approver[] => {
        if (a.kind !== 'role_code') return [a];
        const r = byCode.get(a.code);
        return r ? [{ kind: 'role', roleId: r.id, name: r.name }] : [];
      });
      await c.query(
        `INSERT INTO withdrawal_departments (school_id, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, sort_order, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, code) DO NOTHING`,
        [
          d.code,
          d.name,
          d.step,
          JSON.stringify(approvers.length ? approvers : [{ kind: 'office' }]),
          d.autoCheck,
          d.autoClear,
          d.bypassAllowed,
          d.documentRequired,
          d.gatesTc,
          (order += 1),
        ],
      );
    }
  }

  private async departmentsIn(c: PoolClient, activeOnly: boolean): Promise<DepartmentRow[]> {
    await this.ensureDepartments(c);
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      step: number;
      approvers: Approver[];
      auto_check: DepartmentRow['autoCheck'];
      auto_clear: boolean;
      bypass_allowed: boolean;
      document_required: boolean;
      gates_tc: boolean;
      status: string;
    }>(
      `SELECT id::text, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, status::text
         FROM withdrawal_departments WHERE ($1 = false OR status = 'active') ORDER BY step, sort_order, id`,
      [activeOnly],
    );
    return r.rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      step: d.step,
      approvers: d.approvers,
      approverLabels: d.approvers.map(approverLabel),
      autoCheck: d.auto_check,
      autoClear: d.auto_clear,
      bypassAllowed: d.bypass_allowed,
      documentRequired: d.document_required,
      gatesTc: d.gates_tc,
      active: d.status === 'active',
    }));
  }

  async departments(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const roles = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'support_engineer') AND deleted_at IS NULL ORDER BY name`,
      );
      const staff = await c.query<{ user_id: string; name: string; designation: string | null }>(
        `SELECT e.user_id::text, e.display_name AS name, e.designation FROM employees e
          WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL ORDER BY e.display_name`,
      );
      return {
        departments: await this.departmentsIn(c, false),
        roles: roles.rows,
        staff: staff.rows.map((x) => ({
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
        })),
      };
    });
  }

  async saveDepartments(ctx: RequestContext, dto: SaveDepartmentsDto) {
    const codes = dto.departments.map((d) => d.code);
    if (new Set(codes).size !== codes.length)
      throw new DomainError('validation-failed', 'Each department needs its own code', {
        status: 400,
      });
    if (!dto.departments.some((d) => d.active))
      throw new DomainError('validation-failed', 'Keep at least one department active', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureDepartments(c);
      const approvers = dto.departments.flatMap((d) => d.approvers);
      const roleIds = approvers.flatMap((a) => (a.kind === 'role' ? [a.roleId] : []));
      const userIds = approvers.flatMap((a) => (a.kind === 'user' ? [a.userId] : []));
      if (roleIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT id)::int AS n FROM roles WHERE id = ANY($1::bigint[]) AND (school_id IS NULL OR school_id = app.current_school_id())`,
          [roleIds],
        );
        if (r.rows[0]!.n !== new Set(roleIds).size)
          throw new DomainError('validation-failed', 'An approver role does not exist', {
            status: 400,
          });
      }
      if (userIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT user_id)::int AS n FROM employees WHERE user_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
          [userIds],
        );
        if (r.rows[0]!.n !== new Set(userIds).size)
          throw new DomainError(
            'validation-failed',
            'An approver is not an employee of this school with a login',
            { status: 400 },
          );
      }
      const before = await this.departmentsIn(c, false);
      let order = 0;
      for (const d of dto.departments)
        await c.query(
          `INSERT INTO withdrawal_departments (school_id, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, sort_order, status, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::row_status, app.current_user_id(), app.current_user_id())
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, step = EXCLUDED.step, approvers = EXCLUDED.approvers,
             auto_check = EXCLUDED.auto_check, auto_clear = EXCLUDED.auto_clear, bypass_allowed = EXCLUDED.bypass_allowed,
             document_required = EXCLUDED.document_required, gates_tc = EXCLUDED.gates_tc, sort_order = EXCLUDED.sort_order,
             status = EXCLUDED.status, updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [
            d.code,
            d.name,
            d.step,
            JSON.stringify(d.approvers),
            d.autoCheck,
            d.autoCheck !== 'none' && d.autoClear,
            d.bypassAllowed,
            d.documentRequired,
            d.gatesTc,
            (order += 1),
            d.active ? 'active' : 'inactive',
          ],
        );
      // departments left out of the list are switched off (their past clearances stay)
      await c.query(
        `UPDATE withdrawal_departments SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id() WHERE code <> ALL($1::text[])`,
        [codes],
      );
      const after = await this.departmentsIn(c, false);
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.departments_save',
        entityType: 'withdrawal_departments',
        entityId: requireTenant(ctx).schoolId,
        before: before.map((d) => ({ code: d.code, step: d.step, active: d.active })),
        after: after.map((d) => ({ code: d.code, step: d.step, active: d.active })),
      });
      return after;
    });
  }

  // ---- reading -------------------------------------------------------------------------------------
  private async actor(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const roles = await c.query<{ role_id: string }>(
      `SELECT role_id::text FROM user_roles WHERE user_id = app.current_user_id() AND revoked_at IS NULL
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
    );
    const sections = await c.query<{ id: string }>(
      `SELECT ta.class_section_id::text AS id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL`,
    );
    return {
      userId: ctx.user.id,
      roleIds: new Set(roles.rows.map((x) => x.role_id)),
      sections: new Set(sections.rows.map((x) => x.id)),
      manage: ctx.permissions?.has(LIFECYCLE.withdrawalManage) ?? false,
    };
  }

  private named(a: Approver, actor: Actor, classSectionId: string | null): boolean {
    if (a.kind === 'office') return actor.manage;
    if (a.kind === 'class_teacher')
      return classSectionId !== null && actor.sections.has(classSectionId);
    if (a.kind === 'role') return actor.roleIds.has(a.roleId);
    return a.userId === actor.userId;
  }

  private view(r: Db, actor: Actor | null): WithdrawalRow {
    const open = r.status === 'requested' || r.status === 'cleared';
    const clearances: ClearanceRow[] = r.clearances.map(({ approverList, ...x }) => ({
      ...x,
      approvers: approverList.map(approverLabel),
      canAct: actor
        ? open &&
          x.status !== 'cleared' &&
          x.step === r.current_step &&
          (actor.manage || approverList.some((a) => this.named(a, actor, r.class_section_id)))
        : undefined,
    }));
    const gates = clearances.filter((x) => x.gatesTc);
    const gateCleared = gates.length
      ? gates.every((x) => x.status === 'cleared')
      : r.status !== 'requested';
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      admissionNo: r.admission_no,
      section: r.section,
      initiatedOn: r.initiated_on,
      requestedOn: r.requested_on,
      leavingOn: r.leaving_on,
      reason: r.reason,
      remarks: r.remarks,
      documents: r.documents ?? [],
      status: r.status,
      currentStep: r.current_step,
      requestedBy: r.requested_by,
      completedAt: r.completed_at ? r.completed_at.toISOString() : null,
      cancelReason: r.cancel_reason,
      tc: r.tc,
      clearances,
      canIssueTc: r.status !== 'cancelled' && !r.tc && gateCleared,
    };
  }

  private async findDb(c: PoolClient, id: string, lock = false): Promise<Db | null> {
    const r = await c.query<Db>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      `${SELECT} WHERE w.id = $1${lock ? ' FOR UPDATE OF w' : ''}`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async list(
    ctx: RequestContext,
    q: ListWithdrawalsQueryDto,
  ): Promise<{ rows: WithdrawalRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.status === 'open' || q.mine) where.push(`w.status IN ('requested', 'cleared')`);
      else {
        params.push(q.status);
        where.push(`w.status = $${params.length}::withdrawal_status`);
      }
      if (q.classSectionId) {
        params.push(q.classSectionId);
        where.push(`sec.class_section_id = $${params.length}::text`);
      }
      if (q.q) {
        params.push(`%${q.q.toLowerCase()}%`);
        where.push(
          `(lower(s.display_name) LIKE $${params.length} OR lower(s.admission_no) LIKE $${params.length})`,
        );
      }
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where joins fixed fragments; values are bound parameters
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY w.requested_on DESC, w.id DESC LIMIT 2000`,
        params,
      );
      let rows = r.rows.map((x) => this.view(x, actor));
      // "awaiting me": a department at the current step names me (the office sees only office steps)
      if (q.mine)
        rows = rows.filter((w) =>
          r.rows
            .find((x) => x.id === w.id)!
            .clearances.some(
              (x) =>
                x.status !== 'cleared' &&
                x.step === w.currentStep &&
                x.approverList.some((a) =>
                  this.named(a, actor, r.rows.find((y) => y.id === w.id)!.class_section_id),
                ),
            ),
        );
      const total = rows.length;
      return { rows: rows.slice((q.page - 1) * q.size, q.page * q.size), total };
    });
  }

  async get(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findDb(c, id);
      if (!row) throw new DomainError('not-found', 'Withdrawal not found');
      return this.view(row, await this.actor(c, ctx));
    });
  }

  async forStudent(ctx: RequestContext, studentId: string): Promise<WithdrawalRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE w.student_id = $1 ORDER BY w.id DESC`, [
        studentId,
      ]);
      return r.rows.map((x) => this.view(x, actor));
    });
  }

  // ---- starting --------------------------------------------------------------------------------------
  private async checkFiles(c: PoolClient, files: Array<{ fileId: string }>) {
    const out: Array<{ fileId: string; name: string | null }> = [];
    for (const f of files) {
      const r = await c.query<{ status: string; original_name: string | null }>(
        `SELECT status::text, original_name FROM files WHERE id = $1`,
        [f.fileId],
      );
      if (!r.rows[0])
        throw new DomainError('not-found', 'Attached file not found', { status: 404 });
      if (r.rows[0].status !== 'ready')
        throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
          status: 409,
        });
      out.push({ fileId: f.fileId, name: r.rows[0].original_name });
    }
    return out;
  }

  private async startIn(
    c: PoolClient,
    ctx: RequestContext,
    studentId: string,
    dto: RequestWithdrawalDto & { batchId?: string },
  ): Promise<string> {
    const tenant = requireTenant(ctx);
    const s = await c.query<{ status: string }>(
      `SELECT status::text FROM students WHERE id = $1 AND deleted_at IS NULL`,
      [studentId],
    );
    if (!s.rows[0]) throw new DomainError('not-found', 'Student not found');
    if (s.rows[0].status !== 'active')
      throw new DomainError('withdrawal.student_inactive', 'The student is not active', {
        status: 409,
      });
    const departments = await this.departmentsIn(c, true);
    if (!departments.length)
      throw new DomainError(
        'withdrawal.no_departments',
        'Set up the withdrawal departments first',
        {
          status: 409,
        },
      );
    const documents = await this.checkFiles(c, dto.documents ?? []);
    const firstStep = Math.min(...departments.map((d) => d.step));
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, initiated_on, leaving_on, reason, remarks, documents, current_step, batch_id, requested_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, COALESCE($3::date, CURRENT_DATE), $4::date, $5, $6, $7::jsonb, $8, $9::uuid, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          studentId,
          tenant.academicYearId,
          dto.initiatedOn ?? null,
          dto.leavingOn,
          dto.reason,
          dto.remarks ?? null,
          JSON.stringify(documents),
          firstStep,
          dto.batchId ?? null,
        ],
      );
      id = r.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError(
          'withdrawal.open_exists',
          'The student already has an open withdrawal',
          {
            status: 409,
          },
        );
      throw error;
    }
    for (const d of departments)
      await c.query(
        `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department, department_id, step) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
        [id, d.code, d.id, d.step],
      );
    await this.audit.stage(ctx, c, {
      action: 'people.withdrawal.request',
      entityType: 'student_withdrawals',
      entityId: id,
      after: {
        studentId,
        initiatedOn: dto.initiatedOn ?? null,
        leavingOn: dto.leavingOn,
        reason: dto.reason,
        documents: documents.length,
        departments: departments.map((d) => `${d.step}:${d.code}`),
        batchId: dto.batchId ?? null,
      },
    });
    return id;
  }

  async request(
    ctx: RequestContext,
    studentId: string,
    dto: RequestWithdrawalDto,
  ): Promise<WithdrawalRow> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const id = await this.db.tenant(tenant, (c) => this.startIn(c, ctx, studentId, dto));
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  /** Many students with one leaving date and reason (e.g. Class XII at the year end). */
  async bulkRequest(ctx: RequestContext, dto: BulkWithdrawalDto) {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const batchId = randomUUID();
    const results: Array<{ studentId: string; ok: boolean; id?: string; error?: string }> = [];
    for (const studentId of [...new Set(dto.studentIds)]) {
      try {
        const id = await this.db.tenant(tenant, (c) =>
          this.startIn(c, ctx, studentId, { ...dto, documents: [], batchId }),
        );
        await this.runChecks(ctx, id);
        results.push({ studentId, ok: true, id });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ studentId, ok: false, error: error.message });
      }
    }
    return {
      batchId,
      started: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ---- automatic checks and steps ----------------------------------------------------------------------
  /** Fee dues up to the leaving date (balance and late fee outstanding), from the live ledger. */
  private async feeDues(ctx: RequestContext, studentId: string, leavingOn: string) {
    try {
      const l = await this.ledger.ledger(ctx, studentId);
      const due = l.instalments
        .filter((i) => i.dueOn <= leavingOn)
        .reduce((n, i) => n + Number(i.balance) + Number(i.lateFee.outstanding), 0);
      return {
        kind: 'fees',
        due: Math.max(Math.round(due * 100) / 100, 0),
        detail:
          due > 0
            ? `${money(due)} due up to the leaving date`
            : 'No fees due up to the leaving date',
      };
    } catch (error) {
      if (error instanceof DomainError && error.status === 404)
        return { kind: 'fees', due: 0, detail: 'No fee ledger for this student' };
      throw error;
    }
  }

  private async libraryDues(c: PoolClient, studentId: string) {
    const r = await c.query<{ open: number; fines: string }>(
      `SELECT count(*) FILTER (WHERE returned_on IS NULL)::int AS open,
              COALESCE(sum(fine_amount - fine_waived) FILTER (WHERE fine_amount > fine_waived AND fine_receipt_id IS NULL), 0)::text AS fines
         FROM library_loans WHERE borrower_kind = 'student' AND borrower_id = $1`,
      [studentId],
    );
    const open = r.rows[0]?.open ?? 0;
    const fines = Number(r.rows[0]?.fines ?? 0);
    const parts = [
      open ? `${String(open)} book${open === 1 ? '' : 's'} not returned` : null,
      fines ? `${money(fines)} fine unpaid` : null,
    ].filter(Boolean);
    return {
      kind: 'library',
      due: open + fines,
      detail: parts.length ? parts.join(', ') : 'No books out and no fines',
    };
  }

  /** Moves to the next step once every department of the current one has cleared. */
  private async advance(c: PoolClient, id: string) {
    await c.query(
      `UPDATE student_withdrawals w SET
          current_step = (SELECT min(step) FROM withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared'),
          status = CASE WHEN EXISTS (SELECT 1 FROM withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared')
                        THEN 'requested' ELSE 'cleared' END::withdrawal_status,
          updated_at = now()
        WHERE w.id = $1 AND w.status IN ('requested', 'cleared')`,
      [id],
    );
  }

  /**
   * Runs the automatic checks of the departments at the current step, clears those that may clear
   * themselves when nothing is due, and repeats while that opens the next step.
   */
  private async runChecks(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    for (let round = 0; round < 10; round += 1) {
      const w = await this.db.tenant(tenant, (c) => this.findDb(c, id));
      if (!w || w.status !== 'requested' || w.current_step === null) return;
      const due = w.clearances.filter(
        (x) => x.step === w.current_step && x.status !== 'cleared' && !x.check,
      );
      const checks = await Promise.all(
        due.map(async (x) => {
          const dep = await this.db.tenant(tenant, (c) =>
            c.query<{ auto_check: string; auto_clear: boolean }>(
              `SELECT d.auto_check, d.auto_clear FROM withdrawal_clearances x JOIN withdrawal_departments d ON d.id = x.department_id WHERE x.id = $1`,
              [x.id],
            ),
          );
          const kind = dep.rows[0]?.auto_check ?? 'none';
          if (kind === 'none') return null;
          const result =
            kind === 'fees'
              ? await this.feeDues(ctx, w.student_id, w.leaving_on)
              : await this.db.tenant(tenant, (c) => this.libraryDues(c, w.student_id));
          return { clearanceId: x.id, result, autoClear: dep.rows[0]!.auto_clear };
        }),
      );
      const done = checks.filter((x): x is NonNullable<typeof x> => x !== null);
      if (!done.length) return;
      const stepBefore = w.current_step;
      const stepAfter = await this.db.tenant(tenant, async (c) => {
        for (const ch of done) {
          const clear = ch.autoClear && ch.result.due === 0;
          await c.query(
            `UPDATE withdrawal_clearances SET check_result = $2::jsonb,
                    dues = CASE WHEN $4 = 'fees' THEN $5 ELSE dues END,
                    status = CASE WHEN $3 THEN 'cleared'::clearance_status ELSE status END,
                    auto = $3, remarks = CASE WHEN $3 THEN 'Cleared automatically: ' || $6 ELSE remarks END,
                    acted_at = CASE WHEN $3 THEN now() ELSE acted_at END
              WHERE id = $1`,
            [
              ch.clearanceId,
              JSON.stringify(ch.result),
              clear,
              ch.result.kind,
              ch.result.kind === 'fees' ? ch.result.due : 0,
              ch.result.detail,
            ],
          );
        }
        await this.advance(c, id);
        const r = await c.query<{ current_step: number | null }>(
          `SELECT current_step FROM student_withdrawals WHERE id = $1`,
          [id],
        );
        return r.rows[0]?.current_step ?? null;
      });
      if (stepAfter === stepBefore) return;
    }
  }

  // ---- department actions ------------------------------------------------------------------------------
  private async actOn(
    ctx: RequestContext,
    id: string,
    department: string,
    apply: (c: PoolClient, x: Db['clearances'][number], w: Db) => Promise<Record<string, unknown>>,
    action: string,
  ): Promise<WithdrawalRow> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(w.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      const x = w.clearances.find((y) => y.department === department);
      if (!x) throw new DomainError('not-found', `No clearance for department "${department}"`);
      if (x.step !== w.current_step && x.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_this_step',
          `${x.departmentName} acts at step ${String(x.step)}; the withdrawal is at step ${String(w.current_step ?? '-')}`,
          { status: 409 },
        );
      const actor = await this.actor(c, ctx);
      if (!actor.manage && !x.approverList.some((a) => this.named(a, actor, w.class_section_id)))
        throw new DomainError(
          'withdrawal.not_assigned',
          `${x.departmentName} is cleared by ${x.approverList.map(approverLabel).join(' or ')}`,
          { status: 403 },
        );
      const after = await apply(c, x, w);
      await this.advance(c, id);
      await this.audit.stage(ctx, c, {
        action,
        entityType: 'student_withdrawals',
        entityId: id,
        before: { department, status: x.status },
        after: { department, ...after },
      });
    });
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  async clearance(ctx: RequestContext, id: string, department: string, dto: ClearanceDto) {
    return this.actOn(
      ctx,
      id,
      department,
      async (c, x) => {
        const added = await this.checkFiles(c, dto.documents ?? []);
        const documents = [...(x.documents ?? []), ...added];
        if (dto.status === 'cleared' && x.documentRequired && !documents.length)
          throw new DomainError(
            'withdrawal.document_required',
            `${x.departmentName} needs a document attached to clear`,
            { status: 400 },
          );
        await c.query(
          `UPDATE withdrawal_clearances SET status = $2::clearance_status, dues = $3, remarks = $4, documents = $5::jsonb,
                  bypassed = false, auto = false, acted_by = app.current_user_id(), acted_at = now() WHERE id = $1`,
          [x.id, dto.status, dto.dues, dto.remarks ?? null, JSON.stringify(documents)],
        );
        return {
          status: dto.status,
          dues: dto.dues,
          remarks: dto.remarks ?? null,
          documents: added.length,
        };
      },
      'people.withdrawal.clear',
    );
  }

  /** Skips a department the school allows to be bypassed; the reason is kept with the clearance. */
  async bypass(ctx: RequestContext, id: string, department: string, dto: BypassDto) {
    return this.actOn(
      ctx,
      id,
      department,
      async (c, x) => {
        if (!x.bypassAllowed)
          throw new DomainError('withdrawal.no_bypass', `${x.departmentName} cannot be bypassed`, {
            status: 409,
          });
        await c.query(
          `UPDATE withdrawal_clearances SET status = 'cleared', bypassed = true, auto = false, remarks = $2,
                  acted_by = app.current_user_id(), acted_at = now() WHERE id = $1`,
          [x.id, `Bypassed: ${dto.reason}`],
        );
        return { status: 'cleared', bypassed: true, reason: dto.reason };
      },
      'people.withdrawal.bypass',
    );
  }

  /** The same decision for one department on many withdrawals; each stands alone. */
  async bulkClearance(ctx: RequestContext, dto: BulkClearanceDto) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of [...new Set(dto.withdrawalIds)]) {
      try {
        await this.clearance(ctx, id, dto.department, {
          status: dto.status,
          dues: 0,
          remarks: dto.remarks,
          documents: [],
        });
        results.push({ id, ok: true });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ id, ok: false, error: error.message });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ---- TC, completion, cancel ----------------------------------------------------------------------------
  async issueTc(
    ctx: RequestContext,
    id: string,
    dto: Omit<BulkTcDto, 'withdrawalIds'>,
  ): Promise<WithdrawalRow> {
    const w = await this.get(ctx, id);
    if (w.status === 'cancelled')
      throw new DomainError('withdrawal.not_open', 'The withdrawal was cancelled', { status: 409 });
    if (w.tc)
      throw new DomainError('tc.already_issued', `TC ${w.tc.tcNo} is already issued`, {
        status: 409,
      });
    if (!w.canIssueTc) {
      const waiting = w.clearances.filter((x) => x.gatesTc && x.status !== 'cleared');
      throw new DomainError(
        'withdrawal.tc_gated',
        `The TC can be issued after ${waiting.map((x) => x.departmentName).join(', ') || 'every department'} clears`,
        { status: 409 },
      );
    }
    const tc = await this.tcs.issue(
      ctx,
      w.studentId,
      {
        reason: dto.reason ?? w.reason,
        issuedOn: dto.issuedOn ?? w.leavingOn,
        conduct: dto.conduct ?? 'Good',
        promotionStatus: dto.promotionStatus,
        duesCleared: true,
        remarks: dto.remarks,
      },
      { keepStatus: w.status !== 'completed' },
    );
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`UPDATE student_withdrawals SET tc_id = $2, updated_at = now() WHERE id = $1`, [
        id,
        tc.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.tc',
        entityType: 'student_withdrawals',
        entityId: id,
        after: { tcNo: tc.tcNo, tcId: tc.id },
      });
    });
    return this.get(ctx, id);
  }

  async bulkTc(ctx: RequestContext, dto: BulkTcDto) {
    const results: Array<{
      id: string;
      ok: boolean;
      tcNo?: string;
      exportId?: string | null;
      error?: string;
    }> = [];
    for (const id of [...new Set(dto.withdrawalIds)]) {
      try {
        const w = await this.issueTc(ctx, id, dto);
        results.push({ id, ok: true, tcNo: w.tc?.tcNo, exportId: w.tc?.exportId ?? null });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ id, ok: false, error: error.message });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  async complete(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findDb(c, id);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      await c.query(`SELECT app.complete_withdrawal($1)`, [id]);
      // a parent keeps the login while another child of theirs still studies here
      const parents = await c.query<{ user_id: string }>(
        `SELECT DISTINCT g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = $1 AND g.user_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM student_guardians sg2 JOIN students s2 ON s2.id = sg2.student_id
                             WHERE sg2.guardian_id = g.id AND s2.id <> $1 AND s2.status = 'active' AND s2.deleted_at IS NULL)`,
        [before.student_id],
      );
      if (parents.rows.length)
        await c.query(
          `UPDATE user_school_memberships SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
            WHERE school_id = app.current_school_id() AND person_type = 'guardian' AND user_id = ANY($1::bigint[])`,
          [parents.rows.map((p) => p.user_id)],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.complete',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: {
          status: 'completed',
          studentId: before.student_id,
          leavingOn: before.leaving_on,
          parentLoginsRevoked: parents.rows.length,
        },
      });
    });
    return this.get(ctx, id);
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findDb(c, id, true);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(before.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      if (before.tc)
        throw new DomainError(
          'withdrawal.tc_issued',
          `Cancel TC ${before.tc.tcNo} first, then the withdrawal`,
          { status: 409 },
        );
      await c.query(
        `UPDATE student_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, current_step = NULL, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.cancel',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: { status: 'cancelled', reason: dto.reason },
      });
    });
    return this.get(ctx, id);
  }
}
