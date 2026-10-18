import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ScopePolicy } from '../../common/access/scope.policy';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';

type Count = { key: string; n: number };
const counts = (rows: Array<{ key: string | null; n: number }>, empty = 'Not given'): Count[] =>
  rows.map((r) => ({ key: r.key ?? empty, n: r.n }));

/**
 * The student and the employee dashboards (docs/design/33-people-dashboards.md): strength, movement in the
 * year, today, and the health of the records. Figures first; the admin draws tables and small charts.
 */
@Injectable()
export class PeopleDashboardService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
  ) {}

  private async year(c: PoolClient) {
    const r = await c.query<{ id: string; code: string; start_date: string; end_date: string }>(
      `SELECT id::text, code, start_date::text, end_date::text FROM academic_years
        WHERE id = app.current_academic_year_id()`,
    );
    return r.rows[0] ?? null;
  }

  /** Students of the working year (a class teacher sees their own sections). */
  async students(ctx: RequestContext, classId?: string) {
    const tenant = requireTenant(ctx);
    const sections = await this.scopes.filter(tenant, PEOPLE.studentView, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const y = await this.year(c);
      if (!y) return null;
      // the active enrolments of the year, as the base of every figure
      const base = `
        SELECT s.id, s.gender, s.category, s.dob, s.admitted_on, s.photo_file_id, s.profile, s.secure,
               s.profile_completeness, e.class_section_id, cs.class_id, k.name AS class_name, k.display_order,
               k.code || '-' || cs.name AS section
          FROM enrolments e
          JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
          JOIN class_sections cs ON cs.id = e.class_section_id
          JOIN classes k ON k.id = cs.class_id
         WHERE e.academic_year_id = $1 AND e.status = 'active'
           AND ($2::bigint[] IS NULL OR e.class_section_id = ANY($2::bigint[]))
           AND ($3::bigint IS NULL OR cs.class_id = $3::bigint)`;
      const args = [y.id, sections, classId ?? null];
      const q = <T extends Record<string, unknown>>(sql: string, extra: unknown[] = []) =>
        c.query<T>(`WITH b AS (${base}) ${sql}`, [...args, ...extra]).then((r) => r.rows);

      const [
        totals,
        byClass,
        gender,
        category,
        boarding,
        attendance,
        birthdays,
        movement,
        pending,
      ] = await Promise.all([
        q<{
          total: number;
          new_: number;
          ews: number;
          no_photo: number;
          no_aadhaar: number;
          low: number;
          avg: string | null;
        }>(
          `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE admitted_on BETWEEN $4::date AND $5::date)::int AS new_,
                    count(*) FILTER (WHERE profile->>'ews' = 'Yes')::int AS ews,
                    count(*) FILTER (WHERE photo_file_id IS NULL)::int AS no_photo,
                    count(*) FILTER (WHERE coalesce(secure->>'aadhaar_no', '') = '')::int AS no_aadhaar,
                    count(*) FILTER (WHERE profile_completeness < 80)::int AS low,
                    round(avg(profile_completeness))::text AS avg
               FROM b`,
          [y.start_date, y.end_date],
        ),
        q<{
          class_id: string;
          name: string;
          sections: number;
          n: number;
          boys: number;
          girls: number;
        }>(
          `SELECT class_id::text, class_name AS name, count(DISTINCT class_section_id)::int AS sections,
                    count(*)::int AS n,
                    count(*) FILTER (WHERE lower(gender::text) IN ('male', 'm', 'boy'))::int AS boys,
                    count(*) FILTER (WHERE lower(gender::text) IN ('female', 'f', 'girl'))::int AS girls
               FROM b GROUP BY class_id, class_name, display_order ORDER BY display_order, class_name`,
        ),
        q<{ key: string | null; n: number }>(
          `SELECT gender::text AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
        ),
        q<{ key: string | null; n: number }>(
          `SELECT category AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
        ),
        q<{ key: string | null; n: number }>(
          `SELECT profile->>'boarding' AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
        ),
        // today's day attendance: marked sections and the marks
        q<{ sections: number; marked: number; present: number; absent: number; leave: number }>(
          `SELECT (SELECT count(DISTINCT class_section_id)::int FROM b) AS sections,
                    (SELECT count(DISTINCT a.class_section_id)::int FROM attendance_sessions a
                      WHERE a.on_date = CURRENT_DATE AND a.kind = 'day' AND a.class_section_id IN (SELECT class_section_id FROM b)) AS marked,
                    count(*) FILTER (WHERE m.code IN ('P', 'L', 'H', 'OD', 'SB'))::int AS present,
                    count(*) FILTER (WHERE m.code = 'A')::int AS absent,
                    count(*) FILTER (WHERE m.code = 'SR')::int AS leave
               FROM attendance_marks m
               JOIN attendance_sessions a ON a.id = m.session_id AND a.on_date = CURRENT_DATE AND a.kind = 'day'
              WHERE m.student_id IN (SELECT id FROM b)`,
        ),
        q<{ id: string; name: string; section: string; age: number }>(
          `SELECT b.id::text, s.display_name AS name, b.section,
                    date_part('year', age(CURRENT_DATE, b.dob))::int AS age
               FROM b JOIN students s ON s.id = b.id
              WHERE to_char(b.dob, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
              ORDER BY b.display_order, b.section, s.display_name LIMIT 50`,
        ),
        // the year's movement (whole school; a class teacher sees it too, it holds no names)
        c
          .query<{
            adm_year: number;
            adm_month: number;
            withdrawn: number;
            tcs: number;
            out_: number;
            in_: number;
          }>(
            `SELECT (SELECT count(*)::int FROM students WHERE deleted_at IS NULL AND admitted_on BETWEEN $1::date AND $2::date) AS adm_year,
                      (SELECT count(*)::int FROM students WHERE deleted_at IS NULL AND date_trunc('month', admitted_on) = date_trunc('month', CURRENT_DATE)) AS adm_month,
                      (SELECT count(*)::int FROM student_withdrawals WHERE academic_year_id = $3 AND status = 'completed') AS withdrawn,
                      (SELECT count(*)::int FROM transfer_certificates WHERE academic_year_id = $3 AND status = 'issued') AS tcs,
                      (SELECT count(*)::int FROM school_transfers WHERE from_school_id = app.current_school_id() AND status = 'accepted' AND decided_at::date BETWEEN $1::date AND $2::date) AS out_,
                      (SELECT count(*)::int FROM school_transfers WHERE to_school_id = app.current_school_id() AND status = 'accepted' AND decided_at::date BETWEEN $1::date AND $2::date) AS in_`,
            [y.start_date, y.end_date, y.id],
          )
          .then((r) => r.rows),
        c
          .query<{ n: number }>(
            `SELECT count(*)::int AS n FROM profile_change_requests WHERE status = 'pending'`,
          )
          .then((r) => r.rows),
      ]);
      const t = totals[0]!;
      const a = attendance[0]!;
      const m = movement[0]!;
      return {
        year: { id: y.id, code: y.code },
        strength: {
          total: t.total,
          newThisYear: t.new_,
          old: t.total - t.new_,
          ews: t.ews,
          byClass: byClass.map((x) => ({
            classId: x.class_id,
            name: x.name,
            sections: x.sections,
            students: x.n,
            boys: x.boys,
            girls: x.girls,
          })),
          gender: counts(gender),
          category: counts(category),
          boarding: counts(boarding),
        },
        movement: {
          admittedYear: m.adm_year,
          admittedMonth: m.adm_month,
          withdrawn: m.withdrawn,
          tcsIssued: m.tcs,
          transferredOut: m.out_,
          transferredIn: m.in_,
        },
        today: {
          sections: a.sections,
          sectionsMarked: a.marked,
          present: a.present,
          absent: a.absent,
          leave: a.leave,
          birthdays: birthdays.map((b) => ({
            id: b.id,
            name: b.name,
            section: b.section,
            age: b.age,
          })),
        },
        health: {
          averageCompleteness: t.avg === null ? null : Number(t.avg),
          below80: t.low,
          noPhoto: t.no_photo,
          noAadhaar: t.no_aadhaar,
          pendingChanges: pending[0]?.n ?? 0,
        },
      };
    });
  }

  /** Staff of the school. */
  async staff(ctx: RequestContext, department?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.year(c);
      const from = y?.start_date ?? null;
      const to = y?.end_date ?? null;
      const base = `
        SELECT e.id, e.display_name, e.gender, e.employee_type::text AS employee_type, e.designation, e.department,
               e.dob, e.joined_on, e.user_id, e.completeness, e.profile,
               app.employee_staff_side(e.department, e.employee_type) AS side
          FROM employees e
         WHERE e.deleted_at IS NULL AND e.status = 'active'
           AND ($1::text IS NULL OR lower(e.department) = lower($1::text))`;
      const q = <T extends Record<string, unknown>>(sql: string, extra: unknown[] = []) =>
        c
          .query<T>(`WITH b AS (${base}) ${sql}`, [department ?? null, ...extra])
          .then((r) => r.rows);
      const [totals, side, dept, desig, type, gender, today, people, docs, acr, pending] =
        await Promise.all([
          q<{
            total: number;
            no_login: number;
            low: number;
            avg: string | null;
            joined: number;
            probation: number;
            retire: number;
          }>(
            `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE user_id IS NULL)::int AS no_login,
                  count(*) FILTER (WHERE completeness < 80)::int AS low,
                  round(avg(completeness))::text AS avg,
                  count(*) FILTER (WHERE joined_on BETWEEN $2::date AND $3::date)::int AS joined,
                  count(*) FILTER (WHERE (profile->>'probation_months') ~ '^\\d+$'
                     AND joined_on + make_interval(months => (profile->>'probation_months')::int) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS probation,
                  count(*) FILTER (WHERE dob + interval '60 years' BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '12 months')::int AS retire
             FROM b`,
            [from, to],
          ),
          q<{ key: string | null; n: number }>(
            `SELECT side AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
          ),
          q<{ key: string | null; n: number }>(
            `SELECT department AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC, 1`,
          ),
          q<{ key: string | null; n: number }>(
            `SELECT designation AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
          ),
          q<{ key: string | null; n: number }>(
            `SELECT employee_type AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
          ),
          q<{ key: string | null; n: number }>(
            `SELECT gender::text AS key, count(*)::int AS n FROM b GROUP BY 1 ORDER BY 2 DESC`,
          ),
          // today: punched in, late (after the ACR "late after" time), activity log submitted
          q<{ punched: number; late: number; logs: number; late_after: string }>(
            `SELECT count(DISTINCT p.employee_id)::int AS punched,
                  count(DISTINCT p.employee_id) FILTER (WHERE f.first_in > coalesce(s.staff_late_after, '08:00'))::int AS late,
                  (SELECT count(*)::int FROM activity_logs l WHERE l.on_date = CURRENT_DATE AND l.state IN ('submitted', 'reviewed')
                      AND l.employee_id IN (SELECT id FROM b)) AS logs,
                  to_char(coalesce(max(s.staff_late_after), '08:00'), 'HH24:MI') AS late_after
             FROM b
             LEFT JOIN acr_settings s ON true
             LEFT JOIN LATERAL (
               SELECT min((pl.punched_at AT TIME ZONE 'Asia/Kolkata')::time) AS first_in FROM punch_logs pl
                WHERE pl.employee_id = b.id AND pl.outcome = 'recorded'
                  AND (pl.punched_at AT TIME ZONE 'Asia/Kolkata')::date = CURRENT_DATE) f ON true
             LEFT JOIN punch_logs p ON p.employee_id = b.id AND p.outcome = 'recorded'
                  AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date = CURRENT_DATE`,
          ),
          // birthdays and work anniversaries today
          q<{ id: string; name: string; designation: string | null; kind: string; years: number }>(
            `SELECT id::text, display_name AS name, designation, 'birthday' AS kind,
                  date_part('year', age(CURRENT_DATE, dob))::int AS years
             FROM b WHERE to_char(dob, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
           UNION ALL
           SELECT id::text, display_name, designation, 'anniversary',
                  date_part('year', age(CURRENT_DATE, joined_on))::int
             FROM b WHERE to_char(joined_on, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD') AND joined_on < CURRENT_DATE
           ORDER BY 4, 2 LIMIT 50`,
          ),
          // documents: staff with a required one missing, and ones expiring in 30 days
          q<{ missing: number; expiring: number }>(
            `SELECT (SELECT count(*)::int FROM b WHERE EXISTS (
                     SELECT 1 FROM app.employee_documents_due(b.id) d WHERE d.required AND d.valid = 0)) AS missing,
                  (SELECT count(*)::int FROM employee_documents d WHERE d.deleted_at IS NULL
                      AND d.employee_id IN (SELECT id FROM b)
                      AND d.expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring`,
          ),
          // ACR of the latest cycle
          c
            .query<{ cycle: string | null; status: string; n: number }>(
              `SELECT cy.name AS cycle, r.status, count(*)::int AS n
               FROM acr_cycles cy JOIN acr_reports r ON r.cycle_id = cy.id
              WHERE cy.id = (SELECT c2.id FROM acr_cycles c2 JOIN academic_years y2 ON y2.id = c2.academic_year_id
                              ORDER BY y2.start_date DESC LIMIT 1)
              GROUP BY cy.name, r.status`,
            )
            .then((r) => r.rows),
          c
            .query<{ n: number }>(
              `SELECT count(*)::int AS n FROM employee_change_requests WHERE status = 'pending'`,
            )
            .then((r) => r.rows),
        ]);
      const movement = await c.query<{ left_: number; moved: number; out_: number; in_: number }>(
        `SELECT (SELECT count(*)::int FROM employees WHERE deleted_at IS NULL AND left_on BETWEEN $1::date AND $2::date
                   AND ($3::text IS NULL OR lower(department) = lower($3::text))) AS left_,
                (SELECT count(*)::int FROM employee_transfers t WHERE t.on_date BETWEEN $1::date AND $2::date) AS moved,
                (SELECT count(*)::int FROM employee_school_transfers WHERE from_school_id = app.current_school_id() AND status = 'accepted' AND decided_at::date BETWEEN $1::date AND $2::date) AS out_,
                (SELECT count(*)::int FROM employee_school_transfers WHERE to_school_id = app.current_school_id() AND status = 'accepted' AND decided_at::date BETWEEN $1::date AND $2::date) AS in_`,
        [from, to, department ?? null],
      );
      const t = totals[0]!;
      const td = today[0]!;
      const mv = movement.rows[0]!;
      const sideLabel: Record<string, string> = {
        teaching: 'Teaching',
        non_teaching: 'Non-teaching',
        both: 'Both',
      };
      return {
        year: y ? { id: y.id, code: y.code } : null,
        strength: {
          total: t.total,
          side: counts(side).map((x) => ({ key: sideLabel[x.key] ?? x.key, n: x.n })),
          department: counts(department ? [] : dept),
          designation: counts(desig),
          type: counts(type),
          gender: counts(gender),
        },
        movement: {
          joined: t.joined,
          left: mv.left_,
          transfersRecorded: mv.moved,
          transferredOut: mv.out_,
          transferredIn: mv.in_,
          probationEnding30: t.probation,
          retiring12Months: t.retire,
        },
        today: {
          punchedIn: td.punched,
          late: td.late,
          lateAfter: td.late_after,
          activityLogs: td.logs,
          people: people.map((p) => ({
            id: p.id,
            name: p.name,
            designation: p.designation,
            kind: p.kind,
            years: p.years,
          })),
        },
        health: {
          averageCompleteness: t.avg === null ? null : Number(t.avg),
          below80: t.low,
          noLogin: t.no_login,
          documentsMissing: docs[0]?.missing ?? 0,
          documentsExpiring30: docs[0]?.expiring ?? 0,
          pendingChanges: pending[0]?.n ?? 0,
          acr: acr.length
            ? {
                cycle: acr[0]!.cycle,
                byStatus: Object.fromEntries(acr.map((x) => [x.status, x.n])),
              }
            : null,
        },
      };
    });
  }
}
