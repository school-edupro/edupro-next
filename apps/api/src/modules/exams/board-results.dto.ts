import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BOARD_RESULTS = {
  view: 'exams.board_result.view',
  import: 'exams.board_result.import',
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
