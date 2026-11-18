import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BoardRulesSchema } from './board-rules';

export const BOARD_RESULTS = {
  view: 'exams.board_result.view',
  import: 'exams.board_result.import',
  /** a teacher's own sections and subjects (phase D) */
  own: 'exams.board_result.own',
} as const;

export const BoardUploadSchema = z
  .object({
    board: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,10}$/)
      .default('CBSE'),
    classLabel: z
      .string()
      .trim()
      .regex(/^(X|XII|10|12)$/),
    fileName: z.string().trim().max(200).optional(),
    csv: z.string().max(4_000_000).optional(),
    contentBase64: z.string().max(6_000_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'Send either csv or contentBase64',
  });
export class BoardUploadDto extends createZodDto(BoardUploadSchema) {}

export const BoardListQuerySchema = z.object({
  board: z.string().trim().max(10).optional(),
  classLabel: z.string().trim().max(4).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(100),
});
export class BoardListQueryDto extends createZodDto(BoardListQuerySchema) {}

const Id = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');

/**
 * CBSE's result gazette, the .TXT as sent (docs/design/88): the class, the academic year (or, for an earlier
 * year without one in EduPro, the examination year) and the file's text.
 */
export const GazetteUploadSchema = z
  .object({
    board: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,10}$/)
      .default('CBSE'),
    classLabel: z.enum(['X', 'XII']),
    academicYearId: Id.optional(),
    examYear: z.coerce.number().int().min(2000).max(2100).optional(),
    fileName: z.string().trim().max(200).optional(),
    text: z
      .string()
      .min(20)
      .max(950_000, 'The file is larger than the 900 KB a result file can be'),
  })
  .refine((v) => Boolean(v.academicYearId) || Boolean(v.examYear), {
    message: 'Choose the academic year (or the examination year)',
    path: ['academicYearId'],
  });
export class GazetteUploadDto extends createZodDto(GazetteUploadSchema) {}

export const LayoutActiveSchema = z.object({ active: z.boolean() });
export class LayoutActiveDto extends createZodDto(LayoutActiveSchema) {}

const ClassLabel = z.enum(['X', 'XII']);
const Code = z
  .string()
  .trim()
  .regex(/^\d{3}$/, 'a 3-digit CBSE code');
const Kind = z.enum(['language', 'main', 'skill', 'additional', 'internal']);

/** A candidate linked to a student, marked not ours, or unlinked (docs/design/88, phase B). */
export const PickSchema = z.object({
  studentId: Id.nullable().optional(),
  notOurs: z.boolean().optional(),
});
export class PickDto extends createZodDto(PickSchema) {}

export const BoardSubjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: Kind,
  subjectId: Id.nullable(),
});
export class BoardSubjectDto extends createZodDto(BoardSubjectSchema) {}

export const BoardSubjectAddSchema = BoardSubjectSchema.extend({
  classLabel: ClassLabel,
  code: Code,
});
export class BoardSubjectAddDto extends createZodDto(BoardSubjectAddSchema) {}

export const BoardClassQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export class BoardClassQueryDto extends createZodDto(BoardClassQuerySchema) {}

export const BoardTeacherSchema = z
  .object({
    classLabel: ClassLabel,
    examYear: z.coerce.number().int().min(2000).max(2100),
    section: z.string().trim().min(1).max(40),
    code: Code,
    employeeId: Id.nullable().optional(),
    teacherName: z.string().trim().min(2).max(120).nullable().optional(),
    rolls: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\d{6,10}$/, 'a roll number'),
      )
      .max(400)
      .default([]),
  })
  .refine((v) => Boolean(v.employeeId) || Boolean(v.teacherName), {
    message: 'Choose the teacher',
    path: ['employeeId'],
  });
export class BoardTeacherDto extends createZodDto(BoardTeacherSchema) {}

export const DetailsSheetSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  fileBase64: z.string().min(10).max(1_000_000, 'The sheet is larger than 700 KB'),
});
export class DetailsSheetDto extends createZodDto(DetailsSheetSchema) {}

// ---- phase C: the annexures ----

export const BoardAnalysisQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  section: z.string().trim().min(1).max(40).optional(),
});
export class BoardAnalysisQueryDto extends createZodDto(BoardAnalysisQuerySchema) {}

