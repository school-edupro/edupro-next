import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Employee ACR (0184, docs/design/32-employee-acr.md). */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Id = z.string().regex(/^\d{1,18}$/);
const Group = z.enum(['teaching', 'non_teaching']);

export const AcrSettingsSchema = z.object({
  scaleLabels: z.array(z.string().trim().min(1).max(40)).min(3).max(10),
  representationDays: z.number().int().min(0).max(90),
  /** a staff punch after this time is a late arrival */
  staffLateAfter: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('08:00'),
  /** shown above every self-appraisal and kept with line breaks (20 Oct 2026) */
  guidelines: z.string().max(5000).default(''),
  bands: z
    .array(
      z.object({
        minPct: z.number().min(0).max(100),
        label: z.string().trim().min(1).max(40),
        adverse: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(10),
});
export class AcrSettingsDto extends createZodDto(AcrSettingsSchema) {}

export const AcrLevelsSchema = z.object({
  staffGroup: Group,
  levels: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(60),
        kind: z.enum([
          'acr_hod',
          'acr_reviewer',
          'approver_l1',
          'approver_l2',
          'approver_l3',
          'role',
          'designation',
          'employee',
        ]),
        roleCode: z.string().trim().max(60).nullable().optional(),
        designation: z.string().trim().max(80).nullable().optional(),
        employeeId: Id.nullable().optional(),
        action: z.enum(['rate', 'review']),
        /** 0191: the questionnaire this level answers (none: the grade and remarks only) */
        formId: Id.nullable().optional(),
      }),
    )
    .min(1)
    .max(6),
});
export class AcrLevelsDto extends createZodDto(AcrLevelsSchema) {}

