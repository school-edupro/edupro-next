import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { fyStart } from '../purchase/purchase-reports.service';
import { istToday } from '../purchase/purchase-stock-core';
import { addDays, monthStart, monthWords } from './leave-engine';
import { LEAVE_OFFICE } from './leave.dto';

export const LEAVE_REPORTS = 'leave.report.view';

/** Active staff the reports count: not in the "Not required" list (docs/design/85, phase D). */
export const COUNTED = `e.deleted_at IS NULL AND e.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM staff_report_exclusions x WHERE x.employee_id = e.id AND x.status = 'active')`;

/**
 * The leave & attendance dashboard (docs/design/85, phase D): today's figures and the month's, today by
 * department, who is on leave and late today, what waits longest; then two small charts — attendance by
 * day this month and leave by type this financial year.
 */
@Injectable()
export class LeaveDashboardService {
  constructor(private readonly db: DbService) {}

  static mayOpen(ctx: RequestContext) {
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    return has(LEAVE_REPORTS) || has(LEAVE_OFFICE);
  }

  async dashboard(ctx: RequestContext) {
    if (!LeaveDashboardService.mayOpen(ctx))
      throw new DomainError('permission-denied', 'You cannot open the leave dashboard', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = istToday();
      const month = monthStart(today);
      const fy = fyStart(today);
      const depts = await c.query<{
        dept: string;
        staff: number;
        punched: number;
        on_leave: number;
        not_in: number;
        late: number;
        off: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
        `WITH t AS (
           SELECT e.id, COALESCE(NULLIF(btrim(e.department), ''), 'No department') AS dept,
                  EXISTS (SELECT 1 FROM staff_punches p WHERE p.employee_id = e.id
                            AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS punched,
                  EXISTS (SELECT 1 FROM staff_leave_days l WHERE l.employee_id = e.id AND l.day = $1::date
                            AND l.status = 'approved') AS on_leave,
                  app.staff_is_weekoff(e.id, $1::date) OR app.staff_is_holiday(e.id, $1::date, false) AS off,
                  COALESCE((SELECT a.late_minutes FROM staff_attendance_days a WHERE a.employee_id = e.id AND a.day = $1::date), 0) AS late
             FROM employees e WHERE ${COUNTED})
         SELECT dept, count(*)::int AS staff, count(*) FILTER (WHERE punched)::int AS punched,
                count(*) FILTER (WHERE on_leave)::int AS on_leave,
                count(*) FILTER (WHERE NOT punched AND NOT on_leave AND NOT off)::int AS not_in,
                count(*) FILTER (WHERE late > 0)::int AS late,
                count(*) FILTER (WHERE off AND NOT punched)::int AS off
           FROM t GROUP BY dept ORDER BY dept`,
        [today],
      );
      const sum = (k: keyof (typeof depts.rows)[number]) =>
        depts.rows.reduce((n, r) => n + Number(r[k]), 0);
      const m = (
        await c.query<{
          late: number;
          missing: number;
          lop: string;
          waiting: number;
          corrections: number;
          present: string;
          working: number;
          locked: boolean | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
          `SELECT (SELECT count(*)::int FROM staff_late_marks x JOIN employees e ON e.id = x.employee_id
                    WHERE x.day >= $1::date AND x.status <> 'waived' AND ${COUNTED}) AS late,
                  (SELECT count(*)::int FROM staff_missing_punches x JOIN employees e ON e.id = x.employee_id
                    WHERE x.day >= $1::date AND x.status <> 'retired' AND ${COUNTED}) AS missing,
                  (SELECT COALESCE(sum(COALESCE(a.leave_portion, 1)), 0)::text FROM staff_attendance_days a
                     JOIN staff_leave_types t ON t.id = a.leave_type_id JOIN employees e ON e.id = a.employee_id
                    WHERE a.day >= $1::date AND a.day_type = 'LV' AND t.loss_of_pay AND ${COUNTED}) AS lop,
                  (SELECT count(*)::int FROM staff_leave_requests r WHERE r.status = 'pending' OR r.cancel_status = 'pending') AS waiting,
                  (SELECT count(*)::int FROM staff_regularisations g WHERE g.status = 'pending') AS corrections,
                  (SELECT COALESCE(sum(CASE a.day_type WHEN 'P' THEN 1 WHEN 'HD' THEN 0.5 ELSE 0 END), 0)::text
                     FROM staff_attendance_days a JOIN employees e ON e.id = a.employee_id
                    WHERE a.day >= $1::date AND a.day < $2::date AND a.day_type IN ('P', 'HD', 'A', 'LV', 'HOLD') AND ${COUNTED}) AS present,
                  (SELECT count(*)::int FROM staff_attendance_days a JOIN employees e ON e.id = a.employee_id
                    WHERE a.day >= $1::date AND a.day < $2::date AND a.day_type IN ('P', 'HD', 'A', 'LV', 'HOLD') AND ${COUNTED}) AS working,
                  (SELECT locked FROM staff_month_locks WHERE month = $3::date) AS locked`,
          [month, today, monthStart(addDays(month, -1))],
        )
      ).rows[0]!;
      const onLeave = await c.query<{
        id: string;
        name: string;
        code: string;
        dept: string | null;
        type: string;
        from_date: string;
        to_date: string;
        half: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
        `SELECT r.id::text, e.display_name AS name, e.employee_code AS code, e.department AS dept, t.code AS type,
                r.from_date::text, r.to_date::text, l.portion < 1 AS half
           FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id
           JOIN staff_leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = l.employee_id
          WHERE l.day = $1::date AND l.status = 'approved' AND ${COUNTED}
          ORDER BY e.display_name LIMIT 50`,
        [today],
      );
      const late = await c.query<{
        id: string;
        name: string;
        code: string;
        dept: string | null;
        at: string;
        minutes: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
        `SELECT e.id::text, e.display_name AS name, e.employee_code AS code, e.department AS dept,
                to_char(a.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at, a.late_minutes AS minutes
           FROM staff_attendance_days a JOIN employees e ON e.id = a.employee_id
          WHERE a.day = $1::date AND a.late_minutes > 0 AND ${COUNTED}
          ORDER BY a.late_minutes DESC LIMIT 50`,
        [today],
      );
      const waiting = await c.query<{
        kind: string;
        id: string;
        label: string;
        name: string;
        emp: string;
        day: string | null;
        since: Date;
      }>(
        `SELECT * FROM (
           SELECT CASE WHEN r.status = 'pending' THEN 'leave' ELSE 'cancellation' END AS kind, r.id::text, r.number AS label,
                  e.display_name AS name, e.id::text AS emp, NULL::text AS day,
                  CASE WHEN r.status = 'pending' THEN r.created_at ELSE r.cancel_raised_at END AS since
             FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
            WHERE r.status = 'pending' OR r.cancel_status = 'pending'
           UNION ALL
           SELECT 'correction', g.id::text, to_char(g.day, 'DD-MM-YYYY'), e.display_name, e.id::text, g.day::text, g.created_at
             FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id WHERE g.status = 'pending'
         ) x ORDER BY since LIMIT 10`,
      );
      const byDay = await c.query<{ day: string; present: string; working: number }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
        `SELECT a.day::text, sum(CASE a.day_type WHEN 'P' THEN 1 WHEN 'HD' THEN 0.5 ELSE 0 END)::text AS present,
                count(*)::int AS working
           FROM staff_attendance_days a JOIN employees e ON e.id = a.employee_id
          WHERE a.day >= $1::date AND a.day <= $2::date AND a.day_type IN ('P', 'HD', 'A', 'LV', 'HOLD') AND ${COUNTED}
          GROUP BY a.day ORDER BY a.day`,
        [month, today],
      );
      const byType = await c.query<{ code: string; name: string; days: string }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment
        `SELECT t.code, t.name, sum(l.portion)::text AS days
           FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id
           JOIN staff_leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = l.employee_id
          WHERE l.status = 'approved' AND l.day >= $1::date AND l.day <= $2::date AND ${COUNTED}
          GROUP BY t.code, t.name, t.sort_order ORDER BY t.sort_order, t.code`,
        [fy, today],
      );
      const pct = (p: number, w: number) => (w ? Math.round((p / w) * 1000) / 10 : null);
      return {
        today,
        monthWords: monthWords(month),
        fyFrom: fy,
        figures: {
          staff: sum('staff'),
          punched: sum('punched'),
          onLeave: sum('on_leave'),
          notIn: sum('not_in'),
          late: sum('late'),
          off: sum('off'),
          waiting: m.waiting,
          corrections: m.corrections,
          lateMarks: m.late,
          missing: m.missing,
          lopDays: Number(m.lop),
          attendance: pct(Number(m.present), m.working),
        },
        lastMonth: {
          words: monthWords(addDays(month, -1)),
          month: addDays(month, -1).slice(0, 7),
          locked: !!m.locked,
        },
        departments: depts.rows.map((r) => ({
          department: r.dept,
          staff: r.staff,
          punched: r.punched,
          onLeave: r.on_leave,
          notIn: r.not_in,
          late: r.late,
          off: r.off,
        })),
        onLeave: onLeave.rows.map((r) => ({ ...r, department: r.dept })),
        lateToday: late.rows.map((r) => ({ ...r, department: r.dept })),
        waiting: waiting.rows.map((r) => ({
          ...r,
          since: r.since.toISOString(),
          href:
            r.kind === 'correction'
              ? `/leave/attendance/day?emp=${r.emp}&day=${r.day ?? ''}`
              : `/leave/requests/${r.id}`,
        })),
        byDay: byDay.rows.map((r) => ({ day: r.day, percent: pct(Number(r.present), r.working) })),
        byType: byType.rows.map((r) => ({ code: r.code, name: r.name, days: Number(r.days) })),
      };
    });
  }
}
