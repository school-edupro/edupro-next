import { z } from 'zod';
import type { BoardSubjectKind } from './board-subjects';

/**
 * The board analysis rules (docs/design/88, "Analysis rules a class", 18 Nov 2026): each class (X, XII) has its own
 * best five — a subject always in (English, the best language or none), the rest (the best marks or the first as
 * CBSE printed them), and what an optional subject may do (replace a weaker one, never count, or replace only a
 * failed one — CBSE's own rule) with the kinds that are optional — its distinction and pass marks, and its grade
 * scale (the school's own bands, 2 to 12 grades covering 0–100). The defaults are the school's workbooks', so the
 * figures stay as they were until the school changes them. The setting keeps its history; today's rules count for
 * every year shown, so the years compare fairly.
 */

export type BoardClass = 'X' | 'XII';

export const BEST_INCLUDE = ['language', 'english', 'none'] as const;
export const BEST_REST = ['best', 'printed'] as const;
export const BEST_OPTIONAL = ['replace', 'never', 'failed'] as const;
/** the kinds a class can mark optional (internal subjects never count anyway) */
export const OPTIONAL_KINDS = ['language', 'main', 'skill', 'additional'] as const;

export interface BestFiveSpec {
  /** the subject always counted: English, the best language, or none */
  include: (typeof BEST_INCLUDE)[number];
  /** the rest: the best marks, or the first as CBSE printed them */
  rest: (typeof BEST_REST)[number];
  /** an optional subject may replace a weaker one, never counts, or replaces only a failed one (CBSE's rule) */
  optional: (typeof BEST_OPTIONAL)[number];
  /** the subject kinds that are optional in this class */
  optionalKinds: Array<(typeof OPTIONAL_KINDS)[number]>;
}

export interface GradeBand {
  grade: string;
  /** whole marks, both ends counted */
  from: number;
  to: number;
}

export interface BoardRules {
  bestFive: BestFiveSpec;
  /** Marks from which a subject counts as a distinction. */
  distinction: number;
  /** Marks below which a subject counts as a failure. */
  passMarks: number;
  /** Grades from the marks on the scale, or as CBSE printed them (matched to the scale's names). */
  grades: 'marks' | 'printed';
  /** the class's grade scale, the highest first, covering 0–100 */
  scale: GradeBand[];
}

/** The school's workbook scale: A1 91–100 … C2 41–50, D 33–40, E1 below. */
export const DEFAULT_SCALE: GradeBand[] = [
  { grade: 'A1', from: 91, to: 100 },
  { grade: 'A2', from: 81, to: 90 },
  { grade: 'B1', from: 71, to: 80 },
  { grade: 'B2', from: 61, to: 70 },
  { grade: 'C1', from: 51, to: 60 },
  { grade: 'C2', from: 41, to: 50 },
  { grade: 'D', from: 33, to: 40 },
  { grade: 'E1', from: 0, to: 32 },
];

/** The defaults (the school's workbooks): the best language and the best four others; optional subjects may count. */
export const defaultRules = (cls: BoardClass): BoardRules => ({
  bestFive: {
    include: 'language',
    rest: 'best',
    optional: 'replace',
    optionalKinds: cls === 'X' ? ['skill', 'additional'] : ['additional'],
  },
  distinction: 75,
  passMarks: 33,
  grades: 'marks',
  scale: DEFAULT_SCALE.map((b) => ({ ...b })),
});

export const DEFAULT_BOARD_RULES: BoardRules = defaultRules('X');

const GRADE_NAME = /^[A-Za-z][A-Za-z0-9+*-]{0,3}$/;