/** 0191: a form (the self-appraisal of a staff category, or a level's questionnaire). */
export const AcrFormSchema = z.object({
  name: z.string().trim().min(2).max(80),
  part: z.enum(['self', 'level']),
  staffGroup: z.enum(['teaching', 'non_teaching', 'both']),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  /** 0192: a self-appraisal form for these employee types only (ids from Staff setup); absent = unchanged */
  employeeTypeIds: z
    .array(z.string().regex(/^\d{1,18}$/))
    .max(50)
    .optional(),
});
export class AcrFormDto extends createZodDto(AcrFormSchema) {}
export const AcrFormCopySchema = z.object({
  name: z.string().trim().min(2).max(80),
  staffGroup: z.enum(['teaching', 'non_teaching', 'both']).optional(),
});
export class AcrFormCopyDto extends createZodDto(AcrFormCopySchema) {}
/** Which levels answer a questionnaire (set from the form's side): staff group and level number. */
export const AcrFormLevelsSchema = z.object({
  levels: z
    .array(z.object({ staffGroup: Group, seq: z.number().int().min(1).max(6) }))
    .max(12)
    .default([]),
});
export class AcrFormLevelsDto extends createZodDto(AcrFormLevelsSchema) {}
/** A section of a form: a heading with help, its share of the score, its place. */
export const AcrSectionSchema = z.object({
  formId: Id,
  title: z.string().trim().min(2).max(80),
  help: z.string().trim().max(500).nullable().optional(),
  weight: z.number().min(0.25).max(10).default(1),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export class AcrSectionDto extends createZodDto(AcrSectionSchema) {}

/** The employee-wise level kinds: what the Assessors screen assigns (0189). */
export const ASSESSOR_KINDS = [
  'acr_hod',
  'acr_reviewer',
  'approver_l1',
  'approver_l2',
  'approver_l3',
] as const;
export type AssessorKind = (typeof ASSESSOR_KINDS)[number];
export const AcrAssessorsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
  staffGroup: Group.optional(),
  missing: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export class AcrAssessorsQueryDto extends createZodDto(AcrAssessorsQuerySchema) {}
/** Rows to save: the employee and each assessor as an id or an employee code; null clears. */
export const AcrAssessorsSaveSchema = z.object({
  rows: z
    .array(
      z.object({
        employee: z.string().trim().min(1).max(40),
        assessors: z.record(z.enum(ASSESSOR_KINDS), z.string().trim().max(40).nullable()),
      }),
    )
    .min(1)
    .max(2000),
});
export class AcrAssessorsSaveDto extends createZodDto(AcrAssessorsSaveSchema) {}

export const AcrQuestionSchema = z.object({
  formId: Id,
  sectionId: Id,
  text: z.string().trim().min(3).max(300),
  /** scale: a rating on the scale; text: written; yesno: yes or no (0191) */
  kind: z.enum(['scale', 'text', 'yesno', 'file']),
  weight: z.number().min(0.25).max(10).default(1),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});
export class AcrQuestionDto extends createZodDto(AcrQuestionSchema) {}

/** The ACR PDF: one ACR, or the ACRs shown on the board (up to 100 in one file). */
export const AcrPdfSchema = z.object({ ids: z.array(Id).min(1).max(100) });
export class AcrPdfDto extends createZodDto(AcrPdfSchema) {}

export const AcrCycleSchema = z
  .object({
    academicYearId: Id,
    name: z.string().trim().min(3).max(80),
    selfFrom: Day,
    selfTo: Day,
    reviewBy: Day.nullable().optional(),
  })
  .refine((c) => c.selfTo >= c.selfFrom, {
    message: 'the window ends before it starts',
    path: ['selfTo'],
  });
export class AcrCycleDto extends createZodDto(AcrCycleSchema) {}

/** The answers of a form: question id → a rating (1 to the scale's top) or written text. */
const Answers = z.record(
  z.string().regex(/^\d{1,18}$/),
  z.union([
    // an attachment question: up to three of the person's own files (0194)
    z.array(Id).max(3),
    z.number().int().min(1).max(10),
    z.string().max(4000),
  ]),
);

export const AcrSelfSchema = z.object({ answers: Answers });
export class AcrSelfDto extends createZodDto(AcrSelfSchema) {}

export const AcrLevelSchema = z.object({
  answers: Answers.default({}),
  remarks: z.string().trim().max(4000).nullable().optional(),
  /** review levels: the grade given (a grade name of the bands), why when it differs from the score's */
  grade: z.string().trim().max(40).nullable().optional(),
  gradeReason: z.string().trim().max(1000).nullable().optional(),
  agreement: z.enum(['agree', 'partly', 'disagree']).nullable().optional(),
  /** the standard remark lines ticked at the final level (0195) */
  remarkIds: z.array(Id).max(10).optional(),
});
export class AcrLevelDto extends createZodDto(AcrLevelSchema) {}

/** Principal's remarks (0195): standard lines per grade; the whole list is saved at once. */
export const AcrRemarksSchema = z.object({
  lines: z
    .array(
      z.object({
        id: Id.optional(),
        grade: z.string().trim().min(1).max(60),
        text: z.string().trim().min(3).max(1000),
        sortOrder: z.number().int().min(0).max(9999).default(0),
        active: z.boolean().default(true),
      }),
    )
    .max(500),
});
export class AcrRemarksDto extends createZodDto(AcrRemarksSchema) {}
/** Lines from a spreadsheet (grade, remark, status): added when new, never doubled. */
export const AcrRemarksImportSchema = z.object({
  rows: z
    .array(
      z.object({
        grade: z.string().trim().max(80),
        text: z.string().trim().max(1000),
        active: z.boolean().optional(),
      }),
    )
    .max(2000),
});
export class AcrRemarksImportDto extends createZodDto(AcrRemarksImportSchema) {}

export const AcrReasonSchema = z.object({ reason: z.string().trim().min(5, 'say why').max(1000) });
export class AcrReasonDto extends createZodDto(AcrReasonSchema) {}

export const AcrRepresentSchema = z.object({
  text: z.string().trim().min(20, 'write at least a few lines').max(4000),
});
export class AcrRepresentDto extends createZodDto(AcrRepresentSchema) {}

export const AcrDecideSchema = z
  .object({
    decision: z.enum(['upheld', 'revised']),
    grade: z.string().trim().max(40).nullable().optional(),
    note: z.string().trim().min(5).max(2000),
  })
  .refine((d) => d.decision === 'upheld' || Boolean(d.grade), {
    message: 'give the revised grade',
    path: ['grade'],
  });
export class AcrDecideDto extends createZodDto(AcrDecideSchema) {}

export const AcrReviewersSchema = z.object({ employeeIds: z.array(Id).min(1).max(20) });
export class AcrReviewersDto extends createZodDto(AcrReviewersSchema) {}

export const AcrOfficeFactsSchema = z.object({
  cl: z.number().min(0).max(366).nullable().optional(),
  el: z.number().min(0).max(366).nullable().optional(),
  other: z.number().min(0).max(366).nullable().optional(),
  absent: z.number().min(0).max(366).nullable().optional(),
  /** half-pay leave and the late arrival slips issued, as the office keeps them (20 Oct 2026) */
  hpl: z.number().min(0).max(366).nullable().optional(),
  lateSlips: z.number().int().min(0).max(999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export class AcrOfficeFactsDto extends createZodDto(AcrOfficeFactsSchema) {}
