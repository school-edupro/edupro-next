import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const EXAMS = {
  masterView: 'exams.master.view',
  masterManage: 'exams.master.manage',
  /** Sprint 15: entry */
  marksEnter: 'exams.marks.enter',
  marksView: 'exams.marks.view',
  marksUnlock: 'exams.marks.unlock',
  indicatorEnter: 'exams.indicator.enter',
  remarkEnter: 'exams.remark.enter',
  attendanceEnter: 'exams.attendance.enter',
  healthEnter: 'exams.health.enter',
  healthView: 'exams.health.view',
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

// ---- Sprint 15: entry ----------------------------------------------------------------------------
export const EntryQuerySchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema.optional(),
});
export class EntryQueryDto extends createZodDto(EntryQuerySchema) {}

const Marks = z.number().min(0).max(1000).nullable().optional();
export const PutMarksSchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        marks: Marks,
        absent: z.boolean().default(false),
        exempt: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(300),
});
export class PutMarksDto extends createZodDto(PutMarksSchema) {}

export const PutIndicatorsSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        indicatorId: IdSchema,
        grade: z.string().trim().min(1).max(5),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(3000),
});
export class PutIndicatorsDto extends createZodDto(PutIndicatorsSchema) {}

export const PutRemarksSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        remark: z.string().trim().min(1).max(600),
        bankCode: z.string().trim().max(20).optional(),
      }),
    )
    .min(1)
    .max(300),
});
export class PutRemarksDto extends createZodDto(PutRemarksSchema) {}

export const PutExamAttendanceSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        daysPresent: z.number().int().min(0).max(400),
        daysTotal: z.number().int().min(1).max(400),
      }),
    )
    .min(1)
    .max(300),
});
export class PutExamAttendanceDto extends createZodDto(PutExamAttendanceSchema) {}

export const PutHealthSchema = z.object({
  classSectionId: IdSchema,
  recordedOn: DateSchema.optional(),
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        heightCm: z.number().min(40).max(250).nullable().optional(),
        weightKg: z.number().min(3).max(200).nullable().optional(),
        bloodGroup: z
          .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
          .nullable()
          .optional(),
        visionLeft: z.string().trim().max(20).nullable().optional(),
        visionRight: z.string().trim().max(20).nullable().optional(),
        dental: z.string().trim().max(200).nullable().optional(),
        notes: z.string().trim().max(600).nullable().optional(),
      }),
    )
    .min(1)
    .max(300),
});
export class PutHealthDto extends createZodDto(PutHealthSchema) {}

export const UpsertIndicatorSetSchema = z.object({
  code: Code,
  name: z.string().trim().min(2).max(80),
  grades: z.array(z.string().trim().min(1).max(5)).min(2).max(10),
  indicators: z
    .array(
      z.object({
        code: Code,
        name: z.string().trim().min(2).max(120),
        area: z.string().trim().max(60).optional(),
        sortOrder: z.number().int().min(0).max(1000).default(0),
      }),
    )
    .min(1)
    .max(60),
});
export class UpsertIndicatorSetDto extends createZodDto(UpsertIndicatorSetSchema) {}

export const SetExamIndicatorSetSchema = z.object({
  classId: IdSchema,
  setId: IdSchema.nullable(),
});
export class SetExamIndicatorSetDto extends createZodDto(SetExamIndicatorSetSchema) {}

export const UpsertRemarkBankSchema = z.object({
  entries: z
    .array(
      z.object({
        code: Code,
        text: z.string().trim().min(3).max(600),
        classId: IdSchema.nullable().optional(),
        sortOrder: z.number().int().min(0).max(1000).default(0),
      }),
    )
    .min(1)
    .max(200),
});
export class UpsertRemarkBankDto extends createZodDto(UpsertRemarkBankSchema) {}

// ---- Sprint 16: results, analysis, promotion proposals ------------------------------------------
export const RegisterSheetQuerySchema = z.object({ classSectionId: IdSchema });
export class RegisterSheetQueryDto extends createZodDto(RegisterSheetQuerySchema) {}
export const AnalysisQuerySchema = z.object({ classId: IdSchema.optional() });
export class AnalysisQueryDto extends createZodDto(AnalysisQuerySchema) {}
export const PromotionProposalsQuerySchema = z.object({
  classId: IdSchema.optional(),
  minPct: z.coerce.number().min(0).max(100).default(33),
  maxFailed: z.coerce.number().int().min(0).max(10).default(0),
});
export class PromotionProposalsQueryDto extends createZodDto(PromotionProposalsQuerySchema) {}

/** An exam subject entered in parts (Theory / Practical, or one part per teaching subject). An empty list removes the parts. */
export const SetPartsSchema = z.object({
  parts: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(1).max(60),
        subjectId: IdSchema.nullish(),
        maxMarks: z.coerce.number().positive().max(1000),
      }),
    )
    .max(8),
});
export class SetPartsDto extends createZodDto(SetPartsSchema) {}

export const PutPartMarksSchema = z.object({
  classSectionId: IdSchema,
  partId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        marks: z.number().min(0).max(1000).nullable().optional(),
        absent: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(300),
});
export class PutPartMarksDto extends createZodDto(PutPartMarksSchema) {}
