import type { PoolClient } from 'pg';
import { loadEmployeeLists } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import type { Resolver } from '../workflow/workflow.dto';
import type { Level } from '../workflow/workflow.service';

/**
 * Approval levels set by staff (vacancy approval, employee exit): named employees, everyone holding a
 * designation, the HOD of the request's department, the reporting manager of the employee the request
 * is about, or a role. Shared by the set-up screens that keep them in the workflow engine.
 */
export type ApprovalBy = 'employees' | 'designation' | 'hod' | 'manager' | 'role';
export interface SetupLevel {
  name: string;
  by: ApprovalBy;
  employeeIds: string[];
  designation: string | null;
  roleCode: string | null;
  slaHours: number | null;
}
export interface LevelInput {
  name: string;
  by: ApprovalBy;
  employeeIds: string[];
  designation?: string;
  roleCode?: string;
  slaHours?: number | null;
}
interface Staff {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  user_id: string | null;
}

export function staffOf(c: PoolClient) {
  return c.query<Staff>(
    `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department, e.user_id::text
       FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name, e.employee_code LIMIT 3000`,
  );
}

/** A stored level as the set-up screen shows it. */
export function toSetup(l: Level, staff: Staff[]): SetupLevel {
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

/** What the set-up screen picks from: staff, designations with holders, departments' HODs, roles. */
export async function setupLists(c: PoolClient) {
  await c.query(`SELECT app.staff_masters_seed(app.current_school_id())`);
  // one query at a time: the client runs them in turn
  const staff = await staffOf(c);
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
  const held = new Map(holders.rows.map((x) => [x.d, x.n]));
  return {
    staffRows: staff.rows,
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
  };
}

/**
 * The levels as typed, checked and made into engine levels: each must have somebody who can sign in (an
 * HOD or reporting-manager level is checked per request: one nobody holds is skipped).
 */
export async function buildLevels(
  c: PoolClient,
  input: LevelInput[],
  opts: { allowManager: boolean },
): Promise<Level[]> {
  const staff = (await staffOf(c)).rows;
  const byId = new Map(staff.map((s) => [s.id, s]));
  const lists = await loadEmployeeLists(c);
  const designations = new Map((lists.Designation ?? []).map((d) => [d.toLowerCase(), d]));
  const bad = (n: number, text: string): never => {
    throw new DomainError('validation-failed', `Level ${String(n)}: ${text}`, { status: 400 });
  };
  const names = input.map((l) => l.name.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new DomainError('validation-failed', 'Each level needs its own name', { status: 400 });
  const levels: Level[] = [];
  for (const [i, l] of input.entries()) {
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
    } else if (l.by === 'manager') {
      if (!opts.allowManager) bad(n, 'the reporting manager is not a choice here');
      resolver = { kind: 'staff', by: 'manager', employeeIds: [] };
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
  return levels;
}
