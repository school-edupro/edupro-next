import type { PoolClient } from '@edupro/db';

/**
 * Query catalogue v1 (Sprint 14, design 07 principle 2): the only way the assistant reads school data.
 * Every entry is a parameterised SQL query over the marts and module tables, run inside the caller's tenant
 * transaction (RLS) after the caller's permissions were checked against `anyOf`. The model chooses an entry
 * and its parameters; it never writes SQL. Titles carry Hindi so the assistant can name its sources in
 * either language.
 */
export type ParamType =
  'date' | 'classId' | 'sectionId' | 'studentId' | 'days' | 'limit' | 'text' | 'amount';

export interface CatalogueParam {
  name: string;
  type: ParamType;
  description: string;
  required?: boolean;
}

export interface CatalogueEntry {
  id: string;
  department:
    | 'academics'
    | 'attendance'
    | 'fees'
    | 'admissions'
    | 'transport'
    | 'communication'
    | 'hr'
    | 'exams'
    | 'school';
  title: string;
  titleHi: string;
  description: string;
  /** the caller needs one of these permissions */
  anyOf: string[];
  params: CatalogueParam[];
  /** words that hint this entry (the offline mock router and the "nearest entries" refusal use them) */
  keywords: string[];
  sql: (p: Record<string, unknown>) => { text: string; values: unknown[] };
  maxRows?: number;
}

export interface CatalogueContext {
  academicYearId: string;
  today: string;
}

const s = (v: unknown, fallback: string | null = null): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback;
const n = (v: unknown, fallback: number): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.min(Math.floor(x), 500) : fallback;
};
const date = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;

const CLASS = {
  name: 'classId',
  type: 'classId',
  description: 'Limit to one class (id from list_classes)',
} as const;
const SECTION = {
  name: 'sectionId',
  type: 'sectionId',
  description: 'Limit to one section (id from list_classes)',
} as const;
const DATE = {
  name: 'date',
  type: 'date',
  description: 'The day (YYYY-MM-DD); defaults to today',
} as const;
const DAYS = {
  name: 'days',
  type: 'days',
  description: 'How many days back (default 30)',
} as const;
const LIMIT = {
  name: 'limit',
  type: 'limit',
  description: 'Rows to return (default 20, at most 200)',
} as const;

