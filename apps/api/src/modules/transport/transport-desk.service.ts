/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECTs, time zone, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { readFile } from '../masters/masters.service';
import type {
  ApplyDto,
  DecideManyDto,
  ImportRequestsDto,
  DeskDecideDto,
  DeskExportDto,
  DeskListDto,
  HistoryDto,
  HistoryExportDto,
  QuoteDto,
  Service,
  TransportSetupDto,
} from './transport-desk.dto';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const MONTH = `date_trunc('month', now() AT TIME ZONE ${TZ})::date`;
const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => Number(v ?? 0);
const EXPORT_MAX = 10000;
const SECTION = (studentCol: string, yearCol: string) =>
  `(SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
     WHERE en.student_id = ${studentCol} AND en.academic_year_id = ${yearCol} AND en.status = 'active' LIMIT 1)`;
const SERVICE_LABEL: Record<string, string> = {
  pick: 'Pick only',
  drop: 'Drop only',
  both: 'Pick and drop',
};
const KIND_LABEL: Record<string, string> = {
  join: 'New transport',
  change: 'Change',
  leave: 'Withdrawal',
};
const monthLabel = (m: string | null) =>
  m
    ? new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
const ist = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const REQUEST = `SELECT q.id::text, COALESCE(q.number, 'TR-' || q.id::text) AS number, q.kind::text, q.source, q.service, q.status::text, q.student_id::text,
       s.display_name AS student, s.admission_no, ${SECTION('s.id', 'q.academic_year_id')} AS section, q.academic_year_id::text,
       q.pick_route_id::text, pr.code AS pick_route_code, pr.name AS pick_route, q.pick_stop_id::text, ps.name AS pick_stop, to_char(ps.pickup_time, 'HH24:MI') AS pick_time,
       q.drop_route_id::text, dr.code AS drop_route_code, dr.name AS drop_route, q.drop_stop_id::text, ds.name AS drop_stop, to_char(ds.drop_time, 'HH24:MI') AS drop_time,
       q.slab_id::text, sl.name AS slab, q.monthly_amount::float AS monthly_amount, to_char(q.from_month, 'YYYY-MM') AS from_month,
       to_char(q.to_month, 'YYYY-MM') AS to_month, q.note, q.fee_note, q.decision_note,
       COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = q.requested_by LIMIT 1), ru.display_name) AS requested_by, q.requested_by::text AS requested_by_id,
       q.requested_at, q.decided_at,
       (SELECT count(*) FROM transport_request_approvals a WHERE a.request_id = q.id AND a.status = 'approved')::int AS approved_n,
       (SELECT count(*) FROM transport_request_approvals a WHERE a.request_id = q.id AND a.status <> 'skipped')::int AS levels_n,
       (SELECT a.label FROM transport_request_approvals a WHERE a.request_id = q.id AND a.status = 'pending' ORDER BY a.seq LIMIT 1) AS waiting_on
  FROM transport_requests q
  JOIN students s ON s.id = q.student_id
  LEFT JOIN transport_routes pr ON pr.id = q.pick_route_id
  LEFT JOIN transport_stops ps ON ps.id = q.pick_stop_id
  LEFT JOIN transport_routes dr ON dr.id = q.drop_route_id
  LEFT JOIN transport_stops ds ON ds.id = q.drop_stop_id
  LEFT JOIN transport_slabs sl ON sl.id = q.slab_id
  LEFT JOIN users ru ON ru.id = q.requested_by`;
const REQUEST_FROM = `FROM transport_requests q JOIN students s ON s.id = q.student_id LEFT JOIN transport_routes pr ON pr.id = q.pick_route_id
  LEFT JOIN transport_routes dr ON dr.id = q.drop_route_id`;

export interface DeskRequest {
  id: string;
  number: string;
  kind: 'join' | 'change' | 'leave';
  kindLabel: string;
  source: 'parent' | 'office';
  service: Service | null;
  serviceLabel: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  studentId: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  yearId: string;
  pickRouteId: string | null;
  pickRoute: string | null;
  pickStopId: string | null;
  pickStop: string | null;
  pickTime: string | null;
  dropRouteId: string | null;
  dropRoute: string | null;
  dropStopId: string | null;
  dropStop: string | null;
  dropTime: string | null;
  slab: string | null;
  monthlyAmount: number | null;
  fromMonth: string | null;
  toMonth: string | null;
  /** What is asked, on one line. */
  what: string;
  note: string | null;
  feeNote: string | null;
  decisionNote: string | null;
  requestedBy: string | null;
  requestedById: string | null;
  requestedAt: string;
  decidedAt: string | null;
  approvedLevels: number;
  levels: number;
  waitingOn: string | null;
}
const routeName = (code: unknown, name: unknown) =>
  code ? `${String(code)}${name ? ` ${String(name)}` : ''}` : null;
const toRequest = (x: Row): DeskRequest => {
  const service = text(x.service) as Service | null;
  const pick = x.pick_stop
    ? `${String(x.pick_stop)} (${routeName(x.pick_route_code, null) ?? ''})`
    : null;
  const drop = x.drop_stop
    ? `${String(x.drop_stop)} (${routeName(x.drop_route_code, null) ?? ''})`
    : null;
  const from = text(x.from_month);
  const what =
    x.kind === 'leave'
      ? `Stop the bus from ${monthLabel(from)}`
      : `${SERVICE_LABEL[service ?? 'both']}: ${[
          service !== 'drop' && pick ? `pick ${pick}` : null,
          service !== 'pick' && drop ? `drop ${drop}` : null,
        ]
          .filter(Boolean)
          .join(', ')} · ${monthLabel(from)} to ${monthLabel(text(x.to_month))}`;
  return {
    id: String(x.id),
    number: String(x.number),
    kind: x.kind as DeskRequest['kind'],
    kindLabel: KIND_LABEL[String(x.kind)] ?? String(x.kind),
    source: x.source as DeskRequest['source'],
    service,
    serviceLabel: service ? SERVICE_LABEL[service]! : null,
    status: x.status as DeskRequest['status'],
    studentId: String(x.student_id),
    student: String(x.student),
    admissionNo: text(x.admission_no),
    section: text(x.section),
    yearId: String(x.academic_year_id),
    pickRouteId: text(x.pick_route_id),
    pickRoute: routeName(x.pick_route_code, x.pick_route),
    pickStopId: text(x.pick_stop_id),
    pickStop: text(x.pick_stop),
    pickTime: text(x.pick_time),
    dropRouteId: text(x.drop_route_id),
    dropRoute: routeName(x.drop_route_code, x.drop_route),
    dropStopId: text(x.drop_stop_id),
    dropStop: text(x.drop_stop),
    dropTime: text(x.drop_time),
    slab: text(x.slab),
    monthlyAmount:
      x.monthly_amount === null || x.monthly_amount === undefined ? null : Number(x.monthly_amount),
    fromMonth: from,
    toMonth: text(x.to_month),
    what,
    note: text(x.note),
    feeNote: text(x.fee_note),
    decisionNote: text(x.decision_note),
    requestedBy: text(x.requested_by),
    requestedById: text(x.requested_by_id),
    requestedAt: iso(x.requested_at)!,
    decidedAt: iso(x.decided_at),
    approvedLevels: n(x.approved_n),
    levels: n(x.levels_n),
    waitingOn: text(x.waiting_on),
  };
};

const PERIOD = `SELECT t.id::text, t.student_id::text, s.display_name AS student, s.admission_no, ${SECTION('s.id', 't.academic_year_id')} AS section,
       t.service, t.pick_route_id::text, pr.code AS pick_route_code, pr.name AS pick_route, ps.name AS pick_stop, to_char(ps.pickup_time, 'HH24:MI') AS pick_time,
       t.drop_route_id::text, dr.code AS drop_route_code, dr.name AS drop_route, ds.name AS drop_stop, to_char(ds.drop_time, 'HH24:MI') AS drop_time,
       sl.name AS slab, t.monthly_amount::float AS monthly_amount, to_char(t.from_month, 'YYYY-MM') AS from_month, to_char(t.to_month, 'YYYY-MM') AS to_month,
       t.status, t.request_id::text, q.number AS request_no, q.source, q.decided_at,
       (SELECT COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = a.acted_by LIMIT 1), u.display_name)
          FROM transport_request_approvals a LEFT JOIN users u ON u.id = a.acted_by
         WHERE a.request_id = t.request_id AND a.status = 'approved' ORDER BY a.seq DESC LIMIT 1) AS approved_by,
       (SELECT v.reg_no FROM transport_vehicles v WHERE v.id = COALESCE(pr.vehicle_id, dr.vehicle_id)) AS vehicle,
       eq.number AS ended_by,
       CASE WHEN t.status = 'cancelled' THEN 'cancelled'
            WHEN ${MONTH} < t.from_month THEN 'upcoming'
            WHEN ${MONTH} > t.to_month THEN 'over' ELSE 'running' END AS phase
  FROM student_transport t
  JOIN students s ON s.id = t.student_id
  LEFT JOIN transport_routes pr ON pr.id = t.pick_route_id
  LEFT JOIN transport_stops ps ON ps.id = t.pick_stop_id
  LEFT JOIN transport_routes dr ON dr.id = t.drop_route_id
  LEFT JOIN transport_stops ds ON ds.id = t.drop_stop_id
  LEFT JOIN transport_slabs sl ON sl.id = t.slab_id
  LEFT JOIN transport_requests q ON q.id = t.request_id
  LEFT JOIN transport_requests eq ON eq.id = t.ended_by_request`;
