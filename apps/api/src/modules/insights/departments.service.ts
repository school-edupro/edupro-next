import { Injectable } from '@nestjs/common';
import { DATASETS, type PoolClient, type TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export const DEPARTMENTS = [
  'academics',
  'attendance',
  'fees',
  'admissions',
  'transport',
  'communication',
  'hr',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** A department opens for whoever already holds one of its module permissions (or the principal view). */
const GATES: Record<Department, string[]> = {
  academics: [
    'academics.lesson_plan.view',
    'academics.daily_work.view',
    'academics.timetable.view',
    'academics.substitution.view',
  ],
  attendance: ['attendance.session.view', 'attendance.rfid.manage'],
  fees: ['fees.ledger.view', 'fees.demand.view', 'payments.intent.view'],
  admissions: ['admissions.application.view', 'admissions.cycle.view'],
  transport: ['transport.route.view', 'transport.fleet.view'],
  communication: ['comms.message.view', 'engagement.query.view', 'comms.consent.view'],
  hr: ['people.employee.view', 'attendance.punch.view'],
};

/** Report centre: the export datasets each department offers (the caller still needs the dataset's permission). */
const REPORTS: Record<Department, string[]> = {
  academics: ['classes', 'class_sections', 'lesson_plans', 'substitutions'],
  attendance: ['attendance_daily', 'class_sections'],
  fees: ['fee_dues', 'fee_receipts', 'fee_refunds', 'settlement_lines'],
  admissions: ['admissions_funnel'],
  transport: ['transport_riders', 'transport_vehicle_logs', 'transport_requests'],
  communication: ['comms_delivery', 'parent_queries'],
  hr: ['employees', 'members', 'assignments'],
};

export interface DepartmentCard {
  department: Department;
  allowed: boolean;
  reports: number;
}

const pct = (a: number, b: number): number | null =>
  b > 0 ? Math.round((a / b) * 1000) / 10 : null;
const money = (v: string | number | null | undefined) => Number(v ?? 0).toFixed(2);

/**
 * Sprint 13 (AI track): one dashboard and one report centre per department, computed in SQL from the marts
 * and the module tables, opened by the module permissions the caller already holds. Filters: the working
 * academic year (tenant), a date (defaults to today IST) and optionally a class.
 */
@Injectable()
export class DepartmentsService {
  constructor(private readonly db: DbService) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  allowed(ctx: RequestContext, dept: Department): boolean {
    const p = ctx.permissions;
    if (!p) return false;
    if (p.has('insights.dashboard.view')) return true;
    return GATES[dept].some((code) => p.has(code));
  }

  list(ctx: RequestContext): DepartmentCard[] {
    return DEPARTMENTS.map((d) => ({
      department: d,
      allowed: this.allowed(ctx, d),
      reports: REPORTS[d].filter((id) => ctx.permissions?.has(DATASETS[id]?.permission ?? ''))
        .length,
    }));
  }

  reports(ctx: RequestContext, dept: Department) {
    this.assert(ctx, dept);
    return REPORTS[dept]
      .map((id) => DATASETS[id])
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({
        id: d.id,
        title: d.title,
        permission: d.permission,
        allowed: ctx.permissions?.has(d.permission) ?? false,
        columns: d.columns.map((c) => c.header),
      }));
  }

  private assert(ctx: RequestContext, dept: Department): void {
    if (!this.allowed(ctx, dept))
      throw new DomainError(
        'permission-denied',
        `The ${dept} dashboard needs a ${dept} permission`,
        {
          status: 403,
          extra: { anyOf: GATES[dept] },
        },
      );
  }

  async dashboard(ctx: RequestContext, dept: Department, q: { date?: string; classId?: string }) {
    this.assert(ctx, dept);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const d = await c.query<{ day: string }>(
        `SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS day`,
        [q.date ?? null],
      );
      const day = d.rows[0]!.day;
      const y = await c.query<{ id: string; code: string; status: string }>(
        `SELECT id::text, code, status::text FROM academic_years WHERE id = $1`,
        [yearId],
      );
      const base = { department: dept, date: day, year: y.rows[0]!, classId: q.classId ?? null };
      switch (dept) {
        case 'academics':
          return { ...base, ...(await this.academics(c, yearId, day, q.classId ?? null)) };
        case 'attendance':
          return { ...base, ...(await this.attendance(c, yearId, day, q.classId ?? null)) };
        case 'fees':
          return { ...base, ...(await this.fees(c, yearId, day, q.classId ?? null)) };
        case 'admissions':
          return { ...base, ...(await this.admissions(c, yearId)) };
        case 'transport':
          return { ...base, ...(await this.transport(c, yearId, day)) };
        case 'communication':
          return { ...base, ...(await this.communication(c, yearId, day)) };
        case 'hr':
          return { ...base, ...(await this.hr(c, day)) };
      }
    });
  }

  private async academics(c: PoolClient, yearId: string, day: string, classId: string | null) {
    const work = await c.query<{ kind: string; n: number }>(
      `SELECT w.kind::text, count(*)::int AS n FROM daily_work w JOIN class_sections cs ON cs.id = w.class_section_id
        WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.assigned_on BETWEEN $2::date - 13 AND $2::date AND ($3::bigint IS NULL OR cs.class_id = $3)
        GROUP BY w.kind ORDER BY w.kind`,
      [yearId, day, classId],
    );
    const coverage = await c.query<{
      class_code: string;
      section: string;
      homework: number;
      subjects: number;
      last_on: string | null;
    }>(
      `SELECT k.code AS class_code, cs.name AS section,
              (SELECT count(*)::int FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL AND w.kind = 'homework' AND w.assigned_on BETWEEN $2::date - 6 AND $2::date) AS homework,
              (SELECT count(DISTINCT w.subject_id)::int FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL AND w.assigned_on BETWEEN $2::date - 6 AND $2::date) AS subjects,
              (SELECT max(w.assigned_on)::text FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL) AS last_on
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($3::bigint IS NULL OR cs.class_id = $3)
        ORDER BY k.display_order, cs.name`,
      [yearId, day, classId],
    );
    const plans = await c.query<{ status: string; n: number }>(
      `SELECT status::text, count(*)::int AS n FROM lesson_plans WHERE academic_year_id = $1 GROUP BY status ORDER BY status`,
      [yearId],
    );
    const lag = await c.query<{
      avg_hours: string | null;
      pending: number;
      oldest_hours: string | null;
    }>(
      `SELECT round(avg(extract(epoch FROM (i.completed_at - i.requested_at)) / 3600)::numeric, 1)::text AS avg_hours,
              count(*) FILTER (WHERE i.status = 'pending')::int AS pending,
              round(max(extract(epoch FROM (now() - i.requested_at)) / 3600) FILTER (WHERE i.status = 'pending')::numeric, 1)::text AS oldest_hours
         FROM lesson_plans lp JOIN workflow_instances i ON i.id = lp.workflow_instance_id WHERE lp.academic_year_id = $1`,
      [yearId],
    );
    const subs = await c.query<{ on_date: string; n: number }>(
      `SELECT on_date::text, count(*)::int AS n FROM timetable_substitutions WHERE academic_year_id = $1 AND on_date BETWEEN $2::date - 29 AND $2::date GROUP BY on_date ORDER BY on_date`,
      [yearId, day],
    );
    const absent = await c.query<{ name: string; n: number }>(
      `SELECT e.display_name AS name, count(*)::int AS n FROM timetable_substitutions s JOIN employees e ON e.id = s.absent_employee_id
        WHERE s.academic_year_id = $1 AND s.on_date BETWEEN $2::date - 29 AND $2::date GROUP BY e.display_name ORDER BY n DESC LIMIT 5`,
      [yearId, day],
    );
    return {
      work14d: work.rows,
      coverage: coverage.rows.map((r) => ({
        classCode: r.class_code,
        section: r.section,
        homework7d: r.homework,
        subjects7d: r.subjects,
        lastOn: r.last_on,
      })),
      sectionsWithoutHomework7d: coverage.rows.filter((r) => r.homework === 0).length,
      lessonPlans: plans.rows,
      approvalLag: {
        avgHours: lag.rows[0]?.avg_hours ? Number(lag.rows[0].avg_hours) : null,
        pending: lag.rows[0]?.pending ?? 0,
        oldestHours: lag.rows[0]?.oldest_hours ? Number(lag.rows[0].oldest_hours) : null,
      },
      substitutions30d: subs.rows.map((r) => ({ date: r.on_date, count: r.n })),
      mostSubstituted: absent.rows,
    };
  }

  private async attendance(c: PoolClient, yearId: string, day: string, classId: string | null) {
    const today = await c.query<{
      strength: number;
      present: number;
      absent: number;
      late: number;
      sections: number;
      marked: number;
    }>(
      `SELECT COALESCE(sum(strength) FILTER (WHERE marked), 0)::int AS strength, COALESCE(sum(present), 0)::int AS present, COALESCE(sum(absent), 0)::int AS absent,
              COALESCE(sum(late), 0)::int AS late, count(*)::int AS sections, count(*) FILTER (WHERE marked)::int AS marked
         FROM mart.attendance_daily WHERE academic_year_id = $1 AND on_date = $2::date AND ($3::bigint IS NULL OR class_id = $3)`,
      [yearId, day, classId],
    );
    const trend = await c.query<{ on_date: string; strength: number; present: number }>(
      `SELECT on_date::text, sum(strength)::int AS strength, sum(present)::int AS present FROM mart.attendance_daily
        WHERE academic_year_id = $1 AND marked AND on_date BETWEEN $2::date - 29 AND $2::date AND ($3::bigint IS NULL OR class_id = $3) GROUP BY on_date ORDER BY on_date`,
      [yearId, day, classId],
    );
    const bySection = await c.query<{
      class_code: string;
      section: string;
      strength: number;
      present: number;
      marked: boolean;
    }>(
      `SELECT k.code AS class_code, a.section, a.strength, a.present, a.marked FROM mart.attendance_daily a JOIN classes k ON k.id = a.class_id
        WHERE a.academic_year_id = $1 AND a.on_date = $2::date AND ($3::bigint IS NULL OR a.class_id = $3) ORDER BY k.display_order, a.section`,
      [yearId, day, classId],
    );
    const chronic = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      section: string | null;
      absences: number;
      days: number;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no,
              (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section,
              count(*) FILTER (WHERE m.code = 'A')::int AS absences, count(*)::int AS days
         FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN students s ON s.id = m.student_id
        WHERE a.academic_year_id = $1 AND a.kind = 'day' AND a.on_date BETWEEN $2::date - 29 AND $2::date
        GROUP BY s.id HAVING count(*) FILTER (WHERE m.code = 'A') >= 5 ORDER BY absences DESC LIMIT 20`,
      [yearId, day],
    );
    const readers = await c.query<{
      code: string;
      name: string;
      direction: string;
      last_seen_at: Date | null;
      silent_hours: string | null;
      taps_today: number;
    }>(
      `SELECT d.code, d.name, d.direction::text, d.last_seen_at, round(extract(epoch FROM (now() - d.last_seen_at)) / 3600)::text AS silent_hours,
              (SELECT count(*)::int FROM rfid_events e WHERE e.device_id = d.id AND (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS taps_today
         FROM rfid_devices d WHERE d.status = 'active' ORDER BY d.code`,
      [day],
    );
    const t = today.rows[0]!;
    return {
      today: { ...t, pct: pct(t.present, t.strength) },
      trend30d: trend.rows.map((r) => ({
        date: r.on_date,
        pct: pct(r.present, r.strength),
        strength: r.strength,
        present: r.present,
      })),
      bySection: bySection.rows.map((r) => ({
        classCode: r.class_code,
        section: r.section,
        strength: r.strength,
        present: r.present,
        marked: r.marked,
        pct: r.marked ? pct(r.present, r.strength) : null,
      })),
      chronicAbsentees30d: chronic.rows.map((r) => ({
        studentId: r.student_id,
        name: r.name,
        admissionNo: r.admission_no,
        section: r.section,
        absences: r.absences,
        days: r.days,
      })),
      readers: readers.rows.map((r) => ({
        code: r.code,
        name: r.name,
        direction: r.direction,
        lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
        silentHours: r.silent_hours ? Number(r.silent_hours) : null,
        tapsToday: r.taps_today,
      })),
    };
  }

  private async fees(c: PoolClient, yearId: string, day: string, classId: string | null) {
    const dues = await c.query<{
      due: string;
      collected: string;
      balance: string;
      students: number;
      defaulters: number;
    }>(
      `SELECT COALESCE(sum(net), 0)::text AS due, COALESCE(sum(paid), 0)::text AS collected, COALESCE(sum(balance), 0)::text AS balance,
              count(DISTINCT student_id)::int AS students, count(DISTINCT student_id) FILTER (WHERE balance > 0 AND due_on < $2::date)::int AS defaulters
         FROM mart.fee_dues WHERE academic_year_id = $1 AND due_on <= $2::date AND ($3::bigint IS NULL OR class_id = $3)`,
      [yearId, day, classId],
    );
    const ageing = await c.query<{ bucket: string; balance: string; students: number }>(
      `SELECT bucket, sum(balance)::text AS balance, count(DISTINCT student_id)::int AS students FROM mart.fee_dues
        WHERE academic_year_id = $1 AND balance > 0 AND ($2::bigint IS NULL OR class_id = $2) GROUP BY bucket`,
      [yearId, classId],
    );
    const order = ['current', '1-30', '31-60', '61-90', '90+'];
    const coll = await c.query<{
      today: string;
      d7: string;
      d30: string;
      p30: string;
      receipts_today: number;
    }>(
      `SELECT COALESCE(sum(amount) FILTER (WHERE received_on = $2::date), 0)::text AS today,
              COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 6 AND $2::date), 0)::text AS d7,
              COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 29 AND $2::date), 0)::text AS d30,
              COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $2::date - 59 AND $2::date - 30), 0)::text AS p30,
              COALESCE(sum(receipts) FILTER (WHERE received_on = $2::date), 0)::int AS receipts_today
         FROM mart.fee_collection_daily WHERE academic_year_id = $1`,
      [yearId, day],
    );
    const byMode = await c.query<{ mode: string; amount: string; receipts: number }>(
      `SELECT mode, sum(amount)::text AS amount, sum(receipts)::int AS receipts FROM mart.fee_collection_daily
        WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - 29 AND $2::date GROUP BY mode ORDER BY sum(amount) DESC`,
      [yearId, day],
    );
    const daily = await c.query<{ date: string; amount: string }>(
      `SELECT received_on::text AS date, sum(amount)::text AS amount FROM mart.fee_collection_daily
        WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - 29 AND $2::date GROUP BY received_on ORDER BY received_on`,
      [yearId, day],
    );
    const lateFee = await c.query<{ posted30d: string; outstanding_students: number }>(
      `SELECT COALESCE((SELECT sum(l.amount) FROM fee_late_fee_postings l JOIN fee_payments p ON p.id = l.payment_id WHERE l.academic_year_id = $1 AND p.received_on BETWEEN $2::date - 29 AND $2::date), 0)::text AS posted30d,
              (SELECT count(DISTINCT student_id)::int FROM mart.fee_dues WHERE academic_year_id = $1 AND balance > 0 AND due_on < $2::date) AS outstanding_students`,
      [yearId, day],
    );
    const refunds = await c.query<{ status: string; n: number; amount: string }>(
      `SELECT r.status::text, count(*)::int AS n, sum(r.amount)::text AS amount FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id
        WHERE p.academic_year_id = $1 GROUP BY r.status ORDER BY r.status`,
      [yearId],
    );
    const settlements = await c.query<{
      unmatched: number;
      mismatched: number;
      unsettled_online: string;
    }>(
      `SELECT COALESCE(sum(unmatched), 0)::int AS unmatched, COALESCE(sum(mismatched), 0)::int AS mismatched,
              (SELECT COALESCE(sum(p.amount), 0)::text FROM fee_payments p WHERE p.academic_year_id = $1 AND p.mode = 'online' AND p.settlement_line_id IS NULL) AS unsettled_online
         FROM payment_settlements`,
      [yearId],
    );
    const defaulters = await c.query<{
      student_id: string;
      student_name: string;
      admission_no: string;
      section: string | null;
      balance: string;
      days_overdue: number;
    }>(
      `SELECT student_id::text, student_name, admission_no, section, sum(balance)::text AS balance, max(days_overdue)::int AS days_overdue
         FROM mart.fee_dues WHERE academic_year_id = $1 AND balance > 0 AND due_on < $2::date AND ($3::bigint IS NULL OR class_id = $3)
        GROUP BY student_id, student_name, admission_no, section ORDER BY sum(balance) DESC LIMIT 20`,
      [yearId, day, classId],
    );
    const byClass = await c.query<{
      class_code: string;
      net: string;
      paid: string;
      balance: string;
      students: number;
    }>(
      `SELECT COALESCE(k.code, '—') AS class_code, sum(f.net)::text AS net, sum(f.paid)::text AS paid, sum(f.balance)::text AS balance, count(DISTINCT f.student_id)::int AS students
         FROM mart.fee_dues f LEFT JOIN classes k ON k.id = f.class_id WHERE f.academic_year_id = $1 AND f.due_on <= $2::date
        GROUP BY k.code, k.display_order ORDER BY k.display_order NULLS LAST`,
      [yearId, day],
    );
    const dd = dues.rows[0]!;
    const cc = coll.rows[0]!;
    return {
      dues: {
        dueTillDate: money(dd.due),
        collectedTillDate: money(dd.collected),
        balance: money(dd.balance),
        students: dd.students,
        defaulters: dd.defaulters,
        pctCollected: pct(Number(dd.collected), Number(dd.due)),
      },
      ageing: order.map((b) => {
        const r = ageing.rows.find((x) => x.bucket === b);
        return { bucket: b, balance: money(r?.balance), students: r?.students ?? 0 };
      }),
      collection: {
        today: money(cc.today),
        receiptsToday: cc.receipts_today,
        d7: money(cc.d7),
        d30: money(cc.d30),
        previous30: money(cc.p30),
      },
      byMode30d: byMode.rows.map((r) => ({
        mode: r.mode,
        amount: money(r.amount),
        receipts: r.receipts,
      })),
      daily30d: daily.rows.map((r) => ({ date: r.date, amount: money(r.amount) })),
      lateFee: {
        posted30d: money(lateFee.rows[0]?.posted30d),
        overdueStudents: lateFee.rows[0]?.outstanding_students ?? 0,
      },
      refunds: refunds.rows.map((r) => ({ status: r.status, count: r.n, amount: money(r.amount) })),
      settlements: {
        unmatchedLines: settlements.rows[0]?.unmatched ?? 0,
        mismatchedLines: settlements.rows[0]?.mismatched ?? 0,
        unsettledOnline: money(settlements.rows[0]?.unsettled_online),
      },
      defaulters: defaulters.rows.map((r) => ({
        studentId: r.student_id,
        name: r.student_name,
        admissionNo: r.admission_no,
        section: r.section,
        balance: money(r.balance),
        daysOverdue: r.days_overdue,
      })),
      byClass: byClass.rows.map((r) => ({
        classCode: r.class_code,
        net: money(r.net),
        paid: money(r.paid),
        balance: money(r.balance),
        students: r.students,
      })),
    };
  }

  private async admissions(c: PoolClient, yearId: string) {
    const funnel = await c.query<{
      cycle_id: string;
      cycle_code: string;
      cycle_status: string;
      class_code: string;
      status: string;
      applications: number;
    }>(
      `SELECT cycle_id::text, cycle_code, cycle_status, class_code, status, applications FROM mart.admissions_funnel ORDER BY cycle_code, class_code, status`,
    );
    const cycles = new Map<
      string,
      {
        cycleId: string;
        code: string;
        status: string;
        total: number;
        byStatus: Record<string, number>;
        byClass: Record<string, number>;
      }
    >();
    for (const r of funnel.rows) {
      const k = cycles.get(r.cycle_id) ?? {
        cycleId: r.cycle_id,
        code: r.cycle_code,
        status: r.cycle_status,
        total: 0,
        byStatus: {},
        byClass: {},
      };
      k.total += r.applications;
      k.byStatus[r.status] = (k.byStatus[r.status] ?? 0) + r.applications;
      k.byClass[r.class_code] = (k.byClass[r.class_code] ?? 0) + r.applications;
      cycles.set(r.cycle_id, k);
    }
    const conversion = await c.query<{
      cycle_code: string;
      submitted: number;
      selected: number;
      admitted: number;
      avg_days: string | null;
    }>(
      `SELECT cy.code AS cycle_code, count(*) FILTER (WHERE a.submitted_at IS NOT NULL)::int AS submitted,
              count(*) FILTER (WHERE a.status = 'selected')::int AS selected, count(*) FILTER (WHERE a.student_id IS NOT NULL)::int AS admitted,
              round(avg(extract(epoch FROM (a.decided_at - a.submitted_at)) / 86400)::numeric, 1)::text AS avg_days
         FROM applications a JOIN admission_cycles cy ON cy.id = a.cycle_id GROUP BY cy.code ORDER BY cy.code`,
    );
    const seats = await c.query<{ class_code: string; capacity: number; enrolled: number }>(
      `SELECT k.code AS class_code, COALESCE(sum(cs.capacity), 0)::int AS capacity,
              (SELECT count(*)::int FROM enrolments e JOIN class_sections x ON x.id = e.class_section_id WHERE x.class_id = k.id AND e.academic_year_id = $1 AND e.status = 'active') AS enrolled
         FROM classes k JOIN class_sections cs ON cs.class_id = k.id AND cs.academic_year_id = $1 AND cs.deleted_at IS NULL
        WHERE k.deleted_at IS NULL GROUP BY k.id, k.code, k.display_order ORDER BY k.display_order`,
      [yearId],
    );
    return {
      cycles: [...cycles.values()],
      conversion: conversion.rows.map((r) => ({
        cycle: r.cycle_code,
        submitted: r.submitted,
        selected: r.selected,
        admitted: r.admitted,
        avgDecisionDays: r.avg_days ? Number(r.avg_days) : null,
      })),
      seatFill: seats.rows.map((r) => ({
        classCode: r.class_code,
        capacity: r.capacity,
        enrolled: r.enrolled,
        pct: pct(r.enrolled, r.capacity),
      })),
    };
  }

  private async transport(c: PoolClient, yearId: string, day: string) {
    const routes = await c.query<{
      id: string;
      code: string;
      name: string;
      riders: number;
      capacity: number | null;
      boarded: number;
      alighted: number;
      late: number;
      late_after: string | null;
    }>(
      `SELECT r.id::text, r.code, r.name, v.capacity, to_char(r.late_after, 'HH24:MI') AS late_after,
              (SELECT count(*)::int FROM student_route_assignments a WHERE a.route_id = r.id AND a.academic_year_id = $1) AS riders,
              (SELECT count(*)::int FROM bus_attendance b WHERE b.route_id = r.id AND b.on_date = $2::date AND b.outcome IN ('boarded', 'bus_boarded', 'late_boarding')) AS boarded,
              (SELECT count(*)::int FROM bus_attendance b WHERE b.route_id = r.id AND b.on_date = $2::date AND b.outcome IN ('alighted', 'bus_alighted')) AS alighted,
              (SELECT count(*)::int FROM bus_attendance b WHERE b.route_id = r.id AND b.on_date BETWEEN $2::date - 6 AND $2::date AND b.outcome = 'late_boarding') AS late
         FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id WHERE r.deleted_at IS NULL ORDER BY r.code`,
      [yearId, day],
    );
    const requests = await c.query<{ status: string; n: number }>(
      `SELECT status::text, count(*)::int AS n FROM transport_requests WHERE academic_year_id = $1 GROUP BY status`,
      [yearId],
    );
    const expiries = await c.query<{ kind: string; ref: string; what: string; on_date: string }>(
      `SELECT * FROM (
         SELECT 'vehicle' AS kind, reg_no AS ref, 'insurance' AS what, insurance_expiry::text AS on_date FROM transport_vehicles WHERE deleted_at IS NULL AND insurance_expiry IS NOT NULL
         UNION ALL SELECT 'vehicle', reg_no, 'fitness', fitness_expiry::text FROM transport_vehicles WHERE deleted_at IS NULL AND fitness_expiry IS NOT NULL
         UNION ALL SELECT 'vehicle', reg_no, 'permit', permit_expiry::text FROM transport_vehicles WHERE deleted_at IS NULL AND permit_expiry IS NOT NULL
         UNION ALL SELECT 'driver', name, 'licence', licence_expiry::text FROM transport_drivers WHERE deleted_at IS NULL AND licence_expiry IS NOT NULL
       ) x WHERE on_date::date <= $1::date + 60 ORDER BY on_date`,
      [day],
    );
    const logs = await c.query<{
      reg_no: string;
      days: number;
      km: number | null;
      fuel: string | null;
      cost: string | null;
      incidents: number;
    }>(
      `SELECT v.reg_no, count(*)::int AS days, sum(l.odometer_end - l.odometer_start)::int AS km, sum(l.fuel_litres)::text AS fuel, sum(l.fuel_cost)::text AS cost,
              count(*) FILTER (WHERE l.incident IS NOT NULL AND l.incident <> '')::int AS incidents
         FROM transport_vehicle_logs l JOIN transport_vehicles v ON v.id = l.vehicle_id WHERE l.log_date BETWEEN $1::date - 29 AND $1::date GROUP BY v.reg_no ORDER BY v.reg_no`,
      [day],
    );
    return {
      routes: routes.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        riders: r.riders,
        capacity: r.capacity,
        loadPct: r.capacity ? pct(r.riders, r.capacity) : null,
        boardedToday: r.boarded,
        alightedToday: r.alighted,
        lateBoarding7d: r.late,
        lateAfter: r.late_after,
      })),
      requests: requests.rows.map((r) => ({ status: r.status, count: r.n })),
      expiring60d: expiries.rows.map((r) => ({
        kind: r.kind,
        ref: r.ref,
        what: r.what,
        on: r.on_date,
      })),
      logs30d: logs.rows.map((r) => ({
        regNo: r.reg_no,
        days: r.days,
        km: r.km,
        fuelLitres: r.fuel,
        fuelCost: r.cost,
        incidents: r.incidents,
      })),
    };
  }

  private async communication(c: PoolClient, yearId: string, day: string) {
    const delivery = await c.query<{ channel: string; status: string; messages: number }>(
      `SELECT channel, status, sum(messages)::int AS messages FROM mart.comms_delivery_daily WHERE on_date BETWEEN $1::date - 29 AND $1::date GROUP BY channel, status ORDER BY channel, status`,
      [day],
    );
    const consents = await c.query<{ purpose: string; status: string; n: number }>(
      `SELECT purpose_code AS purpose, status::text, count(*)::int AS n FROM consents GROUP BY purpose_code, status ORDER BY purpose_code, status`,
    );
    const families = await c.query<{ n: number }>(
      `SELECT count(DISTINCT g.user_id)::int AS n FROM guardians g WHERE g.user_id IS NOT NULL AND g.deleted_at IS NULL`,
    );
    const queries = await c.query<{
      open: number;
      closed30d: number;
      avg_first_response_hours: string | null;
      avg_close_days: string | null;
      rating: string | null;
    }>(
      `SELECT count(*) FILTER (WHERE closed_at IS NULL)::int AS open,
              count(*) FILTER (WHERE closed_at BETWEEN $2::date - 29 AND $2::date + 1)::int AS closed30d,
              round(avg(extract(epoch FROM (first_response_at - opened_at)) / 3600)::numeric, 1)::text AS avg_first_response_hours,
              round(avg(extract(epoch FROM (closed_at - opened_at)) / 86400)::numeric, 1)::text AS avg_close_days,
              round(avg(rating)::numeric, 2)::text AS rating
         FROM parent_queries WHERE academic_year_id = $1`,
      [yearId, day],
    );
    const byCategory = await c.query<{ category: string; open: number; total: number }>(
      `SELECT category_code AS category, count(*) FILTER (WHERE closed_at IS NULL)::int AS open, count(*)::int AS total FROM parent_queries WHERE academic_year_id = $1 GROUP BY category_code ORDER BY total DESC`,
      [yearId],
    );
    const q = queries.rows[0]!;
    return {
      delivery30d: delivery.rows,
      consents: consents.rows,
      families: families.rows[0]?.n ?? 0,
      queries: {
        open: q.open,
        closed30d: q.closed30d,
        avgFirstResponseHours: q.avg_first_response_hours
          ? Number(q.avg_first_response_hours)
          : null,
        avgCloseDays: q.avg_close_days ? Number(q.avg_close_days) : null,
        rating: q.rating ? Number(q.rating) : null,
      },
      queriesByCategory: byCategory.rows,
    };
  }

  private async hr(c: PoolClient, day: string) {
    const headcount = await c.query<{
      department: string | null;
      employee_type: string | null;
      n: number;
    }>(
      `SELECT department, employee_type::text, count(*)::int AS n FROM employees WHERE deleted_at IS NULL AND status = 'active' GROUP BY department, employee_type ORDER BY department NULLS LAST, employee_type`,
    );
    const moves = await c.query<{ joined: number; left: number; active: number }>(
      `SELECT count(*) FILTER (WHERE joined_on BETWEEN $1::date - 364 AND $1::date)::int AS joined, count(*) FILTER (WHERE left_on BETWEEN $1::date - 364 AND $1::date)::int AS left,
              count(*) FILTER (WHERE status = 'active')::int AS active FROM employees WHERE deleted_at IS NULL`,
      [day],
    );
    const punches = await c.query<{ present: number; first_in: string | null }>(
      `SELECT count(DISTINCT employee_id)::int AS present, to_char(min(punched_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:MI') AS first_in
         FROM punch_logs WHERE employee_id IS NOT NULL AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`,
      [day],
    );
    const punchTrend = await c.query<{ on_date: string; present: number }>(
      `SELECT (punched_at AT TIME ZONE 'Asia/Kolkata')::date::text AS on_date, count(DISTINCT employee_id)::int AS present FROM punch_logs
        WHERE employee_id IS NOT NULL AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date - 13 AND $1::date GROUP BY 1 ORDER BY 1`,
      [day],
    );
    const designations = await c.query<{ designation: string | null; n: number }>(
      `SELECT designation, count(*)::int AS n FROM employees WHERE deleted_at IS NULL AND status = 'active' GROUP BY designation ORDER BY n DESC LIMIT 12`,
    );
    const m = moves.rows[0]!;
    return {
      headcount: headcount.rows.map((r) => ({
        department: r.department ?? '—',
        type: r.employee_type ?? '—',
        count: r.n,
      })),
      active: m.active,
      joined12m: m.joined,
      left12m: m.left,
      punchesToday: {
        present: punches.rows[0]?.present ?? 0,
        firstIn: punches.rows[0]?.first_in ?? null,
        pct: pct(punches.rows[0]?.present ?? 0, m.active),
      },
      punchTrend14d: punchTrend.rows.map((r) => ({ date: r.on_date, present: r.present })),
      designations: designations.rows.map((r) => ({
        designation: r.designation ?? '—',
        count: r.n,
      })),
    };
  }
}
