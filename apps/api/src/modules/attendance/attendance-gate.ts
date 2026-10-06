/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (time zone, column lists); every value is bound */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

const TZ = `'Asia/Kolkata'`;

export interface Windows {
  classFrom: string | null;
  classTo: string | null;
  busPickFrom: string | null;
  busPickTo: string | null;
  busDropFrom: string | null;
  busDropTo: string | null;
  backDays: number;
  /** The school has set its windows; until then marking is not limited. */
  configured: boolean;
}
export interface WindowState {
  /** The person asking may mark now. */
  open: boolean;
  /** Marking now is outside the window (an admin, or a reopened day): the session is flagged late. */
  late: boolean;
  from: string | null;
  to: string | null;
  /** Why it is closed, or what lets it stay open. */
  note: string | null;
}
export interface Hint {
  leave: { number: string; from: string; to: string } | null;
  pass: {
    kind: 'early_leave' | 'late_arrival';
    number: string;
    atTime: string | null;
    state: string;
    outAt: string | null;
    inAt: string | null;
  } | null;
}
export type Target =
  | { scope: 'class'; classSectionId: string }
  | { scope: 'bus'; routeId: string; trip: 'pick' | 'drop' };

/**
 * What class and bus attendance share (0083): the marking windows the school sets, a day reopened for a
 * teacher, and what is already known about a pupil on a date (an approved leave, a gate pass).
 */
