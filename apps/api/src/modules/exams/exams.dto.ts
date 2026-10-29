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
  /** docs/design/65 part 2 */
  marksVerify: 'exams.marks.verify',
  resultPublish: 'exams.result.publish',
  /** part 5: a parent's feedback on the HPC */
  familyFeedback: 'exams.family.feedback',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const CategoryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,12}$/, 'up to 12 capital letters or digits');
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
        /** 0: a grade-only subject (art, PE): a grade of its scale instead of marks (docs/design/65) */
        maxMarks: z.number().min(0).max(1000),
        passMarks: z.number().min(0).max(1000).nullable().optional(),
        weightage: z.number().min(0).max(100).nullable().optional(),
        isElective: z.boolean().default(false),
        examOn: DateSchema.nullable().optional(),
        /** the subject's own grade scale (a grade-only subject needs one, or the class's) */
        gradeScaleId: IdSchema.nullable().optional(),
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
        /** a marks code (AB, ML, EX, NA, OD, L, NEW ADM or the school's own) in place of marks */
        code: z.string().trim().toUpperCase().max(12).nullable().optional(),
        /** a grade-only subject's grade */
        grade: z.string().trim().max(10).nullable().optional(),
      }),
    )
    .min(1)
    .max(300),
});
export class PutMarksDto extends createZodDto(PutMarksSchema) {}

/** A marks sheet from Excel: checked row by row; `apply` saves it (docs/design/65). */
export const MarksUploadSchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema,
  /** the .xlsx file, base64 */
  file: z.string().min(10).max(2_000_000),
  apply: z.boolean().default(false),
});
export class MarksUploadDto extends createZodDto(MarksUploadSchema) {}

/** Locks of one class of an exam per entry type; marks lock every subject of the class. */
export const ClassLocksSchema = z.object({
  classId: IdSchema,
  marks: z.boolean().optional(),
  indicators: z.boolean().optional(),
  remarks: z.boolean().optional(),
  attendance: z.boolean().optional(),
  health: z.boolean().optional(),
});
export class ClassLocksDto extends createZodDto(ClassLocksSchema) {}

/** A marks code and what it does to a result. */
export const UpsertMarkCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9 ]{0,11}$/, 'capital letters, up to 12'),
    name: z.string().trim().min(2).max(60),
    treatment: z.enum(['zero', 'exclude', 'fixed', 'percent', 'pro_rata']),
    value: z.number().min(0).max(1000).nullable().optional(),
    blocksResult: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(100).default(0),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .refine((x) => ['fixed', 'percent'].includes(x.treatment) === (x.value != null), {
    message: 'Fixed marks and a % of the maximum need a value; the others none',
    path: ['value'],
  });
export class UpsertMarkCodeDto extends createZodDto(UpsertMarkCodeSchema) {}

// ---- subject choices (docs/design/65) ------------------------------------------------------------
export const SubjectChoicesQuerySchema = z.object({ classSectionId: IdSchema });
export class SubjectChoicesQueryDto extends createZodDto(SubjectChoicesQuerySchema) {}
const ChoiceKind = z.enum(['compulsory', 'optional', 'additional']);
export const PutSubjectChoicesSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        stream: z.string().trim().max(40).nullable().optional(),
        /** the whole list for the year; empty = no choices (every subject) */
        subjects: z.array(z.object({ subjectId: IdSchema, kind: ChoiceKind })).max(30),
      }),
    )
    .min(1)
    .max(300),
});
export class PutSubjectChoicesDto extends createZodDto(PutSubjectChoicesSchema) {}
export const SubjectChoicesUploadSchema = z.object({
  classSectionId: IdSchema,
  file: z.string().min(10).max(2_000_000),
  apply: z.boolean().default(false),
});
export class SubjectChoicesUploadDto extends createZodDto(SubjectChoicesUploadSchema) {}

export const PutIndicatorsSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        indicatorId: IdSchema,
        /** a level of the set; a written item takes a note only; neither: the entry is removed */
        grade: z.string().trim().min(1).max(20).nullable().optional(),
        note: z.string().trim().max(600).nullable().optional(),
      }),
    )
    .min(1)
    .max(3000),
});
export class PutIndicatorsDto extends createZodDto(PutIndicatorsSchema) {}

