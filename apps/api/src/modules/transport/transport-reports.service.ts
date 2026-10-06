/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (CTEs, WHERE pieces with numbered placeholders, month columns built from validated YYYY-MM values); every value is bound */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import type { TransportReportDto } from './transport-desk.dto';

type Row = Record<string, unknown>;
type Cell = string | number | null;
const TZ = `'Asia/Kolkata'`;
const MAX = 10000;
const FEE_VIEW = 'transport.fee.view';
const ROUTE_VIEW = 'transport.route.view';

export interface ReportColumn {
  key: string;
  label: string;
  /** Share of the width in the PDF and the Excel sheet. */
  width: number;
  right?: boolean;
  /** Summed in the last row. */
  total?: boolean;
}
export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  school: string;
  session: string;
  columns: ReportColumn[];
  rows: Array<Record<string, Cell>>;
  totals: Record<string, number> | null;
  truncated: boolean;
}
type Filter = 'route' | 'months' | 'dates' | 'measure' | 'service' | 'q';
export const TRANSPORT_REPORTS: Array<{
  id: string;
  title: string;
  group: 'students' | 'fees';
  about: string;
  filters: Filter[];
}> = [
  {
    id: 'mapping',
    title: 'Student transport mapping',
    group: 'students',
    about:
      'Every pupil on the bus with family contacts, route, stoppage, slab, amount, bus and dates.',
    filters: ['route', 'service', 'q'],
  },
  {
    id: 'route-summary',
    title: 'Route-wise student count',
    group: 'students',
    about: 'One row per route: the bus, its seats, pupils riding and seats free.',
    filters: [],
  },
  {
    id: 'stoppage-count',
    title: 'Route and stoppage count',
    group: 'students',
    about: 'Pupils at every stoppage of a route, with the timings.',
    filters: ['route'],
  },
  {
    id: 'student-list',
    title: 'Route student list',
    group: 'students',
    about:
      'The list the bus crew carries: pupils of a route in stoppage order with the parent’s mobile.',
    filters: ['route', 'service', 'q'],
  },
  {
    id: 'class-wise',
    title: 'Class-wise transport users',
    group: 'students',
    about: 'Per class and section: how many use the bus and how many do not.',
    filters: [],
  },
  {
    id: 'fee-months',
    title: 'Route-wise transport fee, month by month',
    group: 'fees',
    about: 'Projected, collected and balance per route for the months of the session.',
    filters: ['route', 'months', 'measure'],
  },
  {
    id: 'fee-students',
    title: 'Transport fee by student',
    group: 'fees',
    about:
      'Each pupil’s transport fee for the months chosen: projected, collected, balance and the months due.',
    filters: ['route', 'months', 'q'],
  },
  {
    id: 'fee-collection',
    title: 'Transport fee collection by date',
    group: 'fees',
    about: 'Transport fee received between two dates, receipt by receipt, with the route.',
    filters: ['route', 'dates', 'q'],
  },
];

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0);
const SERVICE: Record<string, string> = {
  both: 'Pick-up and drop',
  pick: 'Pick-up only',
  drop: 'Drop only',
};
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const dayLabel = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
const SECTION = `(SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
     WHERE en.student_id = s.id AND en.academic_year_id = $1 AND en.status = 'active' LIMIT 1)`;
const GUARDIAN = (relation: string, col: 'display_name' | 'mobile') =>
  `(SELECT g.${col} FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
     WHERE sg.student_id = s.id AND sg.relation = '${relation}' ORDER BY sg.is_primary DESC, sg.id LIMIT 1)`;
const PRIMARY_MOBILE = `(SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
     WHERE sg.student_id = s.id AND g.mobile IS NOT NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1)`;
const ADDRESS = `NULLIF(concat_ws(', ', NULLIF(s.address->>'line1', ''), NULLIF(s.address->>'line2', ''), NULLIF(s.address->>'area', ''),
     NULLIF(s.address->>'city', ''), NULLIF(s.address->>'state', ''), NULLIF(COALESCE(s.address->>'pincode', s.address->>'pin'), '')), '')`;
/** The pupils on the bus now: one row per pupil of the session. */
const RIDERS = `FROM student_route_assignments a
  JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
  JOIN transport_routes r ON r.id = a.route_id
  LEFT JOIN transport_stops st ON st.id = a.stop_id
 WHERE a.academic_year_id = $1`;
/**
 * Every transport fee line of the session with the route it belongs to: the route the pupil rode in that
 * month (the history), else the route the pupil is on now.
 */
const FEE = `fee AS (
  SELECT d.id, d.student_id, to_char(make_date(fp.year, fp.month, 1), 'YYYY-MM') AS m, fp.sequence, fp.due_on, d.net, d.paid, d.status::text,
         COALESCE(p.pick_route_id, p.drop_route_id, a.route_id) AS route_id
    FROM fee_demands d
    JOIN fee_heads fh ON fh.id = d.head_id AND fh.kind = 'transport'
    JOIN fee_periods fp ON fp.id = d.period_id
    LEFT JOIN LATERAL (SELECT x.pick_route_id, x.drop_route_id FROM student_transport x
                        WHERE x.student_id = d.student_id AND x.academic_year_id = d.academic_year_id AND x.status IN ('active', 'ended')
                          AND make_date(fp.year, fp.month, 1) BETWEEN x.from_month AND x.to_month ORDER BY x.id DESC LIMIT 1) p ON true
    LEFT JOIN student_route_assignments a ON a.student_id = d.student_id AND a.academic_year_id = d.academic_year_id
   WHERE d.academic_year_id = $1)`;

