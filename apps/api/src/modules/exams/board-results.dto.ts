import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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

export const BoardRulesSchema = z.object({
  bestFive: z.enum(['language-plus-four', 'english-plus-four', 'any-five']),
  distinction: z.coerce.number().int().min(33).max(100),
  passMarks: z.coerce.number().int().min(1).max(60),
  grades: z.enum(['marks', 'printed']),
});
export class BoardRulesDto extends createZodDto(BoardRulesSchema) {}

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
  method: z.enum(['best5', 'all']).default('best5'),
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
  method: z.enum(['best5', 'all']).default('best5'),
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
});
export class BoardSubjectPerfQueryDto extends createZodDto(BoardSubjectPerfQuerySchema) {}

export const BoardSubjectPerfFileSchema = BoardSubjectPerfQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BoardSubjectPerfFileDto extends createZodDto(BoardSubjectPerfFileSchema) {}
