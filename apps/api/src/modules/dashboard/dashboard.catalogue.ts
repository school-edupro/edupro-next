/**
 * The landing page's widgets (docs/design/26-admin-landing.md): each with the permission(s) that show it
 * (any one), and the default set of each role. A widget the user may not see is never sent.
 */
export interface WidgetDef {
  key: string;
  title: string;
  /** any one of these shows the widget; empty = everyone */
  anyOf: string[];
  /** wide widgets take two columns on a large screen */
  wide?: boolean;
  /** what the school may set besides title and size: days ahead or rows shown, [min, max, default] */
  days?: [number, number, number];
  count?: [number, number, number];
}

export const WIDGETS: WidgetDef[] = [
  { key: 'profile', title: 'Profile', anyOf: [] },
  { key: 'quick_actions', title: 'Quick Actions', anyOf: [], wide: true },
  { key: 'today', title: 'Today at a Glance', anyOf: [], wide: true },
  { key: 'approvals', title: 'Waiting for Me', anyOf: [] },
  { key: 'news', title: 'News and Office Orders', anyOf: [], count: [3, 20, 8] },
  {
    key: 'attendance_trend',
    title: 'Attendance Trend',
    anyOf: ['attendance.session.view', 'attendance.session.mark'],
    wide: true,
  },
  { key: 'staff_attendance', title: 'Staff Attendance Today', anyOf: ['attendance.punch.view'] },
  {
    key: 'birthdays_staff',
    title: 'Staff Birthdays',
    anyOf: ['people.employee.view'],
    days: [1, 31, 7],
  },
  {
    key: 'birthdays_students',
    title: 'Student Birthdays',
    anyOf: ['people.student.view'],
    days: [1, 31, 7],
  },
  { key: 'holidays', title: 'Holidays', anyOf: [], count: [3, 20, 8] },
  {
    key: 'fees_today',
    title: 'Fee Collection Today',
    anyOf: ['fees.ledger.view', 'fees.demand.view'],
    wide: true,
  },
  {
    key: 'fees_dues',
    title: 'Dues and Defaulters',
    anyOf: ['fees.ledger.view', 'fees.demand.view'],
  },
  {
    key: 'admissions',
    title: 'Admissions',
    anyOf: ['admissions.application.view', 'admissions.cycle.view'],
  },
  {
    key: 'front_office',
    title: 'Front Office',
    anyOf: [
      'engagement.visitor.manage',
      'engagement.gate_pass.view',
      'engagement.appointment.checkin',
    ],
  },
  {
    key: 'helpdesk',
    title: 'Helpdesk',
    anyOf: ['helpdesk.ticket.respond', 'engagement.query.view'],
    count: [1, 10, 3],
  },
  {
    key: 'transport',
    title: 'Transport',
    anyOf: ['transport.request.view', 'transport.route.view'],
  },
  { key: 'hostel', title: 'Hostel', anyOf: ['hostel.room.view'] },
  { key: 'library', title: 'Library', anyOf: ['library.catalogue.view', 'library.loan.circulate'] },
  { key: 'clinic', title: 'Clinic', anyOf: ['engagement.clinic.view'] },
];

const ALL_DAY = ['profile', 'quick_actions', 'approvals', 'news', 'holidays'];

/** Built-in defaults by role; the school admin may replace them (dashboard_role_defaults). */
export const ROLE_DEFAULTS: Record<string, string[]> = {
  school_admin: [
    'profile',
    'today',
    'quick_actions',
    'approvals',
    'attendance_trend',
    'fees_today',
    'news',
    'birthdays_staff',
    'birthdays_students',
    'holidays',
    'admissions',
    'helpdesk',
    'staff_attendance',
  ],
  group_admin: [
    'profile',
    'today',
    'quick_actions',
    'approvals',
    'attendance_trend',
    'fees_today',
    'news',
    'birthdays_staff',
    'birthdays_students',
    'holidays',
    'admissions',
    'helpdesk',
  ],
  accountant: [
    'profile',
    'fees_today',
    'quick_actions',
    'fees_dues',
    'approvals',
    'news',
    'holidays',
  ],
  front_office: [
    'profile',
    'front_office',
    'quick_actions',
    'admissions',
    'helpdesk',
    'birthdays_students',
    'news',
    'holidays',
  ],
  front_desk: ['profile', 'front_office', 'quick_actions', 'helpdesk', 'news', 'holidays'],
  gate_security: ['profile', 'front_office', 'quick_actions', 'holidays'],
  transport_incharge: ['profile', 'transport', 'quick_actions', ...ALL_DAY.slice(2)],
  warden: ['profile', 'hostel', 'quick_actions', ...ALL_DAY.slice(2)],
  hostel_clerk: ['profile', 'hostel', 'quick_actions', ...ALL_DAY.slice(2)],
  librarian: ['profile', 'library', 'quick_actions', ...ALL_DAY.slice(2)],
  school_doctor: ['profile', 'clinic', 'quick_actions', ...ALL_DAY.slice(2)],
  school_nurse: ['profile', 'clinic', 'quick_actions', ...ALL_DAY.slice(2)],
  academic_coordinator: [
    'profile',
    'attendance_trend',
    'quick_actions',
    'approvals',
    'news',
    'holidays',
  ],
};

/** The order in which a user's roles choose their landing (the first one held wins). */
export const ROLE_ORDER = [
  'group_admin',
  'school_admin',
  'accountant',
  'front_office',
  'front_desk',
  'transport_incharge',
  'warden',
  'hostel_clerk',
  'librarian',
  'school_doctor',
  'school_nurse',
  'academic_coordinator',
  'gate_security',
];

export const FALLBACK = ['profile', 'quick_actions', 'approvals', 'news', 'holidays'];

/** Roles that never land on the admin app (portal and staff-app users, support accounts). */
export const NO_LANDING = new Set([
  'parent',
  'student',
  'former_parent',
  'former_student',
  'class_teacher',
  'subject_teacher',
  'auditor',
  'erp_support',
  'support_engineer',
  'sensitive_data_viewer',
]);
