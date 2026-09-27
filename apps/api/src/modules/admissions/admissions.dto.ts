import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const ADMISSIONS = {
  cycleView: 'admissions.cycle.view',
  cycleManage: 'admissions.cycle.manage',
  applicationView: 'admissions.application.view',
  applicationReview: 'admissions.application.review',
} as const;

export const FormFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  label: z.string().trim().min(1).max(120),
  labelHi: z.string().trim().max(120).optional(),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'boolean', 'email', 'mobile']),
  required: z.boolean().optional(),
  options: z
    .array(
      z.object({
        value: z.string().min(1).max(40),
        label: z.string().min(1).max(80),
        labelHi: z.string().max(80).optional(),
      }),
    )
    .max(50)
    .optional(),
  section: z.string().trim().min(1).max(60),
  sectionHi: z.string().trim().max(60).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const CriterionSchema = z
  .object({
    classId: IdSchema,
    seats: z.number().int().min(0).max(5000).default(0),
    dobFrom: DateSchema.optional(),
    dobTo: DateSchema.optional(),
    passcode: z.string().trim().min(4).max(40).optional(),
  })
  .refine((v) => !v.dobFrom || !v.dobTo || v.dobTo >= v.dobFrom, {
    message: 'dobTo before dobFrom',
    path: ['dobTo'],
  });

export const ScoreCriterionSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,30}$/),
  name: z.string().trim().min(1).max(80),
  points: z.number().min(0).max(1000),
  autoRule: z
    .string()
    .regex(/^(sibling|staff_ward|alumni|single_girl_child|distance_within:\d{1,3})$/)
    .optional(),
});

export const CreateCycleSchema = z
  .object({
    academicYearId: IdSchema,
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,20}$/, 'upper case letters, digits and dashes'),
    name: z.string().trim().min(1).max(120),
    nameHi: z.string().trim().max(120).optional(),
    instructions: z.string().trim().max(5000).optional(),
    instructionsHi: z.string().trim().max(5000).optional(),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    applicationFee: z.number().min(0).max(1_000_000).default(0),
    formSchema: z.array(FormFieldSchema).max(80).optional(),
    criteria: z.array(CriterionSchema).max(30).default([]),
    scoreCriteria: z.array(ScoreCriterionSchema).max(30).default([]),
  })
  .refine((v) => v.closesAt > v.opensAt, {
    message: 'closesAt must be after opensAt',
    path: ['closesAt'],
  });
export class CreateCycleDto extends createZodDto(CreateCycleSchema) {}

export const UpdateCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    nameHi: z.string().trim().max(120).nullable(),
    instructions: z.string().trim().max(5000).nullable(),
    instructionsHi: z.string().trim().max(5000).nullable(),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    applicationFee: z.number().min(0).max(1_000_000),
    formSchema: z.array(FormFieldSchema).max(80),
    criteria: z.array(CriterionSchema).max(30),
    scoreCriteria: z.array(ScoreCriterionSchema).max(30),
    status: z.enum(['draft', 'open', 'closed']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateCycleDto extends createZodDto(UpdateCycleSchema) {}

export const ApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'under_review',
  'shortlisted',
  'selected',
  'waitlisted',
  'rejected',
  'withdrawn',
]);

export const ListApplicationsQuerySchema = z.object({
  cycleId: IdSchema.optional(),
  classId: IdSchema.optional(),
  status: ApplicationStatusSchema.optional(),
  duplicates: z.coerce.boolean().optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListApplicationsQueryDto extends createZodDto(ListApplicationsQuerySchema) {}

export const SetApplicationStatusSchema = z.object({
  status: z.enum([
    'under_review',
    'shortlisted',
    'selected',
    'waitlisted',
    'rejected',
    'withdrawn',
  ]),
  note: z.string().trim().max(500).optional(),
});
export class SetApplicationStatusDto extends createZodDto(SetApplicationStatusSchema) {}

export const ScoreApplicationSchema = z.object({
  /** Manual criteria to award (codes from the cycle's scoring masters); auto rules are recomputed. */
  award: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{1,30}$/),
    )
    .max(30),
  remarks: z.string().trim().max(500).optional(),
});
export class ScoreApplicationDto extends createZodDto(ScoreApplicationSchema) {}

// ---- public (applicant) ---------------------------------------------------------------------------
export const SchoolCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{2,20}$/);
export const MobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, '10 digits starting 6-9');

export const RequestOtpSchema = z.object({
  schoolCode: SchoolCodeSchema,
  mobile: MobileSchema,
  challenge: z.string().min(10).max(600),
  nonce: z.string().min(1).max(40),
});
export class RequestOtpDto extends createZodDto(RequestOtpSchema) {}

export const VerifyOtpSchema = z.object({
  schoolCode: SchoolCodeSchema,
  mobile: MobileSchema,
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().max(120).optional(),
});
export class VerifyOtpDto extends createZodDto(VerifyOtpSchema) {}

export const CreateApplicationSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  childFirstName: z.string().trim().min(1).max(80),
  childLastName: z.string().trim().max(80).optional(),
  childDob: DateSchema,
  childGender: z.enum(['male', 'female', 'other', 'unspecified']).default('unspecified'),
  passcode: z.string().trim().max(40).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  submit: z.boolean().default(false),
});
export class CreateApplicationDto extends createZodDto(CreateApplicationSchema) {}

export const UpdateApplicationSchema = z
  .object({
    childFirstName: z.string().trim().min(1).max(80),
    childLastName: z.string().trim().max(80).nullable(),
    childDob: DateSchema,
    childGender: z.enum(['male', 'female', 'other', 'unspecified']),
    data: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateApplicationDto extends createZodDto(UpdateApplicationSchema) {}
