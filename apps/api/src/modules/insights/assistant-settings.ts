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

/** The chat window's name before the school gives its own (docs/design/92). */
export const DEFAULT_NAME = 'MobiAI';

/** The subtitle under the name per audience, in English and Hindi, before the school writes its own. */
export const DEFAULT_SUBTITLES: Record<Audience, { en: string; hi: string }> = {
  student: { en: 'Your smart study assistant', hi: 'आपका स्मार्ट पढ़ाई सहायक' },
  parent: { en: 'Your smart parent assistant', hi: 'आपका स्मार्ट अभिभावक सहायक' },
  teacher: { en: 'Your smart teaching assistant', hi: 'आपका स्मार्ट शिक्षण सहायक' },
  admin: { en: 'Your smart admin assistant', hi: 'आपका स्मार्ट प्रशासनिक सहायक' },
};

/**
 * The Quick Update when the window opens (docs/design/92): each line is the one-line answer of an approved query run
 * with the person's rights; one the person may not run, or whose topic is off, is left out.
 */
export const QUICK: Record<Audience, string[]> = {
  student: ['child_attendance', 'child_timetable_today', 'child_homework'],
  parent: ['child_attendance', 'child_dues', 'child_homework'],
  teacher: ['my_absentees', 'my_timetable_today', 'my_leave_balance'],
  admin: ['today_summary', 'open_queries'],
};

export interface AssistantSettings {
  audiences: Record<Audience, boolean>;
  dailyLimit: number;
  topicsOff: Record<Audience, string[]>;
  starters: Record<Audience, string[]>;
  /** the chat window's name */
  name: string;
  /** the school's subtitle per audience ('' = the standard one) */
  subtitles: Record<Audience, string>;
  /** docs/design/93: Claude's help per audience (families wait for a consent that names Anthropic) */
  claude: Record<Audience, boolean>;
  /** Claude answers a month, set by Mobilise (null: the server's default) */
  claudeMonthlyLimit: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  audiences: { student: true, parent: true, teacher: true, admin: true },
  dailyLimit: 30,
  topicsOff: { student: [], parent: [], teacher: [], admin: [] },
  starters: { ...DEFAULT_STARTERS },
  name: DEFAULT_NAME,
  subtitles: { student: '', parent: '', teacher: '', admin: '' },
  claude: { student: false, parent: false, teacher: false, admin: false },
  claudeMonthlyLimit: null,
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
  /** docs/design/92: left out, the saved name and subtitles stay */
  name: z.string().trim().min(1).max(40).optional(),
  subtitles: PerAudience(z.string().trim().max(80)).optional(),
  /** docs/design/93: left out, the saved switches stay */
  claude: PerAudience(z.boolean()).optional(),
});

/** The audiences Claude may help today (docs/design/93: staff first; families after the consent names Anthropic). */
export const CLAUDE_AUDIENCES: readonly Audience[] = ['teacher', 'admin'];
export class AssistantSettingsDto extends createZodDto(AssistantSettingsSchema) {}