export const BoardAnalysisFileSchema = BoardAnalysisQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  annexure: z.coerce.number().int().min(1).max(13).optional(),
});
export class BoardAnalysisFileDto extends createZodDto(BoardAnalysisFileSchema) {}

/** A class's analysis rules (board-rules.ts): the best five built, the marks, the grade scale. */
export const BoardRulesSaveSchema = BoardRulesSchema.extend({ classLabel: z.enum(['X', 'XII']) });
export class BoardRulesDto extends createZodDto(BoardRulesSaveSchema) {}
export const BoardRulesQuerySchema = z.object({ classLabel: z.enum(['X', 'XII']).default('X') });
export class BoardRulesQueryDto extends createZodDto(BoardRulesQuerySchema) {}

export const BoardParentsSchema = z.object({ on: z.boolean() });
export class BoardParentsDto extends createZodDto(BoardParentsSchema) {}

export const BoardMineQuerySchema = z.object({
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export class BoardMineQueryDto extends createZodDto(BoardMineQuerySchema) {}

// ---- phase E: an earlier year's figures typed in (its result file lost) ----

const Count = z.coerce.number().int().min(0).max(100_000);
const Share = z.coerce.number().min(0).max(100);
export const BoardYearSubjectSchema = z.object({
  code: Code,
  appeared: Count,
  highest: Share.nullable().optional(),
  aGrades: Count.nullable().optional(),
  compartments: Count.nullable().optional(),
  failures: Count.nullable().optional(),
  distinctions: Count.nullable().optional(),
  average: Share.nullable().optional(),
  pi: Share.nullable().optional(),
});
export const BoardYearFiguresSchema = z
  .object({
    classLabel: ClassLabel,
    examYear: z.coerce.number().int().min(2000).max(2100),
    registered: Count.nullable().optional(),
    appeared: Count,
    passed: Count.nullable().optional(),
    compartments: Count.nullable().optional(),
    failures: Count.nullable().optional(),
    n90: Count.nullable().optional(),
    n75: Count.nullable().optional(),
    aggregate: Share.nullable().optional(),
    pi: Share.nullable().optional(),
    subjects: z.array(BoardYearSubjectSchema).max(60).default([]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.passed == null || v.passed <= v.appeared, {
    message: 'Passed cannot be more than appeared',
    path: ['passed'],
  })
  .refine((v) => v.n75 == null || v.n75 <= v.appeared, {
    message: '75% and above cannot be more than appeared',
    path: ['n75'],
  })
  .refine((v) => v.n90 == null || v.n75 == null || v.n90 <= v.n75, {
    message: '90% and above cannot be more than 75% and above',
    path: ['n90'],
  })
  .refine((v) => new Set(v.subjects.map((s) => s.code)).size === v.subjects.length, {
    message: 'A subject code is there twice',
    path: ['subjects'],
  });
export class BoardYearFiguresDto extends createZodDto(BoardYearFiguresSchema) {}

// ---- the Results tab: candidate-wise marks (as the school's old "Student Marks Data") ----

export const BoardMarksQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  section: z.string().trim().min(1).max(40).optional(),
  /** best5: the school's best five (the rule in Set-up); all: every subject with marks */
  method: z.enum(['best5', 'first5', 'all']).default('best5'),
  result: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,8}$/)
    .optional(),
  /** the percentage band: 90 and above, 75–89.9, 60–74.9, 45–59.9, below 45 */
  band: z.enum(['90', '75', '60', '45', 'below45']).optional(),
  sort: z.enum(['rank', 'roll', 'name', 'section']).default('rank'),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(1000).default(100),
});
export class BoardMarksQueryDto extends createZodDto(BoardMarksQuerySchema) {}

export const BoardMarksFileSchema = BoardMarksQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardMarksFileDto extends createZodDto(BoardMarksFileSchema) {}

// ---- the Reports tab: Range Wise Subject Summary ----

export const BoardRangeQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  /** how many saved years before it to compare with */
  compare: z.coerce.number().int().min(0).max(4).default(1),
  gender: z.enum(['all', 'M', 'F']).default('all'),
  code: Code.optional(),
});
export class BoardRangeQueryDto extends createZodDto(BoardRangeQuerySchema) {}

export const BoardRangeFileSchema = BoardRangeQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardRangeFileDto extends createZodDto(BoardRangeFileSchema) {}

// ---- the Reports tab: Range Wise Summary (the class's result) ----

