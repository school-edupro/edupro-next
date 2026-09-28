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
};

export const DATASET_IDS = Object.keys(DATASETS) as [string, ...string[]];

export function datasetOrNull(id: string): DatasetDefinition | null {
  return Object.prototype.hasOwnProperty.call(DATASETS, id) ? DATASETS[id]! : null;
}