/** What is wrong with a scale (sorted highest first), or null: 2–12 named grades, 0–100 with no gap or overlap. */
export function scaleProblem(scale: GradeBand[]): string | null {
  if (scale.length < 2 || scale.length > 12) return 'Give 2 to 12 grades.';
  const seen = new Set<string>();
  for (const b of scale) {
    if (!GRADE_NAME.test(b.grade))
      return `"${b.grade}" is not a grade: 1 to 4 letters, digits, + or - (A1, B+, E).`;
    const k = b.grade.toUpperCase();
    if (seen.has(k)) return `Grade ${b.grade} is given twice.`;
    seen.add(k);
    if (b.from > b.to)
      return `${b.grade}: "from" (${String(b.from)}) is above "to" (${String(b.to)}).`;
  }
  if (scale[0]!.to !== 100) return `The top grade (${scale[0]!.grade}) must end at 100.`;
  const last = scale[scale.length - 1]!;
  if (last.from !== 0) return `The lowest grade (${last.grade}) must start at 0.`;
  for (let i = 1; i < scale.length; i += 1) {
    const up = scale[i - 1]!;
    const b = scale[i]!;
    if (b.to !== up.from - 1)
      return `${up.grade} starts at ${String(up.from)}, so ${b.grade} must end at ${String(up.from - 1)} (it ends at ${String(b.to)}).`;
  }
  return null;
}

const sortScale = (s: GradeBand[]) => [...s].sort((a, b) => b.to - a.to || b.from - a.from);

export const BestFiveSchema = z.object({
  include: z.enum(BEST_INCLUDE),
  rest: z.enum(BEST_REST),
  optional: z.enum(BEST_OPTIONAL),
  optionalKinds: z
    .array(z.enum(OPTIONAL_KINDS))
    .max(4)
    .transform((xs) => [...new Set(xs)]),
});

export const GradeScaleSchema = z
  .array(
    z.object({
      grade: z.string().trim().min(1).max(4),
      from: z.coerce.number().int().min(0).max(100),
      to: z.coerce.number().int().min(0).max(100),
    }),
  )
  .min(2, 'Give 2 to 12 grades.')
  .max(12, 'Give 2 to 12 grades.')
  .transform(sortScale)
  .superRefine((s, ctx) => {
    const p = scaleProblem(s);
    if (p) ctx.addIssue({ code: 'custom', message: p });
  });

export const BoardRulesSchema = z.object({
  bestFive: BestFiveSchema,
  distinction: z.coerce.number().int().min(33).max(100),
  passMarks: z.coerce.number().int().min(1).max(60),
  grades: z.enum(['marks', 'printed']),
  scale: GradeScaleSchema,
});

/** The setting: a class's rules once the school has saved them (a class not saved keeps the defaults). */
export const BoardRulesSettingSchema = z.object({
  X: BoardRulesSchema.optional(),
  XII: BoardRulesSchema.optional(),
});

const LEGACY_INCLUDE: Record<string, BestFiveSpec['include']> = {
  'language-plus-four': 'language',
  'english-plus-four': 'english',
  'any-five': 'none',
};

/**
 * A class's rules from the stored setting: the class's own, or the one set of rules saved before the classes had
 * their own (read for both classes), or the defaults.
 */
export function readRules(
  stored: unknown,
  cls: BoardClass,
): { rules: BoardRules; isDefault: boolean } {
  const v = (stored ?? null) as Record<string, unknown> | null;
  if (v && typeof v.bestFive === 'string') {
    const d = defaultRules(cls);
    const old = BoardRulesSchema.omit({ bestFive: true, scale: true }).safeParse(v);
    return {
      rules: {
        ...d,
        ...(old.success ? old.data : {}),
        bestFive: { ...d.bestFive, include: LEGACY_INCLUDE[v.bestFive] ?? 'language' },
      },
      isDefault: false,
    };
  }
  const own = v?.[cls];
  if (own) {
    const p = BoardRulesSchema.safeParse(own);
    if (p.success) return { rules: p.data, isDefault: false };
  }
  return { rules: defaultRules(cls), isDefault: true };
}