/**
 * The transport office's reports: who rides which route (the mapping sheet, counts by route, stoppage and
 * class) and the transport fee by route (projected from the fee lines, collected from the receipts). A
 * person named in-charge of some routes sees the fee of those routes only; the fee office and a
 * school-wide in-charge see every route. Each report shows on screen and comes as Excel or PDF.
 */
@Injectable()
export class TransportReportsService {
  constructor(private readonly db: DbService) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private may(ctx: RequestContext, group: 'students' | 'fees'): boolean {
    const held = ctx.permissions ?? new Set<string>();
    return group === 'students'
      ? held.has(ROUTE_VIEW)
      : held.has(FEE_VIEW) || held.has('fees.ledger.view');
  }

  private assertMay(ctx: RequestContext, group: 'students' | 'fees') {
    if (!this.may(ctx, group))
      throw new DomainError('forbidden', 'You do not have access to this report', {
        status: 403,
        extra: { permission: group === 'students' ? ROUTE_VIEW : FEE_VIEW },
      });
  }

  /** The routes whose fee this person may see: null = every route. */
  private async feeRoutes(ctx: RequestContext, c: PoolClient): Promise<string[] | null> {
    const held = ctx.permissions ?? new Set<string>();
    if (held.has('fees.ledger.view') || held.has('transport.setup.manage')) return null;
    const r = await c.query<{ route_id: string | null }>(
      `SELECT i.route_id::text FROM transport_incharges i JOIN employees e ON e.id = i.employee_id WHERE e.user_id = app.current_user_id()`,
    );
    // not named anywhere: the holder of the role looks after the whole fleet
    if (!r.rows.length || r.rows.some((x) => x.route_id === null)) return null;
    return r.rows.map((x) => x.route_id!);
  }