/** docs/design/65 part 5: the HPC's "All about me", the parent's and the teacher's words */
export const FeedbackKindSchema = z.enum(['self', 'parent', 'teacher']);
export const PutHpcFeedbackSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        kind: FeedbackKindSchema,
        /** empty: removed */
        text: z.string().trim().max(2000).nullable(),
      }),
    )
    .min(1)
    .max(300),
});
export class PutHpcFeedbackDto extends createZodDto(PutHpcFeedbackSchema) {}

export const PortfolioQuerySchema = z.object({
  classSectionId: IdSchema,
  studentId: IdSchema.optional(),
});
export class PortfolioQueryDto extends createZodDto(PortfolioQuerySchema) {}

export const AddPortfolioSchema = z.object({
  classSectionId: IdSchema,
  studentId: IdSchema,
  caption: z.string().trim().max(200).optional(),
  indicatorId: IdSchema.nullable().optional(),
  image: z.object({
    contentType: z.enum(['image/png', 'image/jpeg']),
    /** up to 1 MB */
    base64: z.string().min(16).max(1_400_000),
  }),
});
export class AddPortfolioDto extends createZodDto(AddPortfolioSchema) {}

export const MyFeedbackQuerySchema = z.object({ studentId: IdSchema });
export class MyFeedbackQueryDto extends createZodDto(MyFeedbackQuerySchema) {}
export const PutMyFeedbackSchema = z.object({
  studentId: IdSchema,
  examId: IdSchema,
  text: z.string().trim().min(1).max(2000),
});
export class PutMyFeedbackDto extends createZodDto(PutMyFeedbackSchema) {}

export const PutRemarksSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        remark: z.string().trim().min(1).max(600),
        bankCode: z.string().trim().max(20).optional(),
        /** docs/design/65 part 4: what the student took part in; the class promoted to */
        participation: z.string().trim().max(300).nullable().optional(),
        promotedTo: z.string().trim().max(40).nullable().optional(),
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

/** docs/design/65: exam attendance counted from daily attendance between two dates */
export const AttendanceFromDailySchema = z
  .object({
    classSectionId: IdSchema,
    /** default: the start of the academic year */
    from: DateSchema.optional(),
    /** default: the exam's last day, or today */
    to: DateSchema.optional(),
    /** replace what is already entered (else only the students without it) */
    overwrite: z.boolean().default(false),
  })
  .refine((x) => !x.from || !x.to || x.from <= x.to, {
    message: 'The first day comes before the last',
    path: ['to'],
  });
export class AttendanceFromDailyDto extends createZodDto(AttendanceFromDailySchema) {}

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
  /** the levels (grades) in order; docs/design/65 part 5: words up to 20 letters */
  grades: z.array(z.string().trim().min(1).max(20)).min(2).max(10),
  /** part 5: 'hpc' prints as the Holistic Progress Card; a level's words on it */
  kind: z.enum(['indicators', 'hpc']).default('indicators'),
  levelWords: z.record(z.string().max(20), z.string().trim().max(30)).default({}),
  indicators: z
    .array(
      z.object({
        code: Code,
        name: z.string().trim().min(2).max(120),
        area: z.string().trim().max(60).optional(),
        sortOrder: z.number().int().min(0).max(1000).default(0),
        /** part 5: under another indicator of the set (the third level); one level deep */
        parentCode: Code.nullable().optional(),
        /** level: takes a level; text: a written observation */
        kind: z.enum(['level', 'text']).default('level'),
        description: z.string().trim().max(300).nullable().optional(),
        /** level → what it means for this item */
        descriptors: z.record(z.string().max(20), z.string().trim().max(200)).default({}),
      }),
    )
    .min(1)
    .max(150),
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
        /** docs/design/65 part 7: the category the remark is offered in */
        categoryCode: CategoryCode.nullable().optional(),
        status: z.enum(['active', 'inactive']).default('active'),
      }),
    )
    .min(1)
    .max(200),
});
export class UpsertRemarkBankDto extends createZodDto(UpsertRemarkBankSchema) {}

