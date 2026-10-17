import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { HOSTEL_H3 } from './hostel.dto';

type Row = Record<string, unknown>;
const ROLL: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  on_leave: 'On leave',
  sick: 'Sick bay',
};

/**
 * The summary at the top of the parent app's Hostel page: where the child stays and with whom, the
 * wardens to call, where the child is now (in the hostel, on home leave or on an outing, and when back),
 * the last roll-call, today's meals, and the child's hostel leave and outings.
 */
@Injectable()
export class HostelFamilyService {
  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
  ) {}

  async summary(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stay = (
        await c.query<Row>(
          `SELECT h.id::text AS "hostelId", h.name AS hostel, h.phone AS "hostelPhone", bl.name AS block, r.room_no AS room, b.label AS bed,
                  a.from_date::text AS since, r.id::text AS "roomId",
                  (SELECT count(*)::int FROM hostel_allotments a2 JOIN hostel_beds b2 ON b2.id = a2.bed_id
                    WHERE b2.room_id = r.id AND a2.student_id <> a.student_id AND a2.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
                      AND (a2.to_date IS NULL OR a2.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS "roomMates"
             FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
             JOIN hostels h ON h.id = r.hostel_id LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
            WHERE a.student_id = $1 AND a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
              AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
            ORDER BY a.from_date DESC LIMIT 1`,
          [studentId],
        )
      ).rows[0];
      if (!stay) return { boarder: false };
      const wardens = await c.query<Row>(
        `SELECT e.display_name AS name, w.is_head AS "isHead", e.mobile
           FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id
          WHERE w.hostel_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'
          ORDER BY w.is_head DESC, e.display_name`,
        [stay.hostelId],
      );
      // out now on hostel leave (gate out, not back), else the next approved leave
      const out = (
        await c.query<Row>(
          `SELECT COALESCE(g.pass_no, '#' || g.id) AS number, g.kind, g.return_by AS "returnBy", g.out_at AS "outAt"
             FROM gate_passes g WHERE g.student_id = $1 AND g.kind IN ('hostel_home', 'hostel_outing') AND g.state = 'out'
            ORDER BY g.out_at DESC LIMIT 1`,
          [studentId],
        )
      ).rows[0];
      const next = (
        await c.query<Row>(
          `SELECT COALESCE(g.pass_no, '#' || g.id) AS number, g.kind, g.on_date::text AS "onDate", to_char(g.at_time, 'HH24:MI') AS "atTime",
                  g.return_by AS "returnBy", g.state
             FROM gate_passes g WHERE g.student_id = $1 AND g.kind IN ('hostel_home', 'hostel_outing')
              AND g.state IN ('pending', 'approved', 'handed_over') AND g.on_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
            ORDER BY g.on_date, g.at_time NULLS LAST LIMIT 1`,
          [studentId],
        )
      ).rows[0];
      const roll = (
        await c.query<Row>(
          `SELECT m.status, s.name AS session, r.on_date::text AS "on", to_char(s.at_time, 'HH24:MI') AS at
             FROM hostel_rollcall_marks m JOIN hostel_rollcalls r ON r.id = m.rollcall_id JOIN hostel_rollcall_sessions s ON s.id = r.session_id
            WHERE m.student_id = $1 ORDER BY r.on_date DESC, s.at_time DESC LIMIT 1`,
          [studentId],
        )
      ).rows[0];
      // today's meals: the hostel's menu of today (a change for the day first, else its week of the cycle)
      const menu = await c.query<Row>(
        `WITH h AS (SELECT menu_cycle_weeks AS weeks, menu_cycle_start AS start FROM hostels WHERE id = $1),
              t AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
              wk AS (SELECT (((((t.d - extract(isodow FROM t.d)::int + 1) - h.start) / 7) % h.weeks + h.weeks) % h.weeks) + 1 AS n,
                            extract(dow FROM t.d)::int AS wd, t.d FROM h, t)
         SELECT m.name AS meal, to_char(m.at_time, 'HH24:MI') AS "atTime",
                COALESCE(ch.items, mn.items) AS items, ch.id IS NOT NULL AS changed, ch.note
           FROM hostel_meals m CROSS JOIN wk
           LEFT JOIN hostel_menu mn ON mn.meal_id = m.id AND mn.cycle_week = wk.n AND mn.weekday = wk.wd
           LEFT JOIN hostel_menu_changes ch ON ch.meal_id = m.id AND ch.on_date = wk.d
          WHERE m.hostel_id = $1 AND m.active ORDER BY m.at_time`,
        [stay.hostelId],
      );
      const passes = await c.query<Row>(
        `SELECT g.id::text, COALESCE(g.pass_no, '#' || g.id) AS number, g.kind, g.state, g.on_date::text AS "onDate",
                to_char(g.at_time, 'HH24:MI') AS "atTime", g.return_by AS "returnBy", g.out_at AS "outAt", g.in_at AS "inAt",
                g.late_minutes AS "lateMinutes", g.reason
           FROM gate_passes g WHERE g.student_id = $1 AND g.kind IN ('hostel_home', 'hostel_outing')
          ORDER BY g.on_date DESC, g.id DESC LIMIT 10`,
        [studentId],
      );
      return {
        boarder: true,
        stay: {
          hostel: stay.hostel,
          hostelPhone: stay.hostelPhone,
          block: stay.block,
          room: stay.room,
          bed: stay.bed,
          since: stay.since,
          roomMates: stay.roomMates,
        },
        wardens: wardens.rows,
        now: out
          ? {
              state: out.kind === 'hostel_home' ? 'home_leave' : 'outing',
              number: out.number,
              outAt: out.outAt,
              returnBy: out.returnBy,
              late: out.returnBy instanceof Date && out.returnBy.getTime() < Date.now(),
            }
          : { state: 'in_hostel' },
        next: next ?? null,
        lastRoll: roll
          ? { ...roll, label: ROLL[String(roll.status)] ?? String(roll.status) }
          : null,
        todayMenu: menu.rows,
        passes: passes.rows,
      };
    });
  }
}
