import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const EXAMS = {
  masterView: 'exams.master.view',
  masterManage: 'exams.master.manage',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{2,20}$/, 'upper case code');

export const UpsertExamTypeSchema = z.object({
  code: Code,
  name: z.string().trim().min(2).max(80),
  weightage: z.number().min(0).max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export class UpsertExamTypeDto extends createZodDto(UpsertExamTypeSchema) {}
export const UpdateExamTypeSchema = UpsertExamTypeSchema.omit({ code: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial();
export class UpdateExamTypeDto extends createZodDto(UpdateExamTypeSchema) {}

export const BandSchema = z.object({
  minPct: z.number().min(0).max(100),
  maxPct: z.number().min(0).max(100),
  grade: z.string().trim().min(1).max(10),
  points: z.number().min(0).max(10).nullable().optional(),
  remark: z.string().trim().max(80).optional(),
});
export const UpsertGradeScaleSchema = z.object({
  code: Code,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  bands: z.array(BandSchema).min(1).max(20),
});
export class UpsertGradeScaleDto extends createZodDto(UpsertGradeScaleSchema) {}

export const CreateExamSchema = z.object({
  examTypeId: IdSchema,
  code: Code,
  name: z.string().trim().min(2).max(120),
  startsOn: DateSchema.optional(),
  endsOn: DateSchema.optional(),
  showOnPortal: z.boolean().default(false),
  /** classes that sit this exam, each with an optional grade scale */
  classes: z
    .array(z.object({ classId: IdSchema, gradeScaleId: IdSchema.nullable().optional() }))
    .min(1)
    .max(30),
});
export class CreateExamDto extends createZodDto(CreateExamSchema) {}
export const UpdateExamSchema = CreateExamSchema.omit({ code: true, examTypeId: true })
  .extend({
    startsOn: DateSchema.nullable(),
    endsOn: DateSchema.nullable(),
    status: z.enum(['active', 'inactive']),
    marksLocked: z.boolean(),
  })
  .partial();
export class UpdateExamDto extends createZodDto(UpdateExamSchema) {}

export const SetExamSubjectsSchema = z.object({
  classId: IdSchema,
  subjects: z
    .array(
      z.object({
        subjectId: IdSchema,
        maxMarks: z.number().min(1).max(1000),
        passMarks: z.number().min(0).max(1000).nullable().optional(),
        weightage: z.number().min(0).max(100).nullable().optional(),
        isElective: z.boolean().default(false),
        examOn: DateSchema.nullable().optional(),
      }),
    )
    .max(40),
});
export class SetExamSubjectsDto extends createZodDto(SetExamSubjectsSchema) {}

export const LockExamSubjectsSchema = z.object({
  classId: IdSchema,
  subjectIds: z.array(IdSchema).max(40).optional(),
  locked: z.boolean(),
});
export class LockExamSubjectsDto extends createZodDto(LockExamSubjectsSchema) {}
