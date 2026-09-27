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

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOGUE);