export const BoardOverallQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  compare: z.coerce.number().int().min(0).max(4).default(1),
  gender: z.enum(['all', 'M', 'F']).default('all'),
  method: z.enum(['best5', 'first5', 'all']).default('best5'),
});
export class BoardOverallQueryDto extends createZodDto(BoardOverallQuerySchema) {}

export const BoardOverallFileSchema = BoardOverallQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardOverallFileDto extends createZodDto(BoardOverallFileSchema) {}

// ---- the Reports tab: Subject Summary (every subject by boys and girls) ----

export const BoardSubjectPerfQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  gender: z.enum(['all', 'M', 'F']).default('all'),
  code: Code.optional(),
  /** one section's students, or "each": every subject with a row for each of its sections */
  section: z.string().trim().min(1).max(40).optional(),
});
export class BoardSubjectPerfQueryDto extends createZodDto(BoardSubjectPerfQuerySchema) {}

export const BoardSubjectPerfFileSchema = BoardSubjectPerfQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardSubjectPerfFileDto extends createZodDto(BoardSubjectPerfFileSchema) {}

// ---- the Reports tab: Teacher wise result analysis ----

export const BoardTeacherAnalysisQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  gender: z.enum(['all', 'M', 'F']).default('all'),
  code: Code.optional(),
  /** one teacher: a staff id, "n:<name>" for a name typed on the Teachers tab, or "none" (no teacher set) */
  teacher: z
    .string()
    .trim()
    .regex(/^(\d{1,18}|none|n:[^\n]{1,120})$/)
    .optional(),
});
export class BoardTeacherAnalysisQueryDto extends createZodDto(BoardTeacherAnalysisQuerySchema) {}

export const BoardTeacherAnalysisFileSchema = BoardTeacherAnalysisQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardTeacherAnalysisFileDto extends createZodDto(BoardTeacherAnalysisFileSchema) {}

// ---- the Reports tab: Result Analysis (the subject table and its charts) ----

export const BoardResultAnalysisQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  /** saved years before it for the charts across years */
  compare: z.coerce.number().int().min(0).max(4).default(4),
  /** both: each subject as an All, a Boys and a Girls row */
  gender: z.enum(['all', 'M', 'F', 'both']).default('all'),
  code: Code.optional(),
  result: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,8}$/)
    .optional(),
  /** one section's students, or "each": every subject with a row for each of its sections */
  section: z.string().trim().min(1).max(40).optional(),
});
export class BoardResultAnalysisQueryDto extends createZodDto(BoardResultAnalysisQuerySchema) {}

export const BoardResultAnalysisFileSchema = BoardResultAnalysisQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
  /** graphs: the charts drawn as a PDF (no Excel) */
  view: z.enum(['table', 'graphs']).default('table'),
}).refine((v) => v.view === 'table' || v.format === 'pdf', {
  message: 'The graphs are a PDF only',
  path: ['format'],
});
export class BoardResultAnalysisFileDto extends createZodDto(BoardResultAnalysisFileSchema) {}

// ---- the Reports tab: Topper Report ----

export const BoardToppersQuerySchema = z.object({
  classLabel: ClassLabel.default('X'),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  /** saved years before it, in figures (the toppers over the years) */
  compare: z.coerce.number().int().min(0).max(4).default(0),
  method: z.enum(['best5', 'first5', 'all']).default('best5'),
  gender: z.enum(['all', 'M', 'F']).default('all'),
  section: z.string().trim().min(1).max(40).optional(),
  /** overall: the class's toppers by the aggregate; subjects: each subject's; both */
  show: z.enum(['overall', 'subjects', 'both']).default('both'),
  /** the subjects shown, comma-separated codes (none: every subject) */
  codes: z
    .string()
    .trim()
    .regex(/^\d{3}(,\d{3}){0,79}$/)
    .optional(),
  /** the top ranks (0: none) */
  top: z.coerce.number().int().min(0).max(50).default(5),
  /** the lowest ranks (0: none) */
  low: z.coerce.number().int().min(0).max(50).default(0),
  pctOp: z.enum(['gte', 'lte']).optional(),
  pct: z.coerce.number().min(0).max(100).optional(),
});
export class BoardToppersQueryDto extends createZodDto(BoardToppersQuerySchema) {}

export const BoardToppersFileSchema = BoardToppersQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardToppersFileDto extends createZodDto(BoardToppersFileSchema) {}