  /** What the reports page needs: the reports this person may open and the routes to filter by. */
  async catalogue(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = this.may(ctx, 'fees') ? await this.feeRoutes(ctx, c) : null;
      const routes = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM transport_routes WHERE deleted_at IS NULL ORDER BY code`,
      );
      const months = await this.months(c, yearId);
      return {
        reports: TRANSPORT_REPORTS.filter((r) => this.may(ctx, r.group)),
        routes: routes.rows,
        months,
        feeRoutes: scope,
      };
    });
  }

  private async months(c: PoolClient, yearId: string): Promise<string[]> {
    const r = await c.query<{ m: string }>(
      `SELECT DISTINCT to_char(make_date(year, month, 1), 'YYYY-MM') AS m FROM fee_periods WHERE academic_year_id = $1 ORDER BY 1`,
      [yearId],
    );
    if (r.rows.length) return r.rows.map((x) => x.m);
    const y = await c.query<{ m: string }>(
      `SELECT to_char(g, 'YYYY-MM') AS m FROM academic_years ay, generate_series(date_trunc('month', ay.start_date), ay.end_date, interval '1 month') g WHERE ay.id = $1 ORDER BY 1`,
      [yearId],
    );
    return y.rows.map((x) => x.m);
  }

  async run(ctx: RequestContext, id: string, q: TransportReportDto): Promise<ReportResult> {
    const def = TRANSPORT_REPORTS.find((r) => r.id === id);
    if (!def) throw new DomainError('not-found', 'No such report', { status: 404 });
    this.assertMay(ctx, def.group);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await c.query<{ school: string; session: string }>(
        `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS school, (SELECT name FROM academic_years WHERE id = $1) AS session`,
        [yearId],
      );
      const routeName = q.routeId
        ? (
            await c.query<{ n: string }>(
              `SELECT code || ' · ' || name AS n FROM transport_routes WHERE id = $1`,
              [q.routeId],
            )
          ).rows[0]?.n
        : null;
      const said: string[] = [];
      if (routeName) said.push(`Route ${routeName}`);
      let out: Pick<ReportResult, 'columns' | 'rows'>;
      if (def.group === 'students') {
        if (q.service && def.filters.includes('service'))
          said.push(SERVICE[q.service] ?? q.service);
        out = await this.students(c, id, yearId, q);
      } else {
        const scope = await this.feeRoutes(ctx, c);
        if (scope && q.routeId && !scope.includes(q.routeId))
          throw new DomainError('forbidden', 'You are not the in-charge of this route', {
            status: 403,
          });
        if (scope && !q.routeId) said.push('Your routes');
        const all = await this.months(c, yearId);
        const from = q.fromMonth && all.includes(q.fromMonth) ? q.fromMonth : all[0];
        const to = q.toMonth && all.includes(q.toMonth) ? q.toMonth : all[all.length - 1];
        const months = all.filter((m) => (!from || m >= from) && (!to || m <= to));
        if (id === 'fee-collection') {
          const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
          const d1 = q.from ?? `${today.slice(0, 8)}01`;
          const d2 = q.to ?? today;
          said.push(`Received ${dayLabel(d1)} to ${dayLabel(d2)}`);
          out = await this.collection(c, yearId, q, scope, d1, d2);
        } else {
          if (months.length)
            said.push(`${monthLabel(months[0]!)} to ${monthLabel(months[months.length - 1]!)}`);
          out =
            id === 'fee-months'
              ? await this.feeMonths(c, yearId, q, scope, months)
              : await this.feeStudents(c, yearId, q, scope, months);
          if (id === 'fee-months' && q.measure !== 'projected')
            said.push(
              `Months show the ${q.measure === 'balance' ? 'balance' : 'amount collected'}`,
            );
        }
      }
      if (q.q && def.filters.includes('q')) said.push(`Search "${q.q}"`);
      const totals: Record<string, number> = {};
      for (const col of out.columns.filter((x) => x.total))
        totals[col.key] = out.rows.reduce((n, r) => n + num(r[col.key]), 0);
      const session = head.rows[0]?.session ?? '';
      const sessionLabel = /^session/i.test(session) ? session : `Session ${session}`;
      const generated = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      return {
        id,
        title: def.title,
        subtitle: [`${sessionLabel}`, ...said, `Generated on ${generated}`]
          .filter(Boolean)
          .join(' · '),
        school: head.rows[0]?.school ?? '',
        session: head.rows[0]?.session ?? '',
        columns: out.columns,
        rows: out.rows.slice(0, MAX),
        totals: Object.keys(totals).length ? totals : null,
        truncated: out.rows.length > MAX,
      };
    });
  }

  // ---- who rides ------------------------------------------------------------------------------------
  private async students(c: PoolClient, id: string, yearId: string, q: TransportReportDto) {
    const params: unknown[] = [yearId];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${String(params.length)}`));
    };
    const filtered = (allow: Filter[]) => {
      if (q.routeId && allow.includes('route')) add(`a.route_id = ?::bigint`, q.routeId);
      if (q.service && allow.includes('service')) add(`COALESCE(a.service, 'both') = ?`, q.service);
      if (q.q && allow.includes('q'))
        add(`(s.display_name ILIKE '%' || ? || '%' OR s.admission_no ILIKE '%' || ? || '%')`, q.q);
      return where.length ? ` AND ${where.join(' AND ')}` : '';
    };
    if (id === 'mapping') {
      const w = filtered(['route', 'service', 'q']);
      const r = await c.query<Row>(
        `SELECT s.admission_no, s.display_name AS student, s.category, ${SECTION} AS section, s.blood_group,
                ${GUARDIAN('father', 'display_name')} AS father, ${GUARDIAN('father', 'mobile')} AS father_mobile,
                ${GUARDIAN('mother', 'display_name')} AS mother, ${GUARDIAN('mother', 'mobile')} AS mother_mobile,
                ${ADDRESS} AS address, r.code AS route_code, r.name AS route, COALESCE(st.name, a.stop_name) AS stop,
                COALESCE(psl.name, ssl.name) AS slab, COALESCE(p.monthly_amount, ssl.monthly_amount)::float AS amount,
                v.reg_no AS vehicle, COALESCE(a.service, 'both') AS service,
                COALESCE(a.valid_from, p.from_month, ay.start_date)::text AS valid_from, COALESCE(a.valid_to, ay.end_date)::text AS valid_to,
                to_char(a.created_at AT TIME ZONE ${TZ}, 'DD-MM-YYYY HH24:MI') AS created_at,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = a.created_by LIMIT 1), u.display_name) AS created_by
           ${RIDERS.replace(
             'WHERE',
             `JOIN academic_years ay ON ay.id = a.academic_year_id
           LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id
           LEFT JOIN users u ON u.id = a.created_by
           LEFT JOIN LATERAL (SELECT x.slab_id, x.monthly_amount, x.from_month FROM student_transport x
                               WHERE x.student_id = a.student_id AND x.academic_year_id = a.academic_year_id AND x.status = 'active'
                               ORDER BY x.from_month DESC LIMIT 1) p ON true
           LEFT JOIN transport_slabs psl ON psl.id = p.slab_id
           LEFT JOIN transport_slabs ssl ON ssl.id = st.slab_id
          WHERE`,
           )}${w}
          ORDER BY r.code, s.admission_no LIMIT ${String(MAX + 1)}`,
        params,
      );
      return {
        columns: [
          { key: 'sl', label: 'Sl. no.', width: 3, right: true },
          { key: 'admission_no', label: 'Adm. no.', width: 5 },
          { key: 'student', label: 'Student name', width: 9 },
          { key: 'category', label: 'Student category', width: 6 },
          { key: 'section', label: 'Class-sec', width: 4 },
          { key: 'blood_group', label: 'Blood group', width: 4 },
          { key: 'father', label: 'Father', width: 7 },
          { key: 'father_mobile', label: 'Father mobile no.', width: 7.5 },
          { key: 'mother', label: 'Mother name', width: 7 },
          { key: 'mother_mobile', label: 'Mother mobile', width: 7.5 },
          { key: 'address', label: 'Address', width: 10 },
          { key: 'route', label: 'Route', width: 6 },
          { key: 'stop', label: 'Stop', width: 8 },
          { key: 'slab', label: 'Slab name', width: 5 },
          { key: 'amount', label: 'Route amount', width: 5, right: true },
          { key: 'vehicle', label: 'Vehicle no.', width: 7.5 },
          { key: 'service', label: 'Travel mode', width: 6 },
          { key: 'valid_from', label: 'Valid from', width: 6.5 },
          { key: 'valid_to', label: 'Valid to', width: 6.5 },
          { key: 'status', label: 'Status', width: 4.5 },
          { key: 'created_at', label: 'Create date', width: 7 },
          { key: 'created_by', label: 'Created by', width: 6 },
        ] satisfies ReportColumn[],
        rows: r.rows.map((x, i) => ({
          sl: i + 1,
          admission_no: text(x.admission_no),
          student: text(x.student),
          category: text(x.category),
          section: text(x.section),
          blood_group: text(x.blood_group),
          father: text(x.father),
          father_mobile: text(x.father_mobile),
          mother: text(x.mother),
          mother_mobile: text(x.mother_mobile),
          address: text(x.address),
          route: `${String(x.route_code)} · ${String(x.route)}`,
          stop: text(x.stop),
          slab: text(x.slab),
          amount: x.amount === null ? null : num(x.amount),
          vehicle: text(x.vehicle),
          service: SERVICE[String(x.service)] ?? String(x.service),
          valid_from: dayLabel(text(x.valid_from)),
          valid_to: dayLabel(text(x.valid_to)),
          status: 'Active',
          created_at: text(x.created_at),
          created_by: text(x.created_by),
        })),
      };
    }
    if (id === 'route-summary') {
      const r = await c.query<Row>(
        `SELECT r.code, r.name, v.reg_no, v.capacity, r.driver_name, r.driver_mobile,
                count(a.id) FILTER (WHERE s.id IS NOT NULL)::int AS total,
                count(a.id) FILTER (WHERE s.id IS NOT NULL AND COALESCE(a.service, 'both') = 'both')::int AS both_n,
                count(a.id) FILTER (WHERE s.id IS NOT NULL AND a.service = 'pick')::int AS pick_n,
                count(a.id) FILTER (WHERE s.id IS NOT NULL AND a.service = 'drop')::int AS drop_n,
                count(a.id) FILTER (WHERE s.gender::text = 'male')::int AS boys,
                count(a.id) FILTER (WHERE s.gender::text = 'female')::int AS girls,
                (SELECT count(*) FROM transport_stops x WHERE x.route_id = r.id)::int AS stops
           FROM transport_routes r
           LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id
           LEFT JOIN student_route_assignments a ON a.route_id = r.id AND a.academic_year_id = $1
           LEFT JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
          WHERE r.deleted_at IS NULL
          GROUP BY r.id, v.reg_no, v.capacity ORDER BY r.code`,
        params,
      );
      return {
        columns: [
          { key: 'route', label: 'Route', width: 12 },
          { key: 'vehicle', label: 'Vehicle no.', width: 8 },
          { key: 'driver', label: 'Driver', width: 10 },
          { key: 'stops', label: 'Stoppages', width: 5, right: true, total: true },
          { key: 'capacity', label: 'Seats', width: 5, right: true, total: true },
          { key: 'both', label: 'Pick-up and drop', width: 6, right: true, total: true },
          { key: 'pick', label: 'Pick-up only', width: 5, right: true, total: true },
          { key: 'drop', label: 'Drop only', width: 5, right: true, total: true },
          { key: 'boys', label: 'Boys', width: 4, right: true, total: true },
          { key: 'girls', label: 'Girls', width: 4, right: true, total: true },
          { key: 'total', label: 'Students', width: 5, right: true, total: true },
          { key: 'free', label: 'Seats free', width: 5, right: true },
        ] satisfies ReportColumn[],
        rows: r.rows.map((x) => ({
          route: `${String(x.code)} · ${String(x.name)}`,
          vehicle: text(x.reg_no),
          driver: [text(x.driver_name), text(x.driver_mobile)].filter(Boolean).join(' · ') || null,
          stops: num(x.stops),
          capacity: x.capacity === null ? null : num(x.capacity),
          both: num(x.both_n),
          pick: num(x.pick_n),
          drop: num(x.drop_n),
          boys: num(x.boys),
          girls: num(x.girls),
          total: num(x.total),
          free: x.capacity === null ? null : num(x.capacity) - num(x.total),
        })),
      };
    }
    if (id === 'stoppage-count') {
      if (q.routeId) params.push(q.routeId);
      const r = await c.query<Row>(
        `SELECT r.code, r.name, st.sequence, st.name AS stop, to_char(st.pickup_time, 'HH24:MI') AS pickup, to_char(st.drop_time, 'HH24:MI') AS drop_time,
                sl.name AS slab,
                (SELECT count(*) FROM student_route_assignments a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
                  WHERE a.academic_year_id = $1 AND a.stop_id = st.id AND COALESCE(a.service, 'both') <> 'drop')::int AS pick_n,
                (SELECT count(*) FROM student_route_assignments a JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
                  WHERE a.academic_year_id = $1 AND COALESCE(a.service, 'both') <> 'pick'
                    AND COALESCE(a.drop_stop_id, a.stop_id) = st.id)::int AS drop_n
           FROM transport_stops st JOIN transport_routes r ON r.id = st.route_id AND r.deleted_at IS NULL
           LEFT JOIN transport_slabs sl ON sl.id = st.slab_id
          ${q.routeId ? 'WHERE r.id = $2::bigint' : ''}
          ORDER BY r.code, st.sequence`,
        params,
      );
      return {
        columns: [
          { key: 'route', label: 'Route', width: 12 },
          { key: 'sequence', label: 'Stop no.', width: 4, right: true },
          { key: 'stop', label: 'Stoppage', width: 14 },
          { key: 'slab', label: 'Slab', width: 8 },
          { key: 'pickup', label: 'Pick-up time', width: 5 },
          { key: 'drop_time', label: 'Drop time', width: 5 },
          { key: 'pick', label: 'Students picked', width: 6, right: true, total: true },
          { key: 'drop', label: 'Students dropped', width: 6, right: true, total: true },
        ] satisfies ReportColumn[],
        rows: r.rows.map((x) => ({
          route: `${String(x.code)} · ${String(x.name)}`,
          sequence: num(x.sequence),
          stop: text(x.stop),
          slab: text(x.slab),
          pickup: text(x.pickup),
          drop_time: text(x.drop_time),
          pick: num(x.pick_n),
          drop: num(x.drop_n),
        })),
      };
    }
    if (id === 'student-list') {
      const w = filtered(['route', 'service', 'q']);
      const r = await c.query<Row>(
        `SELECT r.code, r.name, s.admission_no, s.display_name AS student, ${SECTION} AS section, s.gender::text,
                COALESCE(st.name, a.stop_name) AS stop, to_char(COALESCE(st.pickup_time, a.pickup_time), 'HH24:MI') AS pickup,
                to_char(COALESCE(st.drop_time, a.drop_time), 'HH24:MI') AS drop_time, COALESCE(a.service, 'both') AS service,
                ${GUARDIAN('father', 'display_name')} AS father, ${PRIMARY_MOBILE} AS mobile
           ${RIDERS}${w}
          ORDER BY r.code, st.sequence NULLS LAST, s.display_name LIMIT ${String(MAX + 1)}`,
        params,
      );
      return {
        columns: [
          { key: 'sl', label: 'Sl. no.', width: 3, right: true },
          { key: 'route', label: 'Route', width: 10 },
          { key: 'stop', label: 'Stoppage', width: 10 },
          { key: 'pickup', label: 'Pick-up', width: 4 },
          { key: 'drop_time', label: 'Drop', width: 4 },
          { key: 'admission_no', label: 'Adm. no.', width: 5 },
          { key: 'student', label: 'Student', width: 11 },
          { key: 'section', label: 'Class-sec', width: 5 },
          { key: 'gender', label: 'Gender', width: 4 },
          { key: 'service', label: 'Travel mode', width: 7 },
          { key: 'father', label: 'Father', width: 9 },
          { key: 'mobile', label: 'Parent mobile', width: 6 },
        ] satisfies ReportColumn[],
        rows: r.rows.map((x, i) => ({
          sl: i + 1,
          route: `${String(x.code)} · ${String(x.name)}`,
          stop: text(x.stop),
          pickup: text(x.pickup),
          drop_time: text(x.drop_time),
          admission_no: text(x.admission_no),
          student: text(x.student),
          section: text(x.section),
          gender: x.gender ? String(x.gender).replace(/^./, (ch) => ch.toUpperCase()) : null,
          service: SERVICE[String(x.service)] ?? String(x.service),
          father: text(x.father),
          mobile: text(x.mobile),
        })),
      };
    }
    // class-wise
    const r = await c.query<Row>(
      `SELECT k.code || '-' || cs.name AS section, count(*)::int AS strength,
              count(a.id)::int AS riders,
              count(a.id) FILTER (WHERE COALESCE(a.service, 'both') = 'both')::int AS both_n,
              count(a.id) FILTER (WHERE a.service = 'pick')::int AS pick_n,
              count(a.id) FILTER (WHERE a.service = 'drop')::int AS drop_n
         FROM enrolments en
         JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
         JOIN class_sections cs ON cs.id = en.class_section_id
         JOIN classes k ON k.id = cs.class_id
         LEFT JOIN student_route_assignments a ON a.student_id = en.student_id AND a.academic_year_id = en.academic_year_id
        WHERE en.academic_year_id = $1 AND en.status = 'active'
        GROUP BY k.display_order, k.code, cs.name ORDER BY k.display_order, k.code, cs.name`,
      params,
    );
    return {
      columns: [
        { key: 'section', label: 'Class-sec', width: 8 },
        { key: 'strength', label: 'Students', width: 6, right: true, total: true },
        { key: 'riders', label: 'Using the bus', width: 6, right: true, total: true },
        { key: 'both', label: 'Pick-up and drop', width: 6, right: true, total: true },
        { key: 'pick', label: 'Pick-up only', width: 6, right: true, total: true },
        { key: 'drop', label: 'Drop only', width: 6, right: true, total: true },
        { key: 'own', label: 'Not using the bus', width: 6, right: true, total: true },
        { key: 'share', label: 'Share on the bus', width: 6, right: true },
      ] satisfies ReportColumn[],
      rows: r.rows.map((x) => ({
        section: text(x.section),
        strength: num(x.strength),
        riders: num(x.riders),
        both: num(x.both_n),
        pick: num(x.pick_n),
        drop: num(x.drop_n),
        own: num(x.strength) - num(x.riders),
        share: num(x.strength)
          ? `${String(Math.round((num(x.riders) * 100) / num(x.strength)))}%`
          : '',
      })),
    };
  }

  // ---- the transport fee ----------------------------------------------------------------------------
  private feeWhere(
    q: TransportReportDto,
    scope: string[] | null,
    params: unknown[],
    months?: string[],
  ): string {
    const w: string[] = [];
    if (months) {
      params.push(months);
      w.push(`f.m = ANY($${String(params.length)}::text[])`);
    }
    if (q.routeId) {
      params.push(q.routeId);
      w.push(`f.route_id = $${String(params.length)}::bigint`);
    } else if (scope) {
      params.push(scope);
      w.push(`f.route_id = ANY($${String(params.length)}::bigint[])`);
    }
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }

  private async feeMonths(
    c: PoolClient,
    yearId: string,
    q: TransportReportDto,
    scope: string[] | null,
    months: string[],
  ) {
    const params: unknown[] = [yearId];
    const w = this.feeWhere(q, scope, params, months);
    const r = await c.query<Row>(
      `WITH ${FEE}
       SELECT f.route_id::text, r.code, r.name, f.m, count(DISTINCT f.student_id)::int AS pupils,
              sum(f.net)::float AS projected, sum(f.paid)::float AS collected
         FROM fee f LEFT JOIN transport_routes r ON r.id = f.route_id
         ${w}
        GROUP BY f.route_id, r.code, r.name, f.m ORDER BY r.code NULLS LAST, f.m`,
      params,
    );
    const pupils = await c.query<{ route_id: string | null; n: number }>(
      `WITH ${FEE} SELECT f.route_id::text, count(DISTINCT f.student_id)::int AS n FROM fee f ${w} GROUP BY f.route_id`,
      params,
    );
    const byRoute = new Map<string, Record<string, Cell>>();
    for (const x of r.rows) {
      const key = text(x.route_id) ?? '';
      const row =
        byRoute.get(key) ??
        ({
          route: x.code ? `${String(x.code)} · ${String(x.name)}` : 'Billed, not on a route',
          pupils: pupils.rows.find((p) => (p.route_id ?? '') === key)?.n ?? 0,
          projected: 0,
          collected: 0,
          balance: 0,
          ...Object.fromEntries(months.map((m) => [`m_${m}`, 0])),
        } as Record<string, Cell>);
      const projected = num(x.projected);
      const collected = num(x.collected);
      row[`m_${String(x.m)}`] =
        q.measure === 'collected'
          ? collected
          : q.measure === 'balance'
            ? projected - collected
            : projected;
      row.projected = num(row.projected) + projected;
      row.collected = num(row.collected) + collected;
      row.balance = num(row.projected) - num(row.collected);
      byRoute.set(key, row);
    }
    return {
      columns: [
        { key: 'route', label: 'Route', width: 12 },
        { key: 'pupils', label: 'Students', width: 4, right: true, total: true },
        ...months.map((m) => ({
          key: `m_${m}`,
          label: monthLabel(m),
          width: 4,
          right: true,
          total: true,
        })),
        { key: 'projected', label: 'Projected', width: 6, right: true, total: true },
        { key: 'collected', label: 'Collected', width: 6, right: true, total: true },
        { key: 'balance', label: 'Balance', width: 6, right: true, total: true },
      ] satisfies ReportColumn[],
      rows: [...byRoute.values()],
    };
  }

  private async feeStudents(
    c: PoolClient,
    yearId: string,
    q: TransportReportDto,
    scope: string[] | null,
    months: string[],
  ) {
    const params: unknown[] = [yearId];
    let w = this.feeWhere(q, scope, params, months);
    if (q.q) {
      params.push(q.q);
      const p = `$${String(params.length)}`;
      w += `${w ? ' AND' : 'WHERE'} (s.display_name ILIKE '%' || ${p} || '%' OR s.admission_no ILIKE '%' || ${p} || '%')`;
    }
    const r = await c.query<Row>(
      `WITH ${FEE}
       SELECT s.id::text AS student_id, s.admission_no, s.display_name AS student, ${SECTION} AS section,
              string_agg(DISTINCT r.code, ', ') AS routes,
              (SELECT COALESCE(st.name, a.stop_name) FROM student_route_assignments a LEFT JOIN transport_stops st ON st.id = a.stop_id
                WHERE a.student_id = s.id AND a.academic_year_id = $1 LIMIT 1) AS stop,
              count(*)::int AS months, sum(f.net)::float AS projected, sum(f.paid)::float AS collected,
              string_agg(to_char(to_date(f.m, 'YYYY-MM'), 'Mon') , ', ' ORDER BY f.m) FILTER (WHERE f.net > f.paid) AS due_months,
              ${PRIMARY_MOBILE} AS mobile
         FROM fee f JOIN students s ON s.id = f.student_id LEFT JOIN transport_routes r ON r.id = f.route_id
         ${w}
        GROUP BY s.id ORDER BY min(r.code) NULLS LAST, s.display_name LIMIT ${String(MAX + 1)}`,
      params,
    );
    return {
      columns: [
        { key: 'sl', label: 'Sl. no.', width: 3, right: true },
        { key: 'admission_no', label: 'Adm. no.', width: 5 },
        { key: 'student', label: 'Student', width: 11 },
        { key: 'section', label: 'Class-sec', width: 5 },
        { key: 'routes', label: 'Route', width: 5 },
        { key: 'stop', label: 'Stoppage', width: 9 },
        { key: 'mobile', label: 'Parent mobile', width: 6 },
        { key: 'months', label: 'Months billed', width: 4, right: true },
        { key: 'projected', label: 'Projected', width: 6, right: true, total: true },
        { key: 'collected', label: 'Collected', width: 6, right: true, total: true },
        { key: 'balance', label: 'Balance', width: 6, right: true, total: true },
        { key: 'due_months', label: 'Months due', width: 12 },
      ] satisfies ReportColumn[],
      rows: r.rows.map((x, i) => ({
        sl: i + 1,
        // the screen links the pupil to the month-by-month view; the files do not print it
        student_id: text(x.student_id),
        admission_no: text(x.admission_no),
        student: text(x.student),
        section: text(x.section),
        routes: text(x.routes),
        stop: text(x.stop),
        mobile: text(x.mobile),
        months: num(x.months),
        projected: num(x.projected),
        collected: num(x.collected),
        balance: num(x.projected) - num(x.collected),
        due_months: text(x.due_months),
      })),
    };
  }

  private async collection(
    c: PoolClient,
    yearId: string,
    q: TransportReportDto,
    scope: string[] | null,
    from: string,
    to: string,
  ) {
    const params: unknown[] = [yearId];
    let w = this.feeWhere(q, scope, params);
    params.push(from, to);
    w += `${w ? ' AND' : 'WHERE'} pay.received_on BETWEEN $${String(params.length - 1)}::date AND $${String(params.length)}::date AND pay.status IN ('posted', 'partly_refunded')`;
    if (q.q) {
      params.push(q.q);
      const p = `$${String(params.length)}`;
      w += ` AND (s.display_name ILIKE '%' || ${p} || '%' OR s.admission_no ILIKE '%' || ${p} || '%' OR pay.receipt_no ILIKE '%' || ${p} || '%')`;
    }
    const r = await c.query<Row>(
      `WITH ${FEE}
       SELECT pay.received_on::text, pay.receipt_no, pay.mode, s.id::text AS student_id, s.admission_no, s.display_name AS student, ${SECTION} AS section,
              string_agg(DISTINCT r.code, ', ') AS routes,
              string_agg(to_char(to_date(f.m, 'YYYY-MM'), 'Mon YY'), ', ' ORDER BY f.m) AS months, sum(al.amount)::float AS amount
         FROM fee_payment_allocations al
         JOIN fee_payments pay ON pay.id = al.payment_id
         JOIN fee f ON f.id = al.demand_id
         JOIN students s ON s.id = f.student_id
         LEFT JOIN transport_routes r ON r.id = f.route_id
         ${w}
        GROUP BY pay.id, s.id ORDER BY pay.received_on, pay.id LIMIT ${String(MAX + 1)}`,
      params,
    );
    return {
      columns: [
        { key: 'sl', label: 'Sl. no.', width: 3, right: true },
        { key: 'received_on', label: 'Date', width: 5 },
        { key: 'receipt_no', label: 'Receipt no.', width: 8 },
        { key: 'admission_no', label: 'Adm. no.', width: 5 },
        { key: 'student', label: 'Student', width: 11 },
        { key: 'section', label: 'Class-sec', width: 5 },
        { key: 'routes', label: 'Route', width: 5 },
        { key: 'months', label: 'Fee months', width: 14 },
        { key: 'mode', label: 'Mode', width: 5 },
        { key: 'amount', label: 'Transport fee received', width: 7, right: true, total: true },
      ] satisfies ReportColumn[],
      rows: r.rows.map((x, i) => ({
        sl: i + 1,
        student_id: text(x.student_id),
        received_on: dayLabel(text(x.received_on)),
        receipt_no: text(x.receipt_no),
        admission_no: text(x.admission_no),
        student: text(x.student),
        section: text(x.section),
        routes: text(x.routes),
        months: text(x.months),
        mode: text(x.mode),
        amount: num(x.amount),
      })),
    };
  }

  /** One pupil's transport fee, month by month, with the receipts: nothing of the other fee heads. */
  async studentFee(ctx: RequestContext, studentId: string) {
    this.assertMay(ctx, 'fees');
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await this.feeRoutes(ctx, c);
      const s = await c.query<Row>(
        `SELECT s.id::text, s.admission_no, s.display_name AS student, ${SECTION} AS section, r.id::text AS route_id, r.code AS route_code, r.name AS route,
                COALESCE(st.name, a.stop_name) AS stop, COALESCE(a.service, 'both') AS service, ${PRIMARY_MOBILE} AS mobile
           FROM students s
           LEFT JOIN student_route_assignments a ON a.student_id = s.id AND a.academic_year_id = $1
           LEFT JOIN transport_routes r ON r.id = a.route_id
           LEFT JOIN transport_stops st ON st.id = a.stop_id
          WHERE s.id = $2 AND s.deleted_at IS NULL`,
        [yearId, studentId],
      );
      const head = s.rows[0];
      if (!head) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const lines = await c.query<Row>(
        `WITH ${FEE}
         SELECT f.id::text, f.m, f.due_on::text, f.net::float, f.paid::float, f.status, f.route_id::text, r.code AS route_code,
                COALESCE((SELECT json_agg(json_build_object('receiptNo', pay.receipt_no, 'date', pay.received_on::text, 'amount', al.amount::float, 'mode', pay.mode)
                                          ORDER BY pay.received_on, pay.id)
                            FROM fee_payment_allocations al JOIN fee_payments pay ON pay.id = al.payment_id AND pay.status IN ('posted', 'partly_refunded')
                           WHERE al.demand_id = f.id), '[]'::json) AS receipts
           FROM fee f LEFT JOIN transport_routes r ON r.id = f.route_id
          WHERE f.student_id = $2 ORDER BY f.m`,
        [yearId, studentId],
      );
      if (scope) {
        const routes = new Set(
          [text(head.route_id), ...lines.rows.map((x) => text(x.route_id))].filter(Boolean),
        );
        if (![...routes].some((id) => scope.includes(id!)))
          throw new DomainError(
            'forbidden',
            'This student is not on a route you are in-charge of',
            {
              status: 403,
            },
          );
      }
      const months = lines.rows.map((x) => ({
        month: String(x.m),
        route: text(x.route_code),
        dueOn: text(x.due_on),
        amount: num(x.net),
        paid: num(x.paid),
        balance: num(x.net) - num(x.paid),
        status: String(x.status),
        receipts: x.receipts as Array<{
          receiptNo: string | null;
          date: string;
          amount: number;
          mode: string | null;
        }>,
      }));
      return {
        student: {
          id: String(head.id),
          admissionNo: text(head.admission_no),
          name: String(head.student),
          section: text(head.section),
          route: head.route_code ? `${String(head.route_code)} · ${String(head.route)}` : null,
          stop: text(head.stop),
          service: head.route_code ? (SERVICE[String(head.service)] ?? null) : null,
          mobile: text(head.mobile),
        },
        months,
        totals: {
          amount: months.reduce((n, m) => n + m.amount, 0),
          paid: months.reduce((n, m) => n + m.paid, 0),
          balance: months.reduce((n, m) => n + m.balance, 0),
        },
      };
    });
  }

  // ---- files ----------------------------------------------------------------------------------------
  async export(ctx: RequestContext, id: string, q: TransportReportDto, format: 'xlsx' | 'pdf') {
    const rep = await this.run(ctx, id, q);
    const stamp = new Date().toISOString().slice(0, 10);
    const cells = (r: Record<string, Cell>) => rep.columns.map((col) => r[col.key] ?? '');
    const totalRow = rep.totals
      ? rep.columns.map((col, i) =>
          col.key in rep.totals! ? rep.totals![col.key]! : i === 0 ? 'Total' : '',
        )
      : null;
    if (format === 'pdf') {
      const money = (v: Cell | '') =>
        typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : v;
      const rows = rep.rows.map((r) => cells(r).map(money));
      if (totalRow) rows.push(totalRow.map(money));
      return {
        bytes: await tablePdf({
          school: rep.school,
          title: rep.title,
          subtitle: rep.subtitle,
          columns: rep.columns.map((col) => ({
            label: col.label,
            width: col.width,
            right: col.right,
          })),
          rows,
          fontSize: rep.columns.length > 14 ? 6.5 : 8.5,
          wrap: true,
        }),
        filename: `transport-${id}-${stamp}.pdf`,
        type: 'application/pdf',
      };
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(rep.title.slice(0, 31));
    const last = rep.columns.length;
    for (const [i, line] of [rep.school, rep.title, rep.subtitle].entries()) {
      ws.addRow([line]);
      ws.mergeCells(i + 1, 1, i + 1, last);
      ws.getRow(i + 1).font = { bold: i < 2, size: i === 0 ? 14 : i === 1 ? 12 : 10 };
      ws.getRow(i + 1).alignment = { horizontal: 'center' };
    }
    const header = ws.addRow(rep.columns.map((col) => col.label));
    header.font = { bold: true };
    header.alignment = { wrapText: true, vertical: 'middle' };
    for (const r of rep.rows) ws.addRow(cells(r));
    if (totalRow) ws.addRow(totalRow).font = { bold: true };
    rep.columns.forEach((col, i) => {
      const column = ws.getColumn(i + 1);
      column.width = Math.max(8, col.width * 2.4);
      if (col.right) column.alignment = { horizontal: 'right' };
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `transport-${id}-${stamp}.xlsx`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
