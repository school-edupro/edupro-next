/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (time zone, column lists); every value is bound */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { tablePdf } from '../engagement/table-pdf';
import { AttendanceGate } from './attendance-gate';
import { codeOf, readSheet, templateSheet } from '../../common/excel/sheet';
import type {
  AttendanceSetupDto,
  ReopenDto,
  RouteTeacherRemoveDto,
  RouteTeachersDto,
} from './attendance-plus.dto';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const n = (v: unknown) => Number(v ?? 0);
/** Codes that count as "in school" for the day. */
const PRESENT = `('P', 'L', 'H', 'OD', 'SB', 'SR')`;

/**
 * Attendance set-up, registers and the dashboards (0083): the marking windows and the teacher of each
 * route and trip, a day reopened for a teacher, the monthly class register, one dashboard for class and
 * bus attendance, and what a family sees of today.
 */
@Injectable()
export class AttendanceDeskService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
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

  // ---- set-up ---------------------------------------------------------------------------------------
  async setup(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const teachers = await c.query<Row>(
        `SELECT m.route_id::text, m.trip, m.employee_id::text, e.display_name AS name, e.employee_code AS code, (e.user_id IS NOT NULL) AS login,
                r.code AS route_code, r.name AS route_name
           FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id JOIN transport_routes r ON r.id = m.route_id
          ORDER BY e.display_name, r.code, m.trip DESC`,
      );
      const routes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, code || ' · ' || name AS name FROM transport_routes WHERE deleted_at IS NULL AND status = 'active' ORDER BY code`,
      );
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || designation, '') || CASE WHEN user_id IS NULL THEN ' · no login' ELSE '' END AS name
           FROM employees WHERE status = 'active' AND deleted_at IS NULL ORDER BY display_name LIMIT 800`,
      );
      const sections = await c.query<{ id: string; name: string; teacher: string | null }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS name,
                (SELECT e.display_name FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
                  WHERE ta.class_section_id = cs.id AND ta.kind = 'class_teacher' AND ta.is_actual AND ta.valid_to IS NULL LIMIT 1) AS teacher
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY k.display_order, cs.name`,
        [yearId],
      );
      const reopens = await c.query<Row>(
        `SELECT x.id::text, x.scope, x.on_date::text, x.open_until, x.reason, x.trip,
                (SELECT k.code || '-' || cs.name FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = x.class_section_id) AS section,
                (SELECT r.code FROM transport_routes r WHERE r.id = x.route_id) AS route,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = x.created_by LIMIT 1), u.display_name) AS by
           FROM attendance_reopens x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.id DESC LIMIT 20`,
      );
      return {
        windows: await this.gate.windows(c),
        routeTeachers: teachers.rows.map((x) => ({
          routeId: String(x.route_id),
          trip: String(x.trip) as 'pick' | 'drop',
          employeeId: String(x.employee_id),
          name: String(x.name),
          code: x.code ? String(x.code) : null,
          route: `${String(x.route_code)} · ${String(x.route_name)}`,
          login: Boolean(x.login),
        })),
        routes: routes.rows,
        staff: staff.rows,
        sections: sections.rows,
        reopens: reopens.rows.map((x) => ({
          id: String(x.id),
          scope: String(x.scope),
          date: String(x.on_date),
          openUntil: (x.open_until as Date).toISOString(),
          open: (x.open_until as Date).getTime() > Date.now(),
          what:
            x.scope === 'class'
              ? `Class ${String(x.section ?? '')}`
              : `Route ${String(x.route ?? '')} · ${x.trip === 'pick' ? 'morning' : 'afternoon'}`,
          reason: String(x.reason),
          by: x.by ? String(x.by) : null,
        })),
      };
    });
  }

  async saveSetup(ctx: RequestContext, dto: AttendanceSetupDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO attendance_settings (school_id, class_from, class_to, bus_pick_from, bus_pick_to, bus_drop_from, bus_drop_to, back_days, updated_by)
         VALUES (app.current_school_id(), $1::time, $2::time, $3::time, $4::time, $5::time, $6::time, $7, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET class_from = EXCLUDED.class_from, class_to = EXCLUDED.class_to, bus_pick_from = EXCLUDED.bus_pick_from,
               bus_pick_to = EXCLUDED.bus_pick_to, bus_drop_from = EXCLUDED.bus_drop_from, bus_drop_to = EXCLUDED.bus_drop_to, back_days = EXCLUDED.back_days,
               updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [
          dto.classFrom ?? null,
          dto.classTo ?? null,
          dto.busPickFrom ?? null,
          dto.busPickTo ?? null,
          dto.busDropFrom ?? null,
          dto.busDropTo ?? null,
          dto.backDays,
        ],
      );
      if (dto.routeTeachers) await c.query(`DELETE FROM transport_route_teachers`);
      for (const t of dto.routeTeachers ?? [])
        await c.query(
          `INSERT INTO transport_route_teachers (school_id, route_id, trip, employee_id, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) ON CONFLICT DO NOTHING`,
          [t.routeId, t.trip, t.employeeId],
        );
      await this.audit.stage(ctx, c, {
        action: 'attendance.setup.update',
        entityType: 'attendance_settings',
        entityId: requireTenant(ctx).schoolId,
        after: { ...dto, routeTeachers: dto.routeTeachers?.length ?? null },
      });
    });
    return this.setup(ctx);
  }

  /** The coordinator opens a closed day again for the teacher of a class or of a route and trip. */
  // ---- the teacher of each route (bus attendance) ---------------------------------------------------
  private static readonly TRIPS = {
    both: ['pick', 'drop'],
    pick: ['pick'],
    drop: ['drop'],
  } as const;

  /** A teacher on some routes for the morning trip, the afternoon trip or both; a route and trip may have several. */
  async addRouteTeachers(ctx: RequestContext, dto: RouteTeachersDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emp = await c.query<{ login: boolean }>(
        `SELECT (user_id IS NOT NULL) AS login FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.employeeId],
      );
      if (!emp.rows[0]) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const routes = await c.query(
        `SELECT 1 FROM transport_routes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [dto.routeIds],
      );
      if (routes.rowCount !== new Set(dto.routeIds).size)
        throw new DomainError('not-found', 'Route not found', { status: 404 });
      const r = await c.query(
        `INSERT INTO transport_route_teachers (school_id, route_id, trip, employee_id, created_by)
         SELECT app.current_school_id(), x.id, t.trip, $1, app.current_user_id()
           FROM unnest($2::bigint[]) AS x(id) CROSS JOIN unnest($3::text[]) AS t(trip)
         ON CONFLICT DO NOTHING`,
        [dto.employeeId, dto.routeIds, AttendanceDeskService.TRIPS[dto.trip]],
      );
      await this.audit.stage(ctx, c, {
        action: 'attendance.route_teacher.add',
        entityType: 'transport_route_teachers',
        entityId: dto.employeeId,
        after: dto,
      });
      return { added: r.rowCount ?? 0, login: emp.rows[0].login };
    });
  }

  async removeRouteTeacher(ctx: RequestContext, dto: RouteTeacherRemoveDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `DELETE FROM transport_route_teachers WHERE employee_id = $1 AND route_id = $2 AND trip = ANY($3::text[])`,
        [dto.employeeId, dto.routeId, AttendanceDeskService.TRIPS[dto.trip]],
      );
      await this.audit.stage(ctx, c, {
        action: 'attendance.route_teacher.remove',
        entityType: 'transport_route_teachers',
        entityId: dto.employeeId,
        after: dto,
      });
    });
  }

  private static readonly RT_HEADERS = ['Employee', 'Route', 'Trip'];
  private static readonly RT_TRIP: Record<string, 'both' | 'pick' | 'drop'> = {
    both: 'both',
    'morning (pick)': 'pick',
    morning: 'pick',
    pick: 'pick',
    'afternoon (drop)': 'drop',
    afternoon: 'drop',
    drop: 'drop',
  };

  /** The Excel format for the route teachers: employee, route and trip, each from a drop-down. */
  async routeTeacherTemplate(ctx: RequestContext) {
    const l = await this.db.tenant(requireTenant(ctx), async (c) => ({
      staff: (
        await c.query<{ v: string }>(
          `SELECT employee_code || ' · ' || display_name AS v FROM employees WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name`,
        )
      ).rows.map((x) => x.v),
      routes: (
        await c.query<{ v: string }>(
          `SELECT code || ' · ' || name AS v FROM transport_routes WHERE deleted_at IS NULL AND status = 'active' ORDER BY code`,
        )
      ).rows.map((x) => x.v),
    }));
    return {
      bytes: await templateSheet({
        sheet: 'Route teachers',
        columns: [
          { header: 'Employee', width: 34, required: true, options: l.staff },
          { header: 'Route', width: 34, required: true, options: l.routes },
          {
            header: 'Trip',
            width: 18,
            required: true,
            options: ['Both', 'Morning (pick)', 'Afternoon (drop)'],
          },
        ],
        guide: [
          'One row for each teacher and route. Pick every value from its drop-down.',
          'Trip: Both = the teacher marks the morning and the afternoon trip; else only the one chosen.',
          'A route and trip may have more than one teacher: any of them can mark, and the roll shows who did.',
          'A row that is already there is left as it is. Nothing is removed by an upload.',
        ],
      }),
      filename: 'bus-attendance-route-teachers-format.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async importRouteTeachers(ctx: RequestContext, fileBase64: string) {
    const rows = await readSheet(fileBase64, AttendanceDeskService.RT_HEADERS);
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no filled row', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, lower(employee_code) AS code, lower(display_name) AS name FROM employees WHERE deleted_at IS NULL AND status = 'active'`,
      );
      const routes = await c.query<{ id: string; code: string }>(
        `SELECT id::text, lower(code) AS code FROM transport_routes WHERE deleted_at IS NULL`,
      );
      const errors: Array<{ row: number; message: string }> = [];
      const ready: Array<{ employeeId: string; routeId: string; trip: 'both' | 'pick' | 'drop' }> =
        [];
      for (const { row, cells } of rows) {
        const e = codeOf(cells.Employee!).toLowerCase();
        const emp = staff.rows.find((x) => x.code === e || x.name === e);
        const route = routes.rows.find((x) => x.code === codeOf(cells.Route!).toLowerCase());
        const trip = AttendanceDeskService.RT_TRIP[cells.Trip!.toLowerCase()];
        const problems = [
          emp ? null : `Employee "${cells.Employee!}" is not on the list`,
          route ? null : `Route "${cells.Route!}" is not on the list`,
          trip ? null : `Trip "${cells.Trip!}" must be Both, Morning (pick) or Afternoon (drop)`,
        ].filter(Boolean);
        if (problems.length) errors.push({ row, message: problems.join('; ') });
        else ready.push({ employeeId: emp!.id, routeId: route!.id, trip: trip! });
      }
      if (errors.length) return { added: 0, already: 0, errors };
      let added = 0;
      for (const x of ready) {
        const r = await c.query(
          `INSERT INTO transport_route_teachers (school_id, route_id, trip, employee_id, created_by)
           SELECT app.current_school_id(), $2, t.trip, $1, app.current_user_id() FROM unnest($3::text[]) AS t(trip)
           ON CONFLICT DO NOTHING`,
          [x.employeeId, x.routeId, AttendanceDeskService.TRIPS[x.trip]],
        );
        added += r.rowCount ?? 0;
      }
      const asked = ready.reduce((n2, x) => n2 + AttendanceDeskService.TRIPS[x.trip].length, 0);
      await this.audit.stage(ctx, c, {
        action: 'attendance.route_teacher.import',
        entityType: 'transport_route_teachers',
        entityId: requireTenant(ctx).schoolId,
        after: { rows: rows.length, added },
      });
      return { added, already: asked - added, errors };
    });
  }

  async reopen(ctx: RequestContext, dto: ReopenDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const future = await c.query<{ f: boolean }>(`SELECT $1::date > ${TODAY} AS f`, [dto.date]);
      if (future.rows[0]!.f)
        throw new DomainError('validation-failed', 'A future day cannot be reopened', {
          status: 400,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO attendance_reopens (school_id, scope, class_section_id, route_id, trip, on_date, open_until, reason, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, now() + make_interval(hours => $6), $7, app.current_user_id()) RETURNING id::text`,
        [
          dto.scope,
          dto.scope === 'class' ? dto.classSectionId : null,
          dto.scope === 'bus' ? dto.routeId : null,
          dto.scope === 'bus' ? dto.trip : null,
          dto.date,
          dto.hours,
          dto.reason,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'attendance.day.reopen',
        entityType: 'attendance_reopens',
        entityId: r.rows[0]!.id,
        after: dto,
      });
    });
    return this.setup(ctx);
  }

  // ---- class register -------------------------------------------------------------------------------
  /** The month's register of a class: a row per pupil, a column per day marked, and the totals. */
  async classRegister(ctx: RequestContext, sectionId: string, month: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    await this.scopes.assert(tenant, 'attendance.session.view', 'class_section', sectionId);
    return this.db.tenant(tenant, async (c) => {
      const sec = await c.query<{ name: string }>(
        `SELECT k.code || '-' || cs.name AS name FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
        [sectionId],
      );
      if (!sec.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
      const marks = await c.query<{ student_id: string; d: string; code: string }>(
        `SELECT m.student_id::text, a.on_date::text AS d, m.code::text FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
          WHERE a.class_section_id = $1 AND a.kind = 'day' AND a.on_date >= ($2 || '-01')::date AND a.on_date < (($2 || '-01')::date + interval '1 month')`,
        [sectionId, month],
      );
      const pupils = await c.query<Row>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, e.roll_no FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
          WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active' ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [sectionId, yearId],
      );
      const days = [...new Set(marks.rows.map((m) => m.d))].sort();
      const by = new Map<string, Record<string, string>>();
      for (const m of marks.rows)
        by.set(m.student_id, { ...(by.get(m.student_id) ?? {}), [m.d]: m.code });
      return {
        section: sec.rows[0].name,
        month,
        days,
        rows: pupils.rows.map((p) => {
          const m = by.get(String(p.id)) ?? {};
          const codes = Object.values(m);
          const absent = codes.filter((x) => x === 'A').length;
          const leave = codes.filter((x) => x === 'LV').length;
          const present = codes.length - absent - leave;
          return {
            studentId: String(p.id),
            name: String(p.name),
            admissionNo: p.admission_no === null ? null : String(p.admission_no),
            rollNo: p.roll_no === null ? null : Number(p.roll_no),
            marks: m,
            present,
            absent,
            leave,
            late: codes.filter((x) => x === 'L').length,
            unmarked: days.length - codes.length,
            percent: codes.length ? Math.round((present / codes.length) * 1000) / 10 : null,
          };
        }),
      };
    });
  }

  async classRegisterFile(
    ctx: RequestContext,
    sectionId: string,
    month: string,
    format: 'xlsx' | 'pdf',
  ) {
    const reg = await this.classRegister(ctx, sectionId, month);
    const head = [
      'Roll',
      'Student',
      'Adm. no.',
      ...reg.days.map((d) => d.slice(8)),
      'Present',
      'Absent',
      'Leave',
      'Late',
      '%',
    ];
    const rows = reg.rows.map((r) => [
      r.rollNo ?? '',
      r.name,
      r.admissionNo ?? '',
      ...reg.days.map((d) => r.marks[d] ?? '-'),
      r.present,
      r.absent,
      r.leave,
      r.late,
      r.percent ?? '',
    ]);
    const title = `Attendance register · Class ${reg.section} · ${reg.month}`;
    const name = `attendance-register-${reg.section}-${reg.month}`.replace(/[^\w-]+/g, '-');
    if (format === 'pdf') {
      const school = await this.db.tenant(
        requireTenant(ctx),
        async (c) =>
          (
            await c.query<{ name: string }>(
              `SELECT name FROM schools WHERE id = app.current_school_id()`,
            )
          ).rows[0]?.name ?? '',
      );
      return {
        bytes: await tablePdf({
          school,
          title,
          subtitle:
            'P present · A absent · LV leave · L late · H half day · SR short leave · OD on duty · SB stay back · - not marked',
          columns: head.map((h, i) => ({
            label: h,
            width: i === 1 ? 20 : i === 0 ? 4 : i === 2 ? 9 : i > 2 + reg.days.length ? 5 : 3.2,
            right: i > 2 + reg.days.length,
          })),
          rows,
        }),
        filename: `${name}.pdf`,
        contentType: 'application/pdf',
      };
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Register');
    ws.addRow([title]).font = { bold: true };
    ws.addRow(head).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      col.width = i === 1 ? 26 : i === 2 ? 14 : 6;
    });
    ws.views = [{ state: 'frozen', ySplit: 2, xSplit: 2 }];
    return {
      bytes: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
      filename: `${name}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ---- dashboards -----------------------------------------------------------------------------------
  /** Class and bus attendance together: today, what is not marked yet, leave and gate passes, 14 days. */
  async dashboard(ctx: RequestContext, date: string | undefined) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const d = (
        await c.query<{ d: string }>(`SELECT COALESCE($1::date, ${TODAY})::text AS d`, [
          date ?? null,
        ])
      ).rows[0]!.d;
      const cls = await c.query<Row>(
        `SELECT (SELECT count(*) FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
                  WHERE e.academic_year_id = $1 AND e.status = 'active')::int AS strength,
                (SELECT count(*) FROM class_sections cs WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL)::int AS sections,
                count(DISTINCT a.id)::int AS marked_sections,
                count(m.id) FILTER (WHERE m.code::text IN ${PRESENT})::int AS present,
                count(m.id) FILTER (WHERE m.code::text = 'A')::int AS absent,
                count(m.id) FILTER (WHERE m.code::text = 'LV')::int AS leave,
                count(m.id) FILTER (WHERE m.code::text = 'L')::int AS late,
                count(DISTINCT a.id) FILTER (WHERE a.marked_late)::int AS late_sessions
           FROM attendance_sessions a LEFT JOIN attendance_marks m ON m.session_id = a.id
          WHERE a.academic_year_id = $1 AND a.on_date = $2::date AND a.kind = 'day'`,
        [yearId, d],
      );
      const pending = await c.query<Row>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS name,
                (SELECT e.display_name FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
                  WHERE ta.class_section_id = cs.id AND ta.kind = 'class_teacher' AND ta.is_actual AND ta.valid_to IS NULL LIMIT 1) AS teacher
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active')
            AND NOT EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.class_section_id = cs.id AND a.on_date = $2::date AND a.kind = 'day')
          ORDER BY k.display_order, cs.name LIMIT 60`,
        [yearId, d],
      );
      const bus = await c.query<Row>(
        `SELECT t.trip,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1 AND COALESCE(a.service, 'both') <> CASE WHEN t.trip = 'pick' THEN 'drop' ELSE 'pick' END)::int AS riders,
                (SELECT count(*) FROM transport_routes r WHERE r.deleted_at IS NULL AND r.status = 'active')::int AS routes,
                (SELECT count(*) FROM bus_roll_sessions b WHERE b.on_date = $2::date AND b.trip = t.trip)::int AS marked_routes,
                (SELECT jsonb_object_agg(code, n) FROM (SELECT m.code, count(*)::int AS n FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id
                   WHERE b.on_date = $2::date AND b.trip = t.trip GROUP BY m.code) x) AS codes
           FROM (VALUES ('pick'), ('drop')) AS t(trip)`,
        [yearId, d],
      );
      const busPending = await c.query<Row>(
        `SELECT r.id::text, r.code, t.trip,
                (SELECT string_agg(e.display_name, ', ') FROM transport_route_teachers m JOIN employees e ON e.id = m.employee_id WHERE m.route_id = r.id AND m.trip = t.trip) AS teachers
           FROM transport_routes r CROSS JOIN (VALUES ('pick'), ('drop')) AS t(trip)
          WHERE r.deleted_at IS NULL AND r.status = 'active'
            AND EXISTS (SELECT 1 FROM student_route_assignments a WHERE a.academic_year_id = $1 AND $2::date IS NOT NULL
                         AND ((t.trip = 'pick' AND a.route_id = r.id) OR (t.trip = 'drop' AND COALESCE(a.drop_route_id, a.route_id) = r.id)))
            AND NOT EXISTS (SELECT 1 FROM bus_roll_sessions b WHERE b.route_id = r.id AND b.trip = t.trip AND b.on_date = $2::date)
          ORDER BY t.trip DESC, r.code LIMIT 60`,
        [yearId, d],
      );
      const known = await c.query<Row>(
        `SELECT (SELECT count(*) FROM parent_queries q WHERE q.kind = 'leave' AND q.decision = 'approved' AND $1::date BETWEEN q.leave_from AND q.leave_to)::int AS leave,
                (SELECT count(*) FROM gate_passes g WHERE g.audience = 'student' AND g.on_date = $1::date AND g.kind = 'early_leave' AND g.state IN ('approved', 'handed_over', 'out', 'returned'))::int AS early,
                (SELECT count(*) FROM gate_passes g WHERE g.audience = 'student' AND g.on_date = $1::date AND g.kind = 'late_arrival' AND g.state IN ('approved', 'handed_over', 'out', 'returned'))::int AS late`,
        [d],
      );
      const trend = await c.query<Row>(
        `SELECT g::date::text AS d,
                (SELECT count(*) FILTER (WHERE m.code::text IN ${PRESENT}) FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
                  WHERE a.academic_year_id = $1 AND a.on_date = g::date AND a.kind = 'day')::int AS present,
                (SELECT count(*) FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
                  WHERE a.academic_year_id = $1 AND a.on_date = g::date AND a.kind = 'day')::int AS marked,
                (SELECT count(*) FILTER (WHERE m.code = 'P') FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id WHERE b.on_date = g::date AND b.trip = 'pick')::int AS pick,
                (SELECT count(*) FILTER (WHERE m.code = 'P') FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id WHERE b.on_date = g::date AND b.trip = 'drop')::int AS drop
           FROM generate_series($2::date - 13, $2::date, interval '1 day') g ORDER BY 1`,
        [yearId, d],
      );
      const x = cls.rows[0] ?? {};
      const marked = n(x.present) + n(x.absent) + n(x.leave);
      const trip = (t: 'pick' | 'drop') => {
        const b = bus.rows.find((r) => r.trip === t) ?? {};
        const codes = (b.codes as Record<string, number> | null) ?? {};
        const done = Object.values(codes).reduce((a, v) => a + v, 0);
        return {
          riders: n(b.riders),
          routes: n(b.routes),
          markedRoutes: n(b.marked_routes),
          present: codes.P ?? 0,
          absent: codes.A ?? 0,
          leave: codes.LV ?? 0,
          gatePass: codes.GP ?? 0,
          other: codes.OT ?? 0,
          unmarked: Math.max(0, n(b.riders) - done),
        };
      };
      return {
        date: d,
        windows: await this.gate.windows(c),
        class: {
          strength: n(x.strength),
          sections: n(x.sections),
          markedSections: n(x.marked_sections),
          present: n(x.present),
          absent: n(x.absent),
          leave: n(x.leave),
          late: n(x.late),
          unmarked: Math.max(0, n(x.strength) - marked),
          percent: marked ? Math.round((n(x.present) / marked) * 1000) / 10 : null,
          markedLate: n(x.late_sessions),
          pending: pending.rows.map((p) => ({
            id: String(p.id),
            name: String(p.name),
            teacher: p.teacher ? String(p.teacher) : null,
          })),
        },
        bus: {
          pick: trip('pick'),
          drop: trip('drop'),
          pending: busPending.rows.map((p) => ({
            routeId: String(p.id),
            code: String(p.code),
            trip: String(p.trip) as 'pick' | 'drop',
            teachers: p.teachers ? String(p.teachers) : null,
          })),
        },
        known: {
          leave: n(known.rows[0]?.leave),
          earlyLeave: n(known.rows[0]?.early),
          lateArrival: n(known.rows[0]?.late),
        },
        trend: trend.rows.map((t) => ({
          date: String(t.d),
          percent: n(t.marked) ? Math.round((n(t.present) / n(t.marked)) * 1000) / 10 : null,
          present: n(t.present),
          pick: n(t.pick),
          drop: n(t.drop),
        })),
      };
    });
  }

  /** The family home card: each child's month so far, today in class and on the bus, leave and gate pass. */
  async familyToday(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const v = await this.viewer.resolve(ctx, 'attendance.session.view');
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = (await c.query<{ d: string }>(`SELECT ${TODAY}::text AS d`)).rows[0]!.d;
      const hints = await this.gate.hints(
        c,
        v.students.map((s) => s.id),
        today,
      );
      const children = [];
      for (const s of v.students) {
        const m = await c.query<Row>(
          `SELECT count(*)::int AS days, count(*) FILTER (WHERE m.code::text IN ${PRESENT})::int AS present,
                  count(*) FILTER (WHERE m.code::text = 'A')::int AS absent, count(*) FILTER (WHERE m.code::text = 'LV')::int AS leave,
                  (SELECT m2.code::text FROM attendance_marks m2 JOIN attendance_sessions a2 ON a2.id = m2.session_id
                    WHERE m2.student_id = $1 AND a2.on_date = $3::date AND a2.kind = 'day' LIMIT 1) AS today
             FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
            WHERE m.student_id = $1 AND a.academic_year_id = $2 AND a.kind = 'day' AND a.on_date >= date_trunc('month', $3::date)::date AND a.on_date <= $3::date`,
          [s.id, yearId, today],
        );
        const b = await c.query<{ trip: string; code: string }>(
          `SELECT b.trip, m.code FROM bus_roll_marks m JOIN bus_roll_sessions b ON b.id = m.session_id WHERE m.student_id = $1 AND b.on_date = $2::date`,
          [s.id, today],
        );
        const rides = await c.query(
          `SELECT 1 FROM student_route_assignments WHERE student_id = $1 AND academic_year_id = $2`,
          [s.id, yearId],
        );
        const x = m.rows[0] ?? {};
        children.push({
          id: s.id,
          name: s.name,
          section: s.section,
          month: {
            days: n(x.days),
            present: n(x.present),
            absent: n(x.absent),
            leave: n(x.leave),
            percent: n(x.days) ? Math.round((n(x.present) / n(x.days)) * 1000) / 10 : null,
          },
          today: x.today ? String(x.today) : null,
          rides: Boolean(rides.rowCount),
          busPick: b.rows.find((r) => r.trip === 'pick')?.code ?? null,
          busDrop: b.rows.find((r) => r.trip === 'drop')?.code ?? null,
          hint: hints.get(s.id) ?? null,
        });
      }
      return { date: today, children };
    });
  }
}