const PERIOD_FROM = `FROM student_transport t JOIN students s ON s.id = t.student_id`;
const toPeriod = (x: Row) => ({
  id: String(x.id),
  studentId: String(x.student_id),
  student: String(x.student),
  admissionNo: text(x.admission_no),
  section: text(x.section),
  service: String(x.service) as Service,
  serviceLabel: SERVICE_LABEL[String(x.service)] ?? String(x.service),
  pickRoute: routeName(x.pick_route_code, x.pick_route),
  pickStop: text(x.pick_stop),
  pickTime: text(x.pick_time),
  dropRoute: routeName(x.drop_route_code, x.drop_route),
  dropStop: text(x.drop_stop),
  dropTime: text(x.drop_time),
  slab: text(x.slab),
  monthlyAmount: Number(x.monthly_amount ?? 0),
  fromMonth: String(x.from_month),
  toMonth: String(x.to_month),
  status: String(x.status),
  /** running, upcoming, over or cancelled, by today's month. */
  phase: String(x.phase),
  requestId: text(x.request_id),
  requestNo: text(x.request_no),
  source: text(x.source),
  approvedBy: text(x.approved_by),
  approvedAt: iso(x.decided_at),
  vehicle: text(x.vehicle),
  endedBy: text(x.ended_by),
});
export type PeriodRow = ReturnType<typeof toPeriod>;

export interface Settings {
  oneWayPercent: number;
  twoStopRule: 'higher' | 'pick' | 'sum';
  parentCanApply: boolean;
  notifyEmail: boolean;
}

/**
 * Transport v2 (0077): the request desk. A request says how the pupil rides (pick, drop or both), from
 * which stoppage(s) and for which months; the amount comes from the stoppage's slab by the school's rule.
 * It is approved level by level (a family's request: transport in-charge, then the fee department; one
 * the office makes: the fee department), and the last approval writes the period into the history,
 * updates the fees for those months and maps the pupil to the bus while the period runs.
 */
