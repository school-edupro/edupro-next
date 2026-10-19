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
      }),
    )
    .min(1)
    .max(6),
});
export class AcrLevelsDto extends createZodDto(AcrLevelsSchema) {}

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
  part: z.enum(['self', 'rate']),
  staffGroup: z.enum(['teaching', 'non_teaching', 'both']),
  section: z.string().trim().min(2).max(80),
  text: z.string().trim().min(3).max(300),
  kind: z.enum(['scale', 'text']),
  weight: z.number().min(0.25).max(10).default(1),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});
export class AcrQuestionDto extends createZodDto(AcrQuestionSchema) {}

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
  z.union([z.number().int().min(1).max(10), z.string().max(4000)]),
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
});
export class AcrLevelDto extends createZodDto(AcrLevelSchema) {}

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
  note: z.string().trim().max(500).nullable().optional(),
});
export class AcrOfficeFactsDto extends createZodDto(AcrOfficeFactsSchema) {}
