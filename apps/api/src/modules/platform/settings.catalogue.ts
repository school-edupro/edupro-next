import { z } from 'zod';

/**
 * Typed school settings (S2-06). Unknown keys are rejected; values are validated by the key's schema and
 * stored as JSONB with a validity window. Procedures read them through app.setting(key).
 */
export interface SettingDefinition {
  schema: z.ZodTypeAny;
  default: unknown;
  description: string;
  module: string;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'amount with up to two decimals');

export const SETTINGS_CATALOGUE: Record<string, SettingDefinition> = {
  'security.break_glass_email': {
    schema: z.union([z.string().email(), z.literal('')]),
    default: '',
    description:
      'Security lead who receives the break-glass report when an emergency grant expires',
    module: 'platform',
  },
  'compat.holidays': {
    schema: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          name: z.string().min(1).max(80),
        }),
      )
      .max(200),
    default: [],
    description: 'Holiday list served to the current apps through the compatibility API',
    module: 'compat',
  },
  'compat.student_menu': {
    schema: z
      .array(
        z.object({
          menu_name: z.string().min(1).max(60),
          menu_link: z.string().min(1).max(200),
          link_order: z.number().int().min(0),
          category: z.string().max(40).default(''),
        }),
      )
      .max(60),
    default: [
      { menu_name: 'Attendance', menu_link: 'attendance', link_order: 1, category: 'Academics' },
      { menu_name: 'Homework', menu_link: 'homework', link_order: 2, category: 'Academics' },
      { menu_name: 'Fees', menu_link: 'fees', link_order: 3, category: 'Fees' },
      { menu_name: 'Notices', menu_link: 'notices', link_order: 4, category: 'Communication' },
    ],
    description: 'Menu served to the current student app through the compatibility API',
    module: 'compat',
  },
  'school.locale': {
    schema: z.enum(['en', 'hi']),
    default: 'en',
    description: 'Default interface language',
    module: 'platform',
  },
  'school.session_start_month': {
    schema: z.number().int().min(1).max(12),
    default: 4,
    description: 'Month in which the academic session starts (4 = April)',
    module: 'platform',
  },
  'security.session_hours': {
    schema: z.number().int().min(1).max(24),
    default: 12,
    description: 'Admin session length in hours',
    module: 'platform',
  },
  'admissions.admission_fee': {
    schema: money,
    default: '10000.00',
    description: 'Admission fee charged when an application is selected (Sprint 9)',
    module: 'admissions',
  },
  'admissions.number_prefix': {
    schema: z.string().regex(/^[A-Z]{1,4}$/),
    default: 'A',
    description: 'Prefix of admission numbers issued at admission',
    module: 'admissions',
  },
  'attendance.rfid_late_after': {
    schema: z.string().regex(/^\d{2}:\d{2}$/),
    default: '09:00',
    description: 'A first gate tap after this time (IST) marks the student late',
    module: 'attendance',
  },
  'attendance.weekly_off': {
    schema: z.array(z.number().int().min(1).max(7)).max(7),
    default: [7],
    description:
      'Weekly off days (ISO weekday numbers, 7 = Sunday); attendance cannot be marked on them',
    module: 'attendance',
  },
  'comms.alert_throttle_per_hour': {
    schema: z.number().int().min(1).max(60),
    default: 6,
    description:
      'Maximum alert messages (absence, bus, query updates) to one mobile in a rolling hour (Sprint 11)',
    module: 'comms',
  },
  'payments.gateway': {
    schema: z.enum(['mock', 'payu', 'razorpay', 'ccavenue']),
    default: 'mock',
    description:
      'Online payment gateway of the school (Sprint 13): PayU, Razorpay or CCAvenue; mock is the development gateway',
    module: 'payments',
  },
  'fees.tally.cash_ledger': {
    schema: z.string().trim().min(1).max(80),
    default: 'Cash',
    description: 'Tally ledger debited for cash receipts in the ledger export (Sprint 15)',
    module: 'fees',
  },
  'fees.tally.bank_ledger': {
    schema: z.string().trim().min(1).max(80),
    default: 'Bank',
    description: 'Tally ledger debited for cheque, DD, bank, UPI, card and online receipts',
    module: 'fees',
  },
  'workflow.escalate_roles': {
    schema: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/),
    default: 'school_admin',
    description:
      'Role codes added to an overdue approval step when its level has no escalation of its own (Sprint 17)',
    module: 'workflow',
  },
  'workflow.escalate_after_hours': {
    schema: z.coerce.number().int().min(1).max(720),
    default: 24,
    description: 'Hours after the SLA due time before an overdue step escalates (Sprint 17)',
    module: 'workflow',
  },
  'library.loan_days': {
    schema: z.coerce.number().int().min(1).max(90),
    default: 14,
    description: 'Days a copy may be kept before it is overdue (Sprint 17)',
    module: 'library',
  },
  'library.max_loans': {
    schema: z.coerce.number().int().min(1).max(20),
    default: 2,
    description: 'Copies a borrower may hold at once (Sprint 17)',
    module: 'library',
  },
  'library.fine_per_day': {
    schema: money,
    default: '2.00',
    description: 'Fine per overdue day per copy (Sprint 17)',
    module: 'library',
  },
  'transport.gps_retention_days': {
    schema: z.coerce.number().int().min(1).max(365),
    default: 30,
    description: 'Days of vehicle positions kept before the nightly purge (Sprint 17)',
    module: 'transport',
  },
  'insights.alert_roles': {
    schema: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/),
    default: 'school_admin',
    description: 'Role codes whose members receive anomaly alerts (comma separated, Sprint 15)',
    module: 'insights',
  },
  'fees.bounce_charge': {
    schema: money,
    default: '500.00',
    description: 'Charge added to the demand when a cheque or DD bounces (Sprint 14)',
    module: 'fees',
  },
  'fees.bounce_charge_head': {
    schema: z.string().regex(/^[A-Z0-9_]{2,20}$/),
    default: 'BOUNCE',
    description: 'Code of the misc fee head that carries the bounce charge (created if missing)',
    module: 'fees',
  },
  'fees.late_fee_waiver_approval': {
    schema: z.enum(['on', 'off']),
    default: 'on',
    description:
      'on: a late-fee waiver by the accounts desk waits for the approver; off: anyone with fees.late_fee.manage sets it directly',
    module: 'fees',
  },
  'fees.pay_plan': {
    schema: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']),
    default: 'monthly',
    description:
      'How often pupils pay: the school default; a class or a pupil (through approval) can differ',
    module: 'fees',
  },
  'fees.late_fee_mode': {
    schema: z.enum(['daywise', 'slab']),
    default: 'daywise',
    description: 'Late fee rule: per day after the due date, or fixed slabs after slab dates',
    module: 'fees',
  },
  'fees.late_fee_per_day': {
    schema: money,
    default: '0.00',
    description: 'Per-day late fee when the mode is daywise',
    module: 'fees',
  },
  'fees.instalment_visible_days_before': {
    schema: z.number().int().min(0).max(365),
    default: 30,
    description:
      'Families see an instalment this many days before its due date unless the period sets its own visible-from date (Sprint 12)',
    module: 'fees',
  },
  'fees.cheque_bounce_charge': {
    schema: money,
    default: '0.00',
    description: 'Charge added when a cheque bounces',
    module: 'fees',
  },
  'fees.receipt_prefix.school': {
    schema: z.string().regex(/^[A-Z]{1,6}$/),
    default: 'TF',
    description: 'Receipt prefix for the school ledger',
    module: 'fees',
  },
  'fees.receipt_prefix.hostel': {
    schema: z.string().regex(/^[A-Z]{1,6}$/),
    default: 'HF',
    description: 'Receipt prefix for the hostel ledger',
    module: 'fees',
  },
  'fees.receipt_prefix.misc': {
    schema: z.string().regex(/^[A-Z]{1,6}$/),
    default: 'MF',
    description: 'Receipt prefix for miscellaneous fees',
    module: 'fees',
  },
  'fees.receipt_prefix.admission': {
    schema: z.string().regex(/^[A-Z]{1,6}$/),
    default: 'ADM',
    description: 'Receipt prefix for admission fees',
    module: 'fees',
  },
  'attendance.absent_alert_channel': {
    schema: z.enum(['none', 'sms', 'whatsapp', 'push']),
    default: 'sms',
    description: 'Channel used for absent alerts to guardians',
    module: 'attendance',
  },
  'attendance.in_window': {
    schema: z.object({ start: time, end: time }),
    default: { start: '07:00', end: '10:00' },
    description: 'Time window in which the first RFID punch counts as arrival',
    module: 'attendance',
  },
  'academics.default_section_capacity': {
    schema: z.number().int().min(1).max(500),
    default: 40,
    description: 'Default capacity for a new section',
    module: 'academics',
  },
  'exams.reportcard.hold_for_fee_defaulters': {
    schema: z.boolean(),
    default: false,
    description: 'Withhold report cards from students with overdue fees',
    module: 'exams',
  },
};