@Injectable()
export class TransportDeskService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
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
  /** The school's rule; the first read seeds the two approval chains. */
  private async settings(c: PoolClient): Promise<Settings> {
    const made = await c.query(
      `INSERT INTO transport_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    if (made.rowCount)
      await c.query(
        `INSERT INTO transport_approval_levels (school_id, source, seq, label, kind, role_code)
         SELECT app.current_school_id(), x.source, x.seq, x.label, x.kind, x.role_code FROM (VALUES
           ('parent', 1, 'Transport in-charge', 'route_incharge', NULL),
           ('parent', 2, 'Fee department', 'role', 'accountant'),
           ('office', 1, 'Fee department', 'role', 'accountant')
         ) AS x(source, seq, label, kind, role_code)
          WHERE NOT EXISTS (SELECT 1 FROM transport_approval_levels)`,
      );
    const r = await c.query<Row>(
      `SELECT one_way_percent::float AS one_way_percent, two_stop_rule, parent_can_apply, notify_email FROM transport_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      oneWayPercent: Number(x.one_way_percent),
      twoStopRule: x.two_stop_rule as Settings['twoStopRule'],
      parentCanApply: Boolean(x.parent_can_apply),
      notifyEmail: Boolean(x.notify_email),
    };
  }

  private async levels(c: PoolClient, source?: 'parent' | 'office') {
    const r = await c.query<Row>(
      `SELECT l.id::text, l.source, l.seq, l.label, l.kind, l.role_code, l.designation, l.employee_id::text, e.display_name AS employee_name, l.active
         FROM transport_approval_levels l LEFT JOIN employees e ON e.id = l.employee_id
        WHERE ($1::text IS NULL OR l.source = $1) ORDER BY l.source DESC, l.seq, l.id`,
      [source ?? null],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      source: x.source as 'parent' | 'office',
      seq: Number(x.seq),
      label: String(x.label),
      kind: x.kind as 'role' | 'designation' | 'employee' | 'route_incharge',
      roleCode: text(x.role_code),
      designation: text(x.designation),
      employeeId: text(x.employee_id),
      employeeName: text(x.employee_name),
      active: Boolean(x.active),
    }));
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const settings = await this.settings(c);
      await c.query(`SELECT app.module_seed_templates('transport_x')`);
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (code) code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student') ORDER BY code, school_id NULLS LAST`,
      );
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || designation, '') AS name FROM employees
          WHERE status = 'active' AND deleted_at IS NULL AND user_id IS NOT NULL ORDER BY display_name LIMIT 500`,
      );
      const designations = await c.query<{ d: string }>(
        `SELECT DISTINCT btrim(designation) AS d FROM employees WHERE designation IS NOT NULL AND btrim(designation) <> '' AND deleted_at IS NULL ORDER BY 1 LIMIT 200`,
      );
      const templates = await c.query<Row>(
        `SELECT t.code, t.channel::text, t.name, t.status::text, (t.dlt_template_id IS NOT NULL AND btrim(t.dlt_template_id) <> '') AS has_dlt,
                (t.wa_template_name IS NOT NULL AND btrim(t.wa_template_name) <> '') AS has_wa
           FROM comms_templates t WHERE t.code LIKE 'transport\\_%' AND t.deleted_at IS NULL ORDER BY t.code, t.channel`,
      );
      return {
        settings,
        levels: await this.levels(c),
        incharges: (
          await c.query<Row>(
            `SELECT i.route_id::text, i.employee_id::text, e.display_name AS name, e.mobile, (e.user_id IS NOT NULL) AS login
               FROM transport_incharges i JOIN employees e ON e.id = i.employee_id ORDER BY i.route_id NULLS FIRST, e.display_name`,
          )
        ).rows.map((x) => ({
          routeId: text(x.route_id),
          employeeId: String(x.employee_id),
          name: String(x.name),
          mobile: text(x.mobile),
          login: Boolean(x.login),
        })),
        routes: (
          await c.query<{ id: string; name: string }>(
            `SELECT id::text, code || ' · ' || name AS name FROM transport_routes WHERE deleted_at IS NULL AND status = 'active' ORDER BY code`,
          )
        ).rows,
        roles: roles.rows,
        staff: staff.rows,
        designations: designations.rows.map((x) => x.d),
        templates: templates.rows.map((t) => ({
          code: String(t.code),
          channel: String(t.channel),
          name: String(t.name),
          active: t.status === 'active',
          ready:
            t.status === 'active' && (t.channel === 'sms' ? Boolean(t.has_dlt) : Boolean(t.has_wa)),
        })),
      };
    });
  }

  async saveSetup(ctx: RequestContext, dto: TransportSetupDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      for (const source of ['parent', 'office'] as const)
        if (!dto.levels.some((l) => l.source === source && l.active))
          throw new DomainError(
            'validation-failed',
            `Keep at least one approval level for a request ${source === 'parent' ? 'from a family' : 'made by the office'}`,
            { status: 400 },
          );
      await c.query(
        `UPDATE transport_settings SET one_way_percent = $1, two_stop_rule = $2, parent_can_apply = $3, notify_email = $4, updated_at = now(),
                updated_by = app.current_user_id() WHERE school_id = app.current_school_id()`,
        [dto.oneWayPercent, dto.twoStopRule, dto.parentCanApply, dto.notifyEmail],
      );
      await c.query(`DELETE FROM transport_approval_levels`);
      const seq = { parent: 0, office: 0 };
      for (const l of dto.levels) {
        seq[l.source] += 1;
        await c.query(
          `INSERT INTO transport_approval_levels (school_id, source, seq, label, kind, role_code, designation, employee_id, active)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            l.source,
            seq[l.source],
            l.label,
            l.kind,
            l.kind === 'role' ? l.roleCode : null,
            l.kind === 'designation' ? l.designation : null,
            l.kind === 'employee' ? l.employeeId : null,
            l.active,
          ],
        );
      }
      await c.query(`DELETE FROM transport_incharges`);
      for (const i of dto.incharges)
        await c.query(
          `INSERT INTO transport_incharges (school_id, route_id, employee_id, created_by)
           VALUES (app.current_school_id(), $1, $2, app.current_user_id()) ON CONFLICT DO NOTHING`,
          [i.routeId ?? null, i.employeeId],
        );
      await this.audit.stage(ctx, c, {
        action: 'transport.setup.update',
        entityType: 'transport_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
    });
    return this.setup(ctx);
  }

  // ---- what a request can choose, and what it costs --------------------------------------------------
  private async stop(c: PoolClient, id: string, routeId?: string | null) {
    const r = await c.query<Row>(
      `SELECT st.id::text, st.route_id::text, st.name, COALESCE(st.slab_id, sg.slab_id)::text AS slab_id, sl.name AS slab, sl.monthly_amount::float AS amount
         FROM transport_stops st JOIN transport_routes r ON r.id = st.route_id AND r.deleted_at IS NULL AND r.status = 'active'
         LEFT JOIN transport_stoppages sg ON sg.id = st.stoppage_id
         LEFT JOIN transport_slabs sl ON sl.id = COALESCE(st.slab_id, sg.slab_id)
        WHERE st.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x || (routeId && String(x.route_id) !== routeId))
      throw new DomainError('not-found', 'The stoppage is not on this route', { status: 404 });
    return {
      id: String(x.id),
      routeId: String(x.route_id),
      name: String(x.name),
      slabId: text(x.slab_id),
      slab: text(x.slab),
      amount: x.amount === null || x.amount === undefined ? null : Number(x.amount),
    };
  }

  /** The monthly charge for one way of riding, by the school's rule. */
  private async quoteWith(c: PoolClient, dto: QuoteDto) {
    const s = await this.settings(c);
    const pick =
      dto.service !== 'drop' && dto.pickStopId ? await this.stop(c, dto.pickStopId) : null;
    const dropId =
      dto.service === 'pick'
        ? null
        : (dto.dropStopId ?? (dto.service === 'both' ? dto.pickStopId : null));
    const drop = dropId ? await this.stop(c, dropId) : null;
    for (const [side, st] of [
      ['pick', pick],
      ['drop', drop],
    ] as const)
      if (st && st.amount === null)
        throw new DomainError(
          'transport.no_slab',
          `The ${side} stoppage "${st.name}" has no fee slab yet; ask the transport office`,
          { status: 409 },
        );
    const oneWay = (a: number) => Math.round(a * s.oneWayPercent) / 100;
    let amount = 0;
    let slab = pick ?? drop;
    let rule = '';
    if (dto.service === 'pick' && pick) {
      amount = oneWay(pick.amount!);
      rule = `Pick only: ${String(s.oneWayPercent)}% of the slab`;
    } else if (dto.service === 'drop' && drop) {
      amount = oneWay(drop.amount!);
      slab = drop;
      rule = `Drop only: ${String(s.oneWayPercent)}% of the slab`;
    } else if (pick && drop) {
      if (pick.id === drop.id || pick.amount === drop.amount) {
        amount = pick.amount!;
        rule = 'Pick and drop: the slab of the stoppage';
      } else if (s.twoStopRule === 'pick') {
        amount = pick.amount!;
        rule = 'Different stoppages: the slab of the pick stoppage';
      } else if (s.twoStopRule === 'sum') {
        amount = oneWay(pick.amount!) + oneWay(drop.amount!);
        slab = pick.amount! >= drop.amount! ? pick : drop;
        rule = `Different stoppages: ${String(s.oneWayPercent)}% of each slab, added`;
      } else {
        slab = pick.amount! >= drop.amount! ? pick : drop;
        amount = slab.amount!;
        rule = 'Different stoppages: the higher slab';
      }
    } else throw new DomainError('validation-failed', 'Choose the stoppage', { status: 400 });
    return {
      amount: Math.round(amount * 100) / 100,
      slabId: slab!.slabId,
      slab: slab!.slab,
      rule,
      pick,
      drop,
    };
  }

  async quote(ctx: RequestContext, dto: QuoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = await this.quoteWith(c, dto);
      return { amount: q.amount, slab: q.slab, rule: q.rule };
    });
  }

  /** The months of the working session, from the fee calendar or else the session's own dates. */
  private async months(c: PoolClient, yearId: string) {
    const r = await c.query<{ m: string }>(
      `SELECT to_char(make_date(year, month, 1), 'YYYY-MM') AS m FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
      [yearId],
    );
    if (r.rows.length) return r.rows.map((x) => x.m);
    const y = await c.query<{ m: string }>(
      `SELECT to_char(g, 'YYYY-MM') AS m FROM academic_years y, generate_series(date_trunc('month', y.start_date), date_trunc('month', y.end_date), interval '1 month') g
        WHERE y.id = $1 ORDER BY 1`,
      [yearId],
    );
    return y.rows.map((x) => x.m);
  }

  private async optionsWith(c: PoolClient, yearId: string, studentId: string | null) {
    const settings = await this.settings(c);
    const routes = await c.query<Row>(
      `SELECT r.id::text, r.code, r.name,
              (SELECT v.reg_no FROM transport_vehicles v WHERE v.id = r.vehicle_id) AS vehicle,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', st.id::text, 'name', st.name, 'pickupTime', to_char(st.pickup_time, 'HH24:MI'),
                          'dropTime', to_char(st.drop_time, 'HH24:MI'), 'slab', sl.name, 'amount', sl.monthly_amount::float) ORDER BY st.sequence)
                          FROM transport_stops st LEFT JOIN transport_stoppages sg ON sg.id = st.stoppage_id
                          LEFT JOIN transport_slabs sl ON sl.id = COALESCE(st.slab_id, sg.slab_id) WHERE st.route_id = r.id), '[]'::jsonb) AS stops
         FROM transport_routes r WHERE r.deleted_at IS NULL AND r.status = 'active' ORDER BY r.code`,
    );
    const months = await this.months(c, yearId);
    const now = await c.query<{ m: string }>(`SELECT to_char(${MONTH}, 'YYYY-MM') AS m`);
    const periods = studentId
      ? (
          await c.query<Row>(
            `${PERIOD} WHERE t.student_id = $1 AND t.academic_year_id = $2 AND t.status <> 'cancelled' ORDER BY t.from_month DESC, t.id DESC`,
            [studentId, yearId],
          )
        ).rows.map(toPeriod)
      : [];
    return {
      settings: { oneWayPercent: settings.oneWayPercent, twoStopRule: settings.twoStopRule },
      routes: routes.rows.map((x) => ({
        id: String(x.id),
        code: String(x.code),
        name: String(x.name),
        vehicle: text(x.vehicle),
        stops: x.stops as Array<{
          id: string;
          name: string;
          pickupTime: string | null;
          dropTime: string | null;
          slab: string | null;
          amount: number | null;
        }>,
      })),
      months,
      thisMonth: now.rows[0]!.m,
      periods,
      /** Rides now or will ride: a new request for this pupil is a change or a withdrawal. */
      riding: periods.some((p) => p.phase === 'running' || p.phase === 'upcoming'),
    };
  }

  private async family(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'transport.request.view');
    if (v.kind !== 'family')
      throw new DomainError('forbidden', 'Only a parent or student can do this here', {
        status: 403,
      });
    return v;
  }

  async familyOptions(ctx: RequestContext, studentId: string | null) {
    const yearId = this.year(ctx);
    const v = await this.family(ctx);
    if (studentId && !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      return {
        ...(await this.optionsWith(c, yearId, studentId)),
        students: v.students.map((x) => ({ id: x.id, name: x.name, section: x.section })),
        canApply: s.parentCanApply,
      };
    });
  }

  async deskOptions(ctx: RequestContext, studentId: string | null) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => this.optionsWith(c, yearId, studentId));
  }

  /** Pupils by name or admission number, with how they ride now, for a request made at the office. */
  async students(ctx: RequestContext, q: string) {
    const yearId = this.year(ctx);
    const term = q.trim();
    if (term.length < 2) return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, ${SECTION('s.id', '$2::bigint')} AS section,
                (SELECT rt.code || COALESCE(' · ' || a.stop_name, '') FROM student_route_assignments a JOIN transport_routes rt ON rt.id = a.route_id
                  WHERE a.student_id = s.id AND a.academic_year_id = $2) AS riding
           FROM students s WHERE s.deleted_at IS NULL AND (s.admission_no ILIKE $1 || '%' OR s.display_name ILIKE '%' || $1 || '%')
          ORDER BY (lower(s.admission_no) = lower($1)) DESC, s.display_name LIMIT 12`,
        [term, yearId],
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          admissionNo: text(x.admission_no),
          section: text(x.section),
          riding: text(x.riding),
        })),
      };
    });
  }

  // ---- asking ---------------------------------------------------------------------------------------
  private async create(
    c: PoolClient,
    ctx: RequestContext,
    yearId: string,
    dto: ApplyDto,
    source: 'parent' | 'office',
    /** many at once (an Excel upload): the approvers are not mailed one message per pupil */
    quiet = false,
  ) {
    const months = await this.months(c, yearId);
    if (!months.includes(dto.fromMonth))
      throw new DomainError('validation-failed', 'The first month is outside this session', {
        status: 400,
      });
    const toMonth =
      dto.kind === 'leave'
        ? months[months.length - 1]!
        : (dto.toMonth ?? months[months.length - 1]!);
    if (!months.includes(toMonth))
      throw new DomainError('validation-failed', 'The last month is outside this session', {
        status: 400,
      });
    const st = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
      dto.studentId,
    ]);
    if (!st.rowCount) throw new DomainError('not-found', 'Student not found', { status: 404 });
    const riding = await c.query(
      `SELECT 1 FROM student_transport WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active' AND to_month >= ${MONTH}
       UNION ALL SELECT 1 FROM student_route_assignments WHERE student_id = $1 AND academic_year_id = $2`,
      [dto.studentId, yearId],
    );
    if (dto.kind === 'leave' && !riding.rowCount)
      throw new DomainError('transport.not_riding', 'The student is not on a bus this session', {
        status: 409,
      });
    type Stop = Awaited<ReturnType<TransportDeskService['stop']>>;
    let pick = null as Stop | null;
    let drop = null as Stop | null;
    let amount: number | null = null;
    let slabId: string | null = null;
    if (dto.kind !== 'leave') {
      const service = dto.service!;
      if (service !== 'drop') pick = await this.stop(c, dto.pickStopId!, dto.pickRouteId);
      // pick and drop means one route both ways unless another drop stoppage is chosen
      if (service !== 'pick')
        drop = dto.dropStopId ? await this.stop(c, dto.dropStopId, dto.dropRouteId) : pick;
      const q = await this.quoteWith(c, { service, pickStopId: pick?.id, dropStopId: drop?.id });
      amount = q.amount;
      slabId = q.slabId;
    }
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO transport_requests (school_id, student_id, academic_year_id, kind, source, service, route_id, stop_id, pick_route_id, pick_stop_id,
                                         drop_route_id, drop_stop_id, slab_id, monthly_amount, from_month, to_month, effective_from, note, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::transport_request_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ($14 || '-01')::date, ($15 || '-01')::date,
                 ($14 || '-01')::date, $16, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [
          dto.studentId,
          yearId,
          dto.kind,
          source,
          dto.kind === 'leave' ? null : dto.service,
          pick?.routeId ?? drop?.routeId ?? null,
          pick?.id ?? drop?.id ?? null,
          pick?.routeId ?? null,
          pick?.id ?? null,
          drop?.routeId ?? null,
          drop?.id ?? null,
          slabId,
          amount,
          dto.fromMonth,
          toMonth,
          dto.note ?? null,
        ],
      );
      id = r.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError(
          'transport.request_open',
          'A request for this student is already waiting for a decision',
          { status: 409 },
        );
      throw error;
    }
    await c.query(
      `UPDATE transport_requests SET number = 'TR-' || to_char(requested_at AT TIME ZONE ${TZ}, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE id = $1`,
      [id],
    );
    await this.startApprovals(c, id, source, quiet);
    await this.audit.stage(ctx, c, {
      action: 'transport.request.create',
      entityType: 'transport_requests',
      entityId: id,
      after: { ...dto, source, amount },
    });
    return id;
  }

  async familyApply(ctx: RequestContext, dto: ApplyDto) {
    const yearId = this.year(ctx);
    const v = await this.family(ctx);
    if (!v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('permission-denied', 'Not one of your children', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await this.settings(c)).parentCanApply)
        throw new DomainError(
          'transport.closed',
          'Please ask the transport office to make this request',
          {
            status: 409,
          },
        );
      return this.detail(c, await this.create(c, ctx, yearId, dto, 'parent'));
    });
  }

  /** The transport office makes the request for a pupil; it goes to the fee department. */
  async deskApply(ctx: RequestContext, dto: ApplyDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.detail(c, await this.create(c, ctx, yearId, dto, 'office')),
    );
  }

  async familyCancel(ctx: RequestContext, id: string) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = await this.find(c, id);
      if (!v.students.some((s) => s.id === q.studentId))
        throw new DomainError('not-found', 'Request not found', { status: 404 });
      if (q.status !== 'pending')
        throw new DomainError('conflict', 'This request has been decided', { status: 409 });
      await c.query(
        `UPDATE transport_requests SET status = 'cancelled', decided_at = now(), decision_note = 'Cancelled by the family' WHERE id = $1`,
        [id],
      );
      await c.query(
        `UPDATE transport_request_approvals SET status = 'skipped', note = 'Cancelled' WHERE request_id = $1 AND status IN ('pending', 'waiting')`,
        [id],
      );
      return { id };
    });
  }

  // ---- approvals ------------------------------------------------------------------------------------
  private async approversOf(
    c: PoolClient,
    l: {
      kind: string;
      roleCode: string | null;
      designation: string | null;
      employeeId: string | null;
    },
    routeIds: string[] = [],
  ): Promise<string[]> {
    if (l.kind === 'route_incharge') {
      // the in-charge named for the route; else the school's in-charges; else whoever holds the role
      for (const where of [
        `i.route_id = ANY($1::bigint[])`,
        `i.route_id IS NULL AND $1::bigint[] IS NOT NULL`,
      ]) {
        const r = await c.query<{ id: string }>(
           
          `SELECT DISTINCT e.user_id::text AS id FROM transport_incharges i JOIN employees e ON e.id = i.employee_id
            WHERE ${where} AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL`,
          [routeIds],
        );
        if (r.rows.length) return r.rows.map((x) => x.id);
      }
      return this.approversOf(c, { ...l, kind: 'role', roleCode: 'transport_incharge' });
    }
    const r =
      l.kind === 'role'
        ? await c.query<{ id: string }>(
            `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.school_id = app.current_school_id() AND r.code = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
                AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
            [l.roleCode],
          )
        : l.kind === 'designation'
          ? await c.query<{ id: string }>(
              `SELECT DISTINCT user_id::text AS id FROM employees
                WHERE lower(btrim(designation)) = lower(btrim($1)) AND user_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
              [l.designation],
            )
          : await c.query<{ id: string }>(
              `SELECT user_id::text AS id FROM employees WHERE id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL`,
              [l.employeeId],
            );
    return r.rows.map((x) => x.id);
  }

  /** One row per level, in order: the first that someone holds may act; a level nobody holds is skipped. */
  private async startApprovals(
    c: PoolClient,
    id: string,
    source: 'parent' | 'office',
    quiet = false,
  ) {
    await this.settings(c);
    const rows: Array<{ label: string; users: string[] }> = [];
    // the routes the request is about (a withdrawal: the routes the pupil rides now)
    const routes = await c.query<{ id: string }>(
      `SELECT DISTINCT x.id::text FROM transport_requests q
         LEFT JOIN student_route_assignments a ON a.student_id = q.student_id AND a.academic_year_id = q.academic_year_id
         CROSS JOIN LATERAL unnest(ARRAY[q.pick_route_id, q.drop_route_id, a.route_id, a.drop_route_id]) AS x(id)
        WHERE q.id = $1 AND x.id IS NOT NULL`,
      [id],
    );
    const routeIds = routes.rows.map((x) => x.id);
    for (const l of (await this.levels(c, source)).filter((x) => x.active))
      rows.push({ label: l.label, users: await this.approversOf(c, l, routeIds) });
    if (!rows.some((r) => r.users.length)) {
      const admins = await this.approversOf(c, {
        kind: 'role',
        roleCode: 'school_admin',
        designation: null,
        employeeId: null,
      });
      rows.push({ label: 'School admin', users: admins });
    }
    let opened = false;
    let seq = 0;
    for (const r of rows) {
      seq += 1;
      const status = !r.users.length ? 'skipped' : opened ? 'waiting' : 'pending';
      if (status === 'pending') opened = true;
      await c.query(
        `INSERT INTO transport_request_approvals (school_id, request_id, seq, label, approver_user_ids, status, note)
         VALUES (app.current_school_id(), $1, $2, $3, $4::bigint[], $5, $6)`,
        [
          id,
          seq,
          r.label,
          r.users,
          status,
          status === 'skipped' ? 'Nobody holds this level' : null,
        ],
      );
    }
    if (!opened) return this.finish(c, id, 'approved', 'No approver is set up');
    if (!quiet) await this.tellApprovers(c, id);
  }

  private async school(c: PoolClient): Promise<string> {
    return (
      (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]?.name ?? ''
    );
  }

  private mailRows(q: DeskRequest): Array<[string, string | null]> {
    return [
      ['Request', `${q.kindLabel} · ${q.number}`],
      [
        'Student',
        `${q.student}${q.section ? ` (${q.section})` : ''}${q.admissionNo ? ` · Adm. no. ${q.admissionNo}` : ''}`,
      ],
      ['Service', q.serviceLabel],
      [
        'Pick',
        q.service !== 'drop' && q.pickStop
          ? `${q.pickStop} · ${q.pickRoute ?? ''}${q.pickTime ? ` · ${q.pickTime}` : ''}`
          : null,
      ],
      [
        'Drop',
        q.service !== 'pick' && q.dropStop
          ? `${q.dropStop} · ${q.dropRoute ?? ''}${q.dropTime ? ` · ${q.dropTime}` : ''}`
          : null,
      ],
      [q.kind === 'leave' ? 'No bus from' : 'From', monthLabel(q.fromMonth)],
      ['To', q.kind === 'leave' ? null : monthLabel(q.toMonth)],
      ['Slab', q.slab],
      [
        'Monthly charge',
        q.monthlyAmount !== null ? `Rs ${q.monthlyAmount.toLocaleString('en-IN')}` : null,
      ],
      ['Note', q.note],
    ];
  }

  private async tellApprovers(c: PoolClient, id: string) {
    const s = await this.settings(c);
    const q = await this.find(c, id);
    const school = await this.school(c);
    const levels = await c.query<{ label: string; users: string[] }>(
      `SELECT label, approver_user_ids::text[] AS users FROM transport_request_approvals WHERE request_id = $1 AND status = 'pending' AND acted_at IS NULL`,
      [id],
    );
    for (const l of levels.rows) {
      await c.query(
        `SELECT app.template_to_users('transport_to_approve', $1::bigint[], $2::jsonb)`,
        [
          l.users,
          JSON.stringify({
            number: q.number,
            who: q.student,
            what: q.what,
            level: l.label,
            school,
          }),
        ],
      );
      if (!s.notifyEmail) continue;
      const to = await c.query<{ email: string }>(
        `SELECT DISTINCT COALESCE(e.email::text, u.email::text) AS email FROM users u LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
          WHERE u.id = ANY($1::bigint[]) AND COALESCE(e.email::text, u.email::text) IS NOT NULL`,
        [l.users],
      );
      for (const r of to.rows)
        await c.query(
          `SELECT app.queue_mail($1, $2, app.mail_card_html($3, $4, '#B26A00', $5, $6::jsonb, NULL, NULL, NULL), '[]'::jsonb, jsonb_build_object('transportRequest', $7::text))`,
          [
            r.email,
            `Transport request to approve: ${q.student} (${q.number})`,
            school,
            'A transport request is waiting for your approval',
            `You approve as ${l.label}. Open Transport → To approve in the ERP.`,
            JSON.stringify(this.mailRows(q)),
            id,
          ],
        );
    }
  }

  /** The end of the approval. Approved: the period, the fees and the bus mapping; the family is told. */
  private async finish(
    c: PoolClient,
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ) {
    await c.query(
      `UPDATE transport_request_approvals SET status = 'skipped', note = COALESCE(note, 'Not needed') WHERE request_id = $1 AND status IN ('pending', 'waiting')`,
      [id],
    );
    await c.query(
      `UPDATE transport_requests SET status = $2::workflow_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3 WHERE id = $1`,
      [id, outcome, note],
    );
    if (outcome === 'approved') await this.applyApproved(c, id);
    const q = await this.find(c, id);
    const school = await this.school(c);
    const g = await c.query<{ mobile: string | null; email: string | null }>(
      `SELECT g.mobile, g.email::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1 AND sg.receives_notifications`,
      [q.studentId],
    );
    await c.query(`SELECT app.template_to_mobiles($1, $2::text[], $3::jsonb)`, [
      outcome === 'approved' ? 'transport_approved' : 'transport_rejected',
      g.rows.map((x) => x.mobile).filter(Boolean),
      JSON.stringify({
        number: q.number,
        who: q.student,
        what: q.what,
        from: monthLabel(q.fromMonth),
        amount: q.monthlyAmount !== null ? String(q.monthlyAmount) : '',
        reason: note ?? '',
        school,
      }),
    ]);
    if (!(await this.settings(c)).notifyEmail) return;
    for (const email of [
      ...new Set(g.rows.map((x) => x.email).filter((e): e is string => Boolean(e))),
    ])
      await c.query(
        `SELECT app.queue_mail($1, $2, app.mail_card_html($3, $4, $5, $6, $7::jsonb, NULL, NULL, NULL), '[]'::jsonb, jsonb_build_object('transportRequest', $8::text))`,
        [
          email,
          outcome === 'approved'
            ? `Transport request ${q.number} approved: ${q.student}`
            : `Transport request not approved: ${q.student}`,
          school,
          outcome === 'approved' ? 'Transport request approved' : 'Transport request not approved',
          outcome === 'approved' ? '#1B7F4B' : '#B3261E',
          outcome === 'approved'
            ? q.kind === 'leave'
              ? `The bus stops from ${monthLabel(q.fromMonth)}. Until then the route and the live bus position stay in the parent portal.`
              : 'The request is approved. The route, the stoppage and the live bus position show in the parent portal under Transport; the fee is on the fee page.'
            : `The request was not approved${note ? `: ${note}` : '.'}`,
          JSON.stringify(this.mailRows(q)),
          id,
        ],
      );
  }

  /**
   * An approved request becomes history. A change or a withdrawal cuts the running period at the month
   * before; a join or change adds the new period. Then the fees of the session are worked out again from
   * the periods, and the bus mapping follows the period that covers today.
   */
  private async applyApproved(c: PoolClient, id: string) {
    const r = await c.query<Row>(
      `SELECT q.student_id::text, q.academic_year_id::text, q.kind::text, q.service, q.pick_route_id::text, q.pick_stop_id::text, q.drop_route_id::text,
              q.drop_stop_id::text, q.slab_id::text, q.monthly_amount, q.from_month::text, q.to_month::text
         FROM transport_requests q WHERE q.id = $1`,
      [id],
    );
    const q = r.rows[0]!;
    const student = String(q.student_id);
    const yearId = String(q.academic_year_id);
    const had = await c.query(
      `SELECT 1 FROM student_transport WHERE student_id = $1 AND academic_year_id = $2 AND status <> 'cancelled'`,
      [student, yearId],
    );
    if (!had.rowCount) {
      // mapped the old way (no history): what ran so far becomes the first period, so earlier months keep their charge
      await c.query(
        `INSERT INTO student_transport (school_id, student_id, academic_year_id, service, pick_route_id, pick_stop_id, drop_route_id, drop_stop_id, slab_id,
                                        monthly_amount, from_month, to_month, created_by)
         SELECT a.school_id, a.student_id, a.academic_year_id, 'both', a.route_id, a.stop_id, a.route_id, a.stop_id, COALESCE(p.transport_slab_id, st.slab_id),
                COALESCE(sl.monthly_amount, 0), date_trunc('month', y.start_date)::date, ($3::date - interval '1 month')::date, app.current_user_id()
           FROM student_route_assignments a JOIN academic_years y ON y.id = a.academic_year_id
           LEFT JOIN student_fee_profiles p ON p.student_id = a.student_id AND p.academic_year_id = a.academic_year_id
           LEFT JOIN transport_stops st ON st.id = a.stop_id
           LEFT JOIN transport_slabs sl ON sl.id = COALESCE(p.transport_slab_id, st.slab_id)
          WHERE a.student_id = $1 AND a.academic_year_id = $2 AND $3::date > date_trunc('month', y.start_date)::date`,
        [student, yearId, q.from_month],
      );
    }
    // what was to run from this month on gives way
    await c.query(
      `UPDATE student_transport SET status = 'cancelled', ended_by_request = $4 WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active' AND from_month >= $3::date`,
      [student, yearId, q.from_month, id],
    );
    await c.query(
      `UPDATE student_transport SET to_month = ($3::date - interval '1 month')::date, status = 'ended', ended_by_request = $4
        WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active' AND to_month >= $3::date`,
      [student, yearId, q.from_month, id],
    );
    if (q.kind !== 'leave')
      await c.query(
        `INSERT INTO student_transport (school_id, student_id, academic_year_id, request_id, service, pick_route_id, pick_stop_id, drop_route_id, drop_stop_id,
                                        slab_id, monthly_amount, from_month, to_month, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date, app.current_user_id())`,
        [
          student,
          yearId,
          id,
          q.service,
          q.pick_route_id,
          q.pick_stop_id,
          q.drop_route_id,
          q.drop_stop_id,
          q.slab_id,
          q.monthly_amount ?? 0,
          q.from_month,
          q.to_month,
        ],
      );
    await c.query(`SELECT app.transport_sync($1, $2)`, [student, yearId]);
    // the fees: the slab on the profile (so the transport head is raised at all), then the session's demand again
    await c.query('SAVEPOINT transport_fee');
    try {
      await c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, transport_slab_id, transport_disabled, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, false, app.current_user_id(), app.current_user_id())
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET transport_slab_id = COALESCE(EXCLUDED.transport_slab_id, student_fee_profiles.transport_slab_id),
              transport_disabled = false, updated_at = now(), updated_by = app.current_user_id()`,
        [student, yearId, q.slab_id],
      );
      await c.query(`SELECT * FROM app.generate_fee_demand($1, $2)`, [student, yearId]);
      await c.query('RELEASE SAVEPOINT transport_fee');
      // a month already paid keeps what was paid: say so, the fee desk adjusts or refunds it
      const paid = await c.query<{ m: string }>(
        `SELECT to_char(make_date(fp.year, fp.month, 1), 'Mon YYYY') AS m
           FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id JOIN fee_heads fh ON fh.id = d.head_id AND fh.kind = 'transport'
          WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.paid > 0 AND make_date(fp.year, fp.month, 1) >= $3::date
            AND d.gross IS DISTINCT FROM COALESCE((SELECT t.monthly_amount FROM student_transport t
                  WHERE t.student_id = d.student_id AND t.academic_year_id = d.academic_year_id AND t.status <> 'cancelled'
                    AND make_date(fp.year, fp.month, 1) BETWEEN t.from_month AND t.to_month ORDER BY t.id DESC LIMIT 1), 0)
          ORDER BY fp.sequence`,
        [student, yearId, q.from_month],
      );
      await c.query(`UPDATE transport_requests SET fee_note = $2 WHERE id = $1`, [
        id,
        paid.rows.length
          ? `Fees updated for the months of this request, except ${paid.rows.map((x) => x.m).join(', ')}: already paid at the earlier amount, so the fee desk must adjust or refund the difference`
          : 'Fees updated for the months of this request',
      ]);
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT transport_fee');
      const why =
        (e as { detail?: string; message?: string }).detail ??
        (e as Error).message ??
        'unknown reason';
      await c.query(`UPDATE transport_requests SET fee_note = $2 WHERE id = $1`, [
        id,
        `Fees were not updated automatically (${String(why).slice(0, 160)}); the fee desk must update the transport fee`,
      ]);
    }
  }

  /** An approver acts on a request that waits on them. */
  async decide(ctx: RequestContext, id: string, dto: DeskDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM transport_requests WHERE id = $1 FOR UPDATE`, [id]);
      const q = await this.find(c, id);
      if (q.status !== 'pending')
        throw new DomainError('transport.request_decided', 'This request has been decided', {
          status: 409,
        });
      const mine = await c.query<{ id: string }>(
        `SELECT id::text FROM transport_request_approvals WHERE request_id = $1 AND status = 'pending' AND app.current_user_id() = ANY(approver_user_ids)
          ORDER BY seq LIMIT 1`,
        [id],
      );
      if (!mine.rows[0])
        throw new DomainError('forbidden', 'This request is not waiting for your approval', {
          status: 403,
        });
      await c.query(
        `UPDATE transport_request_approvals SET status = $2, acted_by = app.current_user_id(), acted_at = now(), note = $3 WHERE id = $1`,
        [mine.rows[0].id, dto.outcome, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `transport.request.level_${dto.outcome}`,
        entityType: 'transport_requests',
        entityId: id,
        after: { note: dto.note ?? null },
      });
      if (dto.outcome === 'rejected') await this.finish(c, id, 'rejected', dto.note ?? null);
      else {
        const next = await c.query<{ id: string }>(
          `UPDATE transport_request_approvals SET status = 'pending' WHERE id = (
             SELECT id FROM transport_request_approvals WHERE request_id = $1 AND status = 'waiting' ORDER BY seq LIMIT 1) RETURNING id::text`,
          [id],
        );
        if (next.rows[0]) await this.tellApprovers(c, id);
        else await this.finish(c, id, 'approved', dto.note ?? null);
      }
      return this.detail(c, id);
    });
  }

  /** Several requests at my level in one go; each is decided on its own, and the ones refused are named. */
  async decideMany(ctx: RequestContext, dto: DecideManyDto) {
    let done = 0;
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of dto.ids) {
      try {
        await this.decide(ctx, id, { outcome: dto.outcome, note: dto.note });
        done += 1;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        failed.push({ id, message: error.message });
      }
    }
    return { done, failed };
  }

  // ---- many pupils from Excel (the start of a session) -------------------------------------------------
  private static readonly IMPORT_COLUMNS = [
    'Admission no',
    'Service',
    'Pick stoppage',
    'Drop stoppage',
    'From month',
    'To month',
    'Note',
  ];
  private static readonly SERVICE_WORD: Record<string, Service> = {
    pickanddrop: 'both',
    both: 'both',
    pickonly: 'pick',
    pick: 'pick',
    droponly: 'drop',
    drop: 'drop',
  };

  /** The sheet to fill: service, stoppage (route · stoppage) and months are drop-downs. */
  async importTemplate(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const { stops, months } = await this.db.tenant(requireTenant(ctx), async (c) => ({
      stops: (
        await c.query<{ label: string }>(
          `SELECT r.code || ' · ' || st.name AS label FROM transport_stops st JOIN transport_routes r ON r.id = st.route_id AND r.deleted_at IS NULL AND r.status = 'active'
            ORDER BY r.code, st.sequence`,
        )
      ).rows.map((x) => x.label),
      months: await this.months(c, yearId),
    }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transport requests');
    const lists = wb.addWorksheet('Lists');
    const guide = wb.addWorksheet('How to fill');
    ws.addRow(TransportDeskService.IMPORT_COLUMNS).font = { bold: true };
    ws.columns.forEach((col, i) => {
      col.width = i === 2 || i === 3 ? 36 : 18;
      if (i === 0 || i === 4 || i === 5) col.numFmt = '@';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const list = (col: string, title: string, values: string[]) => {
      lists.getCell(`${col}1`).value = title;
      lists.getCell(`${col}1`).font = { bold: true };
      values.forEach((v, i) => {
        lists.getCell(`${col}${String(i + 2)}`).value = v;
      });
      return `Lists!$${col}$2:$${col}$${String(Math.max(2, values.length + 1))}`;
    };
    const services = list('A', 'Service', ['Pick and drop', 'Pick only', 'Drop only']);
    const stoppages = list('B', 'Stoppage (route · stoppage)', stops);
    const monthList = list('C', 'Month', months);
    lists.columns.forEach((col) => {
      col.width = 36;
    });
    const refuse = (title: string) => ({
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'error' as const,
      errorTitle: title,
      error: 'Choose from the drop-down.',
    });
    for (let r = 2; r <= 1001; r += 1) {
      ws.getCell(`B${String(r)}`).dataValidation = {
        type: 'list',
        formulae: [services],
        ...refuse('Service'),
      };
      for (const col of ['C', 'D'])
        ws.getCell(`${col}${String(r)}`).dataValidation = {
          type: 'list',
          formulae: [stoppages],
          ...refuse('Stoppage'),
        };
      for (const col of ['E', 'F'])
        ws.getCell(`${col}${String(r)}`).dataValidation = {
          type: 'list',
          formulae: [monthList],
          ...refuse('Month'),
        };
    }
    for (const line of [
      'One row per pupil. Every row becomes a transport request made by the transport office; it waits for the fee department, and the fees follow the approval.',
      'Admission no: as on the pupil’s record.',
      'Service: Pick and drop, Pick only or Drop only.',
      'Pick stoppage: choose "route · stoppage" (needed for Pick and drop and Pick only).',
      'Drop stoppage: needed for Drop only; for Pick and drop fill it only when the drop is at a different stoppage or route.',
      'From month and To month: like 2026-06. A blank To month means the end of the session.',
      'A pupil who already rides gets a Change request; a pupil with a request still waiting is reported and left out.',
    ])
      guide.addRow([line]);
    guide.getColumn(1).width = 150;
    return {
      bytes: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
      filename: `transport-requests-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  /** Each good row becomes an office request; a row that cannot be read is reported with its line. */
  async importRequests(ctx: RequestContext, dto: ImportRequestsDto) {
    const yearId = this.year(ctx);
    const { header, rows, rowNumbers } = await readFile({ contentBase64: dto.fileBase64 });
    const key = (v: unknown) =>
      String(v ?? '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    const at = Object.fromEntries(header.map((h, i) => [key(h), i]));
    for (const need of ['admissionno', 'service', 'frommonth'])
      if (at[need] === undefined)
        throw new DomainError(
          'validation-failed',
          'The sheet does not have the headings of the template (Admission no, Service, From month …)',
          { status: 400 },
        );
    if (rows.length > 1000)
      throw new DomainError('validation-failed', 'At most 1,000 rows per upload', { status: 400 });
    const cell = (r: unknown[], name: string): string => {
      const v = at[name] === undefined ? null : r[at[name]];
      if (v instanceof Date) return v.toISOString().slice(0, 7);
      return String(v ?? '').trim();
    };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let created = 0;
      const errors: Array<{ row: number; message: string }> = [];
      const stopOf = async (label: string) => {
        const [route, ...rest] = label.split(' · ');
        const r = await c.query<{ id: string; route_id: string }>(
          `SELECT st.id::text, st.route_id::text FROM transport_stops st JOIN transport_routes r ON r.id = st.route_id AND r.deleted_at IS NULL
            WHERE lower(r.code) = lower($1) AND lower(st.name) = lower($2) LIMIT 1`,
          [(route ?? '').trim(), rest.join(' · ').trim()],
        );
        if (!r.rows[0])
          throw new DomainError('validation-failed', `"${label}" is not a stoppage of a route`);
        return r.rows[0];
      };
      for (const [i, r] of rows.entries()) {
        const rowNo = rowNumbers[i] ?? i + 2;
        const adm = cell(r, 'admissionno');
        if (!adm && !cell(r, 'service') && !cell(r, 'pickstoppage')) continue;
        await c.query('SAVEPOINT transport_import');
        try {
          const st = await c.query<{ id: string }>(
            `SELECT id::text FROM students WHERE lower(admission_no) = lower($1) AND deleted_at IS NULL LIMIT 1`,
            [adm],
          );
          if (!st.rows[0])
            throw new DomainError('validation-failed', `No student with admission no. "${adm}"`);
          const service = TransportDeskService.SERVICE_WORD[key(cell(r, 'service'))];
          if (!service)
            throw new DomainError(
              'validation-failed',
              'Service must be Pick and drop, Pick only or Drop only',
            );
          const from = cell(r, 'frommonth').slice(0, 7);
          const to = cell(r, 'tomonth').slice(0, 7);
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || (to && !/^\d{4}-(0[1-9]|1[0-2])$/.test(to)))
            throw new DomainError('validation-failed', 'Months must be like 2026-06');
          const pick = service !== 'drop' ? await stopOf(cell(r, 'pickstoppage')) : null;
          const dropLabel = cell(r, 'dropstoppage');
          const drop =
            service === 'drop' || (service === 'both' && dropLabel)
              ? await stopOf(dropLabel)
              : null;
          const riding = await c.query(
            `SELECT 1 FROM student_transport WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active' AND to_month >= ${MONTH}`,
            [st.rows[0].id, yearId],
          );
          await this.create(
            c,
            ctx,
            yearId,
            {
              studentId: st.rows[0].id,
              kind: riding.rowCount ? 'change' : 'join',
              service,
              pickRouteId: pick?.route_id,
              pickStopId: pick?.id,
              dropRouteId: drop?.route_id,
              dropStopId: drop?.id,
              fromMonth: from,
              toMonth: to || undefined,
              note: cell(r, 'note') || 'Excel upload',
            },
            'office',
            true,
          );
          await c.query('RELEASE SAVEPOINT transport_import');
          created += 1;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT transport_import');
          if (!(error instanceof DomainError)) throw error;
          errors.push({ row: rowNo, message: error.message });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'transport.request.import',
        entityType: 'transport_requests',
        entityId: requireTenant(ctx).schoolId,
        after: { file: dto.fileName ?? null, created, errors: errors.length },
      });
      return { rows: created + errors.length, created, errors: errors.slice(0, 200) };
    });
  }

  async inbox(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `${REQUEST} WHERE q.status = 'pending' AND EXISTS (SELECT 1 FROM transport_request_approvals a WHERE a.request_id = q.id AND a.status = 'pending'
              AND app.current_user_id() = ANY(a.approver_user_ids)) ORDER BY q.requested_at LIMIT 200`,
      );
      const done = await c.query<Row>(
        `${REQUEST} WHERE EXISTS (SELECT 1 FROM transport_request_approvals a WHERE a.request_id = q.id AND a.acted_by = app.current_user_id())
          ORDER BY q.requested_at DESC LIMIT 30`,
      );
      return { data: r.rows.map(toRequest), decided: done.rows.map(toRequest) };
    });
  }

  // ---- reading --------------------------------------------------------------------------------------
  private async find(c: PoolClient, id: string): Promise<DeskRequest> {
    const r = await c.query<Row>(`${REQUEST} WHERE q.id = $1`, [id]);
    if (!r.rows[0])
      throw new DomainError('not-found', 'Transport request not found', { status: 404 });
    return toRequest(r.rows[0]);
  }

  private async detail(c: PoolClient, id: string) {
    const q = await this.find(c, id);
    const trail = await c.query<Row>(
      `SELECT a.seq, a.label, a.status, a.acted_at, a.note, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = a.acted_by LIMIT 1), u.display_name) AS acted_by,
              (SELECT string_agg(x.display_name, ', ' ORDER BY x.display_name) FROM users x WHERE x.id = ANY(a.approver_user_ids)) AS approvers,
              app.current_user_id() = ANY(a.approver_user_ids) AS mine
         FROM transport_request_approvals a LEFT JOIN users u ON u.id = a.acted_by WHERE a.request_id = $1 ORDER BY a.seq`,
      [id],
    );
    const periods = await c.query<Row>(
      `${PERIOD} WHERE t.student_id = $1 AND t.academic_year_id = $2 ORDER BY t.from_month DESC, t.id DESC`,
      [q.studentId, q.yearId],
    );
    return {
      ...q,
      approvals: trail.rows.map((x) => ({
        seq: Number(x.seq),
        label: String(x.label),
        status: String(x.status),
        approvers: text(x.approvers),
        actedBy: text(x.acted_by),
        actedAt: iso(x.acted_at),
        note: text(x.note),
        mine: Boolean(x.mine),
      })),
      canDecide:
        q.status === 'pending' && trail.rows.some((x) => x.status === 'pending' && Boolean(x.mine)),
      periods: periods.rows.map(toPeriod),
    };
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const d = await this.detail(c, id);
      const may = ['transport.request.view', 'transport.request.decide'].some((p) =>
        ctx.permissions?.has(p),
      );
      if (!may && !d.approvals.some((a) => a.mine))
        throw new DomainError('not-found', 'Transport request not found', { status: 404 });
      return d;
    });
  }

  private listWhere(q: DeskExportDto, yearId: string, params: unknown[]): string {
    params.push(yearId);
    const where = [`q.academic_year_id = $1`];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${String(params.length)}`));
    };
    if (q.tab !== 'all') add(`q.status = ?::workflow_status`, q.tab);
    if (q.source) add(`q.source = ?`, q.source);
    if (q.kind) add(`q.kind = ?::transport_request_kind`, q.kind);
    if (q.routeId) add(`? IN (q.pick_route_id, q.drop_route_id)`, q.routeId);
    if (q.from) add(`(q.requested_at AT TIME ZONE ${TZ})::date >= ?::date`, q.from);
    if (q.to) add(`(q.requested_at AT TIME ZONE ${TZ})::date <= ?::date`, q.to);
    if (q.q)
      add(
        `concat_ws(' ', q.number, s.display_name, s.admission_no, pr.code, pr.name, dr.code) ILIKE '%' || ? || '%'`,
        q.q,
      );
    return where.join(' AND ');
  }

  async list(ctx: RequestContext, q: DeskListDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const params: unknown[] = [];
      const w = this.listWhere(q, yearId, params);
      const total = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n ${REQUEST_FROM} WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        `${REQUEST} WHERE ${w} ORDER BY q.requested_at DESC, q.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const counts = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'approved')::int AS approved,
                count(*) FILTER (WHERE status = 'rejected')::int AS rejected FROM transport_requests WHERE academic_year_id = $1`,
        [yearId],
      );
      return {
        data: r.rows.map(toRequest),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: {
          pending: n(counts.rows[0]?.pending),
          approved: n(counts.rows[0]?.approved),
          rejected: n(counts.rows[0]?.rejected),
        },
      };
    });
  }

  private async sheet(
    title: string,
    columns: string[],
    rows: Array<Array<string | number>>,
    name: string,
  ) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(title.slice(0, 30));
    ws.addRow([`${title} · ${String(rows.length)} row(s)`]).font = { bold: true };
    ws.addRow(columns).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      col.width = i === 2 ? 26 : 16;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  async listExcel(ctx: RequestContext, q: DeskExportDto) {
    const yearId = this.year(ctx);
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.listWhere(q, yearId, params);
      const r = await c.query<Row>(
        `${REQUEST} WHERE ${w} ORDER BY q.requested_at DESC, q.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toRequest);
    });
    return this.sheet(
      'Transport requests',
      [
        'Request no.',
        'Type',
        'Student',
        'Admission no.',
        'Class',
        'Service',
        'Pick route',
        'Pick stoppage',
        'Drop route',
        'Drop stoppage',
        'Slab',
        'Monthly charge',
        'From month',
        'To month',
        'Made by',
        'Asked by',
        'Asked on',
        'Status',
        'Approvals',
        'Waiting on',
        'Decided on',
        'Note',
        'Fees',
      ],
      rows.map((x) => [
        x.number,
        x.kindLabel,
        x.student,
        x.admissionNo ?? '',
        x.section ?? '',
        x.serviceLabel ?? '',
        x.pickRoute ?? '',
        x.pickStop ?? '',
        x.dropRoute ?? '',
        x.dropStop ?? '',
        x.slab ?? '',
        x.monthlyAmount ?? '',
        monthLabel(x.fromMonth),
        x.kind === 'leave' ? '' : monthLabel(x.toMonth),
        x.source === 'office' ? 'Transport office' : 'Family',
        x.requestedBy ?? '',
        ist(x.requestedAt),
        x.status,
        `${String(x.approvedLevels)} of ${String(x.levels)}`,
        x.waitingOn ?? '',
        ist(x.decidedAt),
        x.decisionNote ?? x.note ?? '',
        x.feeNote ?? '',
      ]),
      'transport-requests',
    );
  }

  // ---- the history ----------------------------------------------------------------------------------
  private historyWhere(q: HistoryExportDto, yearId: string, params: unknown[]): string {
    params.push(yearId);
    const where = [`t.academic_year_id = $1`];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace(/\?/g, `$${String(params.length)}`));
    };
    if (q.month)
      add(
        `t.status <> 'cancelled' AND (? || '-01')::date BETWEEN t.from_month AND t.to_month`,
        q.month,
      );
    else if (q.when === 'now')
      where.push(`t.status <> 'cancelled' AND ${MONTH} BETWEEN t.from_month AND t.to_month`);
    else if (q.when === 'upcoming')
      where.push(`t.status <> 'cancelled' AND t.from_month > ${MONTH}`);
    else if (q.when === 'past') where.push(`(t.status = 'cancelled' OR t.to_month < ${MONTH})`);
    if (q.studentId) add(`t.student_id = ?`, q.studentId);
    if (q.routeId) add(`? IN (t.pick_route_id, t.drop_route_id)`, q.routeId);
    if (q.service) add(`t.service = ?`, q.service);
    if (q.q) add(`concat_ws(' ', s.display_name, s.admission_no) ILIKE '%' || ? || '%'`, q.q);
    return where.join(' AND ');
  }

  /** Every stretch of months a pupil rode: who, how, where, what it cost, who approved, how it ended. */
  async history(ctx: RequestContext, q: HistoryDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.transport_tick()`);
      const params: unknown[] = [];
      const w = this.historyWhere(q, yearId, params);
      const total = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n ${PERIOD_FROM} WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        `${PERIOD} WHERE ${w} ORDER BY s.display_name, t.from_month DESC, t.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const routes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, code || ' ' || name AS name FROM transport_routes WHERE deleted_at IS NULL ORDER BY code`,
      );
      return {
        data: r.rows.map(toPeriod),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        routes: routes.rows,
        months: await this.months(c, yearId),
      };
    });
  }

  async historyExcel(ctx: RequestContext, q: HistoryExportDto) {
    const yearId = this.year(ctx);
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.historyWhere(q, yearId, params);
      const r = await c.query<Row>(
        `${PERIOD} WHERE ${w} ORDER BY s.display_name, t.from_month DESC, t.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toPeriod);
    });
    const PHASE: Record<string, string> = {
      running: 'Riding now',
      upcoming: 'To start',
      over: 'Over',
      cancelled: 'Cancelled',
    };
    return this.sheet(
      'Student transport history',
      [
        'Student',
        'Admission no.',
        'Class',
        'Service',
        'Pick route',
        'Pick stoppage',
        'Pick time',
        'Drop route',
        'Drop stoppage',
        'Drop time',
        'Vehicle',
        'Slab',
        'Monthly charge',
        'From month',
        'To month',
        'Status',
        'Request no.',
        'Made by',
        'Approved by',
        'Approved on',
        'Ended by',
      ],
      rows.map((x) => [
        x.student,
        x.admissionNo ?? '',
        x.section ?? '',
        x.serviceLabel,
        x.pickRoute ?? '',
        x.pickStop ?? '',
        x.pickTime ?? '',
        x.dropRoute ?? '',
        x.dropStop ?? '',
        x.dropTime ?? '',
        x.vehicle ?? '',
        x.slab ?? '',
        x.monthlyAmount,
        monthLabel(x.fromMonth),
        monthLabel(x.toMonth),
        PHASE[x.phase] ?? x.phase,
        x.requestNo ?? '',
        x.source === 'office' ? 'Transport office' : x.source === 'parent' ? 'Family' : '',
        x.approvedBy ?? '',
        ist(x.approvedAt),
        x.endedBy ?? '',
      ]),
      'student-transport-history',
    );
  }

  /** The family: each child's periods (history), the requests, and what runs now. */
  async familyHistory(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.transport_tick()`);
      const children = [];
      for (const s of v.students) {
        const periods = await c.query<Row>(
          `${PERIOD} WHERE t.student_id = $1 AND t.academic_year_id = $2 ORDER BY t.from_month DESC, t.id DESC`,
          [s.id, yearId],
        );
        const requests = await c.query<Row>(
          `${REQUEST} WHERE q.student_id = $1 AND q.academic_year_id = $2 ORDER BY q.requested_at DESC LIMIT 20`,
          [s.id, yearId],
        );
        const p = periods.rows.map(toPeriod);
        children.push({
          id: s.id,
          name: s.name,
          section: s.section,
          current: p.find((x) => x.phase === 'running') ?? null,
          incharge: await this.inchargeOf(c, s.id, yearId),
          periods: p,
          requests: requests.rows.map(toRequest),
        });
      }
      return { children, canApply: (await this.settings(c)).parentCanApply };
    });
  }

  /** Who the family calls about the child's bus: the route's in-charge, else the school's. */
  private async inchargeOf(c: PoolClient, studentId: string, yearId: string) {
    const r = await c.query<{ name: string; mobile: string | null }>(
      `SELECT e.display_name AS name, e.mobile FROM transport_incharges i JOIN employees e ON e.id = i.employee_id AND e.deleted_at IS NULL
        WHERE i.route_id IS NULL OR i.route_id IN (SELECT a.route_id FROM student_route_assignments a WHERE a.student_id = $1 AND a.academic_year_id = $2)
        ORDER BY (i.route_id IS NOT NULL) DESC, e.display_name LIMIT 2`,
      [studentId, yearId],
    );
    return r.rows.map((x) => ({ name: x.name, mobile: x.mobile }));
  }

  // ---- dashboard ------------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      await c.query(`SELECT app.transport_tick()`);
      const k = await c.query<Row>(
        `SELECT (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1)::int AS riders,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1 AND a.service = 'pick')::int AS pick_only,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1 AND a.service = 'drop')::int AS drop_only,
                (SELECT count(*) FROM transport_requests q WHERE q.academic_year_id = $1 AND q.status = 'pending')::int AS pending,
                (SELECT count(*) FROM transport_routes r WHERE r.deleted_at IS NULL AND r.status = 'active')::int AS routes,
                (SELECT count(*) FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active')::int AS vehicles,
                (SELECT COALESCE(sum(v.capacity), 0) FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
                    AND EXISTS (SELECT 1 FROM transport_routes r WHERE r.vehicle_id = v.id AND r.deleted_at IS NULL))::int AS seats,
                (SELECT COALESCE(sum(t.monthly_amount), 0) FROM student_transport t WHERE t.academic_year_id = $1 AND t.status <> 'cancelled'
                    AND ${MONTH} BETWEEN t.from_month AND t.to_month)::float AS billed,
                (SELECT count(*) FROM student_transport t WHERE t.academic_year_id = $1 AND t.status <> 'cancelled' AND t.from_month > ${MONTH})::int AS upcoming,
                (SELECT count(*) FROM student_transport t WHERE t.academic_year_id = $1 AND t.status <> 'cancelled'
                    AND t.to_month = ${MONTH} AND t.to_month < (SELECT date_trunc('month', end_date)::date FROM academic_years WHERE id = $1))::int AS ending`,
        [yearId],
      );
      const routes = await c.query<Row>(
        `SELECT r.id::text, r.code, r.name, v.reg_no, v.capacity, (SELECT d.name FROM transport_drivers d WHERE d.id = r.driver_id) AS driver,
                (SELECT count(*) FROM transport_stops st WHERE st.route_id = r.id)::int AS stops,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1 AND a.route_id = r.id AND COALESCE(a.service, 'both') <> 'drop')::int AS pick,
                (SELECT count(*) FROM student_route_assignments a WHERE a.academic_year_id = $1 AND COALESCE(a.drop_route_id, a.route_id) = r.id
                    AND COALESCE(a.service, 'both') <> 'pick')::int AS drop
           FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id WHERE r.deleted_at IS NULL AND r.status = 'active' ORDER BY r.code`,
        [yearId],
      );
      const months = await c.query<Row>(
        `SELECT to_char(m, 'YYYY-MM') AS k,
                (SELECT count(*) FROM transport_requests q WHERE q.status = 'approved' AND q.kind = 'join' AND to_char(q.decided_at AT TIME ZONE ${TZ}, 'YYYY-MM') = to_char(m, 'YYYY-MM'))::int AS joins,
                (SELECT count(*) FROM transport_requests q WHERE q.status = 'approved' AND q.kind = 'change' AND to_char(q.decided_at AT TIME ZONE ${TZ}, 'YYYY-MM') = to_char(m, 'YYYY-MM'))::int AS changes,
                (SELECT count(*) FROM transport_requests q WHERE q.status = 'approved' AND q.kind = 'leave' AND to_char(q.decided_at AT TIME ZONE ${TZ}, 'YYYY-MM') = to_char(m, 'YYYY-MM'))::int AS leaves,
                (SELECT count(DISTINCT t.student_id) FROM student_transport t WHERE t.status <> 'cancelled' AND m::date BETWEEN t.from_month AND t.to_month)::int AS riders,
                (SELECT COALESCE(sum(t.monthly_amount), 0) FROM student_transport t WHERE t.status <> 'cancelled' AND m::date BETWEEN t.from_month AND t.to_month)::float AS billed
           FROM generate_series(${MONTH} - interval '5 months', ${MONTH}, interval '1 month') m ORDER BY 1`,
      );
      const days = await c.query<Row>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS k, count(q.id) FILTER (WHERE q.source = 'parent')::int AS parent, count(q.id) FILTER (WHERE q.source = 'office')::int AS office
           FROM generate_series(${TODAY} - 29, ${TODAY}, interval '1 day') d
           LEFT JOIN transport_requests q ON (q.requested_at AT TIME ZONE ${TZ})::date = d::date AND q.academic_year_id = $1 GROUP BY 1 ORDER BY 1`,
        [yearId],
      );
      const pending = await c.query<Row>(
        `SELECT a.label, q.source, count(*)::int AS waiting, round((extract(epoch FROM (now() - min(q.requested_at))) / 3600)::numeric, 1)::float AS oldest_hours
           FROM transport_request_approvals a JOIN transport_requests q ON q.id = a.request_id
          WHERE a.status = 'pending' AND q.status = 'pending' AND q.academic_year_id = $1 GROUP BY a.label, q.source, a.seq ORDER BY a.seq`,
        [yearId],
      );
      const stops = await c.query<Row>(
        `SELECT COALESCE(a.stop_name, 'No stoppage') AS name, r.code AS route, count(*)::int AS n FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id
          WHERE a.academic_year_id = $1 GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 10`,
        [yearId],
      );
      const slabs = await c.query<Row>(
        `SELECT COALESCE(sl.name, 'No slab') AS name, count(*)::int AS n, COALESCE(sum(t.monthly_amount), 0)::float AS amount
           FROM student_transport t LEFT JOIN transport_slabs sl ON sl.id = t.slab_id
          WHERE t.academic_year_id = $1 AND t.status <> 'cancelled' AND ${MONTH} BETWEEN t.from_month AND t.to_month GROUP BY 1 ORDER BY 2 DESC`,
        [yearId],
      );
      const classes = await c.query<Row>(
        `SELECT COALESCE(${SECTION('a.student_id', 'a.academic_year_id')}, 'No class') AS name, count(*)::int AS n
           FROM student_route_assignments a WHERE a.academic_year_id = $1 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
        [yearId],
      );
      const fleet = await c.query<Row>(
        `SELECT * FROM (
           SELECT v.reg_no AS name, 'Insurance' AS what, v.insurance_expiry AS on_date FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
           UNION ALL SELECT v.reg_no, 'Fitness', v.fitness_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
           UNION ALL SELECT v.reg_no, 'Permit', v.permit_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
           UNION ALL SELECT d.name, 'Driving licence', d.licence_expiry FROM transport_drivers d WHERE d.deleted_at IS NULL AND d.status = 'active') x
          WHERE x.on_date IS NOT NULL AND x.on_date <= ${TODAY} + 30 ORDER BY x.on_date LIMIT 20`,
      );
      const x = k.rows[0] ?? {};
      return {
        kpis: {
          riders: n(x.riders),
          pickOnly: n(x.pick_only),
          dropOnly: n(x.drop_only),
          both: n(x.riders) - n(x.pick_only) - n(x.drop_only),
          pending: n(x.pending),
          routes: n(x.routes),
          vehicles: n(x.vehicles),
          seats: n(x.seats),
          billed: Number(x.billed ?? 0),
          upcoming: n(x.upcoming),
          ending: n(x.ending),
        },
        routes: routes.rows.map((r) => ({
          id: String(r.id),
          code: String(r.code),
          name: String(r.name),
          vehicle: text(r.reg_no),
          driver: text(r.driver),
          seats: r.capacity === null || r.capacity === undefined ? null : Number(r.capacity),
          stops: n(r.stops),
          pick: n(r.pick),
          drop: n(r.drop),
        })),
        months: months.rows.map((m) => ({
          key: String(m.k),
          joins: n(m.joins),
          changes: n(m.changes),
          leaves: n(m.leaves),
          riders: n(m.riders),
          billed: Number(m.billed ?? 0),
        })),
        days: days.rows.map((d) => ({
          key: String(d.k),
          parent: n(d.parent),
          office: n(d.office),
        })),
        pending: pending.rows.map((p) => ({
          label: String(p.label),
          source: String(p.source),
          waiting: n(p.waiting),
          oldestHours: Number(p.oldest_hours ?? 0),
        })),
        stops: stops.rows.map((s) => ({
          name: String(s.name),
          route: String(s.route),
          count: n(s.n),
        })),
        slabs: slabs.rows.map((s) => ({
          name: String(s.name),
          count: n(s.n),
          amount: Number(s.amount ?? 0),
        })),
        classes: classes.rows.map((s) => ({ name: String(s.name), count: n(s.n) })),
        fleet: fleet.rows.map((f) => ({
          name: String(f.name),
          what: String(f.what),
          on: f.on_date instanceof Date ? f.on_date.toISOString().slice(0, 10) : String(f.on_date),
        })),
      };
    });
  }
}
