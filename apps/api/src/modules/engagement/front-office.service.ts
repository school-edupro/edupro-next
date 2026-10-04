/* eslint-disable no-restricted-syntax -- every interpolation here is a constant fragment (time zone, today, the series SQL); values are bound */
import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const n = (v: unknown) => Number(v ?? 0);
const MAX_DAYS = 92;

/**
 * The front office and gate dashboard: appointments, gate passes (pupils and staff apart) and walk-in
 * visitors side by side. Six months by month, a chosen range by day, and what is waiting for approval:
 * by approval level (who holds things up, and for how long) and by department / class. Each part is
 * answered only to someone who may see that module.
 */
@Injectable()
export class FrontOfficeService {
  constructor(private readonly db: DbService) {}

  async overview(ctx: RequestContext, q: { from?: string; to?: string }) {
    const may = (p: string) => ctx.permissions?.has(p) ?? false;
    const see = {
      appointments: may('engagement.appointment.view'),
      passes: may('engagement.gate_pass.view'),
      visitors: may('engagement.visitor.manage'),
    };
    if (!see.appointments && !see.passes && !see.visitors)
      return { see, range: null, months: [], days: [], passMonths: [], pending: null };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const range = await c.query<{ from: string; to: string; days: number }>(
        `SELECT f::text AS "from", t::text AS "to", (t - f + 1) AS days FROM (
           SELECT COALESCE($1::date, ${TODAY} - 29) AS f, COALESCE($2::date, ${TODAY}) AS t) x`,
        [q.from ?? null, q.to ?? null],
      );
      const r = range.rows[0]!;
      if (r.days < 1 || r.days > MAX_DAYS)
        throw new DomainError('validation-failed', `Pick up to ${String(MAX_DAYS)} days`, {
          status: 400,
        });
      // one row per (period, series): appointments by visit day, passes by pass day, walk-ins by entry day
      const series = (trunc: 'month' | 'day') => {
        const key = (col: string) =>
          trunc === 'month' ? `to_char(${col}, 'YYYY-MM')` : `to_char(${col}, 'YYYY-MM-DD')`;
        const parts: string[] = [];
        if (see.appointments)
          parts.push(
            `SELECT ${key(`(a.starts_at AT TIME ZONE ${TZ})::date`)} AS k, 'appointments' AS s, count(*)::int AS n FROM appointments a
              WHERE a.starts_at IS NOT NULL AND a.state NOT IN ('rejected', 'cancelled')
                AND (a.starts_at AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date GROUP BY 1`,
          );
        if (see.passes)
          parts.push(
            `SELECT ${key('p.on_date')} AS k, CASE WHEN p.audience = 'student' THEN 'pupil' ELSE 'staff' END AS s, count(*)::int AS n
               FROM gate_passes p WHERE p.state <> 'cancelled' AND p.on_date BETWEEN $1::date AND $2::date GROUP BY 1, 2`,
          );
        if (see.visitors)
          parts.push(
            `SELECT ${key(`(COALESCE(v.in_at, v.created_at) AT TIME ZONE ${TZ})::date`)} AS k, 'visitors' AS s, count(*)::int AS n FROM visitor_log v
              WHERE v.source <> 'appointment' AND v.state <> 'cancelled'
                AND (COALESCE(v.in_at, v.created_at) AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date GROUP BY 1`,
          );
        return parts.join(' UNION ALL ');
      };
      const fold = (rows: Row[], keys: string[]) =>
        keys.map((k) => {
          const of = (s: string) => n(rows.find((x) => x.k === k && x.s === s)?.n);
          return {
            key: k,
            appointments: of('appointments'),
            pupil: of('pupil'),
            staff: of('staff'),
            visitors: of('visitors'),
          };
        });
      const monthKeys = await c.query<{ k: string; f: string; t: string }>(
        `SELECT to_char(m, 'YYYY-MM') AS k, m::date::text AS f, (m + interval '1 month' - interval '1 day')::date::text AS t
           FROM generate_series(date_trunc('month', ${TODAY}) - interval '5 months', date_trunc('month', ${TODAY}), interval '1 month') m ORDER BY 1`,
      );
      const six = [monthKeys.rows[0]!.f, monthKeys.rows[monthKeys.rows.length - 1]!.t];
      const months = await c.query<Row>(series('month'), six);
      const days = await c.query<Row>(series('day'), [r.from, r.to]);
      const dayKeys = await c.query<{ k: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS k FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY 1`,
        [r.from, r.to],
      );
      // gate passes month by month: what was asked, what became of it, how long approval and outings took
      const passMonths = see.passes
        ? await c.query<Row>(
            `SELECT to_char(p.on_date, 'YYYY-MM') AS k, p.audience,
                    count(*)::int AS asked,
                    count(*) FILTER (WHERE p.state IN ('approved', 'handed_over', 'out', 'returned'))::int AS approved,
                    count(*) FILTER (WHERE p.state = 'rejected')::int AS rejected,
                    count(*) FILTER (WHERE p.state = 'pending')::int AS waiting,
                    count(*) FILTER (WHERE p.out_at IS NOT NULL)::int AS went_out,
                    count(*) FILTER (WHERE p.kind = 'rgp' AND p.in_at IS NOT NULL)::int AS came_back,
                    count(*) FILTER (WHERE p.kind = 'rgp' AND p.return_by IS NOT NULL AND COALESCE(p.in_at, now()) > p.return_by AND p.out_at IS NOT NULL)::int AS late_back,
                    round(avg(extract(epoch FROM (p.decided_at - p.created_at)) / 3600) FILTER (WHERE p.decided_at IS NOT NULL)::numeric, 1)::text AS approve_hours,
                    round(avg(extract(epoch FROM (p.in_at - p.out_at)) / 60) FILTER (WHERE p.kind = 'rgp' AND p.in_at IS NOT NULL AND p.out_at IS NOT NULL)::numeric, 0)::text AS out_minutes
               FROM gate_passes p WHERE p.state <> 'cancelled' AND p.on_date BETWEEN $1::date AND $2::date GROUP BY 1, 2`,
            six,
          )
        : { rows: [] as Row[] };
      const pending = {
        // who holds the pending passes now, and since when
        passByLevel: see.passes
          ? (
              await c.query<Row>(
                `SELECT p.audience, a.label, count(*)::int AS waiting,
                        round((extract(epoch FROM (now() - min(p.created_at))) / 3600)::numeric, 1)::text AS oldest_hours,
                        count(*) FILTER (WHERE p.on_date <= ${TODAY})::int AS due_today
                   FROM gate_pass_approvals a JOIN gate_passes p ON p.id = a.pass_id
                  WHERE a.status = 'pending' AND p.state = 'pending' GROUP BY 1, 2, a.seq ORDER BY 1 DESC, a.seq`,
              )
            ).rows.map((x) => ({
              audience: String(x.audience),
              label: String(x.label),
              waiting: n(x.waiting),
              oldestHours: Number(x.oldest_hours ?? 0),
              dueToday: n(x.due_today),
            }))
          : [],
        // the same passes by where they come from: staff by department, pupils by class
        passByGroup: see.passes
          ? (
              await c.query<Row>(
                `SELECT p.audience,
                        CASE WHEN p.audience = 'staff' THEN COALESCE(NULLIF(btrim(e.department), ''), 'No department')
                             ELSE COALESCE((SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                                              JOIN classes k ON k.id = cs.class_id
                                             WHERE en.student_id = p.student_id AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1), 'No class') END AS grp,
                        count(*)::int AS waiting,
                        round((extract(epoch FROM (now() - min(p.created_at))) / 3600)::numeric, 1)::text AS oldest_hours
                   FROM gate_passes p LEFT JOIN employees e ON e.id = p.employee_id
                  WHERE p.state = 'pending' GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC, 2`,
              )
            ).rows.map((x) => ({
              audience: String(x.audience),
              group: String(x.grp),
              waiting: n(x.waiting),
              oldestHours: Number(x.oldest_hours ?? 0),
            }))
          : [],
        // appointment requests the front desk has not decided, by the desk or person asked for
        appointmentByHost: see.appointments
          ? (
              await c.query<Row>(
                `SELECT COALESCE(h.name, 'Not chosen') AS host, count(*)::int AS waiting,
                        round((extract(epoch FROM (now() - min(a.created_at))) / 3600)::numeric, 1)::text AS oldest_hours
                   FROM appointments a LEFT JOIN appointment_hosts h ON h.id = a.host_id
                  WHERE a.state = 'requested' GROUP BY 1 ORDER BY 2 DESC, 1`,
              )
            ).rows.map((x) => ({
              host: String(x.host),
              waiting: n(x.waiting),
              oldestHours: Number(x.oldest_hours ?? 0),
            }))
          : [],
      };
      return {
        see,
        range: { from: r.from, to: r.to },
        months: fold(
          months.rows,
          monthKeys.rows.map((x) => x.k),
        ),
        days: fold(
          days.rows,
          dayKeys.rows.map((x) => x.k),
        ),
        passMonths: passMonths.rows.map((x) => ({
          month: String(x.k),
          audience: String(x.audience),
          asked: n(x.asked),
          approved: n(x.approved),
          rejected: n(x.rejected),
          waiting: n(x.waiting),
          wentOut: n(x.went_out),
          cameBack: n(x.came_back),
          lateBack: n(x.late_back),
          approveHours: x.approve_hours === null ? null : Number(x.approve_hours),
          outMinutes: x.out_minutes === null ? null : Number(x.out_minutes),
        })),
        pending,
      };
    });
  }
}
