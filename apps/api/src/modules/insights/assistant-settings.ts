/**
 * Assistant set-up per school (0410, docs/design/91 phase C): which audiences may use the chatbot, how many questions
 * a person may ask a day, the topics switched off per audience, and the starter questions of the start screen.
 */
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import type { CatalogueEntry } from './catalogue';

export const AUDIENCES = ['student', 'parent', 'teacher', 'admin'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The audience of a caller kind: a family is a parent; unscoped staff are the office and admin. */
export const audienceOfKind = (kind: 'staff' | 'teacher' | 'family' | 'student'): Audience =>
  kind === 'family' ? 'parent' : kind === 'staff' ? 'admin' : kind;

/** The topics a school may switch off (the catalogue's departments), with their names. */
export const TOPICS: ReadonlyArray<{
  key: CatalogueEntry['department'];
  label: string;
  labelHi: string;
}> = [
  { key: 'attendance', label: 'Attendance', labelHi: 'उपस्थिति' },
  { key: 'academics', label: 'Classes and homework', labelHi: 'कक्षाएँ और गृहकार्य' },
  { key: 'exams', label: 'Exams and results', labelHi: 'परीक्षा और परिणाम' },
  { key: 'fees', label: 'Fees', labelHi: 'शुल्क' },
  { key: 'transport', label: 'Transport', labelHi: 'परिवहन' },
  { key: 'communication', label: 'Notices and messages', labelHi: 'सूचनाएँ और संदेश' },
  { key: 'admissions', label: 'Admissions', labelHi: 'प्रवेश' },
  { key: 'hr', label: 'Staff and HR', labelHi: 'कर्मचारी और HR' },
  {
    key: 'school',
    label: 'School, library and certificates',
    labelHi: 'विद्यालय, पुस्तकालय और प्रमाण पत्र',
  },
];

/** The starter questions a school has before it chooses its own. */
export const DEFAULT_STARTERS: Record<Audience, string[]> = {
  student: [
    'child_attendance',
    'child_timetable_today',
    'child_homework',
    'child_date_sheet',
    'child_results',
    'child_library',
  ],
  parent: [
    'child_attendance',
    'child_dues',
    'child_homework',
    'child_notices',
    'child_bus',
    'child_results',
  ],
  teacher: [
    'my_absentees',
    'my_timetable_today',
    'my_homework',
    'my_marks_status',
    'my_leave_balance',
    'my_own_attendance',
  ],
  admin: [
    'today_summary',
    'attendance_today',
    'fee_summary',
    'absentees_of_day',
    'fee_defaulters',
    'admissions_funnel',
  ],
};

export interface AssistantSettings {
  audiences: Record<Audience, boolean>;
  dailyLimit: number;
  topicsOff: Record<Audience, string[]>;
  starters: Record<Audience, string[]>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  audiences: { student: true, parent: true, teacher: true, admin: true },
  dailyLimit: 30,
  topicsOff: { student: [], parent: [], teacher: [], admin: [] },
  starters: { ...DEFAULT_STARTERS },
  updatedAt: null,
  updatedBy: null,
};

/** The catalogue entries an audience may have (by scope), for the set-up page's starter and topic choices. */
export function entriesOfAudience(entries: CatalogueEntry[], a: Audience): CatalogueEntry[] {
  return entries.filter((e) =>
    a === 'student' || a === 'parent'
      ? e.scope === 'student' && (a === 'parent' || !e.parentOnly)
      : a === 'teacher'
        ? e.scope === 'section' || e.scope === 'self'
        : e.scope === undefined || e.scope === 'self',
  );
}

const Topics = z
  .array(z.enum(TOPICS.map((t) => t.key) as [string, ...string[]]))
  .max(TOPICS.length);
const Ids = z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(8);
const PerAudience = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ student: t, parent: t, teacher: t, admin: t });

export const AssistantSettingsSchema = z.object({
  audiences: PerAudience(z.boolean()),
  dailyLimit: z.number().int().min(1).max(500),
  topicsOff: PerAudience(Topics),
  starters: PerAudience(Ids),
});
export class AssistantSettingsDto extends createZodDto(AssistantSettingsSchema) {}
