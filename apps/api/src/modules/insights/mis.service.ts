import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export interface MisDashboard {
  code: string;
  name: string;
  href: string;
  kpis: Array<{ label: string; value: string | number | null; unit?: string }>;
  datasets: string[];
}

export interface GroupRow {
  schoolId: string;
  code: string;
  name: string;
  pupils: number;
  attendanceTodayPct: number | null;
  feesCollectedMonth: string;
  feesOutstanding: string;
  latestExam: string | null;
  passPct: number | null;
  openApprovals: number;
  overdueLoans: number;
}

/** Dashboard keys → where they live and which datasets export them. */
const DASHBOARD_LINKS: Record<string, { href: string; datasets: string[] }> = {
  principal: { href: '/insights/principal', datasets: ['attendance_daily', 'fee_receipts'] },
  academics: {
    href: '/insights/departments/academics',
    datasets: ['lesson_plans', 'substitutions'],
  },
  attendance: { href: '/insights/departments/attendance', datasets: ['attendance_daily'] },
  fees: {
    href: '/insights/departments/fees',
    datasets: ['fee_dues', 'fee_receipts', 'fee_day_book'],
  },
  communication: {
    href: '/insights/departments/communication',
    datasets: ['comms_delivery', 'parent_queries'],
  },
  transport: {
    href: '/insights/departments/transport',
    datasets: ['transport_riders', 'transport_requests'],
  },
  library: { href: '/library/circulation', datasets: ['master_library_copies'] },
  results: { href: '/insights/results', datasets: ['board_results'] },
  group: { href: '/insights/group', datasets: [] },
};

/**
 * Sprint 19: the MIS centre (dashboards mapped to the caller's roles, each with its KPIs from the same
 * marts the module screens read) and the group view across the schools of the caller's group.
 */
@Injectable()
export class MisService {
  constructor(private readonly db: DbService) {}

