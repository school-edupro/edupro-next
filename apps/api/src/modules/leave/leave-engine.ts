/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import type { Level } from '../workflow/workflow.service';

/**
 * The leave engine (docs/design/85, phase B): the day count of an application (weekly offs and holidays,
 * the sandwich inside it and the bridge to a neighbouring leave), the checks in the order the earlier
 * module made them, the balance held and given back, and the approval levels as an engine workflow.
 */

export type DayKind = 'work' | 'weekoff' | 'holiday' | 'optional';
export type Source =
  'self' | 'on_behalf' | 'auto_late' | 'auto_missing' | 'auto_absent' | 'auto_rule' | 'import';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  loss_of_pay: boolean;
  keeps_balance: boolean;
  half_day: boolean;
  auto_approve: boolean;
  document_needed: boolean;
  gap_from_other: boolean;
  advance_allowed: boolean;
  min_days: string | null;
  max_days: string | null;
  max_per_month: string | null;
  for_male: boolean;
  for_female: boolean;
  status: string;
}

export interface Policy {
  id: string;
  name: string;
  min_days: string | null;
  max_days: string | null;
  sandwich_weekoff: boolean;
  sandwich_holiday: boolean;
  sandwich_optional: boolean;
}

export interface Staff {
  id: string;
  code: string;
  name: string;
  department: string | null;
  gender: string | null;
  user_id: string | null;
}

export const fail = (message: string, status = 400): never => {
  throw new DomainError('validation-failed', message, { status });
};

export const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthWords = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]!} ${d.slice(0, 4)}`;
export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const TYPE_COLS = `t.id::text, t.code, t.name, t.paid, t.loss_of_pay, t.keeps_balance, t.half_day, t.auto_approve,
  t.document_needed, t.gap_from_other, t.advance_allowed, t.min_days::text, t.max_days::text, t.max_per_month::text,
  t.for_male, t.for_female, t.status`;

export async function leaveType(c: PoolClient, id: string): Promise<LeaveType> {
  const r = await c.query<LeaveType>(
    `SELECT ${TYPE_COLS} FROM staff_leave_types t WHERE t.id = $1`,
    [id],
  );
  const t = r.rows[0];
  if (!t || t.status !== 'active') fail('Pick an active leave type');
  return t!;
}

export async function staffOf(c: PoolClient, employeeId: string): Promise<Staff> {
  const r = await c.query<Staff>(
    `SELECT id::text, employee_code AS code, display_name AS name, department, gender::text, user_id::text
       FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
    [employeeId],
  );
  if (!r.rows[0]) fail('The employee is not on the active staff', 404);
  return r.rows[0]!;
}

/** The employee's policy for a leave type: the first by priority whose scope takes them in. */
export async function policyFor(c: PoolClient, employeeId: string, typeId: string) {
  const r = await c.query<Policy>(
    `SELECT p.id::text, p.name, p.min_days::text, p.max_days::text, p.sandwich_weekoff, p.sandwich_holiday, p.sandwich_optional
       FROM staff_leave_policies p
      WHERE p.leave_type_id = $1 AND p.status = 'active' AND app.staff_in_scope(p.scope, p.scope_values, $2)
      ORDER BY p.priority, p.id LIMIT 1`,
    [typeId, employeeId],
  );
  return r.rows[0] ?? null;
}

/** Each day of a range: a working day, a weekly off, a declared holiday or an optional holiday. */
export async function dayKinds(c: PoolClient, employeeId: string, from: string, to: string) {
  const r = await c.query<{ day: string; kind: DayKind }>(
    `SELECT d::date::text AS day,
            CASE WHEN app.staff_is_weekoff($1, d::date) THEN 'weekoff'
                 WHEN app.staff_is_holiday($1, d::date, false) THEN 'holiday'
                 WHEN app.staff_is_holiday($1, d::date, true) THEN 'optional'
                 ELSE 'work' END AS kind
       FROM generate_series($2::date, $3::date, interval '1 day') d`,
    [employeeId, from, to],
  );
  return r.rows;
}