/** docs/design/65 part 7: a remark category (the old A / B / C / D lists and "any other") */
export const UpsertRemarkCategorySchema = z.object({
  code: CategoryCode,
  name: z.string().trim().min(2).max(60),
  /** a subject's remarks: its subject teacher writes them too */
  subjectId: IdSchema.nullable().optional(),
  classIds: z.array(IdSchema).max(40).default([]),
  /** false: only the bank's remarks of the category */
  freeText: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  status: z.enum(['active', 'inactive']).default('active'),
});
export class UpsertRemarkCategoryDto extends createZodDto(UpsertRemarkCategorySchema) {}

export const PutRemarkItemsSchema = z.object({
  classSectionId: IdSchema,
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        categoryId: IdSchema,
        /** empty: removed */
        text: z.string().trim().max(600).nullable(),
        bankCode: z.string().trim().max(20).nullable().optional(),
      }),
    )
    .min(1)
    .max(3000),
});
export class PutRemarkItemsDto extends createZodDto(PutRemarkItemsSchema) {}

/** docs/design/65 part 7: promotion proposals from a locked result scheme's term results */
export const SchemePromotionQuerySchema = z.object({
  classId: IdSchema.optional(),
  classSectionId: IdSchema.optional(),
  toYearId: IdSchema.optional(),
});
export class SchemePromotionQueryDto extends createZodDto(SchemePromotionQuerySchema) {}
export const SendPromotionsSchema = z.object({
  /** none: only the cards' "Promoted to" (next year is not set up yet) */
  toYearId: IdSchema.nullable().optional(),
  rows: z
    .array(
      z.object({
        studentId: IdSchema,
        decision: z.enum(['promote', 'retain', 'graduate', 'review']),
        toClassSectionId: IdSchema.nullable().optional(),
        /** the card's "Promoted to"; empty: none */
        promotedTo: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export class SendPromotionsDto extends createZodDto(SendPromotionsSchema) {}

// ---- Sprint 16: results, analysis, promotion proposals ------------------------------------------
export const RegisterSheetQuerySchema = z.object({ classSectionId: IdSchema });
export class RegisterSheetQueryDto extends createZodDto(RegisterSheetQuerySchema) {}
export const AnalysisQuerySchema = z.object({ classId: IdSchema.optional() });

/** docs/design/65 part 6: an exam's analyses, on the screen or as Excel / PDF */
const FormatSchema = z.enum(['json', 'xlsx', 'pdf']).default('json');
export const ExamReportQuerySchema = z.object({
  classId: IdSchema.optional(),
  classSectionId: IdSchema.optional(),
  /** toppers: a subject's toppers */
  subjectId: IdSchema.optional(),
  top: z.coerce.number().int().min(1).max(100).optional(),
  minPct: z.coerce.number().min(0).max(100).optional(),
  belowPct: z.coerce.number().min(0).max(100).optional(),
  /** toppers: the rank in the class (default) or in the section */
  by: z.enum(['class', 'section']).optional(),
  /** ranges: the lower ends of the school's own bands ("90,75,60,33") */
  ranges: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?(,\d{1,3}(\.\d{1,2})?){0,11}$/, 'lower ends, comma between')
    .transform((v) => v.split(',').map(Number))
    .refine((v) => v.every((x) => x >= 0 && x <= 100), 'between 0 and 100')
    .optional(),
  format: FormatSchema,
});
export class ExamReportQueryDto extends createZodDto(ExamReportQuerySchema) {}
export const DivisionsQuerySchema = z.object({
  classId: IdSchema.optional(),
  classSectionId: IdSchema.optional(),
  format: FormatSchema,
});
export class DivisionsQueryDto extends createZodDto(DivisionsQuerySchema) {}
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

// ---- submit, verify, publish (docs/design/65, part 2) ----------------------------------------------
export const EntryStatusQuerySchema = z.object({ classId: IdSchema.optional() });
export class EntryStatusQueryDto extends createZodDto(EntryStatusQuerySchema) {}
export const EntryStatusActionSchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema,
  remark: z.string().trim().max(500).optional(),
});
export class EntryStatusActionDto extends createZodDto(EntryStatusActionSchema) {}
export const EntryStatusNoteSchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema,
  /** why: sent back to the teacher, or reopened after verification */
  note: z.string().trim().min(3, 'Give the reason (3 letters or more)').max(500),
});
export class EntryStatusNoteDto extends createZodDto(EntryStatusNoteSchema) {}