  /** Installs the default role mapping once per school. */
  async installDefaults(ctx: RequestContext): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const defaults: Array<[string, string, string[], number]> = [
        ['principal', 'Principal dashboard', ['school_admin', 'group_admin'], 1],
        ['academics', 'Academics', ['school_admin', 'group_admin', 'academic_coordinator'], 2],
        [
          'attendance',
          'Attendance',
          ['school_admin', 'group_admin', 'academic_coordinator', 'class_teacher'],
          3,
        ],
        ['fees', 'Fees', ['school_admin', 'group_admin', 'accountant', 'auditor'], 4],
        [
          'communication',
          'Communication',
          ['school_admin', 'group_admin', 'academic_coordinator'],
          5,
        ],
        ['transport', 'Transport', ['school_admin', 'group_admin'], 6],
        ['library', 'Library', ['school_admin', 'group_admin', 'academic_coordinator'], 7],
        [
          'results',
          'Results analytics',
          ['school_admin', 'group_admin', 'academic_coordinator', 'class_teacher'],
          8,
        ],
        ['group', 'Group view', ['group_admin'], 9],
      ];
      for (const [code, name, roles, order] of defaults)
        await c.query(
          `INSERT INTO mis_dashboards (school_id, code, name, roles, sort_order) VALUES (app.current_school_id(), $1, $2, $3::text[], $4) ON CONFLICT (school_id, code) DO NOTHING`,
          [code, name, roles, order],
        );
    });
  }

  async mine(ctx: RequestContext): Promise<MisDashboard[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const roles = await c.query<{ code: string }>(
        `SELECT DISTINCT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
      );
      const mine = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM mis_dashboards WHERE status = 'active' AND roles && $1::text[] ORDER BY sort_order, code`,
        [roles.rows.map((r) => r.code)],
      );
      const out: MisDashboard[] = [];
      for (const d of mine.rows) {
        const link = DASHBOARD_LINKS[d.code] ?? { href: '/', datasets: [] };
        out.push({
          code: d.code,
          name: d.name,
          href: link.href,
          datasets: link.datasets,
          kpis: await this.kpis(c, d.code),
        });
      }
      return out;
    });
  }

  private async kpis(
    c: { query: <T = Record<string, unknown>>(t: string, v?: unknown[]) => Promise<{ rows: T[] }> },
    code: string,
  ): Promise<MisDashboard['kpis']> {
    const one = async <T = Record<string, unknown>>(t: string) => (await c.query<T>(t)).rows[0];
    switch (code) {
      case 'principal':
      case 'attendance': {
        const r = await one<{ strength: string; present: string; sections: string }>(
          `SELECT COALESCE(sum(strength), 0)::text AS strength, COALESCE(sum(present), 0)::text AS present, count(*)::text AS sections FROM mart.attendance_daily WHERE on_date = CURRENT_DATE AND marked`,
        );
        const pupils = await one<{ n: string }>(
          `SELECT count(*)::text AS n FROM enrolments WHERE academic_year_id = app.current_academic_year_id() AND status = 'active'`,
        );
        return [
          { label: 'Pupils enrolled', value: Number(pupils?.n ?? 0) },
          {
            label: 'Attendance today',
            value: Number(r?.strength)
              ? Math.round((Number(r!.present) / Number(r!.strength)) * 1000) / 10
              : null,
            unit: '%',
          },
          { label: 'Sections marked today', value: Number(r?.sections ?? 0) },
        ];
      }
      case 'fees': {
        const r = await one<{ month: string; due: string; overdue: string }>(
          `SELECT (SELECT COALESCE(sum(amount), 0)::text FROM fee_payments WHERE status NOT IN ('reversed', 'bounced') AND received_on >= date_trunc('month', CURRENT_DATE)) AS month,
                  (SELECT COALESCE(sum(balance), 0)::text FROM mart.fee_dues WHERE academic_year_id = app.current_academic_year_id()) AS due,
                  (SELECT COALESCE(sum(balance), 0)::text FROM mart.fee_dues WHERE academic_year_id = app.current_academic_year_id() AND days_overdue > 0) AS overdue`,
        );
        return [
          { label: 'Collected this month', value: r?.month ?? '0', unit: '₹' },
          { label: 'Outstanding', value: r?.due ?? '0', unit: '₹' },
          { label: 'Overdue', value: r?.overdue ?? '0', unit: '₹' },
        ];
      }
      case 'academics': {
        const r = await one<{ plans: string; subs: string }>(
          `SELECT (SELECT count(*)::text FROM lesson_plans WHERE status = 'submitted') AS plans, (SELECT count(*)::text FROM timetable_substitutions WHERE on_date = CURRENT_DATE) AS subs`,
        );
        return [
          { label: 'Lesson plans awaiting approval', value: Number(r?.plans ?? 0) },
          { label: 'Substitutions today', value: Number(r?.subs ?? 0) },
        ];
      }
      case 'communication': {
        const r = await one<{ sent: string; open: string }>(
          `SELECT (SELECT count(*)::text FROM comms_messages WHERE created_at >= CURRENT_DATE - 7) AS sent, (SELECT count(*)::text FROM parent_queries WHERE status IN ('open', 'in_progress')) AS open`,
        );
        return [
          { label: 'Messages in the last 7 days', value: Number(r?.sent ?? 0) },
          { label: 'Open parent queries', value: Number(r?.open ?? 0) },
        ];
      }
      case 'transport': {
        const r = await one<{ riders: string; pending: string }>(
          `SELECT (SELECT count(*)::text FROM student_route_assignments WHERE academic_year_id = app.current_academic_year_id()) AS riders, (SELECT count(*)::text FROM transport_requests WHERE status = 'pending') AS pending`,
        );
        return [
          { label: 'Pupils on buses', value: Number(r?.riders ?? 0) },
          { label: 'Pending bus requests', value: Number(r?.pending ?? 0) },
        ];
      }
      case 'library': {
        const r = await one<{ loans: string; overdue: string; fines: string }>(
          `SELECT (SELECT count(*)::text FROM library_loans WHERE returned_on IS NULL) AS loans, (SELECT count(*)::text FROM library_loans WHERE returned_on IS NULL AND due_on < CURRENT_DATE) AS overdue,
                  (SELECT COALESCE(sum(fine_amount - fine_waived), 0)::text FROM library_loans WHERE fine_amount > fine_waived AND fine_paid_on IS NULL) AS fines`,
        );
        return [
          { label: 'Copies on loan', value: Number(r?.loans ?? 0) },
          { label: 'Overdue', value: Number(r?.overdue ?? 0) },
          { label: 'Fines outstanding', value: r?.fines ?? '0', unit: '₹' },
        ];
      }
      case 'results': {
        const r = await one<{ exam: string | null; pass_pct: string | null }>(
          `SELECT m.exam_code AS exam, m.pass_pct::text FROM mart.exam_results m WHERE m.academic_year_id = app.current_academic_year_id() AND m.class_section_id IS NULL ORDER BY m.computed_at DESC NULLS LAST LIMIT 1`,
        );
        return [
          { label: 'Latest exam', value: r?.exam ?? null },
          { label: 'Pass rate', value: r?.pass_pct ? Number(r.pass_pct) : null, unit: '%' },
        ];
      }
      case 'group': {
        const r = await one<{ n: string }>(
          `SELECT count(*)::text AS n FROM schools WHERE group_id = (SELECT group_id FROM schools WHERE id = app.current_school_id())`,
        );
        return [{ label: 'Schools in the group', value: Number(r?.n ?? 0) }];
      }
      default:
        return [];
    }
  }

  /** One row per school of the caller's group, each read under that school's own tenant context. */
  async group(ctx: RequestContext): Promise<GroupRow[]> {
    const tenant = requireTenant(ctx);
    const schools = await this.db.tenant(tenant, (c) =>
      c.query<{ id: string; code: string; name: string }>(
        `SELECT s.id::text, s.code, s.name FROM schools s WHERE (s.group_id = (SELECT group_id FROM schools WHERE id = app.current_school_id()) OR s.id = app.current_school_id()) AND s.status = 'active' ORDER BY s.name`,
      ),
    );
    const allowed = new Set((tenant.allowedSchoolIds ?? []).map(String));
    const out: GroupRow[] = [];
    for (const s of schools.rows) {
      if (allowed.size && !allowed.has(s.id)) continue;
      const row = await this.db.tenant(
        { ...tenant, schoolId: s.id, academicYearId: null },
        async (c) => {
          const r = await c.query<Record<string, unknown>>(
            `SELECT (SELECT count(*) FROM enrolments e JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active' WHERE e.status = 'active')::int AS pupils,
                  (SELECT CASE WHEN sum(strength) > 0 THEN round(100.0 * sum(present) / sum(strength), 1) END FROM mart.attendance_daily WHERE on_date = CURRENT_DATE AND marked) AS att,
                  (SELECT COALESCE(sum(amount), 0)::text FROM fee_payments WHERE status NOT IN ('reversed', 'bounced') AND received_on >= date_trunc('month', CURRENT_DATE)) AS collected,
                  (SELECT COALESCE(sum(balance), 0)::text FROM mart.fee_dues d JOIN academic_years y ON y.id = d.academic_year_id AND y.status = 'active') AS outstanding,
                  (SELECT m.exam_code FROM mart.exam_results m WHERE m.class_section_id IS NULL ORDER BY m.computed_at DESC NULLS LAST LIMIT 1) AS exam,
                  (SELECT m.pass_pct FROM mart.exam_results m WHERE m.class_section_id IS NULL ORDER BY m.computed_at DESC NULLS LAST LIMIT 1) AS pass_pct,
                  (SELECT count(*) FROM workflow_instances WHERE status = 'pending')::int AS approvals,
                  (SELECT count(*) FROM library_loans WHERE returned_on IS NULL AND due_on < CURRENT_DATE)::int AS overdue_loans`,
          );
          return r.rows[0]!;
        },
      );
      out.push({
        schoolId: s.id,
        code: s.code,
        name: s.name,
        pupils: Number(row.pupils),
        attendanceTodayPct: row.att === null ? null : Number(row.att),
        feesCollectedMonth: String(row.collected),
        feesOutstanding: String(row.outstanding),
        latestExam: (row.exam as string | null) ?? null,
        passPct: row.pass_pct === null || row.pass_pct === undefined ? null : Number(row.pass_pct),
        openApprovals: Number(row.approvals),
        overdueLoans: Number(row.overdue_loans),
      });
    }
    return out;
  }
}
