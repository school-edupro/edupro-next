import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { fyStart } from '../purchase/purchase-reports.service';
import { istToday } from '../purchase/purchase-stock-core';
import { addDays, dmy, monthStart, monthWords } from './leave-engine';
import { LEAVE_LOCK, LEAVE_OFFICE, STAFF_TYPES, type DashboardQueryDto } from './leave.dto';

export const LEAVE_REPORTS = 'leave.report.view';

/** Active staff the reports count: not in the "Not required" list (docs/design/85, phase D). */
export const COUNTED = `e.deleted_at IS NULL AND e.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM staff_report_exclusions x WHERE x.employee_id = e.id AND x.status = 'active')`;

/** the department and staff-type filters on an employee `e`, bound at the given parameter numbers */
const filterAt = (dept: number, type: number) =>
  `($${String(dept)}::text IS NULL OR COALESCE(NULLIF(btrim(e.department), ''), 'No department') = $${String(dept)})
   AND ($${String(type)}::text IS NULL OR e.employee_type::text = $${String(type)})`;
const FILTER = filterAt(2, 3);

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayWords = (d: string) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!} ${dmy(d)}`;
const pct = (p: number, w: number) => (w ? Math.round((p / w) * 1000) / 10 : null);

type Status = 'in' | 'leave' | 'notin' | 'off';
interface PersonRow {
  id: string;
  name: string;
  code: string;
  dept: string;
  etype: string;
  first_punch: string | null;
  in_at: string | null;
  day_type: string | null;
  late: number;
  leave_type: string | null;
  request_id: string | null;
  portion: string | null;
  session: string | null;
  off: boolean;
}

/**
 * The staff leave & attendance dashboard (docs/design/85; rebuilt 14 Nov 2026 after a benchmark of HR and school
 * systems): a day (today unless one is picked), a department and a staff type. Six figures — in of those due, on
 * leave, not in, late, waiting for approval with the oldest, the month's attendance against last month's same days;
 * the day at a glance (in · on leave · not in · off, each person once); what needs attention with where to act; who is
 * out that day and the next seven (approved and waiting) with the periods teachers on leave leave to cover and how
 * many are covered; the people by status; departments by presence, lowest first; what waits longest; then the month's
 * trend against last month and leave by type this financial year.
 */
@Injectable()
export class LeaveDashboardService {
  constructor(private readonly db: DbService) {}

  static mayOpen(ctx: RequestContext) {
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    return has(LEAVE_REPORTS) || has(LEAVE_OFFICE);
  }

  async dashboard(ctx: RequestContext, q: Partial<DashboardQueryDto> = {}) {
    if (!LeaveDashboardService.mayOpen(ctx))
      throw new DomainError('permission-denied', 'You cannot open the leave dashboard', {
        status: 403,
      });
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    const today = istToday();
    // a day that is over or today, within the last 400 days
    const day = q.day && q.day <= today && q.day >= addDays(today, -400) ? q.day : today;
    const isToday = day === today;
    const dept = q.department?.trim() || null;
    const etype = q.type ?? null;
    const f = [day, dept, etype];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = monthStart(day);
      const prevMonth = monthStart(addDays(month, -1));
      const prevEnd = addDays(month, -1);
      // the payroll lock is about the month before this one, whatever day is shown
      const lockMonth = monthStart(addDays(monthStart(today), -1));
      const fy = fyStart(day);

      // ---- each counted person on the day ----------------------------------------------------------------------
      const rows = (
        await c.query<PersonRow>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED and FILTER are fixed fragments; values are bound
          `SELECT e.id::text, e.display_name AS name, e.employee_code AS code,
                  COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS dept, e.employee_type::text AS etype,
                  (SELECT to_char(min(p.punched_at) AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') FROM staff_punches p
                    WHERE p.employee_id = e.id AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS first_punch,
                  to_char(a.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS in_at, a.day_type,
                  COALESCE(a.late_minutes, 0) AS late,
                  COALESCE(lv.type, lt.code) AS leave_type, lv.request_id, lv.portion::text AS portion, lv.session,
                  app.staff_is_weekoff(e.id, $1::date) OR app.staff_is_holiday(e.id, $1::date, false) AS off
             FROM employees e
             LEFT JOIN staff_attendance_days a ON a.employee_id = e.id AND a.day = $1::date
             LEFT JOIN staff_leave_types lt ON lt.id = a.leave_type_id AND a.day_type = 'LV'
             LEFT JOIN LATERAL (
               SELECT t.code AS type, l.request_id::text AS request_id, l.portion, l.session
                 FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id
                 JOIN staff_leave_types t ON t.id = r.leave_type_id
                WHERE l.employee_id = e.id AND l.day = $1::date AND l.status = 'approved' AND l.kind = 'work'
                ORDER BY l.portion DESC LIMIT 1) lv ON true
            WHERE ${COUNTED} AND ${FILTER}
            ORDER BY e.display_name, e.employee_code
            LIMIT 3000`,
          f,
        )
      ).rows;
      const statusOf = (r: PersonRow): Status => {
        if (r.first_punch || r.day_type === 'P' || r.day_type === 'HD') return 'in';
        if (r.leave_type) return 'leave';
        if (r.off || r.day_type === 'WO' || r.day_type === 'H') return 'off';
        return 'notin';
      };
      const people = rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        department: r.dept,
        staffType: r.etype,
        status: statusOf(r),
        inAt: r.first_punch ?? r.in_at,
        late: Number(r.late),
        leave: r.leave_type
          ? {
              type: r.leave_type,
              half: r.portion !== null && Number(r.portion) < 1,
              session: r.session,
              requestId: r.request_id,
            }
          : null,
        periods: null as null | { due: number; covered: number },
      }));

      // ---- the periods teachers on leave leave to cover, and how many are covered ------------------------------
      const away = people.filter((p) => p.leave && p.status !== 'off').map((p) => p.id);
      if (away.length) {
        const slots = await c.query<{ emp: string; due: number; covered: number }>(
          `SELECT s.employee_id::text AS emp, count(*)::int AS due,
                  count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM timetable_substitutions x
                     WHERE x.on_date = $1::date AND (x.slot_id = s.id OR (x.absent_employee_id = s.employee_id
                       AND x.period_id = s.period_id AND x.class_section_id = s.class_section_id))))::int AS covered
             FROM timetable_slots s
             JOIN academic_years y ON y.id = s.academic_year_id AND $1::date BETWEEN y.start_date AND y.end_date
            WHERE s.weekday = EXTRACT(ISODOW FROM $1::date) AND s.employee_id = ANY($2::bigint[])
            GROUP BY s.employee_id`,
          [day, away],
        );
        const by = new Map(slots.rows.map((x) => [x.emp, x]));
        for (const p of people) {
          const x = by.get(p.id);
          if (x) p.periods = { due: x.due, covered: x.covered };
        }
      }
      const cover = people.reduce(
        (a, p) => ({
          due: a.due + (p.periods?.due ?? 0),
          covered: a.covered + (p.periods?.covered ?? 0),
        }),
        { due: 0, covered: 0 },
      );

      const count = (s: Status) => people.filter((p) => p.status === s).length;
      const glance = {
        in: count('in'),
        leave: count('leave'),
        notIn: count('notin'),
        off: count('off'),
      };

      // ---- departments: presence lowest first ------------------------------------------------------------------
      const deptMap = new Map<
        string,
        { staff: number; in: number; leave: number; notIn: number; late: number; off: number }
      >();
      for (const p of people) {
        const d = deptMap.get(p.department) ?? {
          staff: 0,
          in: 0,
          leave: 0,
          notIn: 0,
          late: 0,
          off: 0,
        };
        d.staff += 1;
        if (p.status === 'in') d.in += 1;
        if (p.leave) d.leave += 1;
        if (p.status === 'notin') d.notIn += 1;
        if (p.late > 0) d.late += 1;
        if (p.status === 'off') d.off += 1;
        deptMap.set(p.department, d);
      }
      const departments = [...deptMap.entries()]
        .map(([department, d]) => ({
          department,
          ...d,
          due: d.staff - d.off,
          presence: pct(d.in, d.staff - d.off),
        }))
        .sort(
          (a, b) =>
            (a.presence ?? 101) - (b.presence ?? 101) || a.department.localeCompare(b.department),
        );

      // ---- the month against last month's same days ------------------------------------------------------------
      // a running day is not counted: the month runs to the day before today, or to the day picked if it is over
      const upTo = isToday ? addDays(day, -1) : day;
      const hasDays = upTo >= month;
      const sameDay = addDays(prevMonth, Number(upTo.slice(8, 10)) - 1);
      const prevUpTo = hasDays && sameDay < prevEnd ? sameDay : prevEnd;
      const byDay = hasDays ? await this.byDay(c, month, upTo, dept, etype) : [];
      const prevByDay = await this.byDay(c, prevMonth, prevEnd, dept, etype);
      const pctTo = (xs: Array<{ day: string; present: number; working: number }>, to: string) => {
        const w = xs.filter((x) => x.day <= to);
        return pct(
          w.reduce((n, x) => n + x.present, 0),
          w.reduce((n, x) => n + x.working, 0),
        );
      };
      const attendance = {
        month: hasDays ? pctTo(byDay, upTo) : null,
        lastMonth: pctTo(prevByDay, prevUpTo),
        to: hasDays ? upTo : null,
        lastTo: prevUpTo,
      };

      // ---- what waits, the month's marks, the lock --------------------------------------------------------------
      const m = (
        await c.query<{
          leave: number;
          cancels: number;
          corrections: number;
          oldest: Date | null;
          late: number;
          missing: number;
          lop: string;
          locked: boolean | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED and FILTER are fixed fragments; values are bound
          `SELECT (SELECT count(*)::int FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
                    WHERE r.status = 'pending' AND ${FILTER}) AS leave,
                  (SELECT count(*)::int FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
                    WHERE r.cancel_status = 'pending' AND ${FILTER}) AS cancels,
                  (SELECT count(*)::int FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id
                    WHERE g.status = 'pending' AND ${FILTER}) AS corrections,
                  (SELECT min(x.since) FROM (
                     SELECT CASE WHEN r.status = 'pending' THEN r.created_at ELSE r.cancel_raised_at END AS since
                       FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
                      WHERE (r.status = 'pending' OR r.cancel_status = 'pending') AND ${FILTER}
                     UNION ALL
                     SELECT g.created_at FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id
                      WHERE g.status = 'pending' AND ${FILTER}) x) AS oldest,
                  (SELECT count(*)::int FROM staff_late_marks x JOIN employees e ON e.id = x.employee_id
                    WHERE x.day >= $4::date AND x.day <= $1::date AND x.status <> 'waived'
                      AND ${COUNTED} AND ${FILTER}) AS late,
                  (SELECT count(*)::int FROM staff_missing_punches x JOIN employees e ON e.id = x.employee_id
                    WHERE x.day >= $4::date AND x.day <= $1::date AND x.status = 'pending'
                      AND ${COUNTED} AND ${FILTER}) AS missing,
                  (SELECT COALESCE(sum(COALESCE(a.leave_portion, 1)), 0)::text FROM staff_attendance_days a
                     JOIN staff_leave_types t ON t.id = a.leave_type_id JOIN employees e ON e.id = a.employee_id
                    WHERE a.day >= $4::date AND a.day <= $1::date AND a.day_type = 'LV' AND t.loss_of_pay
                      AND ${COUNTED} AND ${FILTER}) AS lop,
                  (SELECT locked FROM staff_month_locks WHERE month = $5::date) AS locked`,
          [...f, month, lockMonth],
        )
      ).rows[0]!;
      const oldestDays = m.oldest
        ? Math.max(0, Math.floor((Date.now() - m.oldest.getTime()) / 86_400_000))
        : null;

      const waiting = (
        await c.query<{
          kind: string;
          id: string;
          label: string;
          name: string;
          code: string;
          dept: string;
          emp: string;
          day: string | null;
          since: Date;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- the filter is a fixed fragment; values are bound
          `SELECT * FROM (
             SELECT CASE WHEN r.status = 'pending' THEN 'leave' ELSE 'cancellation' END AS kind, r.id::text,
                    r.number AS label, e.display_name AS name, e.employee_code AS code,
                    COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS dept, e.id::text AS emp,
                    NULL::text AS day, CASE WHEN r.status = 'pending' THEN r.created_at ELSE r.cancel_raised_at END AS since
               FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
              WHERE (r.status = 'pending' OR r.cancel_status = 'pending') AND ${filterAt(1, 2)}
             UNION ALL
             SELECT 'correction', g.id::text, to_char(g.day, 'DD-MM-YYYY'), e.display_name, e.employee_code,
                    COALESCE(NULLIF(btrim(e.department), ''), 'No department'), e.id::text, g.day::text, g.created_at
               FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id
              WHERE g.status = 'pending' AND ${filterAt(1, 2)}
           ) x ORDER BY since LIMIT 10`,
          [dept, etype],
        )
      ).rows;

      // ---- who is out the next seven days (approved and waiting) -----------------------------------------------
      const upcoming = (
        await c.query<{
          day: string;
          id: string;
          name: string;
          code: string;
          dept: string;
          type: string;
          half: boolean;
          status: string;
          request_id: string;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED and FILTER are fixed fragments; values are bound
          `SELECT l.day::text, e.id::text, e.display_name AS name, e.employee_code AS code,
                  COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS dept, t.code AS type,
                  l.portion < 1 AS half, l.status, r.id::text AS request_id
             FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id
             JOIN staff_leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = l.employee_id
            WHERE l.day > $1::date AND l.day <= $1::date + 7 AND l.kind = 'work'
              AND l.status IN ('approved', 'pending') AND ${COUNTED} AND ${FILTER}
            ORDER BY l.day, e.display_name LIMIT 300`,
          f,
        )
      ).rows;
      const nextDays = Array.from({ length: 7 }, (_, i) => addDays(day, i + 1)).map((d) => ({
        day: d,
        words: dayWords(d),
        people: upcoming
          .filter((u) => u.day === d)
          .map((u) => ({
            id: u.id,
            name: u.name,
            code: u.code,
            department: u.dept,
            type: u.type,
            half: u.half,
            waiting: u.status === 'pending',
            requestId: u.request_id,
          })),
      }));

      const byType = (
        await c.query<{ code: string; name: string; days: string }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED and FILTER are fixed fragments; values are bound
          `SELECT t.code, t.name, sum(l.portion)::text AS days
             FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id
             JOIN staff_leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = l.employee_id
            WHERE l.status = 'approved' AND l.day >= $4::date AND l.day <= $1::date AND ${COUNTED} AND ${FILTER}
            GROUP BY t.code, t.name, t.sort_order ORDER BY t.sort_order, t.code`,
          [...f, fy],
        )
      ).rows;

      const departmentsAll = (
        await c.query<{ d: string }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
          `SELECT DISTINCT COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS d FROM employees e
            WHERE ${COUNTED} ORDER BY 1`,
        )
      ).rows.map((r) => r.d);

      // ---- what needs attention, each with where to act ---------------------------------------------------------
      const office = has(LEAVE_OFFICE);
      const ym = (d: string) => d.slice(0, 7);
      const attention: Array<{
        key: string;
        label: string;
        count: number;
        detail?: string;
        href: string | null;
        tone: 'danger' | 'warning' | 'info';
      }> = [];
      if (m.leave)
        attention.push({
          key: 'leave',
          label: 'Leave waiting for approval',
          count: m.leave,
          ...(oldestDays !== null
            ? { detail: `oldest waits ${String(oldestDays)} day${oldestDays === 1 ? '' : 's'}` }
            : {}),
          href: office ? '/leave/register?bucket=pending' : '/leave/approvals',
          tone: (oldestDays ?? 0) >= 3 ? 'danger' : 'warning',
        });
      if (m.cancels)
        attention.push({
          key: 'cancel',
          label: 'Cancellations waiting',
          count: m.cancels,
          href: '/leave/approvals',
          tone: 'warning',
        });
      if (m.corrections)
        attention.push({
          key: 'corrections',
          label: 'Attendance corrections waiting',
          count: m.corrections,
          href: '/leave/attendance/approvals',
          tone: 'warning',
        });
      if (cover.due > cover.covered)
        attention.push({
          key: 'cover',
          label: 'Periods to cover (teachers on leave)',
          count: cover.due - cover.covered,
          detail: `${String(cover.covered)} of ${String(cover.due)} covered`,
          href: has('academics.substitution.view') ? `/academics/substitutions?date=${day}` : null,
          tone: 'danger',
        });
      if ((office || has(LEAVE_LOCK)) && !m.locked)
        attention.push({
          key: 'lock',
          label: `${monthWords(lockMonth)} not locked for payroll`,
          count: 1,
          detail: 'lock it once its attendance is final',
          href: office
            ? `/leave/attendance?month=${ym(lockMonth)}`
            : `/payroll/inputs?tab=attendance&month=${ym(lockMonth)}`,
          tone: 'warning',
        });
      if (m.missing)
        attention.push({
          key: 'missing',
          label: `Missing punches open · ${monthWords(month)}`,
          count: m.missing,
          href: office ? `/leave/attendance/exceptions?kind=missing&month=${ym(month)}` : null,
          tone: 'info',
        });
      if (m.late)
        attention.push({
          key: 'late',
          label: `Late marks · ${monthWords(month)}`,
          count: m.late,
          href: office ? `/leave/attendance/exceptions?kind=late&month=${ym(month)}` : null,
          tone: 'info',
        });
      if (Number(m.lop))
        attention.push({
          key: 'lop',
          label: `Loss-of-pay days · ${monthWords(month)}`,
          count: Number(m.lop),
          href: '/leave/reports',
          tone: 'info',
        });

      return {
        today,
        day,
        isToday,
        dayWords: dayWords(day),
        monthWords: monthWords(month),
        lastMonthWords: monthWords(prevMonth),
        fyFrom: fy,
        filters: { department: dept, type: etype },
        options: { departments: departmentsAll, types: [...STAFF_TYPES] },
        figures: {
          staff: people.length,
          due: people.length - glance.off,
          in: glance.in,
          onLeave: people.filter((p) => p.leave).length,
          notIn: glance.notIn,
          late: people.filter((p) => p.late > 0).length,
          off: glance.off,
          waiting: m.leave + m.cancels + m.corrections,
          oldestDays,
          attendance,
        },
        glance,
        attention,
        cover,
        people,
        nextDays,
        departments,
        waiting: waiting.map((r) => ({
          kind: r.kind,
          id: r.id,
          label: r.label,
          name: r.name,
          code: r.code,
          department: r.dept,
          since: r.since.toISOString(),
          days: Math.max(0, Math.floor((Date.now() - r.since.getTime()) / 86_400_000)),
          href:
            r.kind === 'correction'
              ? `/leave/attendance/day?emp=${r.emp}&day=${r.day ?? ''}`
              : `/leave/requests/${r.id}`,
        })),
        trend: {
          thisMonth: byDay.map((x) => ({ day: x.day, percent: pct(x.present, x.working) })),
          lastMonth: prevByDay.map((x) => ({ day: x.day, percent: pct(x.present, x.working) })),
        },
        byType: byType.map((r) => ({ code: r.code, name: r.name, days: Number(r.days) })),
        lastMonth: { words: monthWords(lockMonth), month: ym(lockMonth), locked: !!m.locked },
        can: { office, lock: has(LEAVE_LOCK) },
      };
    });
  }

  /** Present (a half day counts half) of the working days, day by day, from..to. */
  private async byDay(
    c: PoolClient,
    from: string,
    to: string,
    dept: string | null,
    etype: string | null,
  ) {
    if (from > to) return [];
    return (
      await c.query<{ day: string; present: string; working: number }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED and FILTER are fixed fragments; values are bound
        `SELECT a.day::text, sum(CASE a.day_type WHEN 'P' THEN 1 WHEN 'HD' THEN 0.5 ELSE 0 END)::text AS present,
                count(*)::int AS working
           FROM staff_attendance_days a JOIN employees e ON e.id = a.employee_id
          WHERE a.day >= $4::date AND a.day <= $1::date AND a.day_type IN ('P', 'HD', 'A', 'LV', 'HOLD')
            AND ${COUNTED} AND ${FILTER}
          GROUP BY a.day ORDER BY a.day`,
        [to, dept, etype, from],
      )
    ).rows.map((r) => ({ day: r.day, present: Number(r.present), working: r.working }));
  }
}
