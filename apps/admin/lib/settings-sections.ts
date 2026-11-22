/**
 * School settings (docs/design/95): the areas of the settings page and each setting's plain name, help line and
 * control. The API keeps the values and checks them (`settings.catalogue.ts`); a key this file does not place shows
 * under Advanced until it is given a home.
 */

/** One setting as `GET /platform/settings` gives it. */
export interface SettingRow {
  key: string;
  module: string;
  description: string;
  value: unknown;
  /** The standard value (what the school has when it never set one). */
  default: unknown;
  isDefault: boolean;
  validFrom: string | null;
}

export interface Choice {
  value: string | number;
  label: string;
}

export type Control =
  | { kind: 'switch' }
  /** a text 'on' / 'off' value shown as a switch */
  | { kind: 'onoff' }
  | { kind: 'number'; unit?: string; min?: number; max?: number; step?: number }
  | { kind: 'money' }
  | { kind: 'text'; upper?: boolean; maxLength?: number; placeholder?: string }
  | { kind: 'email' }
  | { kind: 'time' }
  /** {start, end} times */
  | { kind: 'window' }
  /** '' or a date */
  | { kind: 'date' }
  | { kind: 'choice'; choices: Choice[] }
  /** a list of the choices (numbers or words), saved as a list */
  | { kind: 'multi'; choices: Choice[]; min?: number }
  /** a comma-separated list of the choices, saved as text */
  | { kind: 'csv'; choices: Choice[] }
  /** role codes, comma separated */
  | { kind: 'roles' }
  /** a list of objects edited as rows */
  | {
      kind: 'rows';
      columns: Array<{ key: string; label: string; type: 'text' | 'date' | 'number' }>;
    }
  /** a list of words, one per line */
  | { kind: 'lines'; placeholder?: string }
  | { kind: 'textarea'; maxLength?: number }
  | { kind: 'json' };

export interface SettingField {
  /** The setting's key in the API. */
  setting: string;
  label: string;
  help: string;
  control: Control;
  /** Edited on its own page: shown here as it is now, with a link there. */
  ownPage?: { href: string; label: string };
}