// ---- Sprint 20: DPDP retention, data-principal requests, compatibility app versions ----
const retention = (def: number, min: number, what: string, module = 'platform') => ({
  schema: z.coerce.number().int().min(min).max(3650),
  default: def,
  description: `Days of ${what} kept before the nightly retention purge (Sprint 20)`,
  module,
});
SETTINGS_CATALOGUE['privacy.dsr_days'] = {
  schema: z.coerce.number().int().min(7).max(90),
  default: 30,
  description: 'Days allowed to answer a data-principal request (Sprint 20)',
  module: 'platform',
};
SETTINGS_CATALOGUE['privacy.retention.comms_body_days'] = retention(
  180,
  30,
  'message bodies (metadata is kept)',
);
SETTINGS_CATALOGUE['privacy.retention.login_events_days'] = retention(365, 90, 'sign-in events');
SETTINGS_CATALOGUE['privacy.retention.visitor_log_days'] = retention(365, 90, 'visitor log rows');
SETTINGS_CATALOGUE['privacy.retention.ai_messages_days'] = retention(
  180,
  30,
  'assistant conversations',
);
SETTINGS_CATALOGUE['compat.app_version_android'] = {
  schema: z.string().regex(/^\d+(\.\d+){0,3}$/),
  default: '1.0.0',
  description: 'Current Android build of the school apps (compat app_version)',
  module: 'platform',
};
SETTINGS_CATALOGUE['compat.app_version_ios'] = {
  schema: z.string().regex(/^\d+(\.\d+){0,3}$/),
  default: '1.0.0',
  description: 'Current iOS build of the school apps (compat app_version)',
  module: 'platform',
};
SETTINGS_CATALOGUE['compat.app_force_below'] = {
  schema: z.string().regex(/^\d+(\.\d+){0,3}$/),
  default: '0.0.0',
  description: 'Builds below this version must update before use (compat app_version)',
  module: 'platform',
};

