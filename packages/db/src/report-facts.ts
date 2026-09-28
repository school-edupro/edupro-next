import type { PoolClient } from 'pg';

/**
 * Sprint 16 (AI track): facts before words. Every number an AI report may mention comes from a named query
 * here, run under the school's tenant context, so a narrative can cite `[fact.id]` and a reader can check
 * it. The model never sees a table, only these facts.
 */
export interface ReportFact {
  id: string;
  label: string;
  value: string | number | null;
  unit?: string;
  /** Comparison or breakdown a sentence may use. */
  detail?: Record<string, string | number | null>;
}

export type ReportDepartment = 'academics' | 'attendance' | 'fees' | 'communication';
export interface ReportScope {
  kind: 'principal_brief' | 'department_weekly';
  department?: ReportDepartment;
  /** Inclusive period (YYYY-MM-DD). */
  from: string;
  to: string;
}

const money = (v: unknown) => (v === null || v === undefined ? null : Number(Number(v).toFixed(2)));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const shift = (d: string, days: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};

async function attendanceFacts(c: PoolClient, from: string, to: string): Promise<ReportFact[]> {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const pf = shift(from, -days);
  const pt = shift(to, -days);
  const r = await c.query<{
    pct: string | null;
    prev_pct: string | null;
    strength: string;
    marked_days: string;
    unmarked: string;
  }>(
    `SELECT round(sum(present) FILTER (WHERE marked AND on_date BETWEEN $1 AND $2)::numeric * 100 / NULLIF(sum(strength) FILTER (WHERE marked AND on_date BETWEEN $1 AND $2), 0), 1)::text AS pct,
            round(sum(present) FILTER (WHERE marked AND on_date BETWEEN $3 AND $4)::numeric * 100 / NULLIF(sum(strength) FILTER (WHERE marked AND on_date BETWEEN $3 AND $4), 0), 1)::text AS prev_pct,
            max(strength)::text AS strength,
            count(DISTINCT on_date) FILTER (WHERE marked AND on_date BETWEEN $1 AND $2)::text AS marked_days,
            count(*) FILTER (WHERE NOT marked AND on_date BETWEEN $1 AND $2 AND on_date < CURRENT_DATE)::text AS unmarked
       FROM mart.attendance_daily`,
    [from, to, pf, pt],
  );
  const low = await c.query<{ section: string; pct: string }>(
    `SELECT section, round(sum(present)::numeric * 100 / NULLIF(sum(strength), 0), 1)::text AS pct FROM mart.attendance_daily
      WHERE marked AND on_date BETWEEN $1 AND $2 GROUP BY section HAVING sum(strength) > 0 AND sum(present)::numeric * 100 / sum(strength) < 85
      ORDER BY 2 LIMIT 5`,
    [from, to],
  );
  const chronic = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT m.student_id FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
        WHERE a.kind = 'day' AND a.on_date BETWEEN $1 AND $2 GROUP BY m.student_id HAVING count(*) FILTER (WHERE m.code = 'A') >= 3) x`,
    [from, to],
  );
  const x = r.rows[0]!;
  return [
    {
      id: 'attendance.pct',
      label: 'Attendance for the period',
      value: num(x.pct),
      unit: '%',
      detail: { previousPeriod: num(x.prev_pct), markedDays: num(x.marked_days) },
    },
    {
      id: 'attendance.unmarked_sessions',
      label: 'Section-days left unmarked',
      value: num(x.unmarked),
    },
    {
      id: 'attendance.low_sections',
      label: 'Sections under 85%',
      value: low.rows.length,
      detail: Object.fromEntries(low.rows.map((s) => [s.section, num(s.pct)])),
    },
    {
      id: 'attendance.chronic_absentees',
      label: 'Pupils absent three days or more',
      value: num(chronic.rows[0]!.n),
    },
  ];
}

async function feeFacts(c: PoolClient, from: string, to: string): Promise<ReportFact[]> {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const pf = shift(from, -days);
  const pt = shift(to, -days);
  const col = await c.query<{ amount: string; receipts: string; prev: string }>(
    `SELECT COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $1 AND $2), 0)::text AS amount,
            COALESCE(sum(receipts) FILTER (WHERE received_on BETWEEN $1 AND $2), 0)::text AS receipts,
            COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN $3 AND $4), 0)::text AS prev
       FROM mart.fee_collection_daily`,
    [from, to, pf, pt],
  );
  const mode = await c.query<{ mode: string; amount: string }>(
    `SELECT mode, sum(amount)::text AS amount FROM mart.fee_collection_daily WHERE received_on BETWEEN $1 AND $2 GROUP BY mode ORDER BY 2 DESC`,
    [from, to],
  );
  const dues = await c.query<{ balance: string; students: string; over90: string }>(
    `SELECT COALESCE(sum(balance) FILTER (WHERE due_on <= $1), 0)::text AS balance, count(DISTINCT student_id) FILTER (WHERE balance > 0 AND due_on < $1)::text AS students,
            COALESCE(sum(balance) FILTER (WHERE bucket = '90+'), 0)::text AS over90
       FROM mart.fee_dues WHERE balance > 0`,
    [to],
  );
  const rem = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM fee_reminders WHERE sent_on BETWEEN $1 AND $2`,
    [from, to],
  );
  const x = col.rows[0]!;
  const d = dues.rows[0]!;
  return [
    {
      id: 'fees.collected',
      label: 'Collected in the period',
      value: money(x.amount),
      unit: '₹',
      detail: { receipts: num(x.receipts), previousPeriod: money(x.prev) },
    },
    {
      id: 'fees.by_mode',
      label: 'Collection by mode',
      value: mode.rows.length,
      detail: Object.fromEntries(mode.rows.map((m) => [m.mode, money(m.amount)])),
    },
    {
      id: 'fees.overdue_balance',
      label: 'Overdue balance at period end',
      value: money(d.balance),
      unit: '₹',
      detail: { defaulters: num(d.students), over90Days: money(d.over90) },
    },
    { id: 'fees.reminders', label: 'Fee reminders sent', value: num(rem.rows[0]!.n) },
  ];
}