/** An optional holiday is a working day unless the policy treats it as a holiday. */
export const isOff = (k: DayKind, p: Policy | null) =>
  k === 'weekoff' || k === 'holiday' || (k === 'optional' && !!p?.sandwich_optional);

/** Is an off day between two leave days charged under the policy's sandwich? */
export const sandwiched = (k: DayKind, p: Policy | null) =>
  k === 'weekoff'
    ? !!p?.sandwich_weekoff
    : k === 'holiday' || k === 'optional'
      ? !!p?.sandwich_holiday
      : true;

/** The first month of these days locked for payroll, in words. */
export async function lockedMonth(c: PoolClient, days: string[]) {
  if (!days.length) return null;
  const r = await c.query<{ m: string }>(
    `SELECT month::text AS m FROM staff_month_locks
      WHERE locked AND month = ANY($1::date[]) ORDER BY month LIMIT 1`,
    [[...new Set(days.map(monthStart))]],
  );
  return r.rows[0] ? monthWords(r.rows[0].m) : null;
}

export async function mustBeOpen(c: PoolClient, days: string[], what: string) {
  const m = await lockedMonth(c, days);
  if (m) fail(`${m} is locked for payroll: ${what} after the office unlocks it`, 409);
}

/**
 * The bridge (the sandwich across two leaves): the nearest live leave day on each side within 60 days;
 * when every day between is a weekly off or holiday and both leaves' policies charge that kind, those days
 * belong to the new leave.
 */
export async function bridgeDays(
  c: PoolClient,
  employeeId: string,
  policy: Policy | null,
  from: string,
  to: string,
) {
  const out: Array<{ day: string; kind: DayKind }> = [];
  for (const side of ['before', 'after'] as const) {
    const n = await c.query<{ day: string | null }>(
      side === 'before'
        ? `SELECT max(day)::text AS day FROM staff_leave_days WHERE employee_id = $1 AND status IN ('pending', 'approved')
             AND day < $2::date AND day >= $2::date - 60`
        : `SELECT min(day)::text AS day FROM staff_leave_days WHERE employee_id = $1 AND status IN ('pending', 'approved')
             AND day > $2::date AND day <= $2::date + 60`,
      [employeeId, side === 'before' ? from : to],
    );
    const near = n.rows[0]?.day;
    if (!near) continue;
    const gapFrom = side === 'before' ? addDays(near, 1) : addDays(to, 1);
    const gapTo = side === 'before' ? addDays(from, -1) : addDays(near, -1);
    if (gapFrom > gapTo) continue;
    const gap = await dayKinds(c, employeeId, gapFrom, gapTo);
    if (gap.some((g) => !isOff(g.kind, policy))) continue;
    // the neighbour's policies (a split day may hold two leaves): any one that charges the kind
    const theirs = await c.query<Policy>(
      `SELECT p.id::text, p.name, p.min_days::text, p.max_days::text, p.sandwich_weekoff, p.sandwich_holiday, p.sandwich_optional
         FROM staff_leave_days d JOIN staff_leave_requests r ON r.id = d.request_id
         JOIN LATERAL (SELECT x.* FROM staff_leave_policies x WHERE x.leave_type_id = r.leave_type_id AND x.status = 'active'
                         AND app.staff_in_scope(x.scope, x.scope_values, $1) ORDER BY x.priority, x.id LIMIT 1) p ON true
        WHERE d.employee_id = $1 AND d.day = $2::date AND d.status IN ('pending', 'approved')`,
      [employeeId, near],
    );
    for (const g of gap)
      if (sandwiched(g.kind, policy) && theirs.rows.some((p) => sandwiched(g.kind, p))) out.push(g);
  }
  return out;
}

