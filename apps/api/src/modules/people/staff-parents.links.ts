import type { PoolClient } from '@edupro/db';

/**
 * Where a parent record marked "School staff: Yes" stands with the staff member's login:
 *  joined          tied to the staff login (the app lists Staff and Parent of the child)
 *  ready           names a staff member with a login and has no login of its own: Join
 *  separate_login  has a login of its own: Use staff login moves it (that login stops seeing these children)
 *  staff_no_login  the staff member has no login yet (joined by itself when they get one)
 *  no_employee     no active staff member has the code entered
 *  no_code         School staff is Yes but no employee code is entered
 */
export type StaffParentState =
  'joined' | 'ready' | 'separate_login' | 'staff_no_login' | 'no_employee' | 'no_code';

export interface StaffParentLink {
  state: StaffParentState;
  /** the employee code as entered on the record */
  code: string | null;
  employee: { id: string; code: string; name: string } | null;
  /** joined here (Undo puts back the login it had before); false when the logins matched already */
  canUndo: boolean;
  joinedAt: string | null;
}

export interface StaffParentRow extends StaffParentLink {
  guardianId: string;
  guardianName: string;
  relation: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  section: string | null;
}

/** The staff state of guardians aliased g; e is the staff member the code names (active, this school). */
export const STATE_SQL = `
  CASE
    WHEN NULLIF(btrim(COALESCE(g.profile->>'staff_employee_id', '')), '') IS NULL THEN 'no_code'
    WHEN e.id IS NULL THEN 'no_employee'
    WHEN e.user_id IS NULL THEN 'staff_no_login'
    WHEN g.user_id = e.user_id THEN 'joined'
    WHEN g.user_id IS NULL THEN 'ready'
    ELSE 'separate_login'
  END`;
export const EMPLOYEE_JOIN = `
  LEFT JOIN employees e ON e.school_id = g.school_id AND e.deleted_at IS NULL AND e.status = 'active'
   AND lower(e.employee_code) = lower(btrim(COALESCE(g.profile->>'staff_employee_id', '')))`;
export const IS_STAFF = `COALESCE(g.profile->>'school_staff', '') = 'Yes'`;

export const TODO: StaffParentState[] = [
  'ready',
  'separate_login',
  'staff_no_login',
  'no_employee',
  'no_code',
];

export interface LinkRow {
  guardian_id: string;
  state: StaffParentState;
  code: string | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  can_undo: boolean;
  joined_at: Date | null;
}

export const linkOf = (x: LinkRow): StaffParentLink => ({
  state: x.state,
  code: x.code,
  employee:
    x.employee_id && x.employee_code
      ? { id: x.employee_id, code: x.employee_code, name: x.employee_name ?? x.employee_code }
      : null,
  canUndo: x.can_undo,
  joinedAt: x.joined_at ? x.joined_at.toISOString() : null,
});

export const LINK_COLS = `g.id::text AS guardian_id, ${STATE_SQL} AS state,
  NULLIF(btrim(COALESCE(g.profile->>'staff_employee_id', '')), '') AS code,
  e.id::text AS employee_id, e.employee_code, e.display_name AS employee_name,
  (g.staff_employee_id IS NOT NULL) AS can_undo, g.staff_joined_at AS joined_at`;

/** The staff state of each of these parent records that is marked School staff (others are left out). */
export async function staffParentLinks(
  c: PoolClient,
  guardianIds: string[],
): Promise<Map<string, StaffParentLink>> {
  if (!guardianIds.length) return new Map();
  const r = await c.query<LinkRow>(
    // eslint-disable-next-line no-restricted-syntax -- fixed fragments and numbered placeholders only; values are bound
    `SELECT ${LINK_COLS} FROM guardians g ${EMPLOYEE_JOIN}
      WHERE g.id = ANY($1::bigint[]) AND g.deleted_at IS NULL AND ${IS_STAFF}`,
    [guardianIds],
  );
  return new Map(r.rows.map((x) => [x.guardian_id, linkOf(x)]));
}
