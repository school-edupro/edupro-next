/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (time zone, column lists, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { generatedOn, monthName, registerFile, schoolHead } from './register-file';
import { AttendanceGate, suggest, type Hint, type WindowState } from './attendance-gate';
import type { BusRollMarkDto, BusRollQueryDto, RegisterQueryDto } from './attendance-plus.dto';

type Row = Record<string, unknown>;
type Trip = 'pick' | 'drop';
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
export const BUS_CODES = ['P', 'A', 'LV', 'GP', 'OT'] as const;
export const BUS_LABEL: Record<string, string> = {
  P: 'On the bus',
  A: 'Not on the bus',
  LV: 'On leave',
  GP: 'Gate pass',
  OT: 'Other arrangement',
};
const TRIP_LABEL: Record<Trip, string> = { pick: 'Morning (pick)', drop: 'Afternoon (drop)' };
const SECTION = `(SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
     WHERE en.student_id = s.id AND en.academic_year_id = a.academic_year_id AND en.status = 'active' LIMIT 1)`;
/** The pupils who ride route $1 on trip $2 in year $3. */
const RIDERS = `FROM student_route_assignments a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
   LEFT JOIN transport_stops ps ON ps.id = a.stop_id
   LEFT JOIN transport_stops ds ON ds.id = COALESCE(a.drop_stop_id, a.stop_id)
  WHERE a.academic_year_id = $3
    AND (($2 = 'pick' AND a.route_id = $1 AND COALESCE(a.service, 'both') <> 'drop')
      OR ($2 = 'drop' AND COALESCE(a.drop_route_id, a.route_id) = $1 AND COALESCE(a.service, 'both') <> 'pick'))`;

/**
 * Bus attendance marked by the teacher mapped to a route (0083): one roll for the morning trip and one for
 * the afternoon. The roll is the approved transport list of the route; an approved leave or a gate pass
 * of the day pre-fills the pupil; the school's marking window applies.
 */
@Injectable()
export class BusRollService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly gate: AttendanceGate,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  /** A coordinator or admin: may change the status of a pupil on approved leave. */
  private overridesLeave(ctx: RequestContext): boolean {
    return ctx.permissions?.has('attendance.setup.manage') === true;
  }

  /** Runs bus attendance for the school (any route, not bound to the teacher's window). */
  private manager(ctx: RequestContext): boolean {
    return ['attendance.setup.manage', 'transport.fleet.manage'].some((p) =>
      ctx.permissions?.has(p),
    );
  }

  /** The routes and trips the person marks: the ones mapped to them; every route for someone who runs attendance. */
  async myRoutes(ctx: RequestContext) {
    const manager = this.manager(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT r.id::text, r.code, r.name, t.trip
           FROM transport_routes r CROSS JOIN (VALUES ('pick'), ('drop')) AS t(trip)
          WHERE r.deleted_at IS NULL AND r.status = 'active'
            AND ($1 OR EXISTS (SELECT 1 FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id
                                WHERE m.route_id = r.id AND m.trip = t.trip AND e.user_id = app.current_user_id()))
          ORDER BY r.code, t.trip DESC`,
        [manager],
      );
      return {
        manager,
        data: r.rows.map((x) => ({
          routeId: String(x.id),
          code: String(x.code),
          name: String(x.name),
          trip: String(x.trip) as Trip,
          tripLabel: TRIP_LABEL[String(x.trip) as Trip],
        })),
      };
    });
  }

  /** Staff who oversee attendance read every route's roll and register (families hold the bus view too, for their own child only). */
  private overseer(ctx: RequestContext): boolean {
    return (
      this.manager(ctx) ||
      ['attendance.session.lock', 'attendance.rfid.manage'].some((p) => ctx.permissions?.has(p))
    );
  }

  /** A roll or a register is read by an overseer, or by a teacher mapped to the route (either trip). */
  private async assertMayRead(c: PoolClient, ctx: RequestContext, routeId: string) {
    if (this.overseer(ctx)) return;
    const r = await c.query(
      `SELECT 1 FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id
        WHERE m.route_id = $1 AND e.user_id = app.current_user_id() LIMIT 1`,
      [routeId],
    );
    if (!r.rowCount)
      throw new DomainError('forbidden', 'You are not a teacher mapped to this route', {
        status: 403,
      });
  }

  private async assertMayMark(c: PoolClient, ctx: RequestContext, routeId: string, trip: Trip) {
    if (this.manager(ctx)) return;
    const r = await c.query(
      `SELECT 1 FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id
        WHERE m.route_id = $1 AND m.trip = $2 AND e.user_id = app.current_user_id() LIMIT 1`,
      [routeId, trip],
    );
    if (!r.rowCount)
      throw new DomainError(
        'attendance.not_assigned',
        'You are not the teacher mapped to this route and trip',
        { status: 403 },
      );
  }

  private async rollWith(c: PoolClient, ctx: RequestContext, yearId: string, q: BusRollQueryDto) {
    const route = await c.query<{ code: string; name: string; vehicle: string | null }>(
      `SELECT r.code, r.name, (SELECT v.reg_no FROM transport_vehicles v WHERE v.id = app.transport_vehicle_today(r.vehicle_id)) AS vehicle
         FROM transport_routes r WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [q.routeId],
    );
    if (!route.rows[0]) throw new DomainError('not-found', 'Route not found', { status: 404 });
    const session = await c.query<Row>(
      `SELECT b.id::text, b.marked_at, b.marked_late, b.notes,
              COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = b.marked_by LIMIT 1), u.display_name) AS marked_by
         FROM bus_roll_sessions b LEFT JOIN users u ON u.id = b.marked_by WHERE b.route_id = $1 AND b.on_date = $2::date AND b.trip = $3`,
      [q.routeId, q.date, q.trip],
    );
    const sid = session.rows[0] ? String(session.rows[0].id) : null;
    const r = await c.query<Row>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no, ${SECTION} AS section,
              CASE WHEN $2 = 'pick' THEN COALESCE(ps.name, a.stop_name) ELSE COALESCE(ds.name, a.stop_name) END AS stop,
              CASE WHEN $2 = 'pick' THEN to_char(COALESCE(a.pickup_time, ps.pickup_time), 'HH24:MI') ELSE to_char(COALESCE(a.drop_time, ds.drop_time), 'HH24:MI') END AS at_time,
              CASE WHEN $2 = 'pick' THEN ps.sequence ELSE ds.sequence END AS seq,
              m.code, m.remarks,
              (SELECT cm.code::text FROM attendance_marks cm JOIN attendance_sessions cs2 ON cs2.id = cm.session_id
                WHERE cm.student_id = s.id AND cs2.on_date = $4::date AND cs2.kind = 'day' LIMIT 1) AS class_code,
              (SELECT to_char(min(t.occurred_at) AT TIME ZONE ${TZ}, 'HH24:MI') FROM bus_attendance t
                WHERE t.student_id = s.id AND t.on_date = $4::date AND t.direction::text = CASE WHEN $2 = 'pick' THEN 'in' ELSE 'out' END
                  AND t.outcome::text IN ('boarded', 'late_boarding', 'alighted')) AS tapped
         ${RIDERS.replace('FROM student_route_assignments a', `FROM student_route_assignments a LEFT JOIN bus_roll_marks m ON m.session_id = $5::bigint AND m.student_id = a.student_id`)}
        ORDER BY seq NULLS LAST, s.display_name`,
      [q.routeId, q.trip, yearId, q.date, sid],
    );
    const hints = await this.gate.hints(
      c,
      r.rows.map((x) => String(x.id)),
      q.date,
    );
    const mayOverride = this.overridesLeave(ctx);
    const roster = r.rows.map((x) => {
      const hint: Hint | null = hints.get(String(x.id)) ?? null;
      const code = x.code === null || x.code === undefined ? null : String(x.code);
      const classCode =
        x.class_code === null || x.class_code === undefined ? null : String(x.class_code);
      return {
        studentId: String(x.id),
        name: String(x.name),
        admissionNo: x.admission_no === null ? null : String(x.admission_no),
        section: x.section === null ? null : String(x.section),
        stop: x.stop === null ? null : String(x.stop),
        atTime: x.at_time === null ? null : String(x.at_time),
        code,
        remarks: x.remarks === null || x.remarks === undefined ? null : String(x.remarks),
        hint,
        /** Today's class attendance of the pupil, when the class teacher has marked it. */
        classCode,
        /** The time the pupil's card was read on the bus, when the bus has a reader. */
        tapped: x.tapped === null || x.tapped === undefined ? null : String(x.tapped),
        /** On approved leave: marked as leave, and only a coordinator or admin may change it. */
        locked: Boolean(hint?.leave) && !mayOverride,
        suggested:
          hint?.leave && !mayOverride && code !== 'LV'
            ? 'LV'
            : code
              ? null
              : (suggest(hint ?? undefined, q.trip) ??
                (x.tapped
                  ? 'P'
                  : q.trip === 'drop' && (classCode === 'A' || classCode === 'LV')
                    ? 'A'
                    : null)),
      };
    });
    const counts: Record<string, number> = { riders: roster.length, unmarked: 0 };
    for (const x of roster) {
      if (!x.code) counts.unmarked = (counts.unmarked ?? 0) + 1;
      else counts[x.code] = (counts[x.code] ?? 0) + 1;
    }
    const window: WindowState = await this.gate.state(
      c,
      { scope: 'bus', routeId: q.routeId, trip: q.trip },
      q.date,
      this.manager(ctx),
    );
    return {
      id: sid,
      routeId: q.routeId,
      route: `${route.rows[0].code} · ${route.rows[0].name}`,
      routeCode: route.rows[0].code,
      vehicle: route.rows[0].vehicle,
      date: q.date,
      trip: q.trip,
      tripLabel: TRIP_LABEL[q.trip],
      markedBy: session.rows[0]?.marked_by ? String(session.rows[0].marked_by) : null,
      markedAt:
        session.rows[0]?.marked_at instanceof Date ? session.rows[0].marked_at.toISOString() : null,
      markedLate: Boolean(session.rows[0]?.marked_late),
      window,
      roster,
      counts,
    };
  }

  async roll(ctx: RequestContext, q: BusRollQueryDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMayRead(c, ctx, q.routeId);
      return this.rollWith(c, ctx, yearId, q);
    });
  }

  async mark(ctx: RequestContext, dto: BusRollMarkDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMayMark(c, ctx, dto.routeId, dto.trip);
      const day = await c.query<{ future: boolean }>(`SELECT $1::date > ${TODAY} AS future`, [
        dto.date,
      ]);
      if (day.rows[0]!.future)
        throw new DomainError(
          'attendance.future_date',
          'Attendance cannot be marked for a future date',
          {
            status: 409,
          },
        );
      const window = await this.gate.assertOpen(
        c,
        { scope: 'bus', routeId: dto.routeId, trip: dto.trip },
        dto.date,
        this.manager(ctx),
      );
      const riders = await c.query<{ id: string }>(`SELECT a.student_id::text AS id ${RIDERS}`, [
        dto.routeId,
        dto.trip,
        yearId,
      ]);
      const allowed = new Set(riders.rows.map((x) => x.id));
      const s = await c.query<{ id: string }>(
        `INSERT INTO bus_roll_sessions (school_id, academic_year_id, route_id, on_date, trip, marked_by, marked_at, marked_late, notes)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, app.current_user_id(), now(), $5, $6)
         ON CONFLICT (route_id, on_date, trip) DO UPDATE SET marked_by = EXCLUDED.marked_by, marked_at = now(), updated_at = now(),
               marked_late = bus_roll_sessions.marked_late OR EXCLUDED.marked_late, notes = COALESCE(EXCLUDED.notes, bus_roll_sessions.notes)
         RETURNING id::text`,
        [yearId, dto.routeId, dto.date, dto.trip, window.late, dto.notes ?? null],
      );
      const sid = s.rows[0]!.id;
      // an approved leave stands: the teacher's entry for that pupil is kept as leave
      const onLeave = this.overridesLeave(ctx)
        ? null
        : await this.gate.hints(
            c,
            dto.marks.map((m) => m.studentId),
            dto.date,
          );
      for (const m of dto.marks) {
        if (!allowed.has(m.studentId))
          throw new DomainError(
            'attendance.student_not_on_route',
            'A student in the list does not ride this route on this trip',
            { status: 422 },
          );
        await c.query(
          `INSERT INTO bus_roll_marks (school_id, session_id, student_id, code, remarks, marked_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (session_id, student_id) DO UPDATE SET code = EXCLUDED.code, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [sid, m.studentId, onLeave?.get(m.studentId)?.leave ? 'LV' : m.code, m.remarks ?? null],
        );
      }
      const roll = await this.rollWith(c, ctx, yearId, dto);
      await this.audit.stage(ctx, c, {
        action: 'attendance.bus.mark',
        entityType: 'bus_roll_sessions',
        entityId: sid,
        after: {
          date: dto.date,
          route: roll.routeCode,
          trip: dto.trip,
          counts: roll.counts,
          late: window.late,
        },
      });
      return roll;
    });
  }

  /** Every route and trip of a date: riders, on the bus, not on it, leave, gate pass, not marked. */
  async summary(ctx: RequestContext, date: string | undefined) {
    const yearId = this.year(ctx);
    // staff who oversee attendance see every route; a teacher sees the routes and trips mapped to them
    const all = this.overseer(ctx);
    if (!all && !ctx.permissions?.has('attendance.bus.mark'))
      throw new DomainError('forbidden', 'Bus attendance is not part of your role', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT r.id::text, r.code, r.name, t.trip, COALESCE($2::date, ${TODAY})::text AS on_date,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1
                    AND ((t.trip = 'pick' AND a.route_id = r.id AND COALESCE(a.service, 'both') <> 'drop')
                      OR (t.trip = 'drop' AND COALESCE(a.drop_route_id, a.route_id) = r.id AND COALESCE(a.service, 'both') <> 'pick')))::int AS riders,
                b.id::text AS session_id, b.marked_at, b.marked_late,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = b.marked_by LIMIT 1), u.display_name) AS marked_by,
                (SELECT jsonb_object_agg(code, n) FROM (SELECT m.code, count(*)::int AS n FROM bus_roll_marks m WHERE m.session_id = b.id GROUP BY m.code) x) AS codes,
                (SELECT string_agg(e.display_name, ', ' ORDER BY e.display_name) FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id
                  WHERE m.route_id = r.id AND m.trip = t.trip) AS teachers
           FROM transport_routes r CROSS JOIN (VALUES ('pick'), ('drop')) AS t(trip)
           LEFT JOIN bus_roll_sessions b ON b.route_id = r.id AND b.trip = t.trip AND b.on_date = COALESCE($2::date, ${TODAY})
           LEFT JOIN users u ON u.id = b.marked_by
          WHERE r.deleted_at IS NULL AND r.status = 'active'
            AND ($3 OR EXISTS (SELECT 1 FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id
                                WHERE m.route_id = r.id AND m.trip = t.trip AND e.user_id = app.current_user_id()))
          ORDER BY r.code, t.trip DESC`,
        [yearId, date ?? null, all],
      );
      return {
        date: r.rows[0]
          ? String(r.rows[0].on_date)
          : (date ?? new Date().toISOString().slice(0, 10)),
        windows: await this.gate.windows(c),
        /** Only the routes and trips mapped to this teacher are listed. */
        mine: !all,
        rows: r.rows.map((x) => {
          const codes = (x.codes as Record<string, number> | null) ?? {};
          const marked = Object.values(codes).reduce((a, b) => a + b, 0);
          return {
            routeId: String(x.id),
            code: String(x.code),
            name: String(x.name),
            trip: String(x.trip) as Trip,
            tripLabel: TRIP_LABEL[String(x.trip) as Trip],
            riders: Number(x.riders),
            marked: x.session_id !== null && x.session_id !== undefined,
            present: codes.P ?? 0,
            absent: codes.A ?? 0,
            leave: codes.LV ?? 0,
            gatePass: codes.GP ?? 0,
            other: codes.OT ?? 0,
            unmarked: Math.max(0, Number(x.riders) - marked),
            markedBy: x.marked_by ? String(x.marked_by) : null,
            markedAt: x.marked_at instanceof Date ? x.marked_at.toISOString() : null,
            markedLate: Boolean(x.marked_late),
            teachers: x.teachers ? String(x.teachers) : null,
          };
        }),
      };
    });
  }

  /**
   * The month's register of a route: a row per pupil and, under each day, the morning (M) and the
   * afternoon (A) trip, with the totals of both. One trip alone shows that trip's column only.
   */
  async register(
    ctx: RequestContext,
    q: RegisterQueryDto & { routeId: string; trip: Trip | 'both' },
  ) {
    const yearId = this.year(ctx);
    const trips: Trip[] = q.trip === 'both' ? ['pick', 'drop'] : [q.trip];
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMayRead(c, ctx, q.routeId);
      const route = await c.query<{ code: string; name: string; vehicle_no: string | null }>(
        `SELECT code, name, vehicle_no FROM transport_routes WHERE id = $1 AND deleted_at IS NULL`,
        [q.routeId],
      );
      if (!route.rows[0]) throw new DomainError('not-found', 'Route not found', { status: 404 });
      const from = `${q.month}-01`;
      const marks = await c.query<{ student_id: string; d: string; trip: Trip; code: string }>(
        `SELECT m.student_id::text, b.on_date::text AS d, b.trip, m.code FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id
          WHERE b.route_id = $1 AND b.trip = ANY($2::text[]) AND b.on_date >= $3::date AND b.on_date < ($3::date + interval '1 month')`,
        [q.routeId, trips, from],
      );
      const pupils = new Map<string, Row & { trips: Trip[] }>();
      for (const trip of trips) {
        const r = await c.query<Row>(
          `SELECT s.id::text, s.display_name AS name, s.admission_no, ${SECTION} AS section,
                  CASE WHEN $2 = 'pick' THEN COALESCE(ps.name, a.stop_name) ELSE COALESCE(ds.name, a.stop_name) END AS stop
             ${RIDERS} ORDER BY s.display_name`,
          [q.routeId, trip, yearId],
        );
        for (const p of r.rows) {
          const had = pupils.get(String(p.id));
          if (had) had.trips.push(trip);
          else pupils.set(String(p.id), { ...p, trips: [trip] });
        }
      }
      const days = [...new Set(marks.rows.map((m) => m.d))].sort();
      const by = new Map<string, Record<string, string>>();
      for (const m of marks.rows) {
        const key = `${m.student_id}|${m.trip}`;
        by.set(key, { ...(by.get(key) ?? {}), [m.d]: m.code });
      }
      const head = await schoolHead(c);
      return {
        school: head.name,
        address: head.address,
        route: `${route.rows[0].code} · ${route.rows[0].name}`,
        routeCode: route.rows[0].code,
        vehicle: route.rows[0].vehicle_no,
        trip: q.trip,
        trips,
        tripLabel: q.trip === 'both' ? 'Morning and afternoon' : TRIP_LABEL[q.trip],
        month: q.month,
        days,
        rows: [...pupils.values()]
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((p) => {
            const pick = by.get(`${String(p.id)}|pick`) ?? {};
            const drop = by.get(`${String(p.id)}|drop`) ?? {};
            const all = [...Object.values(pick), ...Object.values(drop)];
            const n = (code: string) => all.filter((x) => x === code).length;
            const count = (m: Record<string, string>) =>
              Object.values(m).filter((x) => x === 'P').length;
            return {
              studentId: String(p.id),
              name: String(p.name),
              admissionNo: p.admission_no === null ? null : String(p.admission_no),
              section: p.section === null ? null : String(p.section),
              stop: p.stop === null ? null : String(p.stop),
              /** The trips this pupil rides on this route. */
              rides: p.trips,
              /** One trip asked for: that trip's marks (kept for the single-trip view). */
              marks: q.trip === 'drop' ? drop : pick,
              pick,
              drop,
              presentPick: count(pick),
              presentDrop: count(drop),
              present: n('P'),
              absent: n('A'),
              leave: n('LV'),
              gatePass: n('GP'),
              other: n('OT'),
              unmarked: days.length * p.trips.length - all.length,
            };
          }),
      };
    });
  }

  async registerFile(
    ctx: RequestContext,
    q: RegisterQueryDto & { routeId: string; trip: Trip | 'both' },
    format: 'xlsx' | 'pdf',
  ) {
    const reg = await this.register(ctx, q);
    const both = reg.trips.length === 2;
    const dayCols = reg.days.flatMap((d) =>
      reg.trips.map((t) => ({
        label: both ? (t === 'pick' ? 'M' : 'A') : d.slice(8),
        width: 2.6,
        center: true,
        group: both ? d.slice(8) : undefined,
      })),
    );
    return registerFile(
      {
        school: reg.school,
        address: reg.address,
        report: 'Bus attendance register',
        details: [
          `Route ${reg.route}`,
          reg.vehicle ? `Bus ${reg.vehicle}` : '',
          reg.tripLabel,
          monthName(reg.month),
          generatedOn(),
        ].filter(Boolean),
        legend: `${both ? 'M morning (pick) · A afternoon (drop) · ' : ''}P on the bus · A not on the bus · LV leave · GP gate pass · OT other arrangement · - not marked${both ? ' · blank: does not ride that trip' : ''}`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Student', width: 16 },
          { label: 'Adm. no.', width: 7 },
          { label: 'Class', width: 5 },
          { label: 'Stoppage', width: 10 },
          ...dayCols,
          ...(both
            ? [
                { label: 'On bus M', width: 4, right: true },
                { label: 'On bus A', width: 4, right: true },
              ]
            : [{ label: 'On bus', width: 4, right: true }]),
          { label: 'Not on bus', width: 4, right: true },
          { label: 'Leave', width: 4, right: true },
          { label: 'Gate pass', width: 4, right: true },
          { label: 'Other', width: 4, right: true },
        ],
        rows: reg.rows.map((r, i) => [
          i + 1,
          r.name,
          r.admissionNo ?? '',
          r.section ?? '',
          r.stop ?? '',
          ...reg.days.flatMap((d) =>
            reg.trips.map((t) =>
              r.rides.includes(t) ? ((t === 'pick' ? r.pick : r.drop)[d] ?? '-') : '',
            ),
          ),
          ...(both ? [r.presentPick, r.presentDrop] : [r.present]),
          r.absent,
          r.leave,
          r.gatePass,
          r.other,
        ]),
        filename: `bus-register-${reg.routeCode}-${reg.trip}-${reg.month}`.replace(/[^\w-]+/g, '-'),
      },
      format,
    );
  }

  /** The family: each child's bus attendance of a month, morning and afternoon. */
  async mine(ctx: RequestContext, month: string | undefined) {
    const v = await this.viewer.resolve(ctx, 'attendance.bus.view');
    const m = month ?? new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 7);
    if (v.kind !== 'family') return { month: m, children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const r = await c.query<{ d: string; trip: Trip; code: string; route: string }>(
          `SELECT b.on_date::text AS d, b.trip, m.code, r.code AS route FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id
             JOIN transport_routes r ON r.id = b.route_id
            WHERE m.student_id = $1 AND b.on_date >= ($2 || '-01')::date AND b.on_date < (($2 || '-01')::date + interval '1 month') ORDER BY b.on_date, b.trip DESC`,
          [s.id, m],
        );
        const days = new Map<
          string,
          { date: string; pick: string | null; drop: string | null; route: string }
        >();
        for (const x of r.rows) {
          const d = days.get(x.d) ?? { date: x.d, pick: null, drop: null, route: x.route };
          d[x.trip] = x.code;
          days.set(x.d, d);
        }
        const all = r.rows.map((x) => x.code);
        children.push({
          id: s.id,
          name: s.name,
          section: s.section,
          days: [...days.values()],
          summary: {
            trips: all.length,
            onBus: all.filter((x) => x === 'P').length,
            notOnBus: all.filter((x) => x === 'A').length,
          },
        });
      }
      return { month: m, children };
    });
  }
}