async function academicsFacts(c: PoolClient, from: string, to: string): Promise<ReportFact[]> {
  const work = await c.query<{ homework: string; all_work: string; silent: string }>(
    `SELECT count(*) FILTER (WHERE kind = 'homework')::text AS homework, count(*)::text AS all_work,
            (SELECT count(*) FROM class_sections cs WHERE cs.deleted_at IS NULL AND cs.status = 'active' AND cs.academic_year_id = app.current_academic_year_id()
               AND NOT EXISTS (SELECT 1 FROM daily_work w2 WHERE w2.class_section_id = cs.id AND w2.deleted_at IS NULL AND w2.assigned_on BETWEEN $1 AND $2))::text AS silent
       FROM daily_work w WHERE w.deleted_at IS NULL AND w.assigned_on BETWEEN $1 AND $2`,
    [from, to],
  );
  const marks = await c.query<{ pending: string; exams: string }>(
    `SELECT count(*) FILTER (WHERE NOT es.entry_locked AND (SELECT count(*) FROM mark_entries m WHERE m.exam_subject_id = es.id) = 0)::text AS pending, count(DISTINCT es.exam_id)::text AS exams
       FROM exam_subjects es JOIN exams e ON e.id = es.exam_id WHERE e.deleted_at IS NULL AND e.academic_year_id = app.current_academic_year_id() AND e.ends_on <= $1::date + 30`,
    [to],
  );
  const w = work.rows[0]!;
  return [
    {
      id: 'academics.work_posted',
      label: 'Homework and classwork posted',
      value: num(w.all_work),
      detail: { homework: num(w.homework) },
    },
    {
      id: 'academics.silent_sections',
      label: 'Sections with nothing posted',
      value: num(w.silent),
    },
    {
      id: 'academics.marks_pending',
      label: 'Exam subjects with no marks entered',
      value: num(marks.rows[0]!.pending),
      detail: { exams: num(marks.rows[0]!.exams) },
    },
  ];
}

async function communicationFacts(c: PoolClient, from: string, to: string): Promise<ReportFact[]> {
  const d = await c.query<{ status: string; n: string }>(
    `SELECT status, sum(messages)::text AS n FROM mart.comms_delivery_daily WHERE on_date BETWEEN $1 AND $2 GROUP BY status`,
    [from, to],
  );
  const q = await c.query<{ open: string; opened: string; avg_hours: string | null }>(
    `SELECT count(*) FILTER (WHERE closed_at IS NULL)::text AS open, count(*) FILTER (WHERE opened_at::date BETWEEN $1 AND $2)::text AS opened,
            round(avg(extract(epoch FROM first_response_at - opened_at) / 3600) FILTER (WHERE first_response_at IS NOT NULL AND opened_at::date BETWEEN $1 AND $2), 1)::text AS avg_hours
       FROM parent_queries`,
    [from, to],
  );
  const by = Object.fromEntries(d.rows.map((x) => [x.status, num(x.n)]));
  const sent = (by.sent ?? 0) + (by.delivered ?? 0);
  const total = sent + (by.failed ?? 0);
  return [
    {
      id: 'comms.delivery',
      label: 'Messages delivered',
      value: sent,
      detail: {
        failed: by.failed ?? 0,
        queued: by.queued ?? 0,
        deliveryRatePct: total ? Math.round((sent * 1000) / total) / 10 : null,
      },
    },
    {
      id: 'comms.queries',
      label: 'Parent queries opened',
      value: num(q.rows[0]!.opened),
      detail: { stillOpen: num(q.rows[0]!.open), avgFirstResponseHours: num(q.rows[0]!.avg_hours) },
    },
  ];
}

async function schoolFacts(c: PoolClient, from: string, to: string): Promise<ReportFact[]> {
  const alerts = await c.query<{ open: string; kinds: string | null }>(
    `SELECT count(*) FILTER (WHERE acked_at IS NULL)::text AS open, string_agg(DISTINCT kind, ', ') AS kinds FROM insight_alerts WHERE detected_on BETWEEN $1 AND $2`,
    [from, to],
  );
  return [
    {
      id: 'school.open_alerts',
      label: 'Open anomaly alerts',
      value: num(alerts.rows[0]!.open),
      detail: { kinds: alerts.rows[0]!.kinds },
    },
  ];
}

/** Collects the facts for a scope; the principal's brief takes every department's headline facts. */
export async function collectReportFacts(c: PoolClient, scope: ReportScope): Promise<ReportFact[]> {
  const { from, to } = scope;
  if (scope.kind === 'department_weekly') {
    switch (scope.department) {
      case 'attendance':
        return attendanceFacts(c, from, to);
      case 'fees':
        return feeFacts(c, from, to);
      case 'academics':
        return academicsFacts(c, from, to);
      case 'communication':
        return communicationFacts(c, from, to);
      default:
        throw new Error(`unknown department ${String(scope.department)}`);
    }
  }
  const [a, f, ac, co, s] = await Promise.all([
    attendanceFacts(c, from, to),
    feeFacts(c, from, to),
    academicsFacts(c, from, to),
    communicationFacts(c, from, to),
    schoolFacts(c, from, to),
  ]);
  return [...a, ...f, ...ac, ...co, ...s];
}

export const REPORT_DEPARTMENTS: ReportDepartment[] = [
  'academics',
  'attendance',
  'fees',
  'communication',
];