@Injectable()
export class AttendanceGate {
  async windows(c: PoolClient): Promise<Windows> {
    const r = await c.query<Record<string, string | number | null>>(
      `SELECT to_char(class_from, 'HH24:MI') AS class_from, to_char(class_to, 'HH24:MI') AS class_to,
              to_char(bus_pick_from, 'HH24:MI') AS bus_pick_from, to_char(bus_pick_to, 'HH24:MI') AS bus_pick_to,
              to_char(bus_drop_from, 'HH24:MI') AS bus_drop_from, to_char(bus_drop_to, 'HH24:MI') AS bus_drop_to, back_days
         FROM attendance_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0] ?? {};
    const t = (k: string) => (x[k] === null || x[k] === undefined ? null : String(x[k]));
    return {
      classFrom: t('class_from'),
      classTo: t('class_to'),
      busPickFrom: t('bus_pick_from'),
      busPickTo: t('bus_pick_to'),
      busDropFrom: t('bus_drop_from'),
      busDropTo: t('bus_drop_to'),
      backDays: Number(x.back_days ?? 0),
      configured: r.rows.length > 0,
    };
  }

  /**
   * Whether marking `date` is open for this person. Someone who runs attendance (`manager`) always may;
   * a teacher may inside today's window, for the few days back the school allows, or while the day is
   * reopened for their class or route.
   */
  async state(c: PoolClient, target: Target, date: string, manager: boolean): Promise<WindowState> {
    const w = await this.windows(c);
    const [from, to] =
      target.scope === 'class'
        ? [w.classFrom, w.classTo]
        : target.trip === 'pick'
          ? [w.busPickFrom, w.busPickTo]
          : [w.busDropFrom, w.busDropTo];
    const now = await c.query<{ today: string; hm: string; days: number }>(
      `SELECT (now() AT TIME ZONE ${TZ})::date::text AS today, to_char(now() AT TIME ZONE ${TZ}, 'HH24:MI') AS hm,
              ((now() AT TIME ZONE ${TZ})::date - $1::date)::int AS days`,
      [date],
    );
    const { hm, days } = now.rows[0]!;
    if (!w.configured) return { open: true, late: false, from: null, to: null, note: null };
    const inside = days === 0 && (!from || hm >= from) && (!to || hm <= to);
    if (inside) return { open: true, late: false, from, to, note: null };
    if (manager)
      return {
        open: true,
        late: true,
        from,
        to,
        note: 'Outside the marking window: saved as marked late.',
      };
    const reopened = await c.query<{ until: Date }>(
      `SELECT open_until AS until FROM attendance_reopens
        WHERE on_date = $1::date AND open_until > now() AND scope = $2
          AND (($2 = 'class' AND class_section_id = $3::bigint) OR ($2 = 'bus' AND route_id = $3::bigint AND trip = $4))
        ORDER BY open_until DESC LIMIT 1`,
      [
        date,
        target.scope,
        target.scope === 'class' ? target.classSectionId : target.routeId,
        target.scope === 'bus' ? target.trip : null,
      ],
    );
    if (reopened.rows[0])
      return {
        open: true,
        late: true,
        from,
        to,
        note: `Reopened for you until ${reopened.rows[0].until.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}.`,
      };
    if (days > 0 && days <= w.backDays)
      return { open: true, late: true, from, to, note: 'An earlier day: saved as marked late.' };
    return {
      open: false,
      late: false,
      from,
      to,
      note:
        days === 0
          ? hm < (from ?? '00:00')
            ? `Marking opens at ${from ?? ''}.`
            : `Marking closed at ${to ?? ''}. Ask the coordinator to mark it or to reopen the day.`
          : 'This day is closed. Ask the coordinator to mark it or to reopen the day.',
    };
  }

  async assertOpen(
    c: PoolClient,
    target: Target,
    date: string,
    manager: boolean,
  ): Promise<WindowState> {
    const s = await this.state(c, target, date, manager);
    if (!s.open)
      throw new DomainError('attendance.window_closed', s.note ?? 'Marking is closed', {
        status: 409,
      });
    return s;
  }

  /** An approved leave covering the date and a gate pass of the date, per pupil. */
  async hints(c: PoolClient, studentIds: string[], date: string): Promise<Map<string, Hint>> {
    const out = new Map<string, Hint>();
    if (!studentIds.length) return out;
    const of = (id: string) => {
      if (!out.has(id)) out.set(id, { leave: null, pass: null });
      return out.get(id)!;
    };
    const leave = await c.query<{ student_id: string; number: string; f: string; t: string }>(
      `SELECT q.student_id::text, COALESCE(q.number, 'Q-' || q.id::text) AS number, q.leave_from::text AS f, q.leave_to::text AS t
         FROM parent_queries q
        WHERE q.kind = 'leave' AND q.decision = 'approved' AND q.student_id = ANY($1::bigint[]) AND $2::date BETWEEN q.leave_from AND q.leave_to
        UNION ALL
       -- leave applied from the portal (0088); the days the family gave up are not leave
       SELECT l.student_id::text, COALESCE(l.number, 'LV-' || l.id::text), l.from_date::text, LEAST(l.to_date, COALESCE(l.ended_on - 1, l.to_date))::text
         FROM student_leaves l
        WHERE l.status = 'approved' AND l.student_id = ANY($1::bigint[])
          AND $2::date BETWEEN l.from_date AND LEAST(l.to_date, COALESCE(l.ended_on - 1, l.to_date))`,
      [studentIds, date],
    );
    for (const x of leave.rows) of(x.student_id).leave = { number: x.number, from: x.f, to: x.t };
    const pass = await c.query<{
      student_id: string;
      kind: 'early_leave' | 'late_arrival';
      number: string;
      at_time: string | null;
      state: string;
      out_at: Date | null;
      in_at: Date | null;
    }>(
      `SELECT g.student_id::text, g.kind, COALESCE(g.pass_no, 'GP-' || g.id::text) AS number, to_char(g.at_time, 'HH24:MI') AS at_time, g.state, g.out_at, g.in_at
         FROM gate_passes g
        WHERE g.audience = 'student' AND g.student_id = ANY($1::bigint[]) AND g.on_date = $2::date AND g.kind IN ('early_leave', 'late_arrival')
          AND g.state IN ('approved', 'handed_over', 'out', 'returned')
        ORDER BY g.id`,
      [studentIds, date],
    );
    for (const x of pass.rows)
      of(x.student_id).pass = {
        kind: x.kind,
        number: x.number,
        atTime: x.at_time,
        state: x.state,
        outAt: x.out_at ? x.out_at.toISOString() : null,
        inAt: x.in_at ? x.in_at.toISOString() : null,
      };
    return out;
  }
}

/** What the roster pre-fills for a pupil nobody has marked yet (the teacher can change it). */
export function suggest(h: Hint | undefined, where: 'class' | 'pick' | 'drop'): string | null {
  if (!h) return null;
  if (h.leave) return 'LV';
  if (h.pass?.kind === 'late_arrival')
    return where === 'class' ? 'L' : where === 'pick' ? 'GP' : null;
  if (h.pass?.kind === 'early_leave')
    return where === 'class' ? 'SR' : where === 'drop' ? 'GP' : null;
  return null;
}
