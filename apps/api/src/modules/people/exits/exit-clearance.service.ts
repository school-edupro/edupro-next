import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { PEOPLE } from '../people.permissions';
import type { ClearDto } from './exits.dto';

/** Who may clear a department of an exit. */
export type ClearanceApprover =
  | { kind: 'office' }
  | { kind: 'hod' }
  | { kind: 'role'; code: string }
  | { kind: 'user'; userId: string };

export interface ClearanceCheck {
  kind: 'library' | 'assets';
  /** Something is owed (books out, money unpaid). */
  due: boolean;
  amount: number;
  detail: string;
}
export interface ClearanceRow {
  department: string;
  name: string;
  auto: 'library' | 'assets' | null;
  status: 'pending' | 'cleared';
  dues: number;
  note: string | null;
  actedBy: string | null;
  actedAt: string | null;
  approvers: string[];
  check: ClearanceCheck | null;
  mayClear: boolean;
}
export interface Actor {
  userId: string;
  manage: boolean;
  roles: Set<string>;
  /** departments (names and codes, lower case) whose HOD the actor is */
  hodOf: Set<string>;
}

const money = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function approverText(a: ClearanceApprover, roleNames: Map<string, string>): string {
  if (a.kind === 'office') return 'The office (exit rights)';
  if (a.kind === 'hod') return 'HOD of the employee’s department';
  if (a.kind === 'role') return roleNames.get(a.code) ?? a.code;
  return 'A named person';
}

/**
 * Employee exit, part 6 (docs/design/38): the no-dues clearance of an accepted exit. Each department in
 * use clears it or notes dues with an amount (recovered in the full and final statement); library books
 * on loan and unpaid library fines and charges are shown from the system.
 */