// ---- Sprints 22-23: pilot feature flags, cut-over tolerance, hypercare SLAs ----
export const MODULE_FLAGS = [
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
  'insights',
  'reports',
  'system',
] as const;
SETTINGS_CATALOGUE['platform.modules_enabled'] = {
  schema: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/),
  default: MODULE_FLAGS.join(','),
  description:
    'Modules shown in the apps during the pilot (comma separated); hidden modules stay available to the API and the compat layer (Sprint 22)',
  module: 'platform',
};
SETTINGS_CATALOGUE['platform.cutover_tolerance_pct'] = {
  schema: z.coerce.number().min(0).max(5),
  default: 0,
  description:
    'Allowed difference in percent between legacy and live counts at the cut-over sign-off (Sprint 22)',
  module: 'platform',
};
SETTINGS_CATALOGUE['platform.hypercare_until'] = {
  schema: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  default: '',
  description: 'Last day of hypercare: the daily digest stops after it (Sprint 22)',
  module: 'platform',
};
for (const [sev, hours] of [
  ['s1', 4],
  ['s2', 24],
  ['s3', 72],
  ['s4', 168],
] as const)
  SETTINGS_CATALOGUE[`hypercare.sla_${sev}_hours`] = {
    schema: z.coerce.number().int().min(1).max(720),
    default: hours,
    description: `Hours to resolve a severity ${sev.toUpperCase()} hypercare issue (Sprint 22)`,
    module: 'platform',
  };

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOGUE);