/** Builds the catalogue for one call; the year and today come from the tenant, never from the model. */
export function buildCatalogue(ctx: CatalogueContext): CatalogueEntry[] {
  const Y = ctx.academicYearId;
  const T = ctx.today;
  return [
    // ---- school -----------------------------------------------------------------------------------
    {
      id: 'list_classes',
      department: 'school',
      title: 'Classes and sections of the session',
      titleHi: 'सत्र की कक्षाएँ और अनुभाग',
      description:
        'Every class and section with its strength; use it to find ids for other queries.',
      anyOf: [
        'academics.class.view',
        'academics.class_section.view',
        'people.student.view',
        'attendance.session.view',
        'fees.ledger.view',
      ],
      params: [],
      keywords: ['class', 'section', 'strength', 'कक्षा', 'अनुभाग'],
      sql: () => ({
        text: `SELECT k.id::text AS class_id, k.code AS class, cs.id::text AS section_id, cs.name AS section,
                      (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS strength
                 FROM class_sections cs JOIN classes k ON k.id = cs.class_id
                WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY k.display_order, cs.name`,
        values: [Y],
      }),
    },
    {
      id: 'find_student',
      department: 'school',
      title: 'Find a student by name or admission number',
      titleHi: 'नाम या प्रवेश संख्या से विद्यार्थी खोजें',
      description: 'Students matching a name fragment or admission number, with their section.',
      anyOf: ['people.student.view', 'fees.ledger.view', 'attendance.session.view'],
      params: [
        {
          name: 'q',
          type: 'text',
          description: 'Name fragment or admission number',
          required: true,
        },
        LIMIT,
      ],
      keywords: ['student', 'find', 'who is', 'admission number', 'विद्यार्थी', 'खोज'],
      sql: (p) => ({
        text: `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no,
                      (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section
                 FROM students s WHERE s.deleted_at IS NULL AND (s.display_name ILIKE '%' || $2 || '%' OR s.admission_no ILIKE $2 || '%')
                ORDER BY s.display_name LIMIT $3`,
        values: [Y, s(p.q, ''), n(p.limit, 20)],
      }),
    },
    // ---- attendance -------------------------------------------------------------------------------
    {
      id: 'attendance_today',
      department: 'attendance',
      title: 'Attendance of a day by class',
      titleHi: 'दिन की उपस्थिति, कक्षा अनुसार',
      description:
        'Strength, present, absent and late per class for one day, with unmarked sections.',
      anyOf: ['attendance.session.view', 'insights.dashboard.view'],
      params: [DATE, CLASS],
      keywords: ['attendance', 'present', 'absent', 'today', 'उपस्थिति', 'अनुपस्थित'],
      sql: (p) => ({
        text: `SELECT k.code AS class, a.section, a.strength, a.present, a.absent, a.late, a.marked,
                      CASE WHEN a.marked AND a.strength > 0 THEN round(a.present::numeric * 100 / a.strength, 1) END AS pct
                 FROM mart.attendance_daily a JOIN classes k ON k.id = a.class_id
                WHERE a.academic_year_id = $1 AND a.on_date = $2::date AND ($3::bigint IS NULL OR a.class_id = $3)
                ORDER BY k.display_order, a.section`,
        values: [Y, date(p.date, T), s(p.classId)],
      }),
    },
    {
      id: 'attendance_trend',
      department: 'attendance',
      title: 'Attendance percentage per day',
      titleHi: 'प्रतिदिन उपस्थिति प्रतिशत',
      description: 'School (or class) attendance percentage for each marked day in the period.',
      anyOf: ['attendance.session.view', 'insights.dashboard.view'],
      params: [DAYS, CLASS],
      keywords: ['trend', 'attendance percentage', 'last week', 'this month', 'रुझान'],
      sql: (p) => ({
        text: `SELECT on_date::text AS date, sum(strength)::int AS strength, sum(present)::int AS present,
                      round(sum(present)::numeric * 100 / NULLIF(sum(strength), 0), 1) AS pct
                 FROM mart.attendance_daily WHERE academic_year_id = $1 AND marked AND on_date BETWEEN $2::date - $3::int AND $2::date AND ($4::bigint IS NULL OR class_id = $4)
                GROUP BY on_date ORDER BY on_date`,
        values: [Y, T, n(p.days, 30), s(p.classId)],
      }),
    },
    {
      id: 'classes_below_attendance',
      department: 'attendance',
      title: 'Classes below an attendance threshold',
      titleHi: 'निर्धारित उपस्थिति से नीचे की कक्षाएँ',
      description:
        'Classes whose attendance percentage over the period fell below the threshold (default 85).',
      anyOf: ['attendance.session.view', 'insights.dashboard.view'],
      params: [
        { name: 'threshold', type: 'amount', description: 'Percentage threshold (default 85)' },
        DAYS,
      ],
      keywords: ['below', 'threshold', 'fell', 'attendance drop', 'कम उपस्थिति'],
      sql: (p) => ({
        text: `SELECT k.code AS class, sum(a.strength)::int AS strength, sum(a.present)::int AS present, round(sum(a.present)::numeric * 100 / NULLIF(sum(a.strength), 0), 1) AS pct
                 FROM mart.attendance_daily a JOIN classes k ON k.id = a.class_id
                WHERE a.academic_year_id = $1 AND a.marked AND a.on_date BETWEEN $2::date - $3::int AND $2::date
                GROUP BY k.id, k.code, k.display_order HAVING sum(a.present)::numeric * 100 / NULLIF(sum(a.strength), 0) < $4 ORDER BY pct`,
        values: [Y, T, n(p.days, 30), Number(p.threshold) || 85],
      }),
    },
    {
      id: 'absentees_of_day',
      department: 'attendance',
      title: 'Students absent on a day',
      titleHi: 'एक दिन के अनुपस्थित विद्यार्थी',
      description: 'The students marked absent on a day, optionally for one section.',
      anyOf: ['attendance.session.view'],
      params: [DATE, SECTION, LIMIT],
      keywords: ['absent', 'who was absent', 'absentees', 'अनुपस्थित'],
      sql: (p) => ({
        text: `SELECT st.display_name AS name, st.admission_no, k.code || '-' || cs.name AS section, m.code::text AS mark
                 FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN students st ON st.id = m.student_id
                 JOIN class_sections cs ON cs.id = a.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE a.academic_year_id = $1 AND a.kind = 'day' AND a.on_date = $2::date AND m.code = 'A' AND ($3::bigint IS NULL OR a.class_section_id = $3)
                ORDER BY k.display_order, cs.name, st.display_name LIMIT $4`,
        values: [Y, date(p.date, T), s(p.sectionId), n(p.limit, 50)],
      }),
    },
    {
      id: 'chronic_absentees',
      department: 'attendance',
      title: 'Chronic absentees',
      titleHi: 'बार-बार अनुपस्थित विद्यार्थी',
      description: 'Students with at least N absences in the period (default 5 in 30 days).',
      anyOf: ['attendance.session.view', 'insights.dashboard.view'],
      params: [
        { name: 'minAbsences', type: 'days', description: 'Minimum absences (default 5)' },
        DAYS,
        CLASS,
        LIMIT,
      ],
      keywords: ['chronic', 'frequently absent', 'repeated absence', 'बार-बार'],
      sql: (p) => ({
        text: `SELECT st.display_name AS name, st.admission_no, k.code || '-' || cs.name AS section, count(*) FILTER (WHERE m.code = 'A')::int AS absences, count(*)::int AS days
                 FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN students st ON st.id = m.student_id
                 JOIN class_sections cs ON cs.id = a.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE a.academic_year_id = $1 AND a.kind = 'day' AND a.on_date BETWEEN $2::date - $3::int AND $2::date AND ($4::bigint IS NULL OR cs.class_id = $4)
                GROUP BY st.id, st.display_name, st.admission_no, k.code, cs.name, k.display_order HAVING count(*) FILTER (WHERE m.code = 'A') >= $5
                ORDER BY absences DESC LIMIT $6`,
        values: [Y, T, n(p.days, 30), s(p.classId), n(p.minAbsences, 5), n(p.limit, 20)],
      }),
    },
    {
      id: 'student_attendance',
      department: 'attendance',
      title: 'Attendance of one student',
      titleHi: 'एक विद्यार्थी की उपस्थिति',
      description: 'Day-wise marks of one student in the period.',
      anyOf: ['attendance.session.view'],
      params: [
        {
          name: 'studentId',
          type: 'studentId',
          description: 'The student (id from find_student)',
          required: true,
        },
        DAYS,
      ],
      keywords: ['attendance of', 'was present', 'student attendance', 'विद्यार्थी की उपस्थिति'],
      sql: (p) => ({
        text: `SELECT a.on_date::text AS date, m.code::text AS mark FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
                WHERE m.student_id = $1 AND a.academic_year_id = $2 AND a.kind = 'day' AND a.on_date BETWEEN $3::date - $4::int AND $3::date ORDER BY a.on_date`,
        values: [s(p.studentId), Y, T, n(p.days, 30)],
      }),
    },
    {
      id: 'reader_health',
      department: 'attendance',
      title: 'RFID readers and when they were last seen',
      titleHi: 'RFID रीडर और उनका अंतिम संपर्क',
      description: 'Every active reader with its last event and the taps of the day.',
      anyOf: ['attendance.rfid.manage', 'insights.dashboard.view'],
      params: [DATE],
      keywords: ['reader', 'rfid', 'device', 'offline', 'silent', 'रीडर'],
      sql: (p) => ({
        text: `SELECT d.code, d.name, d.direction::text, d.last_seen_at::text AS last_seen,
                      (SELECT count(*)::int FROM rfid_events e WHERE e.device_id = d.id AND (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS taps
                 FROM rfid_devices d WHERE d.status = 'active' ORDER BY d.code`,
        values: [date(p.date, T)],
      }),
    },
    // ---- fees -------------------------------------------------------------------------------------
    {
      id: 'fee_summary',
      department: 'fees',
      title: 'Fees due, collected and balance till date',
      titleHi: 'अब तक देय, संग्रहित और शेष शुल्क',
      description: 'Totals of the session till the date, optionally for one class.',
      anyOf: ['fees.ledger.view', 'fees.demand.view', 'insights.dashboard.view'],
      params: [DATE, CLASS],
      keywords: [
        'collected',
        'collection',
        'due',
        'balance',
        'fees summary',
        'शुल्क',
        'संग्रह',
        'बकाया',
      ],
      sql: (p) => ({
        text: `SELECT COALESCE(sum(net), 0)::text AS due_till_date, COALESCE(sum(paid), 0)::text AS collected, COALESCE(sum(balance), 0)::text AS balance,
                      count(DISTINCT student_id)::int AS students, count(DISTINCT student_id) FILTER (WHERE balance > 0 AND due_on < $2::date)::int AS defaulters
                 FROM mart.fee_dues WHERE academic_year_id = $1 AND due_on <= $2::date AND ($3::bigint IS NULL OR class_id = $3)`,
        values: [Y, date(p.date, T), s(p.classId)],
      }),
    },
    {
      id: 'fee_defaulters',
      department: 'fees',
      title: 'Fee defaulters',
      titleHi: 'शुल्क बकायादार',
      description:
        'Students with overdue balance, largest first; optional class and minimum amount.',
      anyOf: ['fees.ledger.view', 'fees.demand.view', 'insights.dashboard.view'],
      params: [
        CLASS,
        { name: 'minAmount', type: 'amount', description: 'Only balances above this amount' },
        LIMIT,
      ],
      keywords: ['defaulter', 'overdue', 'not paid', 'pending fees', 'बकायादार', 'बकाया'],
      sql: (p) => ({
        text: `SELECT student_name AS name, admission_no, section, sum(balance)::text AS balance, max(days_overdue)::int AS days_overdue
                 FROM mart.fee_dues WHERE academic_year_id = $1 AND balance > 0 AND due_on < $2::date AND ($3::bigint IS NULL OR class_id = $3)
                GROUP BY student_id, student_name, admission_no, section HAVING sum(balance) >= $4 ORDER BY sum(balance) DESC LIMIT $5`,
        values: [Y, T, s(p.classId), Number(p.minAmount) || 0, n(p.limit, 20)],
      }),
    },
    {
      id: 'fee_collection_by_day',
      department: 'fees',
      title: 'Fee collection per day',
      titleHi: 'प्रतिदिन शुल्क संग्रह',
      description: 'Amount and receipts per day over the period.',
      anyOf: ['fees.ledger.view', 'insights.dashboard.view'],
      params: [DAYS],
      keywords: [
        'collection per day',
        'daily collection',
        'collected yesterday',
        'collection by day',
        'दैनिक संग्रह',
      ],
      sql: (p) => ({
        text: `SELECT received_on::text AS date, sum(amount)::text AS amount, sum(receipts)::int AS receipts FROM mart.fee_collection_daily
                WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - $3::int AND $2::date GROUP BY received_on ORDER BY received_on`,
        values: [Y, T, n(p.days, 30)],
      }),
    },
    {
      id: 'fee_collection_by_mode',
      department: 'fees',
      title: 'Fee collection by mode',
      titleHi: 'माध्यम अनुसार शुल्क संग्रह',
      description: 'Cash, UPI, online and other modes over the period.',
      anyOf: ['fees.ledger.view', 'insights.dashboard.view'],
      params: [DAYS],
      keywords: ['collection by mode', 'by mode', 'cash', 'upi', 'cheque', 'माध्यम अनुसार'],
      sql: (p) => ({
        text: `SELECT mode, sum(amount)::text AS amount, sum(receipts)::int AS receipts FROM mart.fee_collection_daily
                WHERE academic_year_id = $1 AND received_on BETWEEN $2::date - $3::int AND $2::date GROUP BY mode ORDER BY sum(amount) DESC`,
        values: [Y, T, n(p.days, 30)],
      }),
    },
    {
      id: 'fee_ageing',
      department: 'fees',
      title: 'Dues ageing',
      titleHi: 'बकाया आयु विश्लेषण',
      description: 'Outstanding balance by days overdue (current, 1-30, 31-60, 61-90, 90+).',
      anyOf: ['fees.ledger.view', 'insights.dashboard.view'],
      params: [CLASS],
      keywords: ['ageing', 'aging', 'overdue buckets', '90 days', 'आयु'],
      sql: (p) => ({
        text: `SELECT bucket, sum(balance)::text AS balance, count(DISTINCT student_id)::int AS students FROM mart.fee_dues
                WHERE academic_year_id = $1 AND balance > 0 AND ($2::bigint IS NULL OR class_id = $2) GROUP BY bucket ORDER BY min(days_overdue)`,
        values: [Y, s(p.classId)],
      }),
    },
    {
      id: 'fee_by_class',
      department: 'fees',
      title: 'Fees due and collected by class',
      titleHi: 'कक्षा अनुसार देय और संग्रहित शुल्क',
      description: 'Net, paid and balance per class till date.',
      anyOf: ['fees.ledger.view', 'fees.demand.view', 'insights.dashboard.view'],
      params: [DATE],
      keywords: ['by class', 'class wise', 'classwise', 'कक्षा अनुसार'],
      sql: (p) => ({
        text: `SELECT COALESCE(k.code, '—') AS class, sum(f.net)::text AS net, sum(f.paid)::text AS paid, sum(f.balance)::text AS balance, count(DISTINCT f.student_id)::int AS students
                 FROM mart.fee_dues f LEFT JOIN classes k ON k.id = f.class_id WHERE f.academic_year_id = $1 AND f.due_on <= $2::date
                GROUP BY k.code, k.display_order ORDER BY k.display_order NULLS LAST`,
        values: [Y, date(p.date, T)],
      }),
    },
    {
      id: 'student_fee_ledger',
      department: 'fees',
      title: 'Fee instalments of one student',
      titleHi: 'एक विद्यार्थी की शुल्क किस्तें',
      description: 'Each instalment of the student with net, paid and balance.',
      anyOf: ['fees.ledger.view'],
      params: [
        {
          name: 'studentId',
          type: 'studentId',
          description: 'The student (id from find_student)',
          required: true,
        },
      ],
      keywords: ['ledger of', 'fees of', 'how much does', 'owes', 'विद्यार्थी का शुल्क'],
      sql: (p) => ({
        text: `SELECT due_on::text AS due_on, sum(net)::text AS net, sum(paid)::text AS paid, sum(net - paid)::text AS balance, ledger::text
                 FROM fee_demands WHERE student_id = $1 AND academic_year_id = $2 AND status IN ('pending', 'partial', 'paid') GROUP BY due_on, ledger ORDER BY due_on`,
        values: [s(p.studentId), Y],
      }),
    },
    {
      id: 'receipts_of_day',
      department: 'fees',
      title: 'Receipts of a day',
      titleHi: 'एक दिन की रसीदें',
      description: 'Receipts posted on a day with number, student, amount and mode.',
      anyOf: ['fees.ledger.view'],
      params: [DATE, LIMIT],
      keywords: ['receipts', 'receipt list', 'today receipts', 'रसीदें'],
      sql: (p) => ({
        text: `SELECT p.receipt_no, st.display_name AS student, st.admission_no, p.amount::text, p.late_fee::text, p.mode, p.status
                 FROM fee_payments p JOIN students st ON st.id = p.student_id WHERE p.academic_year_id = $1 AND p.received_on = $2::date ORDER BY p.id LIMIT $3`,
        values: [Y, date(p.date, T), n(p.limit, 100)],
      }),
    },
    {
      id: 'refunds_pending',
      department: 'fees',
      title: 'Refunds and adjustments waiting for approval',
      titleHi: 'स्वीकृति की प्रतीक्षा में धनवापसी और समायोजन',
      description: 'Open refund requests and adjustment requests (waiver, reversal, bounce).',
      anyOf: [
        'fees.refund.request',
        'fees.adjustment.request',
        'fees.refund.approve',
        'fees.adjustment.approve',
      ],
      params: [],
      keywords: ['refund', 'waiver', 'reversal', 'bounce', 'pending approval', 'धनवापसी', 'छूट'],
      sql: () => ({
        text: `SELECT 'refund' AS kind, st.display_name AS student, r.amount::text, r.reason, r.requested_at::text AS requested_at FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id JOIN students st ON st.id = p.student_id WHERE r.status = 'requested'
               UNION ALL
               SELECT a.kind::text, st.display_name, a.amount::text, a.reason, a.requested_at::text FROM fee_adjustments a JOIN students st ON st.id = a.student_id WHERE a.status = 'pending' AND a.academic_year_id = $1
               ORDER BY requested_at`,
        values: [Y],
      }),
    },
    {
      id: 'online_payments_status',
      department: 'fees',
      title: 'Online payments and settlement status',
      titleHi: 'ऑनलाइन भुगतान और सेटलमेंट स्थिति',
      description:
        'Online receipts over the period, settled and unsettled, plus the last reconciliation.',
      anyOf: ['payments.settlement.view', 'payments.reconcile.view', 'fees.ledger.view'],
      params: [DAYS],
      keywords: ['online', 'gateway', 'settlement', 'razorpay', 'reconcile', 'सेटलमेंट'],
      sql: (p) => ({
        text: `SELECT count(*)::int AS online_receipts, COALESCE(sum(amount), 0)::text AS amount,
                      count(*) FILTER (WHERE settlement_line_id IS NOT NULL)::int AS settled, count(*) FILTER (WHERE settlement_line_id IS NULL)::int AS unsettled,
                      (SELECT variance::text FROM payment_reconciliation_runs ORDER BY run_date DESC LIMIT 1) AS last_variance
                 FROM fee_payments WHERE academic_year_id = $1 AND mode = 'online' AND received_on BETWEEN $2::date - $3::int AND $2::date`,
        values: [Y, T, n(p.days, 30)],
      }),
    },
    {
      id: 'misc_receipts',
      department: 'fees',
      title: 'Misc receipts',
      titleHi: 'विविध रसीदें',
      description: 'Misc receipts (students, employees, vendors) over the period by head.',
      anyOf: ['fees.misc.view'],
      params: [DAYS],
      keywords: ['misc', 'miscellaneous', 'vendor', 'id card', 'विविध'],
      sql: (p) => ({
        text: `SELECT h.name AS head, m.payer_kind::text, count(*)::int AS receipts, sum(m.amount)::text AS amount FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                WHERE m.received_on BETWEEN $1::date - $2::int AND $1::date AND m.status = 'posted' GROUP BY h.name, m.payer_kind ORDER BY sum(m.amount) DESC`,
        values: [T, n(p.days, 30)],
      }),
    },
    // ---- academics --------------------------------------------------------------------------------
    {
      id: 'homework_coverage',
      department: 'academics',
      title: 'Homework posted per section',
      titleHi: 'अनुभाग अनुसार गृहकार्य',
      description:
        'Homework, classwork and assignments posted per section over the period, with sections that have none.',
      anyOf: ['academics.daily_work.view', 'insights.dashboard.view'],
      params: [DAYS, CLASS],
      keywords: ['homework', 'daily work', 'no homework', 'गृहकार्य'],
      sql: (p) => ({
        text: `SELECT k.code || '-' || cs.name AS section,
                      (SELECT count(*)::int FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL AND w.kind = 'homework' AND w.assigned_on BETWEEN $2::date - $3::int AND $2::date) AS homework,
                      (SELECT count(*)::int FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL AND w.assigned_on BETWEEN $2::date - $3::int AND $2::date) AS all_work,
                      (SELECT max(w.assigned_on)::text FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL) AS last_posted
                 FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($4::bigint IS NULL OR cs.class_id = $4)
                ORDER BY k.display_order, cs.name`,
        values: [Y, T, n(p.days, 7), s(p.classId)],
      }),
    },
    {
      id: 'lesson_plans_status',
      department: 'academics',
      title: 'Lesson plans by status',
      titleHi: 'स्थिति अनुसार पाठ योजनाएँ',
      description: 'Counts of lesson plans by status and the plans waiting for approval.',
      anyOf: ['academics.lesson_plan.view', 'insights.dashboard.view'],
      params: [],
      keywords: ['lesson plan', 'approval', 'waiting', 'पाठ योजना'],
      sql: () => ({
        text: `SELECT status::text, count(*)::int AS plans FROM lesson_plans WHERE academic_year_id = $1 GROUP BY status ORDER BY status`,
        values: [Y],
      }),
    },
    {
      id: 'substitutions',
      department: 'academics',
      title: 'Timetable substitutions',
      titleHi: 'समय-सारणी प्रतिस्थापन',
      description: 'Substitutions over the period with the absent and the substitute teacher.',
      anyOf: ['academics.substitution.view', 'insights.dashboard.view'],
      params: [DAYS, LIMIT],
      keywords: ['substitution', 'substitute', 'teacher absent', 'प्रतिस्थापन'],
      sql: (p) => ({
        text: `SELECT s.on_date::text AS date, k.code || '-' || cs.name AS section, a.display_name AS absent_teacher, b.display_name AS substitute
                 FROM timetable_substitutions s JOIN class_sections cs ON cs.id = s.class_section_id JOIN classes k ON k.id = cs.class_id
                 LEFT JOIN employees a ON a.id = s.absent_employee_id JOIN employees b ON b.id = s.substitute_employee_id
                WHERE s.academic_year_id = $1 AND s.on_date BETWEEN $2::date - $3::int AND $2::date ORDER BY s.on_date DESC LIMIT $4`,
        values: [Y, T, n(p.days, 30), n(p.limit, 50)],
      }),
    },
    {
      id: 'timetable_of_section',
      department: 'academics',
      title: 'Timetable of a section',
      titleHi: 'एक अनुभाग की समय-सारणी',
      description: 'Periods of a section by day with subject and teacher.',
      anyOf: ['academics.timetable.view'],
      params: [{ ...SECTION, required: true }],
      keywords: ['timetable', 'periods', 'which teacher', 'समय-सारणी'],
      sql: (p) => ({
        text: `SELECT ts.day_of_week, tp.name AS period, sub.name AS subject, e.display_name AS teacher
                 FROM timetable_slots ts JOIN timetable_periods tp ON tp.id = ts.period_id LEFT JOIN subjects sub ON sub.id = ts.subject_id LEFT JOIN employees e ON e.id = ts.employee_id
                WHERE ts.class_section_id = $1 ORDER BY ts.day_of_week, tp.sort_order`,
        values: [s(p.sectionId)],
      }),
    },
    // ---- admissions -------------------------------------------------------------------------------
    {
      id: 'admissions_funnel',
      department: 'admissions',
      title: 'Admissions funnel',
      titleHi: 'प्रवेश फ़नल',
      description: 'Applications by cycle, class and status.',
      anyOf: ['admissions.application.view', 'admissions.cycle.view', 'insights.dashboard.view'],
      params: [],
      keywords: ['admission', 'applications', 'funnel', 'shortlisted', 'प्रवेश'],
      sql: () => ({
        text: `SELECT cycle_code AS cycle, class_code AS class, status, applications FROM mart.admissions_funnel ORDER BY cycle_code, class_code, status`,
        values: [],
      }),
    },
    {
      id: 'seat_fill',
      department: 'admissions',
      title: 'Seat fill by class',
      titleHi: 'कक्षा अनुसार सीट भराव',
      description: 'Capacity and enrolled students per class in the session.',
      anyOf: [
        'admissions.application.view',
        'academics.class_section.view',
        'insights.dashboard.view',
      ],
      params: [],
      keywords: ['seats', 'capacity', 'vacant', 'seat fill', 'सीट'],
      sql: () => ({
        text: `SELECT k.code AS class, COALESCE(sum(cs.capacity), 0)::int AS capacity,
                      (SELECT count(*)::int FROM enrolments e JOIN class_sections x ON x.id = e.class_section_id WHERE x.class_id = k.id AND e.academic_year_id = $1 AND e.status = 'active') AS enrolled
                 FROM classes k JOIN class_sections cs ON cs.class_id = k.id AND cs.academic_year_id = $1 AND cs.deleted_at IS NULL
                WHERE k.deleted_at IS NULL GROUP BY k.id, k.code, k.display_order ORDER BY k.display_order`,
        values: [Y],
      }),
    },
    // ---- transport --------------------------------------------------------------------------------
    {
      id: 'route_load',
      department: 'transport',
      title: 'Bus routes, riders and boarding today',
      titleHi: 'बस मार्ग, सवार और आज की बोर्डिंग',
      description: 'Each route with riders, capacity, and boardings today.',
      anyOf: ['transport.route.view', 'insights.dashboard.view'],
      params: [DATE],
      keywords: ['route', 'bus', 'riders', 'boarded', 'बस', 'मार्ग'],
      sql: (p) => ({
        text: `SELECT r.code, r.name, v.capacity,
                      (SELECT count(*)::int FROM student_route_assignments a WHERE a.route_id = r.id AND a.academic_year_id = $1) AS riders,
                      (SELECT count(*)::int FROM bus_attendance b WHERE b.route_id = r.id AND b.on_date = $2::date AND b.outcome IN ('boarded', 'bus_boarded', 'late_boarding')) AS boarded_today
                 FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id WHERE r.deleted_at IS NULL ORDER BY r.code`,
        values: [Y, date(p.date, T)],
      }),
    },
    {
      id: 'transport_requests_pending',
      department: 'transport',
      title: 'Pending bus requests',
      titleHi: 'लंबित बस अनुरोध',
      description: 'Bus seat, stop and leave requests waiting for a decision.',
      anyOf: ['transport.request.view'],
      params: [],
      keywords: ['bus request', 'seat request', 'stop change', 'बस अनुरोध'],
      sql: () => ({
        text: `SELECT st.display_name AS student, q.kind::text, r.code AS route, q.requested_at::text AS requested_at, q.note
                 FROM transport_requests q JOIN students st ON st.id = q.student_id LEFT JOIN transport_routes r ON r.id = q.route_id
                WHERE q.academic_year_id = $1 AND q.status = 'pending' ORDER BY q.requested_at`,
        values: [Y],
      }),
    },
    {
      id: 'vehicle_documents_expiring',
      department: 'transport',
      title: 'Vehicle and driver documents expiring',
      titleHi: 'समाप्त होते वाहन और चालक दस्तावेज़',
      description: 'Insurance, fitness, permit and licence expiries within N days.',
      anyOf: ['transport.fleet.view'],
      params: [DAYS],
      keywords: ['insurance', 'fitness', 'permit', 'licence', 'expiring', 'बीमा'],
      sql: (p) => ({
        text: `SELECT * FROM (
                 SELECT 'vehicle' AS kind, reg_no AS ref, 'insurance' AS document, insurance_expiry::text AS expires_on FROM transport_vehicles WHERE deleted_at IS NULL AND insurance_expiry IS NOT NULL
                 UNION ALL SELECT 'vehicle', reg_no, 'fitness', fitness_expiry::text FROM transport_vehicles WHERE deleted_at IS NULL AND fitness_expiry IS NOT NULL
                 UNION ALL SELECT 'vehicle', reg_no, 'permit', permit_expiry::text FROM transport_vehicles WHERE deleted_at IS NULL AND permit_expiry IS NOT NULL
                 UNION ALL SELECT 'driver', name, 'licence', licence_expiry::text FROM transport_drivers WHERE deleted_at IS NULL AND licence_expiry IS NOT NULL
               ) x WHERE expires_on::date <= $1::date + $2::int ORDER BY expires_on`,
        values: [T, n(p.days, 60)],
      }),
    },
    // ---- communication ----------------------------------------------------------------------------
    {
      id: 'message_delivery',
      department: 'communication',
      title: 'Message delivery by channel',
      titleHi: 'चैनल अनुसार संदेश डिलीवरी',
      description: 'Sent, delivered and failed messages per channel over the period.',
      anyOf: ['comms.message.view', 'insights.dashboard.view'],
      params: [DAYS],
      keywords: ['delivery', 'whatsapp', 'sms', 'email', 'failed messages', 'संदेश'],
      sql: (p) => ({
        text: `SELECT channel, status, sum(messages)::int AS messages FROM mart.comms_delivery_daily WHERE on_date BETWEEN $1::date - $2::int AND $1::date GROUP BY channel, status ORDER BY channel, status`,
        values: [T, n(p.days, 30)],
      }),
    },
    {
      id: 'open_queries',
      department: 'communication',
      title: 'Open parent queries',
      titleHi: 'खुले अभिभावक प्रश्न',
      description: 'Queries not yet closed, oldest first, with category and days open.',
      anyOf: ['engagement.query.view'],
      params: [LIMIT],
      keywords: ['query', 'queries', 'complaint', 'open', 'unanswered', 'प्रश्न', 'शिकायत'],
      sql: (p) => ({
        text: `SELECT q.number, q.category_code AS category, st.display_name AS student, q.subject, q.opened_at::text AS opened_at, (CURRENT_DATE - q.opened_at::date)::int AS days_open, q.first_response_at IS NOT NULL AS answered
                 FROM parent_queries q JOIN students st ON st.id = q.student_id WHERE q.academic_year_id = $1 AND q.closed_at IS NULL ORDER BY q.opened_at LIMIT $2`,
        values: [Y, n(p.limit, 50)],
      }),
    },
    {
      id: 'consent_coverage',
      department: 'communication',
      title: 'Consent coverage by purpose',
      titleHi: 'उद्देश्य अनुसार सहमति',
      description: 'How many families granted or withdrew each consent purpose.',
      anyOf: ['comms.consent.view', 'insights.dashboard.view'],
      params: [],
      keywords: ['consent', 'dpdp', 'withdrawn', 'सहमति'],
      sql: () => ({
        text: `SELECT purpose_code AS purpose, status::text, count(*)::int AS families FROM consents GROUP BY purpose_code, status ORDER BY purpose_code, status`,
        values: [],
      }),
    },
    // ---- hr ---------------------------------------------------------------------------------------
    {
      id: 'staff_headcount',
      department: 'hr',
      title: 'Staff headcount by department',
      titleHi: 'विभाग अनुसार कर्मचारी संख्या',
      description: 'Active employees by department and type.',
      anyOf: ['people.employee.view', 'insights.dashboard.view'],
      params: [],
      keywords: ['staff', 'employees', 'headcount', 'teachers count', 'कर्मचारी'],
      sql: () => ({
        text: `SELECT COALESCE(department, '—') AS department, employee_type::text AS type, count(*)::int AS employees FROM employees WHERE deleted_at IS NULL AND status = 'active' GROUP BY department, employee_type ORDER BY department NULLS LAST, employee_type`,
        values: [],
      }),
    },
    {
      id: 'staff_punches_today',
      department: 'hr',
      title: 'Staff punched in today',
      titleHi: 'आज पंच करने वाले कर्मचारी',
      description: 'Employees with a punch on the day and the earliest punch time.',
      anyOf: ['attendance.punch.view', 'people.employee.view'],
      params: [DATE],
      keywords: ['punch', 'staff attendance', 'came today', 'पंच'],
      sql: (p) => ({
        text: `SELECT e.display_name AS employee, e.department, to_char(min(l.punched_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:MI') AS first_punch, count(*)::int AS punches
                 FROM punch_logs l JOIN employees e ON e.id = l.employee_id WHERE (l.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date GROUP BY e.id, e.display_name, e.department ORDER BY min(l.punched_at)`,
        values: [date(p.date, T)],
      }),
    },
    // ---- exams ------------------------------------------------------------------------------------
    {
      id: 'exams_of_year',
      department: 'exams',
      title: 'Exams of the session',
      titleHi: 'सत्र की परीक्षाएँ',
      description: 'Exams with dates, classes and whether marks are locked.',
      anyOf: ['exams.master.view'],
      params: [],
      keywords: ['exam', 'exams', 'periodic test', 'term', 'परीक्षा'],
      sql: () => ({
        text: `SELECT e.code, e.name, t.name AS type, e.starts_on::text, e.ends_on::text, e.marks_locked,
                      (SELECT string_agg(k.code, ', ' ORDER BY k.display_order) FROM exam_classes ec JOIN classes k ON k.id = ec.class_id WHERE ec.exam_id = e.id) AS classes
                 FROM exams e JOIN exam_types t ON t.id = e.exam_type_id WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL ORDER BY e.starts_on NULLS LAST, e.code`,
        values: [Y],
      }),
    },
  ];
}

/** Runs one entry with the caller's transaction; rows are capped so the model never receives a dump. */
export async function runEntry(
  c: PoolClient,
  entry: CatalogueEntry,
  params: Record<string, unknown>,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  for (const p of entry.params)
    if (
      p.required &&
      (params[p.name] === undefined || params[p.name] === null || params[p.name] === '')
    )
      throw new Error(`${entry.id}: ${p.name} is required`);
  const q = entry.sql(params);
  const cap = entry.maxRows ?? 200;
  const r = await c.query<Record<string, unknown>>(q.text, q.values);
  return { rows: r.rows.slice(0, cap), truncated: r.rows.length > cap };
}