@Injectable()
export class ExitClearanceService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The board of an accepted exit: one row per department in use, made once. */
  async makeBoard(c: PoolClient, exitId: string) {
    await c.query(
      `INSERT INTO exit_clearances (school_id, exit_id, department, name, auto, approvers, sort_order)
       SELECT app.current_school_id(), $1, d.code, d.name, d.auto, d.approvers, d.sort_order
         FROM exit_clearance_departments d
        WHERE d.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM exit_clearances x WHERE x.exit_id = $1)
       ON CONFLICT DO NOTHING`,
      [exitId],
    );
  }

  async actorOf(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const roles = await c.query<{ code: string }>(
      `SELECT DISTINCT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
    );
    const hod = await c.query<{ name: string; code: string }>(
      `SELECT lower(d.name) AS name, lower(d.code) AS code FROM departments d JOIN employees e ON e.id = d.hod_employee_id
        WHERE e.user_id = app.current_user_id() AND e.deleted_at IS NULL AND d.status = 'active'`,
    );
    return {
      userId: ctx.user.id,
      manage: ctx.permissions?.has(PEOPLE.exitManage) === true,
      roles: new Set(roles.rows.map((x) => x.code)),
      hodOf: new Set(hod.rows.flatMap((x) => [x.name, x.code])),
    };
  }

  mayAct(a: ClearanceApprover[], actor: Actor, department: string | null): boolean {
    return a.some((x) =>
      x.kind === 'office'
        ? actor.manage
        : x.kind === 'hod'
          ? department !== null && actor.hodOf.has(department.toLowerCase())
          : x.kind === 'role'
            ? actor.roles.has(x.code)
            : x.userId === actor.userId,
    );
  }

  /** What the system knows the employee owes a department. */
  async check(
    c: PoolClient,
    employeeId: string,
    auto: 'library' | 'assets' | null,
  ): Promise<ClearanceCheck | null> {
    if (auto === 'assets')
      return {
        kind: 'assets',
        due: false,
        amount: 0,
        detail: 'EduPro keeps no asset register yet: note any asset not returned as dues.',
      };
    if (auto !== 'library') return null;
    const r = await c.query<{ open: number; fines: string; charges: string }>(
      `SELECT count(*) FILTER (WHERE returned_on IS NULL)::int AS open,
              app.library_fines_unsent('employee', $1)::text AS fines,
              app.library_charges_due('employee', $1)::text AS charges
         FROM library_loans WHERE borrower_kind = 'employee' AND borrower_id = $1`,
      [employeeId],
    );
    const open = r.rows[0]?.open ?? 0;
    const fines = Number(r.rows[0]?.fines ?? 0);
    const charges = Number(r.rows[0]?.charges ?? 0);
    const parts = [
      open ? `${String(open)} book${open === 1 ? '' : 's'} not returned` : null,
      fines ? `${money(fines)} fine unpaid` : null,
      charges ? `${money(charges)} of library charges unpaid (lost or damaged books)` : null,
    ].filter(Boolean);
    return {
      kind: 'library',
      due: parts.length > 0,
      amount: fines + charges,
      detail: parts.length ? parts.join(', ') : 'No books out and nothing unpaid',
    };
  }

  /** The rows of an exit's board, with what the system shows and what the signed-in person may do. */
  async rowsWith(
    c: PoolClient,
    ctx: RequestContext,
    exit: { id: string; employeeId: string; department: string | null; open: boolean },
  ): Promise<ClearanceRow[]> {
    const r = await c.query<{
      department: string;
      name: string;
      auto: 'library' | 'assets' | null;
      approvers: ClearanceApprover[];
      status: 'pending' | 'cleared';
      dues: string;
      note: string | null;
      check_result: ClearanceCheck | null;
      acted_by: string | null;
      acted_at: Date | null;
    }>(
      `SELECT x.department, x.name, x.auto, x.approvers, x.status, x.dues::text, x.note, x.check_result,
              u.display_name AS acted_by, x.acted_at
         FROM exit_clearances x LEFT JOIN users u ON u.id = x.acted_by
        WHERE x.exit_id = $1 ORDER BY x.sort_order, x.name`,
      [exit.id],
    );
    if (!r.rows.length) return [];
    const actor = await this.actorOf(c, ctx);
    const roleNames = new Map(
      (
        await c.query<{ code: string; name: string }>(
          `SELECT DISTINCT ON (code) code, name FROM roles WHERE school_id IS NULL OR school_id = app.current_school_id() ORDER BY code, school_id NULLS LAST`,
        )
      ).rows.map((x) => [x.code, x.name]),
    );
    const out: ClearanceRow[] = [];
    for (const x of r.rows)
      out.push({
        department: x.department,
        name: x.name,
        auto: x.auto,
        status: x.status,
        dues: Number(x.dues),
        note: x.note,
        actedBy: x.acted_by,
        actedAt: x.acted_at?.toISOString() ?? null,
        approvers: x.approvers.map((a) => approverText(a, roleNames)),
        check:
          x.status === 'cleared' ? x.check_result : await this.check(c, exit.employeeId, x.auto),
        mayClear: exit.open && this.mayAct(x.approvers, actor, exit.department),
      });
    return out;
  }

  private async exitOf(c: PoolClient, exitId: string) {
    if (!/^\d{1,18}$/.test(exitId))
      throw new DomainError('not-found', 'Exit not found', { status: 404 });
    const r = await c.query<{
      id: string;
      employee_id: string;
      department: string | null;
      status: string;
      name: string;
    }>(
      `SELECT x.id::text, x.employee_id::text, e.department, x.status, e.display_name AS name
         FROM employee_exits x JOIN employees e ON e.id = x.employee_id WHERE x.id = $1`,
      [exitId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Exit not found', { status: 404 });
    return r.rows[0];
  }

  /** A department clears the exit, noting the dues (0 when nothing is owed). */
  async clear(ctx: RequestContext, exitId: string, department: string, dto: ClearDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.exitOf(c, exitId);
      if (x.status !== 'approved')
        throw new DomainError(
          'people.exit_not_accepted',
          'The no-dues clearance starts once the exit is accepted',
          { status: 409 },
        );
      await this.makeBoard(c, exitId);
      const row = await c.query<{
        status: string;
        approvers: ClearanceApprover[];
        auto: 'library' | 'assets' | null;
        name: string;
      }>(
        `SELECT status, approvers, auto, name FROM exit_clearances WHERE exit_id = $1 AND department = $2 FOR UPDATE`,
        [exitId, department],
      );
      const d = row.rows[0];
      if (!d) throw new DomainError('not-found', 'Department not on this exit', { status: 404 });
      if (d.status === 'cleared')
        throw new DomainError('people.clearance_done', `${d.name} has already cleared it`, {
          status: 409,
        });
      if (!this.mayAct(d.approvers, await this.actorOf(c, ctx), x.department))
        throw new DomainError('permission-denied', `You do not clear for ${d.name}`, {
          status: 403,
        });
      const check = await this.check(c, x.employee_id, d.auto);
      // what the system shows as owed is either settled now or written down
      if (check?.due && !(dto.dues > 0) && !dto.note?.trim())
        throw new DomainError(
          'validation-failed',
          `${check.detail}: note the dues (an amount) or why it is cleared anyway`,
          { status: 400, extra: { errors: { dues: 'is owed' } } },
        );
      await c.query(
        `UPDATE exit_clearances SET status = 'cleared', dues = $3, note = $4, check_result = $5::jsonb,
                acted_by = app.current_user_id(), acted_at = now()
          WHERE exit_id = $1 AND department = $2`,
        [exitId, department, dto.dues.toFixed(2), dto.note?.trim() || null, JSON.stringify(check)],
      );
      await c.query(
        `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
         VALUES (app.current_school_id(), $1, 'cleared', $2, app.current_user_id(), $3)`,
        [
          exitId,
          `${d.name}${dto.dues > 0 ? `: dues ${money(dto.dues)}` : ': no dues'}${dto.note?.trim() ? ` (${dto.note.trim()})` : ''}`,
          ctx.user.displayName,
        ],
      );
      const left = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM exit_clearances WHERE exit_id = $1 AND status = 'pending'`,
        [exitId],
      );
      if (left.rows[0]!.n === 0)
        await c.query(
          `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
           VALUES (app.current_school_id(), $1, 'all_cleared', NULL, app.current_user_id(), $2)`,
          [exitId, ctx.user.displayName],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.exit.clear',
        entityType: 'employee_exits',
        entityId: exitId,
        after: { department, dues: dto.dues, note: dto.note ?? null },
      });
      return { cleared: department, pending: left.rows[0]!.n };
    });
  }

  /** The office opens a department's clearance again (a mistake, dues found later). */
  async reopen(ctx: RequestContext, exitId: string, department: string, reason?: string) {
    if (ctx.permissions?.has(PEOPLE.exitManage) !== true)
      throw new DomainError('permission-denied', 'Only the office opens a clearance again', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.exitOf(c, exitId);
      if (x.status !== 'approved')
        throw new DomainError('people.exit_not_accepted', 'The exit is not in clearance', {
          status: 409,
        });
      const r = await c.query<{ name: string }>(
        `UPDATE exit_clearances SET status = 'pending', dues = 0, note = NULL, check_result = NULL, acted_by = NULL, acted_at = NULL
          WHERE exit_id = $1 AND department = $2 AND status = 'cleared' RETURNING name`,
        [exitId, department],
      );
      if (!r.rows[0])
        throw new DomainError('people.clearance_open', 'That department has not cleared it', {
          status: 409,
        });
      await c.query(
        `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
         VALUES (app.current_school_id(), $1, 'reopened', $2, app.current_user_id(), $3)`,
        [exitId, `${r.rows[0].name}${reason ? `: ${reason}` : ''}`, ctx.user.displayName],
      );
      return { reopened: department };
    });
  }

  /**
   * The no-dues board: accepted exits with their departments. `mine`: only the exits with a department
   * waiting for the signed-in person (the staff app, the header count).
   */
  async board(ctx: RequestContext, opts: { mine: boolean }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const exits = await c.query<{
        id: string;
        employee_id: string;
        name: string;
        code: string;
        department: string | null;
        designation: string | null;
        last_day: string | null;
        exit_type: string;
      }>(
        `SELECT x.id::text, x.employee_id::text, e.display_name AS name, e.employee_code AS code, e.department, e.designation,
                COALESCE(x.accepted_last_day, x.proposed_last_day)::text AS last_day, COALESCE(t.name, x.exit_type) AS exit_type
           FROM employee_exits x JOIN employees e ON e.id = x.employee_id
           LEFT JOIN employee_exit_types t ON t.code = x.exit_type
          WHERE x.status = 'approved' ORDER BY COALESCE(x.accepted_last_day, x.proposed_last_day), x.id`,
      );
      const data = [];
      for (const x of exits.rows) {
        await this.makeBoard(c, x.id);
        const rows = await this.rowsWith(c, ctx, {
          id: x.id,
          employeeId: x.employee_id,
          department: x.department,
          open: true,
        });
        if (opts.mine && !rows.some((r) => r.status === 'pending' && r.mayClear)) continue;
        data.push({
          id: x.id,
          employee: {
            id: x.employee_id,
            name: x.name,
            code: x.code,
            department: x.department,
            designation: x.designation,
          },
          exitType: x.exit_type,
          lastDay: x.last_day,
          clearances: rows,
          pending: rows.filter((r) => r.status === 'pending').length,
          dues: rows.reduce((s, r) => s + r.dues, 0),
        });
      }
      return { data };
    });
  }
}