export interface SettingsSection {
  id: string;
  title: string;
  /** The card's line on the settings page. */
  summary: string;
  fields: SettingField[];
  /** Pages that go with the area (e.g. class-wise fee rules). */
  related?: Array<{ href: string; label: string; help: string }>;
  /** Support's area: the keys are shown and lists are edited with care. */
  advanced?: boolean;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MODULES = [
  'people',
  'admissions',
  'fees',
  'attendance',
  'workflow',
  'academics',
  'access',
  'communication',
  'engagement',
  'exams',
  'transport',
  'library',
  'purchase',
  'insights',
  'reports',
  'system',
];

const days = (label: string, help: string, key: string, min = 0, max?: number): SettingField => ({
  setting: key,
  label,
  help,
  control: { kind: 'number', unit: 'days', min, ...(max ? { max } : {}) },
});
const SIGN_IN = { href: '/system/sign-in', label: 'Sign-in settings' };
const FEE_MASTERS = { href: '/fees/masters', label: 'Fee masters' };
const BOARD = { href: '/exams/board-results?tab=setup', label: 'Board results set-up' };
const HOSTEL_WITHDRAWAL = {
  href: '/hostel/withdrawals/settings',
  label: 'Hostel withdrawal settings',
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'general',
    title: 'General',
    summary:
      'Language, when the session starts, the size of a new section, former pupils’ portal access',
    fields: [
      {
        setting: 'school.locale',
        label: 'Default language',
        help: 'The language the apps start in; each person can switch it.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी (Hindi)' },
          ],
        },
      },
      {
        setting: 'school.session_start_month',
        label: 'Academic session starts in',
        help: 'The month a new academic session begins.',
        control: { kind: 'choice', choices: MONTHS.map((m, i) => ({ value: i + 1, label: m })) },
      },
      {
        setting: 'academics.default_section_capacity',
        label: 'Pupils in a new section',
        help: 'The capacity a new section starts with; each section can have its own.',
        control: { kind: 'number', unit: 'pupils', min: 1, max: 500 },
      },
      days(
        'Former pupils keep portal access for',
        'A withdrawn pupil and the parents may still sign in to see their records for this many days; 0 closes it at once.',
        'people.former_portal_days',
        0,
        730,
      ),
    ],
  },
  {
    id: 'sign-in',
    title: 'Sign-in & security',
    summary: 'How long an admin session lasts, the break-glass report; how people sign in',
    fields: [
      {
        setting: 'security.session_hours',
        label: 'An admin session lasts',
        help: 'Hours before the admin app asks to sign in again.',
        control: { kind: 'number', unit: 'hours', min: 1, max: 24 },
      },
      {
        setting: 'security.break_glass_email',
        label: 'Break-glass report goes to',
        help: 'The security lead’s e-mail; it gets a report when an emergency access grant ends. Empty: no report.',
        control: { kind: 'email' },
      },
      {
        setting: 'auth.login_mode',
        label: 'How people sign in',
        help: 'One Auth, One Auth and then a code, or the code alone.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'oneauth', label: 'One Auth only' },
            { value: 'oneauth_otp', label: 'One Auth, then a code' },
            { value: 'otp', label: 'The code alone' },
          ],
        },
        ownPage: SIGN_IN,
      },
      {
        setting: 'auth.otp_channels',
        label: 'The sign-in code goes by',
        help: 'Every ticked way that reaches the person.',
        control: {
          kind: 'multi',
          min: 1,
          choices: [
            { value: 'email', label: 'E-mail' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'sms', label: 'SMS' },
          ],
        },
        ownPage: SIGN_IN,
      },
      {
        setting: 'auth.otp_on_screen',
        label: 'Show the sign-in code on screen too',
        help: 'While e-mail addresses are being corrected; every code shown is recorded.',
        control: { kind: 'switch' },
        ownPage: SIGN_IN,
      },
      {
        setting: 'auth.otp_remember',
        label: 'Allow “remember this device”',
        help: '30 days without the code on a device the person trusts.',
        control: { kind: 'switch' },
        ownPage: SIGN_IN,
      },
      {
        setting: 'auth.otp_sms_template',
        label: 'SMS template for the code',
        help: 'The DLT template; empty uses the active sign-in template.',
        control: { kind: 'text' },
        ownPage: SIGN_IN,
      },
      {
        setting: 'auth.otp_whatsapp_template',
        label: 'WhatsApp template for the code',
        help: 'The approved WhatsApp template; empty uses the active sign-in template.',
        control: { kind: 'text' },
        ownPage: SIGN_IN,
      },
    ],
  },
  {
    id: 'fees',
    title: 'Fees & receipts',
    summary: 'Late fee, bounce charges, waivers, deposit slips, receipt numbers, Tally ledgers',
    related: [
      {
        href: '/fees/rules',
        label: 'Fee rules',
        help: 'A class’s own late fee, bounce charge and last dates; the school’s pay plan',
      },
    ],
    fields: [
      {
        setting: 'fees.late_fee_mode',
        label: 'Late fee rule',
        help: 'The school’s rule; a class can have its own on Fee rules.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'daywise', label: 'Per day after the due date' },
            { value: 'slab', label: 'Fixed slabs after slab dates' },
          ],
        },
      },
      {
        setting: 'fees.late_fee_per_day',
        label: 'Late fee per day',
        help: 'Used when the rule is per day.',
        control: { kind: 'money' },
      },
      days(
        'Families see an instalment',
        'Days before its due date, unless the period sets its own date.',
        'fees.instalment_visible_days_before',
        0,
        365,
      ),
      {
        setting: 'fees.bounce_charge',
        label: 'Bounce charge',
        help: 'Added to the pupil’s dues when a cheque or draft bounces.',
        control: { kind: 'money' },
      },
      {
        setting: 'fees.bounce_charge_head',
        label: 'Fee head for the bounce charge',
        help: 'The code of the miscellaneous fee head that carries it (made if missing).',
        control: { kind: 'text', upper: true, maxLength: 20 },
      },
      {
        setting: 'fees.late_fee_waiver_approval',
        label: 'Late-fee waivers need approval',
        help: 'On: a waiver by the accounts desk waits for the approver. Off: it applies at once.',
        control: { kind: 'onoff' },
      },
      {
        setting: 'fees.deposit_slip_limit',
        label: 'Cheques and drafts on one deposit slip',
        help: 'More are split over several slips; 0 means no limit.',
        control: { kind: 'number', unit: 'at most', min: 0, max: 500 },
      },
      {
        setting: 'fees.receipt_prefix.school',
        label: 'Receipt number prefix: school fees',
        help: 'Capital letters, up to six.',
        control: { kind: 'text', upper: true, maxLength: 6 },
      },
      {
        setting: 'fees.receipt_prefix.hostel',
        label: 'Receipt number prefix: hostel fees',
        help: 'Capital letters, up to six.',
        control: { kind: 'text', upper: true, maxLength: 6 },
      },
      {
        setting: 'fees.receipt_prefix.misc',
        label: 'Receipt number prefix: miscellaneous fees',
        help: 'Capital letters, up to six.',
        control: { kind: 'text', upper: true, maxLength: 6 },
      },
      {
        setting: 'fees.receipt_prefix.admission',
        label: 'Receipt number prefix: admission fees',
        help: 'Capital letters, up to six.',
        control: { kind: 'text', upper: true, maxLength: 6 },
      },
      {
        setting: 'fees.tally.cash_ledger',
        label: 'Tally ledger for cash receipts',
        help: 'The ledger debited for cash in the Tally export.',
        control: { kind: 'text', maxLength: 80 },
      },
      {
        setting: 'fees.tally.bank_ledger',
        label: 'Tally ledger for bank receipts',
        help: 'The ledger debited for cheque, draft, bank, UPI, card and online receipts.',
        control: { kind: 'text', maxLength: 80 },
      },
      {
        setting: 'fees.pay_plan',
        label: 'How often pupils pay',
        help: 'The school’s plan; a class or a pupil can differ.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'half_yearly', label: 'Half-yearly' },
            { value: 'yearly', label: 'Yearly' },
          ],
        },
        ownPage: { href: '/fees/rules', label: 'Fee rules' },
      },
      {
        setting: 'fees.bill_layout',
        label: 'Fee bill',
        help: 'The school’s annual bill or the instalment-wise bill.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'annual', label: 'Annual bill' },
            { value: 'instalment', label: 'Instalment-wise bill' },
          ],
        },
        ownPage: FEE_MASTERS,
      },
      {
        setting: 'fees.receipt_layout',
        label: 'Fee receipt',
        help: 'Two panels (the school’s layout) or classic.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'two_panel', label: 'Two panels' },
            { value: 'classic', label: 'Classic' },
          ],
        },
        ownPage: FEE_MASTERS,
      },
      {
        setting: 'fees.receipt_copies',
        label: 'Receipt copies printed',
        help: 'Which copies print on one receipt.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'parent', label: 'Parent' },
            { value: 'parent_school', label: 'Parent and school' },
            { value: 'parent_school_office', label: 'Parent, school and office' },
          ],
        },
        ownPage: FEE_MASTERS,
      },
      {
        setting: 'payments.gateway',
        label: 'Online payment gateway',
        help: 'Where families pay online.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'mock', label: 'Test (no money moves)' },
            { value: 'payu', label: 'PayU' },
            { value: 'razorpay', label: 'Razorpay' },
            { value: 'ccavenue', label: 'CCAvenue' },
          ],
        },
        ownPage: { href: '/fees/gateways', label: 'Payment gateways' },
      },
    ],
  },
  {
    id: 'admissions',
    title: 'Admissions',
    summary: 'The admission fee and the admission number prefix',
    fields: [
      {
        setting: 'admissions.admission_fee',
        label: 'Admission fee',
        help: 'Charged when an application is selected.',
        control: { kind: 'money' },
      },
      {
        setting: 'admissions.number_prefix',
        label: 'Admission number prefix',
        help: 'Capital letters, up to four, before each new admission number.',
        control: { kind: 'text', upper: true, maxLength: 4 },
      },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    summary: 'When a pupil is late, the arrival window, weekly off days, absence alerts',
    fields: [
      {
        setting: 'attendance.rfid_late_after',
        label: 'Late after',
        help: 'A pupil’s first gate tap after this time marks them late.',
        control: { kind: 'time' },
      },
      {
        setting: 'attendance.in_window',
        label: 'Arrival window',
        help: 'The first card tap in this window counts as the arrival.',
        control: { kind: 'window' },
      },
      {
        setting: 'attendance.weekly_off',
        label: 'Weekly off days',
        help: 'Attendance cannot be marked on these days.',
        control: { kind: 'multi', choices: WEEKDAYS.map((d, i) => ({ value: i + 1, label: d })) },
      },
      {
        setting: 'attendance.absent_alert_channel',
        label: 'Absence alerts to families go by',
        help: 'How the family hears that a pupil is absent.',
        control: {
          kind: 'choice',
          choices: [
            { value: 'none', label: 'No alert' },
            { value: 'sms', label: 'SMS' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'push', label: 'App notification' },
          ],
        },
      },
    ],
  },
  {
    id: 'library',
    title: 'Library',
    summary: 'Loan days, books at once, fines, lost and damaged books, reservations, stock checks',
    fields: [
      days('A book may be kept for', 'Then it is overdue.', 'library.loan_days', 1, 90),
      {
        setting: 'library.max_loans',
        label: 'Books a borrower may hold at once',
        help: 'For pupils and staff alike.',
        control: { kind: 'number', unit: 'books', min: 1, max: 20 },
      },
      {
        setting: 'library.fine_per_day',
        label: 'Fine per late day, per book',
        help: 'Charged for each day a book is overdue.',
        control: { kind: 'money' },
      },
      {
        setting: 'library.lost_processing_fee',
        label: 'Lost-book processing fee',
        help: 'Charged with the book’s price; it goes on the miscellaneous fee.',
        control: { kind: 'money' },
      },
      {
        setting: 'library.damage_share_pct',
        label: 'Suggested charge for a damaged book',
        help: 'A share of the book’s price.',
        control: { kind: 'number', unit: '% of the price', min: 0, max: 100 },
      },
      {
        setting: 'library.reservations_per_borrower',
        label: 'Reservations per borrower',
        help: 'Books a pupil or staff member may have reserved at once; 0 means no reservations.',
        control: { kind: 'number', unit: 'books', min: 0, max: 10 },
      },
      days(
        'A returned book is held for',
        'For the first in line of its reservations.',
        'library.hold_days',
        1,
        30,
      ),
      days(
        'A closed stock check can reopen for',
        'Days after closing; 0 means never.',
        'library.stock_reopen_days',
        0,
        60,
      ),
    ],
  },
  {
    id: 'hostel',
    title: 'Hostel',
    summary: 'The withdrawal notice and its charge',
    fields: [
      {
        ...days(
          'Withdrawal notice',
          'A leaving date fewer days than this after the request keeps the next month’s hostel fee.',
          'hostel.withdrawal_notice_days',
          0,
          120,
        ),
        ownPage: HOSTEL_WITHDRAWAL,
      },
      {
        setting: 'hostel.withdrawal_notice_charge',
        label: 'Charge the next month on short notice',
        help: 'The next month of hostel fee when the notice is short.',
        control: { kind: 'switch' },
        ownPage: HOSTEL_WITHDRAWAL,
      },
    ],
  },
  {
    id: 'exams',
    title: 'Exams & results',
    summary: 'Report cards for fee defaulters; board results for parents and their rules',
    fields: [
      {
        setting: 'exams.reportcard.hold_for_fee_defaulters',
        label: 'Hold report cards of pupils with overdue fees',
        help: 'Families with overdue fees do not get the report card until they pay.',
        control: { kind: 'switch' },
      },
      {
        setting: 'exams.board_result.parents',
        label: 'Show board results to parents',
        help: 'A child’s CBSE board result (subjects, marks, grades) on the parent app.',
        control: { kind: 'switch' },
        ownPage: BOARD,
      },
      {
        setting: 'exams.board_rules',
        label: 'Board result analysis rules',
        help: 'Best five, distinction and pass marks and the grade scale, a class at a time.',
        control: { kind: 'json' },
        ownPage: BOARD,
      },
    ],
  },
  {
    id: 'alerts',
    title: 'Alerts & approvals',
    summary:
      'How many alerts one mobile gets, who gets anomaly alerts, when overdue approvals escalate',
    fields: [
      {
        setting: 'comms.alert_throttle_per_hour',
        label: 'Alerts to one mobile, at most',
        help: 'Absence, bus and query alerts in any one hour; more wait.',
        control: { kind: 'number', unit: 'an hour', min: 1, max: 60 },
      },
      {
        setting: 'insights.alert_roles',
        label: 'Anomaly alerts go to',
        help: 'The members of these roles get the alerts when figures look unusual.',
        control: { kind: 'roles' },
      },
      {
        setting: 'workflow.escalate_roles',
        label: 'Overdue approvals also go to',
        help: 'Added to an overdue step when its level has no escalation of its own.',
        control: { kind: 'roles' },
      },
      {
        setting: 'workflow.escalate_after_hours',
        label: 'An overdue step escalates after',
        help: 'Hours after its due time.',
        control: { kind: 'number', unit: 'hours', min: 1, max: 720 },
      },
    ],
  },
  {
    id: 'transport',
    title: 'Transport',
    summary: 'How long vehicle positions are kept',
    fields: [
      days(
        'Vehicle positions are kept for',
        'Older positions go in the nightly clean-up.',
        'transport.gps_retention_days',
        1,
        365,
      ),
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy & retention',
    summary:
      'Days to answer a data request; how long messages, sign-ins, visitors and assistant chats are kept',
    related: [
      {
        href: '/system/privacy',
        label: 'Privacy',
        help: 'The privacy notice, data requests and the breach log',
      },
    ],
    fields: [
      days(
        'Answer a data request within',
        'Days allowed to answer a person’s request about their data.',
        'privacy.dsr_days',
        7,
        90,
      ),
      days(
        'Message texts are kept for',
        'Then the text goes in the nightly clean-up (who, when and how stay).',
        'privacy.retention.comms_body_days',
        30,
        3650,
      ),
      days(
        'Sign-in records are kept for',
        'Then they go in the nightly clean-up.',
        'privacy.retention.login_events_days',
        90,
        3650,
      ),
      days(
        'Visitor log rows are kept for',
        'Then they go in the nightly clean-up.',
        'privacy.retention.visitor_log_days',
        90,
        3650,
      ),
      days(
        'Assistant conversations are kept for',
        'Then they go in the nightly clean-up.',
        'privacy.retention.ai_messages_days',
        30,
        3650,
      ),
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced (support)',
    summary:
      'For Mobilise support: old-app lists and versions, modules on, cut-over, hypercare, report columns',
    advanced: true,
    fields: [
      {
        setting: 'compat.holidays',
        label: 'Old apps: holiday list',
        help: 'The holidays the old school apps show.',
        control: {
          kind: 'rows',
          columns: [
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'name', label: 'Holiday', type: 'text' },
          ],
        },
      },
      {
        setting: 'compat.student_menu',
        label: 'Old apps: student menu',
        help: 'The menu the old student app shows.',
        control: {
          kind: 'rows',
          columns: [
            { key: 'menu_name', label: 'Name', type: 'text' },
            { key: 'menu_link', label: 'Link', type: 'text' },
            { key: 'link_order', label: 'Order', type: 'number' },
            { key: 'category', label: 'Group', type: 'text' },
          ],
        },
      },
      {
        setting: 'compat.app_version_android',
        label: 'Old apps: current Android version',
        help: 'For example 1.0.0.',
        control: { kind: 'text', maxLength: 20 },
      },
      {
        setting: 'compat.app_version_ios',
        label: 'Old apps: current iOS version',
        help: 'For example 1.0.0.',
        control: { kind: 'text', maxLength: 20 },
      },
      {
        setting: 'compat.app_force_below',
        label: 'Old apps: must update below version',
        help: 'Versions below this must update before use.',
        control: { kind: 'text', maxLength: 20 },
      },
      {
        setting: 'compat.app_update_message',
        label: 'Old apps: update message',
        help: 'What the old apps say when an update is due (e.g. install the new EduPro app, with its link); empty keeps the old words.',
        control: { kind: 'textarea', maxLength: 300 },
      },
      {
        setting: 'platform.modules_enabled',
        label: 'Modules shown in the apps',
        help: 'During the pilot; hidden modules stay available to the API.',
        control: { kind: 'csv', choices: MODULES.map((m) => ({ value: m, label: m })) },
      },
      {
        setting: 'platform.cutover_tolerance_pct',
        label: 'Cut-over tolerance',
        help: 'Allowed difference between the old and the new counts at the cut-over sign-off.',
        control: { kind: 'number', unit: '%', min: 0, max: 5, step: 0.1 },
      },
      {
        setting: 'platform.hypercare_until',
        label: 'Hypercare ends on',
        help: 'The daily hypercare digest stops after this day; empty: no end set.',
        control: { kind: 'date' },
      },
      ...(['s1', 's2', 's3', 's4'] as const).map((s): SettingField => ({
        setting: `hypercare.sla_${s}_hours`,
        label: `Hypercare: resolve a severity ${s.toUpperCase()} issue within`,
        help: 'Hours from when it is raised.',
        control: { kind: 'number', unit: 'hours', min: 1, max: 720 },
      })),
      {
        setting: 'fees.reminder_cc',
        label: 'Fee reminders: staff on copy',
        help: 'Employee ids, one per line; each gets the first reminder once and the run’s summary.',
        control: { kind: 'lines', placeholder: 'e.g. 15' },
      },
      {
        setting: 'fees.cheque_bounce_charge',
        label: 'Cheque bounce charge (older setting)',
        help: 'Charge added when a cheque bounces; Fees & receipts → Bounce charge is the one on the dues.',
        control: { kind: 'money' },
      },
      {
        setting: 'fees.report_columns',
        label: 'Fee reports: columns left out by default',
        help: 'Per report; each person may choose their own.',
        control: { kind: 'json' },
      },
      {
        setting: 'hostel.report_columns',
        label: 'Hostel reports: columns left out by default',
        help: 'Per report (register, occupancy, withdrawals, leave).',
        control: { kind: 'json' },
      },
    ],
  },
];

/** The App layouts card: pages of their own. */
export const APP_LAYOUT_LINKS = [
  {
    href: '/system/settings/family-app-layout',
    label: 'Arrange the family app',
    help: 'Students and parents apart: tabs, Home shortcuts and cards, the Academics tab, the menu',
  },
  {
    href: '/system/settings/staff-app-layout',
    label: 'Arrange the staff app',
    help: 'Tabs and tab lists, Home shortcuts and work cards, the menu',
  },
];

/**
 * The areas with every setting the API has: a key no area places (a setting added later) joins Advanced, named by its
 * key and edited as JSON.
 */
export function sectionsFor(rows: SettingRow[]): SettingsSection[] {
  const placed = new Set(SETTINGS_SECTIONS.flatMap((s) => s.fields.map((f) => f.setting)));
  const known = new Set(rows.map((r) => r.key));
  const extra: SettingField[] = rows
    .filter((r) => !placed.has(r.key))
    .map((r) => ({ setting: r.key, label: r.key, help: r.description, control: { kind: 'json' } }));
  return SETTINGS_SECTIONS.map((s) => ({
    ...s,
    fields: [...s.fields.filter((f) => known.has(f.setting)), ...(s.advanced ? extra : [])],
  }));
}

/** A value as words (cards, own-page fields, search). */
export function valueText(field: SettingField, value: unknown): string {
  const c = field.control;
  const label = (v: unknown) =>
    'choices' in c ? (c.choices.find((x) => x.value === v)?.label ?? String(v)) : String(v);
  if (c.kind === 'switch') return value === true ? 'On' : 'Off';
  if (c.kind === 'onoff') return value === 'on' ? 'On' : 'Off';
  if (c.kind === 'choice') return label(value);
  if (c.kind === 'multi')
    return Array.isArray(value) && value.length ? value.map(label).join(', ') : 'None';
  if (c.kind === 'csv' || c.kind === 'roles')
    return typeof value === 'string' && value ? value.split(',').map(label).join(', ') : 'None';
  if (c.kind === 'money') {
    const n = Number(value);
    return Number.isFinite(n)
      ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: String(value).includes('.') ? 2 : 0, maximumFractionDigits: 2 })}`
      : String(value);
  }
  if (c.kind === 'number') return `${String(value)}${c.unit ? ` ${c.unit}` : ''}`;
  if (c.kind === 'window' && value && typeof value === 'object') {
    const w = value as { start?: string; end?: string };
    return `${w.start ?? ''} to ${w.end ?? ''}`;
  }
  if (c.kind === 'rows' || c.kind === 'lines')
    return Array.isArray(value) ? `${String(value.length)} rows` : '—';
  if (c.kind === 'json') return 'Set as a list (see its page)';
  return value === '' || value == null ? 'Not set' : String(value);
}
