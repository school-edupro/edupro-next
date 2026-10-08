import { MASTERS, masterToDataset } from './masters';
/**
 * Export datasets (S3-03). The API validates the request (dataset exists, caller holds the permission,
 * scope filters applied) and the worker runs the query under the requester's tenant context, so
 * row-level security and the scope filter both apply to the generated file.
 *
 * Every query uses bound parameters only; params arrive as JSON from the exports row.
 */
export type DatasetColumnType = 'text' | 'number' | 'date' | 'datetime' | 'json';

export interface DatasetColumn {
  key: string;
  header: string;
  type?: DatasetColumnType;
  width?: number;
}

export interface DatasetQuery {
  text: string;
  values: unknown[];
}

export interface DatasetDefinition {
  id: string;
  title: string;
  /** Permission the requester must hold. */
  permission: string;
  /** Scope type the API resolves into params.sectionIds when the requester is scoped. */
  scope?: 'class_section';
  columns: DatasetColumn[];
  maxRows: number;
  query: (params: Record<string, unknown>) => DatasetQuery;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const idList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 ? v.map(String) : null;

export const DATASETS: Record<string, DatasetDefinition> = {
  classes: {
    id: 'classes',
    title: 'Classes',
    permission: 'academics.class.view',
    maxRows: 10_000,
    columns: [
      { key: 'code', header: 'Code', width: 12 },
      { key: 'name', header: 'Name', width: 28 },
      { key: 'display_order', header: 'Order', type: 'number', width: 8 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'updated_at', header: 'Updated', type: 'datetime', width: 20 },
    ],
    query: () => ({
      text: 'SELECT code, name, display_order, status::text, updated_at FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code',
      values: [],
    }),
  },
  class_sections: {
    id: 'class_sections',
    title: 'Sections',
    permission: 'academics.class_section.view',
    scope: 'class_section',
    maxRows: 20_000,
    columns: [
      { key: 'academic_year', header: 'Year', width: 10 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'class_name', header: 'Class name', width: 24 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'capacity', header: 'Capacity', type: 'number', width: 10 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    query: (p) => ({
      text: `SELECT y.code AS academic_year, c.code AS class_code, c.name AS class_name, s.name AS section, s.capacity, s.status::text
               FROM class_sections s
               JOIN classes c ON c.id = s.class_id
               JOIN academic_years y ON y.id = s.academic_year_id
              WHERE s.deleted_at IS NULL
                AND ($1::bigint IS NULL OR s.academic_year_id = $1::bigint)
                AND ($2::bigint[] IS NULL OR s.id = ANY($2::bigint[]))
              ORDER BY y.start_date DESC, c.display_order, s.name`,
      values: [str(p.academicYearId), idList(p.sectionIds)],
    }),
  },
  members: {
    id: 'members',
    title: 'Members',
    permission: 'access.assignment.view',
    maxRows: 50_000,
    columns: [
      { key: 'display_name', header: 'Name', width: 28 },
      { key: 'person_type', header: 'Type', width: 12 },
      { key: 'mobile', header: 'Mobile', width: 14 },
      { key: 'email', header: 'Email', width: 28 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'roles', header: 'Roles', width: 40 },
      { key: 'last_login_at', header: 'Last sign-in', type: 'datetime', width: 20 },
    ],
    query: (p) => ({
      text: `SELECT u.display_name, m.person_type::text, u.mobile, u.email, m.status::text,
                    (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND ur.revoked_at IS NULL) AS roles,
                    u.last_login_at
               FROM user_school_memberships m
               JOIN users u ON u.id = m.user_id
              WHERE m.deleted_at IS NULL
                AND ($1::person_type IS NULL OR m.person_type = $1::person_type)
              ORDER BY u.display_name`,
      values: [str(p.personType)],
    }),
  },
  assignments: {
    id: 'assignments',
    title: 'Role assignments',
    permission: 'access.assignment.view',
    maxRows: 50_000,
    columns: [
      { key: 'display_name', header: 'Person', width: 28 },
      { key: 'role', header: 'Role', width: 24 },
      { key: 'campus', header: 'Campus', width: 16 },
      { key: 'valid_from', header: 'Valid from', type: 'date', width: 12 },
      { key: 'valid_to', header: 'Valid to', type: 'date', width: 12 },
      { key: 'revoked_at', header: 'Revoked', type: 'datetime', width: 20 },
      { key: 'reason', header: 'Reason', width: 40 },
    ],
    query: (p) => ({
      text: `SELECT u.display_name, r.name AS role, c.name AS campus, ur.valid_from, ur.valid_to, ur.revoked_at, ur.reason
               FROM user_roles ur
               JOIN users u ON u.id = ur.user_id
               JOIN roles r ON r.id = ur.role_id
               LEFT JOIN campuses c ON c.id = ur.campus_id
              WHERE ($1::boolean IS NULL OR ($1::boolean = (ur.revoked_at IS NULL)))
              ORDER BY u.display_name, r.name`,
      values: [typeof p.active === 'boolean' ? p.active : null],
    }),
  },
  audit_logs: {
    id: 'audit_logs',
    title: 'Audit log',
    permission: 'platform.audit.view',
    maxRows: 100_000,
    columns: [
      { key: 'occurred_at', header: 'When', type: 'datetime', width: 20 },
      { key: 'actor', header: 'Actor', width: 24 },
      { key: 'action', header: 'Action', width: 28 },
      { key: 'entity_type', header: 'Entity', width: 20 },
      { key: 'entity_id', header: 'Entity id', width: 12 },
      { key: 'permission_code', header: 'Permission', width: 28 },
      { key: 'request_id', header: 'Request', width: 38 },
      { key: 'diff', header: 'Changes', type: 'json', width: 60 },
    ],
    query: (p) => ({
      text: `SELECT a.occurred_at, COALESCE(u.display_name, a.actor_type::text) AS actor, a.action, a.entity_type, a.entity_id,
                    a.permission_code, a.request_id::text, a.diff
               FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_user_id
              WHERE ($1::timestamptz IS NULL OR a.occurred_at >= $1::timestamptz)
                AND ($2::timestamptz IS NULL OR a.occurred_at < $2::timestamptz)
                AND ($3::text IS NULL OR a.entity_type = $3::text)
                AND ($4::text IS NULL OR a.entity_id = $4::text)
                AND ($5::bigint IS NULL OR a.actor_user_id = $5::bigint)
                AND ($6::text IS NULL OR a.action LIKE $6::text || '%')
              ORDER BY a.occurred_at DESC`,
      values: [
        str(p.from),
        str(p.to),
        str(p.entityType),
        str(p.entityId),
        str(p.actorUserId),
        str(p.action),
      ],
    }),
  },
  // ---- Sprint 13: department report centres ----------------------------------------------------------
  fee_dues: {
    id: 'fee_dues',
    title: 'Fee dues by student and instalment',
    permission: 'fees.ledger.view',
    maxRows: 100_000,
    columns: [
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'student_name', header: 'Student', width: 28 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'due_on', header: 'Due on', type: 'date', width: 12 },
      { key: 'net', header: 'Net', type: 'number', width: 12 },
      { key: 'paid', header: 'Paid', type: 'number', width: 12 },
      { key: 'balance', header: 'Balance', type: 'number', width: 12 },
      { key: 'days_overdue', header: 'Days overdue', type: 'number', width: 12 },
      { key: 'bucket', header: 'Ageing', width: 10 },
    ],
    query: (p) => ({
      text: `SELECT admission_no, student_name, section, due_on, net, paid, balance, days_overdue, bucket
               FROM mart.fee_dues
              WHERE ($1::bigint IS NULL OR academic_year_id = $1::bigint)
                AND ($2::boolean IS NOT TRUE OR balance > 0)
              ORDER BY section, student_name, due_on`,
      values: [str(p.academicYearId), p.onlyOpen === true || p.onlyOpen === 'true'],
    }),
  },
  fee_receipts: {
    id: 'fee_receipts',
    title: 'Fee receipts',
    permission: 'fees.ledger.view',
    maxRows: 100_000,
    columns: [
      { key: 'receipt_no', header: 'Receipt no.', width: 20 },
      { key: 'received_on', header: 'Date', type: 'date', width: 12 },
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'late_fee', header: 'Late fee', type: 'number', width: 10 },
      { key: 'refunded', header: 'Refunded', type: 'number', width: 10 },
      { key: 'mode', header: 'Mode', width: 10 },
      { key: 'reference', header: 'Reference', width: 20 },
      { key: 'instrument_no', header: 'Cheque / DD', width: 14 },
      { key: 'bank_name', header: 'Bank', width: 16 },
      { key: 'received_by', header: 'Received by', width: 20 },
      { key: 'status', header: 'Status', width: 14 },
      { key: 'settled', header: 'Settled', width: 8 },
    ],
    query: (p) => ({
      text: `SELECT p.receipt_no, p.received_on, s.admission_no, s.display_name AS student, p.amount, p.late_fee, p.refunded, p.mode, p.reference,
                    p.instrument_no, p.bank_name, COALESCE(u.display_name, 'Online') AS received_by, p.status, (p.settlement_line_id IS NOT NULL) AS settled
               FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.received_by
              WHERE ($1::bigint IS NULL OR p.academic_year_id = $1::bigint)
                AND ($2::date IS NULL OR p.received_on >= $2::date)
                AND ($3::date IS NULL OR p.received_on <= $3::date)
              ORDER BY p.received_on DESC, p.id DESC`,
      values: [str(p.academicYearId), str(p.from), str(p.to)],
    }),
  },
  fee_refunds: {
    id: 'fee_refunds',
    title: 'Fee refunds',
    permission: 'fees.refund.request',
    maxRows: 20_000,
    columns: [
      { key: 'requested_at', header: 'Requested', type: 'datetime', width: 20 },
      { key: 'receipt_no', header: 'Receipt no.', width: 20 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'mode', header: 'Mode', width: 10 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'reason', header: 'Reason', width: 40 },
      { key: 'reference', header: 'Reference', width: 20 },
      { key: 'paid_on', header: 'Paid on', type: 'date', width: 12 },
    ],
    query: (p) => ({
      text: `SELECT r.requested_at, p.receipt_no, s.display_name AS student, r.amount, r.mode, r.status::text, r.reason, r.reference, r.paid_on
               FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id JOIN students s ON s.id = p.student_id
              WHERE ($1::bigint IS NULL OR p.academic_year_id = $1::bigint)
              ORDER BY r.requested_at DESC`,
      values: [str(p.academicYearId)],
    }),
  },
  settlement_lines: {
    id: 'settlement_lines',
    title: 'Gateway settlement lines',
    permission: 'payments.settlement.view',
    maxRows: 100_000,
    columns: [
      { key: 'provider', header: 'Gateway', width: 12 },
      { key: 'settlement_ref', header: 'Settlement', width: 20 },
      { key: 'settled_on', header: 'Settled on', type: 'date', width: 12 },
      { key: 'line_no', header: '#', type: 'number', width: 6 },
      { key: 'provider_ref', header: 'Payment ref', width: 22 },
      { key: 'txn_id', header: 'Transaction', width: 22 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'charges', header: 'Charges', type: 'number', width: 10 },
      { key: 'tax', header: 'Tax', type: 'number', width: 10 },
      { key: 'net', header: 'Net', type: 'number', width: 12 },
      { key: 'status', header: 'Match', width: 16 },
      { key: 'receipt_no', header: 'Receipt no.', width: 20 },
      { key: 'note', header: 'Note', width: 30 },
    ],
    query: (p) => ({
      text: `SELECT s.provider, s.settlement_ref, s.settled_on, l.line_no, l.provider_ref, l.txn_id, l.amount, l.charges, l.tax, l.net, l.status, fp.receipt_no, l.note
               FROM payment_settlement_lines l JOIN payment_settlements s ON s.id = l.settlement_id LEFT JOIN fee_payments fp ON fp.id = l.payment_id
              WHERE ($1::text IS NULL OR l.status = $1::text)
              ORDER BY s.settled_on DESC, s.id DESC, l.line_no`,
      values: [str(p.status)],
    }),
  },
  attendance_daily: {
    id: 'attendance_daily',
    title: 'Attendance by section and day',
    permission: 'attendance.session.view',
    scope: 'class_section',
    maxRows: 100_000,
    columns: [
      { key: 'on_date', header: 'Date', type: 'date', width: 12 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'strength', header: 'Strength', type: 'number', width: 10 },
      { key: 'present', header: 'Present', type: 'number', width: 10 },
      { key: 'absent', header: 'Absent', type: 'number', width: 10 },
      { key: 'late', header: 'Late', type: 'number', width: 10 },
      { key: 'marked', header: 'Marked', width: 8 },
    ],
    query: (p) => ({
      text: `SELECT a.on_date, k.code AS class_code, a.section, a.strength, a.present, a.absent, a.late, a.marked
               FROM mart.attendance_daily a JOIN classes k ON k.id = a.class_id
              WHERE ($1::bigint IS NULL OR a.academic_year_id = $1::bigint)
                AND ($2::bigint[] IS NULL OR a.class_section_id = ANY($2::bigint[]))
                AND ($3::date IS NULL OR a.on_date >= $3::date)
                AND ($4::date IS NULL OR a.on_date <= $4::date)
              ORDER BY a.on_date DESC, k.display_order, a.section`,
      values: [str(p.academicYearId), idList(p.sectionIds), str(p.from), str(p.to)],
    }),
  },
  lesson_plans: {
    id: 'lesson_plans',
    title: 'Lesson plans and their approval',
    permission: 'academics.lesson_plan.view',
    scope: 'class_section',
    maxRows: 50_000,
    columns: [
      { key: 'week_start', header: 'Week of', type: 'date', width: 12 },
      { key: 'teacher', header: 'Teacher', width: 24 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'subject', header: 'Subject', width: 18 },
      { key: 'title', header: 'Title', width: 36 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'submitted_at', header: 'Submitted', type: 'datetime', width: 20 },
    ],
    query: (p) => ({
      text: `SELECT lp.week_start, e.display_name AS teacher, k.code AS class_code, cs.name AS section, sub.name AS subject, lp.title, lp.status::text, lp.submitted_at
               FROM lesson_plans lp JOIN employees e ON e.id = lp.employee_id JOIN class_sections cs ON cs.id = lp.class_section_id JOIN classes k ON k.id = cs.class_id
               JOIN subjects sub ON sub.id = lp.subject_id
              WHERE ($1::bigint IS NULL OR lp.academic_year_id = $1::bigint)
                AND ($2::bigint[] IS NULL OR lp.class_section_id = ANY($2::bigint[]))
              ORDER BY lp.week_start DESC, k.display_order, cs.name`,
      values: [str(p.academicYearId), idList(p.sectionIds)],
    }),
  },
  substitutions: {
    id: 'substitutions',
    title: 'Timetable substitutions',
    permission: 'academics.substitution.view',
    scope: 'class_section',
    maxRows: 50_000,
    columns: [
      { key: 'on_date', header: 'Date', type: 'date', width: 12 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'period', header: 'Period', width: 10 },
      { key: 'absent', header: 'Absent teacher', width: 24 },
      { key: 'substitute', header: 'Substitute', width: 24 },
      { key: 'subject', header: 'Subject', width: 18 },
      { key: 'reason', header: 'Reason', width: 24 },
    ],
    query: (p) => ({
      text: `SELECT s.on_date, k.code AS class_code, cs.name AS section, tp.name AS period, a.display_name AS absent, b.display_name AS substitute, sub.name AS subject, s.reason
               FROM timetable_substitutions s JOIN class_sections cs ON cs.id = s.class_section_id JOIN classes k ON k.id = cs.class_id
               JOIN timetable_periods tp ON tp.id = s.period_id LEFT JOIN employees a ON a.id = s.absent_employee_id JOIN employees b ON b.id = s.substitute_employee_id
               LEFT JOIN subjects sub ON sub.id = s.subject_id
              WHERE ($1::bigint IS NULL OR s.academic_year_id = $1::bigint)
                AND ($2::bigint[] IS NULL OR s.class_section_id = ANY($2::bigint[]))
              ORDER BY s.on_date DESC, k.display_order, cs.name`,
      values: [str(p.academicYearId), idList(p.sectionIds)],
    }),
  },
  admissions_funnel: {
    id: 'admissions_funnel',
    title: 'Admissions funnel',
    permission: 'admissions.application.view',
    maxRows: 10_000,
    columns: [
      { key: 'cycle_code', header: 'Cycle', width: 14 },
      { key: 'cycle_status', header: 'Cycle status', width: 12 },
      { key: 'class_code', header: 'Class', width: 10 },
      { key: 'status', header: 'Application status', width: 16 },
      { key: 'applications', header: 'Applications', type: 'number', width: 12 },
    ],
    query: () => ({
      text: `SELECT cycle_code, cycle_status, class_code, status, applications FROM mart.admissions_funnel ORDER BY cycle_code, class_code, status`,
      values: [],
    }),
  },
  transport_riders: {
    id: 'transport_riders',
    title: 'Students on the bus',
    permission: 'transport.route.view',
    maxRows: 50_000,
    columns: [
      { key: 'route_code', header: 'Route', width: 10 },
      { key: 'route_name', header: 'Route name', width: 24 },
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'stop_name', header: 'Stop', width: 20 },
      { key: 'pickup_time', header: 'Pickup', width: 8 },
      { key: 'drop_time', header: 'Drop', width: 8 },
      { key: 'guardian_mobile', header: 'Guardian mobile', width: 14 },
    ],
    query: (p) => ({
      text: `SELECT r.code AS route_code, r.name AS route_name, s.admission_no, s.display_name AS student,
                    (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                      WHERE e.student_id = s.id AND e.academic_year_id = a.academic_year_id AND e.status = 'active' LIMIT 1) AS section,
                    a.stop_name, to_char(a.pickup_time, 'HH24:MI') AS pickup_time, to_char(a.drop_time, 'HH24:MI') AS drop_time,
                    (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) AS guardian_mobile
               FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id JOIN students s ON s.id = a.student_id
              WHERE ($1::bigint IS NULL OR a.academic_year_id = $1::bigint)
              ORDER BY r.code, a.pickup_time NULLS LAST, s.display_name`,
      values: [str(p.academicYearId)],
    }),
  },
  transport_requests: {
    id: 'transport_requests',
    title: 'Transport requests',
    permission: 'transport.request.view',
    maxRows: 20_000,
    columns: [
      { key: 'requested_at', header: 'Requested', type: 'datetime', width: 20 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'kind', header: 'Request', width: 10 },
      { key: 'route_code', header: 'Route', width: 10 },
      { key: 'stop_name', header: 'Stop', width: 20 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'decided_at', header: 'Decided', type: 'datetime', width: 20 },
      { key: 'decision_note', header: 'Note', width: 30 },
    ],
    query: (p) => ({
      text: `SELECT q.requested_at, s.display_name AS student, q.kind::text, r.code AS route_code, st.name AS stop_name, q.status::text, q.decided_at, q.decision_note
               FROM transport_requests q JOIN students s ON s.id = q.student_id LEFT JOIN transport_routes r ON r.id = q.route_id LEFT JOIN transport_stops st ON st.id = q.stop_id
              WHERE ($1::bigint IS NULL OR q.academic_year_id = $1::bigint)
              ORDER BY q.requested_at DESC`,
      values: [str(p.academicYearId)],
    }),
  },
  transport_vehicle_logs: {
    id: 'transport_vehicle_logs',
    title: 'Vehicle logs',
    permission: 'transport.log.view',
    maxRows: 50_000,
    columns: [
      { key: 'log_date', header: 'Date', type: 'date', width: 12 },
      { key: 'reg_no', header: 'Vehicle', width: 14 },
      { key: 'route_code', header: 'Route', width: 10 },
      { key: 'driver', header: 'Driver', width: 20 },
      { key: 'odometer_start', header: 'Odo start', type: 'number', width: 10 },
      { key: 'odometer_end', header: 'Odo end', type: 'number', width: 10 },
      { key: 'km', header: 'Km', type: 'number', width: 8 },
      { key: 'fuel_litres', header: 'Fuel (l)', type: 'number', width: 8 },
      { key: 'fuel_cost', header: 'Fuel cost', type: 'number', width: 10 },
      { key: 'trips', header: 'Trips', type: 'number', width: 6 },
      { key: 'incident', header: 'Incident', width: 30 },
    ],
    query: (p) => ({
      text: `SELECT l.log_date, v.reg_no, r.code AS route_code, d.name AS driver, l.odometer_start, l.odometer_end, (l.odometer_end - l.odometer_start) AS km, l.fuel_litres, l.fuel_cost, l.trips, l.incident
               FROM transport_vehicle_logs l JOIN transport_vehicles v ON v.id = l.vehicle_id LEFT JOIN transport_routes r ON r.id = l.route_id LEFT JOIN transport_drivers d ON d.id = l.driver_id
              WHERE ($1::date IS NULL OR l.log_date >= $1::date) AND ($2::date IS NULL OR l.log_date <= $2::date)
              ORDER BY l.log_date DESC, v.reg_no`,
      values: [str(p.from), str(p.to)],
    }),
  },
  comms_delivery: {
    id: 'comms_delivery',
    title: 'Message delivery by day and channel',
    permission: 'comms.message.view',
    maxRows: 50_000,
    columns: [
      { key: 'on_date', header: 'Date', type: 'date', width: 12 },
      { key: 'channel', header: 'Channel', width: 12 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'messages', header: 'Messages', type: 'number', width: 10 },
    ],
    query: (p) => ({
      text: `SELECT on_date, channel, status, messages FROM mart.comms_delivery_daily
              WHERE ($1::date IS NULL OR on_date >= $1::date) AND ($2::date IS NULL OR on_date <= $2::date)
              ORDER BY on_date DESC, channel, status`,
      values: [str(p.from), str(p.to)],
    }),
  },
  parent_queries: {
    id: 'parent_queries',
    title: 'Parent queries and response times',
    permission: 'engagement.query.view',
    maxRows: 50_000,
    columns: [
      { key: 'number', header: 'Number', width: 14 },
      { key: 'opened_at', header: 'Opened', type: 'datetime', width: 20 },
      { key: 'category_code', header: 'Category', width: 14 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'subject', header: 'Subject', width: 36 },
      { key: 'first_response_hours', header: 'First response (h)', type: 'number', width: 12 },
      { key: 'closed_at', header: 'Closed', type: 'datetime', width: 20 },
      { key: 'rating', header: 'Rating', type: 'number', width: 8 },
    ],
    query: (p) => ({
      text: `SELECT q.number, q.opened_at, q.category_code, s.display_name AS student, q.subject,
                    round(extract(epoch FROM (q.first_response_at - q.opened_at)) / 3600, 1) AS first_response_hours, q.closed_at, q.rating
               FROM parent_queries q JOIN students s ON s.id = q.student_id
              WHERE ($1::bigint IS NULL OR q.academic_year_id = $1::bigint)
                AND ($2::boolean IS NOT TRUE OR q.closed_at IS NULL)
              ORDER BY q.opened_at DESC`,
      values: [str(p.academicYearId), p.onlyOpen === true || p.onlyOpen === 'true'],
    }),
  },
  employees: {
    id: 'employees',
    title: 'Employees',
    permission: 'people.employee.view',
    maxRows: 20_000,
    columns: [
      { key: 'employee_code', header: 'Code', width: 10 },
      { key: 'display_name', header: 'Name', width: 28 },
      { key: 'designation', header: 'Designation', width: 20 },
      { key: 'department', header: 'Department', width: 16 },
      { key: 'employee_type', header: 'Type', width: 12 },
      { key: 'joined_on', header: 'Joined', type: 'date', width: 12 },
      { key: 'left_on', header: 'Left', type: 'date', width: 12 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'mobile', header: 'Mobile', width: 14 },
      { key: 'email', header: 'Email', width: 28 },
    ],
    query: (p) => ({
      text: `SELECT employee_code, display_name, designation, department, employee_type::text, joined_on, left_on, status::text, mobile, email
               FROM employees WHERE deleted_at IS NULL AND ($1::text IS NULL OR status::text = $1::text)
              ORDER BY department NULLS LAST, display_name`,
      values: [str(p.status)],
    }),
  },
  // ---- Sprint 15: the fee reports centre (screen and file share these definitions) -----------------
  fee_day_book: {
    id: 'fee_day_book',
    title: 'Fee day book',
    permission: 'fees.ledger.view',
    maxRows: 50_000,
    columns: [
      { key: 'received_on', header: 'Date', type: 'date', width: 12 },
      { key: 'kind', header: 'Kind', width: 8 },
      { key: 'ledger', header: 'Ledger', width: 8 },
      { key: 'receipt_no', header: 'Receipt no.', width: 20 },
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'payer', header: 'Payer', width: 28 },
      { key: 'section', header: 'Section', width: 8 },
      { key: 'mode', header: 'Mode', width: 8 },
      { key: 'instrument_no', header: 'Cheque / DD', width: 14 },
      { key: 'bank_name', header: 'Bank', width: 16 },
      { key: 'reference', header: 'Reference', width: 18 },
      { key: 'principal', header: 'Fee', type: 'number', width: 12 },
      { key: 'late_fee', header: 'Late fee', type: 'number', width: 10 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'received_by', header: 'Received by', width: 18 },
      { key: 'cleared_on', header: 'Bank cleared', type: 'date', width: 12 },
    ],
    query: (p) => ({
      // reversed receipts never appear (legacy Cancel/reversed); bounced ones stay with their status; paid
      // refunds are negative lines on the day they were paid out
      text: `SELECT * FROM (
               SELECT 'receipt' AS kind, p.ledger::text AS ledger, p.receipt_no, p.received_on, s.admission_no, s.display_name AS payer,
                      k.code || '-' || cs.name AS section, COALESCE(p.mode_label, p.mode) AS mode, p.instrument_no, p.bank_name, p.reference,
                      (p.amount - p.late_fee) AS principal, p.late_fee, p.amount, p.status, COALESCE(u.display_name, 'Online') AS received_by, p.cleared_on
                 FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.received_by
                 LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status = 'active'
                 LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status <> 'reversed'
               UNION ALL
               SELECT 'misc', 'misc', m.receipt_no, m.received_on, s.admission_no, m.payer_name, k.code || '-' || cs.name, m.mode, m.instrument_no, m.bank_name, m.reference,
                      m.amount, 0, m.amount, m.status, u.display_name, m.cleared_on
                 FROM misc_receipts m LEFT JOIN students s ON s.id = m.student_id LEFT JOIN users u ON u.id = m.received_by
                 LEFT JOIN enrolments e ON e.student_id = m.student_id AND e.academic_year_id = m.academic_year_id AND e.status = 'active'
                 LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
                WHERE m.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND m.status = 'posted'
               UNION ALL
               SELECT 'refund', p.ledger::text, p.receipt_no, r.paid_on, s.admission_no, s.display_name, k.code || '-' || cs.name, r.mode, NULL, NULL, r.reference,
                      -r.amount, 0, -r.amount, 'refund', u.display_name, NULL
                 FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = r.decided_by
                 LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status = 'active'
                 LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
                WHERE r.status = 'paid' AND r.paid_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE)
             ) x
             WHERE ($3::text IS NULL OR x.ledger = $3) AND ($4::text IS NULL OR x.mode = $4)
             ORDER BY x.received_on, x.kind, x.receipt_no`,
      values: [str(p.from) ?? str(p.to), str(p.to) ?? str(p.from), str(p.ledger), str(p.mode)],
    }),
  },
  // day-wise and mode-wise collection: one row per day, ledger and payment mode (refunds paid are minus)
  fee_mode_summary: {
    id: 'fee_mode_summary',
    title: 'Mode-wise collection',
    permission: 'fees.ledger.view',
    maxRows: 50_000,
    columns: [
      { key: 'on_date', header: 'Date', type: 'date', width: 12 },
      { key: 'ledger', header: 'Ledger', width: 10 },
      { key: 'mode', header: 'Mode', width: 10 },
      { key: 'receipts', header: 'Receipts', type: 'number', width: 10 },
      { key: 'fee', header: 'Fee', type: 'number', width: 14 },
      { key: 'late_fee', header: 'Late fee', type: 'number', width: 12 },
      { key: 'refunds', header: 'Refunds', type: 'number', width: 12 },
      { key: 'amount', header: 'Net amount', type: 'number', width: 14 },
    ],
    query: (p) => ({
      text: `SELECT x.on_date, x.ledger, x.mode, sum(x.receipts)::int AS receipts, sum(x.fee) AS fee, sum(x.late_fee) AS late_fee, sum(x.refunds) AS refunds,
                    sum(x.fee + x.late_fee - x.refunds) AS amount
               FROM (
                 SELECT p.received_on AS on_date, p.ledger::text AS ledger, COALESCE(p.mode_label, p.mode) AS mode, 1 AS receipts, (p.amount - p.late_fee) AS fee, p.late_fee, 0::numeric AS refunds
                   FROM fee_payments p
                  WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced')
                 UNION ALL
                 SELECT m.received_on, 'misc', m.mode, 1, m.amount, 0, 0
                   FROM misc_receipts m
                  WHERE m.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND m.status = 'posted'
                 UNION ALL
                 SELECT r.paid_on, p.ledger::text, r.mode, 0, 0, 0, r.amount
                   FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id
                  WHERE r.status = 'paid' AND r.paid_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE)
               ) x
              WHERE ($3::text IS NULL OR x.ledger = $3)
              GROUP BY x.on_date, x.ledger, x.mode
              ORDER BY x.on_date, x.ledger, x.mode`,
      values: [str(p.from) ?? str(p.to), str(p.to) ?? str(p.from), str(p.ledger)],
    }),
  },
  // cheques and drafts that came back: the receipt, the instrument, the charge raised and whether it is paid
  fee_cheque_bounce: {
    id: 'fee_cheque_bounce',
    title: 'Cheque bounce report',
    permission: 'fees.ledger.view',
    maxRows: 20_000,
    columns: [
      { key: 'bounced_on', header: 'Bounced on', type: 'date', width: 12 },
      { key: 'received_on', header: 'Received on', type: 'date', width: 12 },
      { key: 'receipt_no', header: 'Receipt no.', width: 20 },
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'section', header: 'Section', width: 8 },
      { key: 'ledger', header: 'Ledger', width: 8 },
      { key: 'mode', header: 'Mode', width: 8 },
      { key: 'instrument_no', header: 'Cheque / DD no.', width: 14 },
      { key: 'instrument_date', header: 'Cheque date', type: 'date', width: 12 },
      { key: 'bank_name', header: 'Bank', width: 18 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'charge', header: 'Bounce charge', type: 'number', width: 12 },
      { key: 'charge_paid', header: 'Charge paid', type: 'number', width: 12 },
      { key: 'reason', header: 'Reason', width: 30 },
      { key: 'approved_by', header: 'Approved by', width: 18 },
    ],
    query: (p) => ({
      text: `SELECT (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS bounced_on, p.received_on, p.receipt_no, s.admission_no, s.display_name AS student,
                    k.code || '-' || cs.name AS section, p.ledger::text AS ledger, p.mode, p.instrument_no, p.instrument_date, p.bank_name, p.amount,
                    a.charge, COALESCE(cd.paid, 0) AS charge_paid, a.reason, u.display_name AS approved_by
               FROM fee_adjustments a JOIN fee_payments p ON p.id = a.payment_id JOIN students s ON s.id = p.student_id
               LEFT JOIN fee_demands cd ON cd.id = a.charge_demand_id LEFT JOIN users u ON u.id = a.decided_by
               LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status = 'active'
               LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
              WHERE a.kind = 'bounce' AND a.status = 'approved'
                AND (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN COALESCE($1::date, CURRENT_DATE - 30) AND COALESCE($2::date, CURRENT_DATE)
                AND ($3::text IS NULL OR p.ledger::text = $3)
              ORDER BY a.decided_at DESC`,
      values: [str(p.from), str(p.to), str(p.ledger)],
    }),
  },
  fee_head_tally: {
    id: 'fee_head_tally',
    title: 'Head-wise tally',
    permission: 'fees.ledger.view',
    maxRows: 50_000,
    columns: [
      { key: 'on_date', header: 'Date', type: 'date', width: 12 },
      { key: 'ledger', header: 'Ledger', width: 8 },
      { key: 'head_code', header: 'Head', width: 12 },
      { key: 'head_name', header: 'Head name', width: 28 },
      { key: 'receipts', header: 'Receipts', type: 'number', width: 10 },
      { key: 'amount', header: 'Amount', type: 'number', width: 14 },
    ],
    query: (p) => ({
      // long form (one row per day, ledger and head); the screen pivots days x heads. Refunds reverse
      // allocations, so they net out of the head they came from; reversed and bounced receipts are out.
      text: `SELECT * FROM (
               SELECT p.received_on AS on_date, h.ledger::text AS ledger, h.code AS head_code, h.name AS head_name, count(DISTINCT p.id)::int AS receipts, sum(a.amount) AS amount
                 FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced')
                GROUP BY p.received_on, h.ledger, h.code, h.name
               UNION ALL
               SELECT p.received_on, p.ledger::text, 'LATE_FEE', 'Late fee', count(DISTINCT p.id)::int, sum(lf.amount)
                 FROM fee_late_fee_postings lf JOIN fee_payments p ON p.id = lf.payment_id
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced')
                GROUP BY p.received_on, p.ledger
               UNION ALL
               SELECT p.received_on, p.ledger::text, 'ADVANCE', 'Advance / unallocated', count(*)::int, sum(p.amount - p.late_fee - COALESCE(al.total, 0))
                 FROM fee_payments p LEFT JOIN LATERAL (SELECT sum(amount) AS total FROM fee_payment_allocations WHERE payment_id = p.id) al ON true
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced') AND p.amount - p.late_fee - COALESCE(al.total, 0) > 0.005
                GROUP BY p.received_on, p.ledger
               UNION ALL
               SELECT m.received_on, 'misc', h.code, h.name, count(*)::int, sum(m.amount)
                 FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                WHERE m.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND m.status = 'posted'
                GROUP BY m.received_on, h.code, h.name
             ) x
             WHERE ($3::text IS NULL OR x.ledger = $3)
             ORDER BY x.on_date, x.ledger, x.head_code`,
      values: [str(p.from), str(p.to), str(p.ledger)],
    }),
  },
  fee_defaulters: {
    id: 'fee_defaulters',
    title: 'Fee defaulters',
    permission: 'fees.ledger.view',
    scope: 'class_section',
    maxRows: 20_000,
    columns: [
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'student', header: 'Student', width: 28 },
      { key: 'section', header: 'Section', width: 8 },
      { key: 'oldest_due', header: 'Oldest due', type: 'date', width: 12 },
      { key: 'days_overdue', header: 'Days overdue', type: 'number', width: 10 },
      { key: 'balance', header: 'Balance', type: 'number', width: 12 },
      { key: 'guardian_mobile', header: 'Guardian mobile', width: 14 },
      { key: 'last_reminded_on', header: 'Last reminded', type: 'date', width: 12 },
    ],
    query: (p) => ({
      text: `SELECT d.student_id::text, d.admission_no, d.student_name AS student, d.section, d.class_section_id::text,
                    min(d.due_on) AS oldest_due, max(d.days_overdue)::int AS days_overdue, sum(d.balance) AS balance,
                    (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                      WHERE sg.student_id = d.student_id AND sg.receives_notifications AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS guardian_mobile,
                    (SELECT max(r.sent_on) FROM fee_reminders r WHERE r.student_id = d.student_id) AS last_reminded_on
               FROM mart.fee_dues d
              WHERE d.academic_year_id = $1::bigint AND d.balance > 0 AND d.due_on < COALESCE($2::date, CURRENT_DATE)
                AND ($3::bigint IS NULL OR d.class_id = $3::bigint)
                AND ($4::bigint[] IS NULL OR d.class_section_id = ANY($4::bigint[]))
              GROUP BY d.student_id, d.admission_no, d.student_name, d.section, d.class_section_id
             HAVING sum(d.balance) >= COALESCE($5::numeric, 0)
              ORDER BY sum(d.balance) DESC, d.student_name`,
      values: [
        str(p.academicYearId),
        str(p.asOf),
        str(p.classId),
        idList(p.sectionIds) ?? (str(p.sectionId) ? [str(p.sectionId)] : null),
        str(p.minBalance),
      ],
    }),
  },
  fee_forecast: {
    id: 'fee_forecast',
    title: 'Fee forecast (expected vs collected by class and month)',
    permission: 'fees.ledger.view',
    maxRows: 5_000,
    columns: [
      { key: 'month', header: 'Due month', width: 10 },
      { key: 'class_code', header: 'Class', width: 8 },
      { key: 'ledger', header: 'Ledger', width: 8 },
      { key: 'students', header: 'Students', type: 'number', width: 10 },
      { key: 'expected', header: 'Expected', type: 'number', width: 14 },
      { key: 'collected', header: 'Collected', type: 'number', width: 14 },
      { key: 'balance', header: 'Balance', type: 'number', width: 14 },
    ],
    query: (p) => ({
      text: `SELECT to_char(due_month, 'YYYY-MM') AS month, class_code, ledger, students, expected, collected, balance
               FROM mart.fee_forecast WHERE academic_year_id = $1::bigint AND ($2::text IS NULL OR ledger = $2)
              ORDER BY due_month, class_code, ledger`,
      values: [str(p.academicYearId), str(p.ledger)],
    }),
  },
  fee_tally_vouchers: {
    id: 'fee_tally_vouchers',
    title: 'Ledger export (Tally vouchers)',
    permission: 'fees.ledger.view',
    maxRows: 100_000,
    columns: [
      { key: 'date', header: 'Date', type: 'date', width: 12 },
      { key: 'voucher_type', header: 'Voucher type', width: 10 },
      { key: 'voucher_no', header: 'Voucher no.', width: 20 },
      { key: 'party', header: 'Party', width: 30 },
      { key: 'ledger_name', header: 'Ledger', width: 24 },
      { key: 'amount', header: 'Amount', type: 'number', width: 12 },
      { key: 'mode', header: 'Mode', width: 8 },
      { key: 'instrument_no', header: 'Cheque / DD', width: 14 },
      { key: 'bank_name', header: 'Bank', width: 16 },
      { key: 'narration', header: 'Narration', width: 40 },
    ],
    query: (p) => ({
      // one line per voucher and credit ledger; the XML generator groups lines by voucher_no
      text: `SELECT * FROM (
               SELECT p.received_on AS date, 'Receipt' AS voucher_type, p.receipt_no AS voucher_no, s.admission_no || ' - ' || s.display_name AS party,
                      h.name AS ledger_name, sum(a.amount) AS amount, p.mode, p.instrument_no, p.bank_name,
                      'Fee receipt ' || p.receipt_no || CASE WHEN p.instrument_no IS NOT NULL THEN ' ' || p.mode || ' ' || p.instrument_no ELSE '' END AS narration
                 FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id
                 JOIN students s ON s.id = p.student_id
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced') AND ($3::text IS NULL OR p.ledger::text = $3)
                GROUP BY p.id, p.received_on, p.receipt_no, s.admission_no, s.display_name, h.name, p.mode, p.instrument_no, p.bank_name
               UNION ALL
               SELECT p.received_on, 'Receipt', p.receipt_no, s.admission_no || ' - ' || s.display_name, 'Late fee', sum(lf.amount), p.mode, p.instrument_no, p.bank_name,
                      'Late fee on ' || p.receipt_no
                 FROM fee_late_fee_postings lf JOIN fee_payments p ON p.id = lf.payment_id JOIN students s ON s.id = p.student_id
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced') AND ($3::text IS NULL OR p.ledger::text = $3)
                GROUP BY p.id, p.received_on, p.receipt_no, s.admission_no, s.display_name, p.mode, p.instrument_no, p.bank_name
               UNION ALL
               SELECT p.received_on, 'Receipt', p.receipt_no, s.admission_no || ' - ' || s.display_name, 'Fee advance', p.amount - p.late_fee - COALESCE(al.total, 0), p.mode, p.instrument_no, p.bank_name,
                      'Advance on ' || p.receipt_no
                 FROM fee_payments p JOIN students s ON s.id = p.student_id
                 LEFT JOIN LATERAL (SELECT sum(amount) AS total FROM fee_payment_allocations WHERE payment_id = p.id) al ON true
                WHERE p.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND p.status NOT IN ('reversed', 'bounced') AND ($3::text IS NULL OR p.ledger::text = $3)
                  AND p.amount - p.late_fee - COALESCE(al.total, 0) > 0.005
               UNION ALL
               SELECT m.received_on, 'Receipt', m.receipt_no, m.payer_name, h.name, m.amount, m.mode, m.instrument_no, m.bank_name, 'Misc receipt ' || m.receipt_no
                 FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                WHERE m.received_on BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE) AND m.status = 'posted' AND ($3::text IS NULL OR $3 = 'misc')
             ) x ORDER BY x.date, x.voucher_no, x.ledger_name`,
      values: [str(p.from), str(p.to), str(p.ledger)],
    }),
  },
  board_results: {
    id: 'board_results',
    title: 'Board results',
    permission: 'exams.board_result.view',
    maxRows: 50_000,
    columns: [
      { key: 'board', header: 'Board', width: 8 },
      { key: 'class_label', header: 'Class', width: 6 },
      { key: 'roll_no', header: 'Roll no', width: 12 },
      { key: 'candidate_name', header: 'Candidate', width: 26 },
      { key: 'admission_no', header: 'Admission no', width: 12 },
      { key: 'subject_code', header: 'Subject code', width: 8 },
      { key: 'subject_name', header: 'Subject', width: 22 },
      { key: 'theory', header: 'Theory', type: 'number', width: 8 },
      { key: 'practical', header: 'Practical', type: 'number', width: 8 },
      { key: 'total', header: 'Total', type: 'number', width: 8 },
      { key: 'grade', header: 'Grade', width: 6 },
      { key: 'result', header: 'Result', width: 10 },
    ],
    query: (p) => ({
      text: `SELECT r.board, r.class_label, r.roll_no, r.candidate_name, s.admission_no, r.subject_code, r.subject_name, r.theory, r.practical, r.total, r.grade, r.result
               FROM board_results r LEFT JOIN students s ON s.id = r.student_id
              WHERE ($1::bigint IS NULL OR r.academic_year_id = $1::bigint) AND ($2::text IS NULL OR r.class_label = $2)
              ORDER BY r.class_label, r.roll_no, r.subject_code`,
      values: [str(p.academicYearId), str(p.classLabel)],
    }),
  },
  // ---- communication v2 (2026-10-02): usage statement, delivery log, failures ------------------------
  comms_monthly_usage: {
    id: 'comms_monthly_usage',
    title: 'Communication usage statement',
    permission: 'comms.report.view',
    maxRows: 5_000,
    columns: [
      { key: 'month', header: 'Month', width: 12 },
      { key: 'channel', header: 'Channel', width: 12 },
      { key: 'messages', header: 'Messages', type: 'number', width: 11 },
      { key: 'units', header: 'Units (SMS parts)', type: 'number', width: 14 },
      { key: 'delivered', header: 'Delivered', type: 'number', width: 11 },
      { key: 'read', header: 'Read', type: 'number', width: 9 },
      { key: 'failed', header: 'Failed', type: 'number', width: 9 },
      { key: 'pending', header: 'Pending', type: 'number', width: 9 },
      { key: 'delivery_rate', header: 'Delivery %', type: 'number', width: 11 },
      { key: 'cost', header: 'Cost (₹)', type: 'number', width: 12 },
      { key: 'credited', header: 'Credits added', type: 'number', width: 13 },
    ],
    // dates are school days (India time); the channel filter applies to messages and credits alike
    query: (p) => ({
      text: `WITH m AS (
               SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, channel::text AS channel,
                      count(*)::int AS messages, COALESCE(sum(units), 0)::int AS units,
                      count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
                      count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read,
                      count(*) FILTER (WHERE status = 'failed')::int AS failed,
                      count(*) FILTER (WHERE status IN ('queued', 'sending', 'sent'))::int AS pending,
                      round(COALESCE(sum(cost), 0), 2)::float AS cost
                 FROM comms_messages
                WHERE channel <> 'push' AND status <> 'cancelled'
                  AND ($1::date IS NULL OR created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
                  AND ($2::date IS NULL OR created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
                  AND ($3::text IS NULL OR channel::text = $3)
                GROUP BY 1, 2),
             k AS (
               SELECT to_char(date_trunc('month', on_date), 'YYYY-MM') AS month, channel::text AS channel, sum(units)::float AS credited
                 FROM comms_credits
                WHERE ($1::date IS NULL OR on_date >= $1::date) AND ($2::date IS NULL OR on_date <= $2::date)
                  AND ($3::text IS NULL OR channel::text = $3)
                GROUP BY 1, 2)
             SELECT COALESCE(m.month, k.month) AS month, COALESCE(m.channel, k.channel) AS channel_code,
                    (CASE COALESCE(m.channel, k.channel) WHEN 'sms' THEN 'SMS' WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'email' THEN 'Email' ELSE COALESCE(m.channel, k.channel)::text END) AS channel,
                    COALESCE(m.messages, 0) AS messages, COALESCE(m.units, 0) AS units, COALESCE(m.delivered, 0) AS delivered,
                    COALESCE(m.read, 0) AS read, COALESCE(m.failed, 0) AS failed, COALESCE(m.pending, 0) AS pending,
                    CASE WHEN COALESCE(m.messages, 0) > 0 THEN round(100.0 * m.delivered / m.messages, 1)::float ELSE NULL END AS delivery_rate,
                    COALESCE(m.cost, 0) AS cost, COALESCE(k.credited, 0) AS credited
               FROM m FULL JOIN k ON k.month = m.month AND k.channel = m.channel
              ORDER BY 1 DESC, array_position(ARRAY['sms', 'whatsapp', 'email'], COALESCE(m.channel, k.channel))`,
      values: [str(p.from), str(p.to), str(p.channel)],
    }),
  },
  comms_delivery_log: {
    id: 'comms_delivery_log',
    title: 'Communication delivery report',
    permission: 'comms.report.view',
    maxRows: 100_000,
    columns: [
      { key: 'created_at', header: 'Queued', type: 'datetime', width: 18 },
      { key: 'channel', header: 'Channel', width: 10 },
      { key: 'title', header: 'Message', width: 26 },
      { key: 'student_name', header: 'Student', width: 24 },
      { key: 'class_section', header: 'Class', width: 10 },
      { key: 'admission_no', header: 'Admission no.', width: 14 },
      { key: 'recipient', header: 'Sent to', width: 24 },
      { key: 'address', header: 'Mobile / email', width: 26 },
      { key: 'status', header: 'Status', width: 11 },
      { key: 'units', header: 'Units', type: 'number', width: 7 },
      { key: 'cost', header: 'Cost (₹)', type: 'number', width: 9 },
      { key: 'sent_at', header: 'Sent', type: 'datetime', width: 18 },
      { key: 'delivered_at', header: 'Delivered', type: 'datetime', width: 18 },
      { key: 'read_at', header: 'Read', type: 'datetime', width: 18 },
      { key: 'last_error', header: 'Error', width: 30 },
      { key: 'sent_by', header: 'Sent by', width: 18 },
      { key: 'message', header: 'Message text', width: 60 },
    ],
    /**
     * One row per message with the student it was about (name, class, admission no.). Filters: dates
     * (India time) or a month (YYYY-MM), channel, status, a count bucket from the dashboard / statement
     * (delivered, failed, pending, read; all = not cancelled), a search over mobile / email / names /
     * admission no., and a request.
     */
    query: (p) => {
      const month = str(p.month);
      const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
      const from = ym ? `${ym}-01` : str(p.from);
      const to = ym ? null : str(p.to);
      const bucket = str(p.bucket);
      return {
        text: `SELECT m.id::text AS id, m.created_at, (CASE m.channel::text WHEN 'sms' THEN 'SMS' WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'email' THEN 'Email' WHEN 'push' THEN 'App push' ELSE m.channel::text END) AS channel,
                      COALESCE(r.title, t.name, 'Single message') AS title,
                      s.display_name AS student_name, en.cls AS class_section, s.admission_no,
                      COALESCE(x.name, u.display_name) AS recipient, m.recipient_address AS address, m.status::text AS status, m.units,
                      round(COALESCE(m.cost, 0), 2)::float AS cost, m.sent_at, m.delivered_at, m.read_at, m.last_error, sb.display_name AS sent_by,
                      left(concat_ws(' · ', NULLIF(m.subject, ''),
                           CASE WHEN m.format = 'html' THEN btrim(regexp_replace(regexp_replace(m.body, '<[^>]+>', ' ', 'g'), '(\\s|&nbsp;)+', ' ', 'g')) ELSE m.body END), 2000) AS message
                 FROM comms_messages m
                 LEFT JOIN message_requests r ON r.id = m.message_request_id
                 LEFT JOIN message_request_recipients x ON x.message_id = m.id
                 LEFT JOIN comms_templates t ON t.id = m.template_id
                 LEFT JOIN users u ON u.id = m.recipient_user_id
                 LEFT JOIN users sb ON sb.id = m.created_by
                 LEFT JOIN students s ON s.id = COALESCE(x.student_id,
                      (SELECT st.id FROM students st WHERE m.recipient_user_id IS NOT NULL AND st.user_id = m.recipient_user_id LIMIT 1))
                 LEFT JOIN LATERAL (
                      SELECT k.code || '-' || cs.name AS cls
                        FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                       WHERE e.student_id = s.id
                       ORDER BY (e.status = 'active') DESC, e.academic_year_id DESC LIMIT 1) en ON true
                WHERE ($1::date IS NULL OR m.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
                  AND ($2::date IS NULL OR m.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
                  AND ($8::boolean IS NOT TRUE OR m.created_at < ((($1::date + interval '1 month')::date)::timestamp AT TIME ZONE 'Asia/Kolkata'))
                  AND ($3::text IS NULL OR m.channel::text = $3) AND ($4::text IS NULL OR m.status::text = $4)
                  AND ($5::bigint IS NULL OR m.message_request_id = $5::bigint)
                  AND (CASE $6::text
                         WHEN 'delivered' THEN m.status = 'delivered'
                         WHEN 'failed' THEN m.status = 'failed'
                         WHEN 'pending' THEN m.status IN ('queued', 'sending', 'sent')
                         WHEN 'read' THEN m.read_at IS NOT NULL
                         WHEN 'all' THEN m.status <> 'cancelled' AND m.channel <> 'push'
                         ELSE true END)
                  AND ($7::text IS NULL OR concat_ws(' ', m.recipient_address, x.name, u.display_name, s.display_name, s.admission_no) ILIKE '%' || $7 || '%')
                ORDER BY m.created_at DESC, m.id DESC`,
        values: [
          from,
          to,
          str(p.channel),
          str(p.status),
          str(p.requestId),
          bucket && ['delivered', 'failed', 'pending', 'read', 'all'].includes(bucket)
            ? bucket
            : null,
          str(p.q),
          Boolean(ym),
        ],
      };
    },
  },
  helpdesk_tickets: {
    id: 'helpdesk_tickets',
    title: 'Helpdesk tickets',
    // The helpdesk API picks the tickets a person may see and queues this itself (params.ids); asking
    // for it through the general export route needs the see-everything permission.
    permission: 'helpdesk.ticket.viewall',
    maxRows: 5000,
    columns: [
      { key: 'number', header: 'Number', width: 13 },
      { key: 'opened_at', header: 'Raised', type: 'datetime', width: 16 },
      { key: 'head', header: 'Query type', width: 18 },
      { key: 'subject', header: 'Subject', width: 30 },
      { key: 'about', header: 'Student / raised by', width: 26 },
      { key: 'owner', header: 'With', width: 20 },
      { key: 'status', header: 'Status', width: 11 },
      { key: 'level', header: 'Level', type: 'number', width: 6 },
      { key: 'due_at', header: 'Due', type: 'datetime', width: 16 },
      { key: 'closed_at', header: 'Closed', type: 'datetime', width: 16 },
      { key: 'rating', header: 'Rating', width: 8 },
    ],
    /** The chosen tickets (params.ids), latest first. */
    query: (p) => ({
      text: `SELECT q.id::text AS id, q.number, q.opened_at, COALESCE(k.name, q.category_code) AS head, q.subject,
                    concat_ws(' · ', s.display_name, s.admission_no,
                              COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = q.raised_by_user_id LIMIT 1), ru.display_name)) AS about,
                    COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = q.assigned_user_id LIMIT 1), au.display_name,
                             (SELECT r.name FROM roles r WHERE r.code = q.assigned_role AND (r.school_id IS NULL OR r.school_id = q.school_id) AND r.deleted_at IS NULL
                               ORDER BY r.school_id NULLS LAST LIMIT 1), q.assigned_role) AS owner,
                    replace(q.status::text, '_', ' ') AS status, q.level, q.due_at, q.closed_at,
                    repeat('★', COALESCE(q.rating, 0)) AS rating
               FROM parent_queries q
               LEFT JOIN students s ON s.id = q.student_id
               LEFT JOIN users ru ON ru.id = q.raised_by_user_id
               LEFT JOIN users au ON au.id = q.assigned_user_id
               LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = q.desk AND k.code = q.category_code
              WHERE q.id = ANY($1::bigint[]) AND q.kind <> 'leave'
              ORDER BY q.opened_at DESC, q.id DESC`,
      values: [(idList(p.ids) ?? []).filter((x) => /^\d{1,18}$/.test(x))],
    }),
  },
  visitor_register: {
    id: 'visitor_register',
    title: 'Visitor register',
    permission: 'engagement.visitor.manage',
    maxRows: 5000,
    columns: [
      { key: 'number', header: 'Pass no.', width: 12 },
      { key: 'visitor', header: 'Visitor', width: 22 },
      { key: 'visitor_type', header: 'Type', width: 14 },
      { key: 'mobile', header: 'Mobile', width: 12 },
      { key: 'organisation', header: 'Coming from', width: 18 },
      { key: 'party_size', header: 'People', type: 'number', width: 6 },
      { key: 'to_meet', header: 'To meet', width: 18 },
      { key: 'purpose', header: 'Purpose', width: 24 },
      { key: 'equipment', header: 'Carrying', width: 18 },
      { key: 'in_at', header: 'In', type: 'datetime', width: 15 },
      { key: 'out_at', header: 'Out', type: 'datetime', width: 15 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    /** The register for a period, a status (inside, waiting, today, left) and a search. */
    query: (p) => ({
      text: `SELECT v.id::text AS id, v.number, v.visitor_name AS visitor, v.visitor_type, v.mobile, v.organisation, v.party_size,
                    COALESCE(NULLIF(concat_ws(' · ', h.name, COALESCE(e.display_name, he.display_name)), ''), v.to_meet) AS to_meet,
                    v.purpose, v.equipment, v.in_at, v.out_at,
                    (CASE v.state WHEN 'waiting' THEN 'Waiting' WHEN 'inside' THEN 'Inside' WHEN 'left' THEN 'Left' ELSE 'Not let in' END) AS status
               FROM visitor_log v
               LEFT JOIN appointment_hosts h ON h.id = v.host_id
               LEFT JOIN employees e ON e.id = v.with_employee_id
               LEFT JOIN employees he ON he.id = h.employee_id
              WHERE (CASE $1::text
                       WHEN 'inside' THEN v.state = 'inside'
                       WHEN 'waiting' THEN v.state = 'waiting'
                       WHEN 'left' THEN v.state = 'left'
                       WHEN 'today' THEN (COALESCE(v.in_at, v.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND v.state <> 'cancelled'
                       ELSE true END)
                AND ($2::date IS NULL OR (COALESCE(v.in_at, v.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
                AND ($3::date IS NULL OR (COALESCE(v.in_at, v.created_at) AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
                AND ($4::text IS NULL OR v.visitor_type = $4)
                AND ($5::text IS NULL OR concat_ws(' ', v.number, v.visitor_name, v.mobile, v.organisation, v.vehicle_no, v.purpose, v.to_meet) ILIKE '%' || $5 || '%')
              ORDER BY COALESCE(v.in_at, v.created_at) DESC, v.id DESC`,
      values: [str(p.state), str(p.from), str(p.to), str(p.type), str(p.q)],
    }),
  },
  comms_failures: {
    id: 'comms_failures',
    title: 'Communication failures by reason',
    permission: 'comms.report.view',
    maxRows: 2_000,
    columns: [
      { key: 'channel', header: 'Channel', width: 10 },
      { key: 'reason', header: 'Reason', width: 50 },
      { key: 'messages', header: 'Messages', type: 'number', width: 10 },
      { key: 'last_seen', header: 'Last seen', type: 'datetime', width: 18 },
    ],
    query: (p) => ({
      text: `SELECT (CASE channel::text WHEN 'sms' THEN 'SMS' WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'email' THEN 'Email' ELSE channel::text::text END) AS channel, COALESCE(NULLIF(left(last_error, 200), ''), 'Unknown') AS reason, count(*)::int AS messages, max(failed_at) AS last_seen
               FROM comms_messages WHERE status = 'failed'
                AND ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < ($2::date + 1))
              GROUP BY 1, 2 ORDER BY 3 DESC`,
      values: [str(p.from), str(p.to)],
    }),
  },
};

// every master is a dataset too (Excel, CSV and PDF exports of the grid)
for (const m of MASTERS) {
  const d = masterToDataset(m);
  DATASETS[d.id] = d;
}

export const DATASET_IDS = Object.keys(DATASETS) as [string, ...string[]];

export function datasetOrNull(id: string): DatasetDefinition | null {
  return Object.prototype.hasOwnProperty.call(DATASETS, id) ? DATASETS[id]! : null;
}