/** The balance left in the month's row (opened if missing): opening + credited + correction − held. */
export async function available(c: PoolClient, employeeId: string, typeId: string, month: string) {
  const r = await c.query<{ v: string }>(
    `SELECT (b.opening + b.credited + b.correction - b.held)::text AS v FROM app.staff_leave_balance_row($1, $2, $3::date) b`,
    [employeeId, typeId, month],
  );
  return Number(r.rows[0]?.v ?? 0);
}

/** Hold days in the month the leave is raised (it shows as availed while it waits). */
export async function hold(
  c: PoolClient,
  employeeId: string,
  typeId: string,
  month: string,
  days: number,
  line: string,
  today: string,
) {
  await c.query(`SELECT app.staff_leave_balance_row($1, $2, $3::date)`, [
    employeeId,
    typeId,
    month,
  ]);
  await c.query(
    `UPDATE staff_leave_balances SET held = held + $4, updated_at = now(), trail = trail || $5::text
      WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date`,
    [employeeId, typeId, month, days, `${dmy(today)} held ${String(days)} — ${line}`],
  );
  await c.query(`SELECT app.staff_leave_resync($1, $2, $3::date)`, [employeeId, typeId, month]);
}

/**
 * Give held days back: into the month they were held in while it is open; once that month is closed, into
 * this month as a correction (the earlier module re-closed past months — this keeps closed months closed).
 */
export async function release(
  c: PoolClient,
  employeeId: string,
  typeId: string,
  heldMonth: string,
  days: number,
  line: string,
  today: string,
) {
  if (days <= 0) return;
  const r = await c.query<{ closed: boolean }>(
    `SELECT closed FROM staff_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date FOR UPDATE`,
    [employeeId, typeId, heldMonth],
  );
  if (r.rows[0] && !r.rows[0].closed) {
    await c.query(
      `UPDATE staff_leave_balances SET held = GREATEST(0, held - $4), updated_at = now(), trail = trail || $5::text
        WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date`,
      [employeeId, typeId, heldMonth, days, `${dmy(today)} given back ${String(days)} — ${line}`],
    );
    await c.query(`SELECT app.staff_leave_resync($1, $2, $3::date)`, [
      employeeId,
      typeId,
      heldMonth,
    ]);
    return;
  }
  const now = monthStart(today);
  await c.query(`SELECT app.staff_leave_balance_row($1, $2, $3::date)`, [employeeId, typeId, now]);
  await c.query(
    `UPDATE staff_leave_balances SET correction = correction + $4, updated_at = now(), trail = trail || $5::text
      WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date`,
    [
      employeeId,
      typeId,
      now,
      days,
      `${dmy(today)} given back ${String(days)} — ${line} (held in ${monthWords(heldMonth)}, closed)`,
    ],
  );
}

/**
 * The approval levels of a rule's band as a workflow definition (made or brought up to date when used):
 * the employee never approves their own leave — their level passes on, the last one to the school admin —
 * and a level nobody holds is skipped.
 */
export async function leaveFlow(
  c: PoolClient,
  entity: 'staff_leave' | 'staff_leave_cancel',
  ruleId: string,
  ruleName: string,
  band: number,
  levels: Level[],
) {
  const code = `${entity}_${ruleId}_${String(band)}`;
  const lv: Level[] = levels.map((l, i) => ({
    ...l,
    level: i + 1,
    autoSkip: true,
    noSelfApproval: true,
  }));
  const name = `${entity === 'staff_leave' ? 'Leave' : 'Leave cancellation'} · ${ruleName}`;
  const upd = await c.query(
    `UPDATE workflow_definitions SET name = $2, levels = $3::jsonb, creator_roles = '{}', status = 'active', updated_at = now(),
            updated_by = app.current_user_id()
      WHERE code = $1 AND deleted_at IS NULL`,
    [code, name, JSON.stringify(lv)],
  );
  if (!upd.rowCount)
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, '{}', app.current_user_id(), app.current_user_id())`,
      [code, name, entity, JSON.stringify(lv)],
    );
  return code;
}