/** A class's rules saved into the setting, the other class kept as it was. */
export function writeRules(stored: unknown, cls: BoardClass, rules: BoardRules) {
  const other: BoardClass = cls === 'X' ? 'XII' : 'X';
  const kept = readRules(stored, other);
  return { [other]: kept.isDefault ? undefined : kept.rules, [cls]: rules } as Record<
    BoardClass,
    BoardRules | undefined
  >;
}

/** A grade whose top mark is below the pass marks is a failing grade. */
export const failingGrade = (b: GradeBand, rules: Pick<BoardRules, 'passMarks'>) =>
  b.to < rules.passMarks;

/** The grade of a mark on the scale (a half from grace takes its whole number), or the printed grade on it. */
export function gradeOn(
  m: { marks: number; grade: string | null },
  rules: Pick<BoardRules, 'grades' | 'scale'>,
): string | null {
  if (rules.grades === 'printed') {
    const p = (m.grade ?? '').trim().toUpperCase();
    if (!p) return null;
    const exact = rules.scale.find((b) => b.grade.toUpperCase() === p);
    if (exact) return exact.grade;
    // D1 / D2 → D, E → E1: the one grade of the scale with that letter
    const same = rules.scale.filter((b) => b.grade.toUpperCase()[0] === p[0]);
    return same.length === 1 ? same[0]!.grade : null;
  }
  const x = Math.floor(m.marks);
  return rules.scale.find((b) => x >= b.from && x <= b.to)?.grade ?? null;
}

/** A grade's marks, as the column headings show them: "91-100". */
export const bandRange = (b: GradeBand) => `${String(b.from)}-${String(b.to)}`;

const KIND_WORDS: Record<BoardSubjectKind, string> = {
  language: 'language',
  main: 'main',
  skill: 'skill',
  additional: 'additional',
  internal: 'internal',
};

const NUMBER = ['', 'one', 'two', 'three', 'four', 'five'];

/** The best five in words, for the files' notes: "English and the best four other subjects; additional … never count". */
export function ruleWords(spec: BestFiveSpec): string {
  const n = spec.include === 'none' ? 5 : 4;
  const how =
    spec.rest === 'best'
      ? `the best ${NUMBER[n]!} ${n === 5 ? 'subjects' : 'other subjects'}`
      : `the first ${NUMBER[n]!} ${n === 5 ? 'subjects' : 'other subjects'} as CBSE printed them`;
  const head =
    spec.include === 'english'
      ? `English and ${how}`
      : spec.include === 'language'
        ? `the best language and ${how}`
        : how;
  const kinds = spec.optionalKinds.map((k) => KIND_WORDS[k]);
  if (!kinds.length || spec.optional === 'replace') return head;
  const list =
    kinds.length === 1
      ? kinds[0]!
      : `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]!}`;
  return spec.optional === 'never'
    ? `${head}; ${list} subjects never count`
    : `${head}; a ${list} subject counts only in place of a failed one (CBSE's rule)`;
}

/**
 * The grades' chart colours, top first: the passing grades green, navy, cyan … the last one amber; the failing
 * ones red (the design system's chart tones; the PDF draws the same).
 */
const PASS_TONES = [
  'success',
  'success-soft',
  'navy',
  'navy-soft',
  'cyan',
  'cyan-soft',
  'info',
  'info-soft',
  'muted',
  'muted-soft',
  'warning-soft',
] as const;
export type GradeTone = (typeof PASS_TONES)[number] | 'warning' | 'danger' | 'danger-soft';

export function gradeTones(rules: Pick<BoardRules, 'scale' | 'passMarks'>): GradeTone[] {
  const passing = rules.scale.filter((b) => !failingGrade(b, rules)).length;
  let p = 0;
  let f = 0;
  return rules.scale.map((b) => {
    if (failingGrade(b, rules)) return f++ % 2 ? 'danger-soft' : 'danger';
    p += 1;
    if (passing > 1 && p === passing) return 'warning';
    return PASS_TONES[p - 1] ?? 'muted';
  });
}
