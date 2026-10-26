import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RULE_OPS } from '@edupro/db';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Condition = z.object({
  field: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  op: z.enum(RULE_OPS),
  value: z.string().max(200).optional(),
});

export const AdmissionSettingsSchema = z.object({
  signinChannels: z
    .array(z.enum(['email', 'sms', 'whatsapp']))
    .min(1)
    .max(3),
  regReceiptPrefix: z.string().regex(/^[A-Z]{1,6}$/, 'one to six capital letters'),
  admReceiptPrefix: z.string().regex(/^[A-Z]{1,6}$/, 'one to six capital letters'),
  /** also show sign-in codes on screen (testing; every code shown is recorded) */
  otpOnScreen: z.boolean().optional(),
});
export class AdmissionSettingsDto extends createZodDto(AdmissionSettingsSchema) {}

export const FeeCategoriesSchema = z.object({
  categories: z
    .array(
      z.object({
        id: IdSchema.optional(),
        code: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
        name: z.string().trim().min(2).max(60),
        logic: z.enum(['all', 'any']).default('any'),
        conditions: z.array(Condition).max(10).default([]),
        isDefault: z.boolean().default(false),
        status: z.enum(['active', 'inactive']).default('active'),
      }),
    )
    .min(1)
    .max(20)
    .refine((l) => l.filter((c) => c.isDefault && c.status === 'active').length === 1, {
      message: 'Exactly one active category must be the default (e.g. General)',
    })
    .refine((l) => new Set(l.map((c) => c.code)).size === l.length, {
      message: 'Codes must differ',
    }),
});
export class FeeCategoriesDto extends createZodDto(FeeCategoriesSchema) {}

export const SessionClassesSchema = z.object({
  classes: z
    .array(
      z
        .object({
          classId: IdSchema,
          formId: IdSchema.nullable(),
          seats: z.number().int().min(0).max(5000),
          opensAt: z.string().datetime().nullish(),
          closesAt: z.string().datetime().nullish(),
          ageAsOn: DateSchema.nullish(),
          dobFrom: DateSchema.nullish(),
          dobTo: DateSchema.nullish(),
          /** the PIN codes a family's address may start with (none: any) */
          pincodePrefixes: z
            .array(z.string().regex(/^\d{1,6}$/))
            .max(40)
            .nullish(),
          /** an alumnus parent's pass-out year must be before this */
          passOutBefore: z.number().int().min(1950).max(2100).nullish(),
          notes: z.string().trim().max(500).nullish(),
          status: z.enum(['open', 'closed']).default('open'),
        })
        .refine((v) => !v.dobFrom || !v.dobTo || v.dobTo >= v.dobFrom, {
          message: 'Date of birth "to" is before "from"',
        })
        .refine((v) => !v.opensAt || !v.closesAt || v.closesAt > v.opensAt, {
          message: 'The class closes before it opens',
        }),
    )
    .max(40),
});
export class SessionClassesDto extends createZodDto(SessionClassesSchema) {}

export const SessionFeesSchema = z.object({
  fees: z
    .array(
      z.object({
        classId: IdSchema,
        categoryId: IdSchema,
        registrationFee: z.number().min(0).max(1_000_000),
        admissionFee: z.number().min(0).max(10_000_000),
        /** seats of the category in the class (none: it takes from the class's seats) */
        seats: z.number().int().min(0).max(5000).nullable().optional(),
      }),
    )
    .max(800),
});
export class SessionFeesDto extends createZodDto(SessionFeesSchema) {}

export const SessionSettingsSchema = z.object({
  refundDeductionPct: z.number().min(0).max(100),
  /** days an admission offer stays open */
  offerDays: z.number().int().min(1).max(90).optional(),
});
export class SessionSettingsDto extends createZodDto(SessionSettingsSchema) {}

// ---- merit points (docs/design/40, part 2) ---------------------------------------------------------
const FieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/);
const PointSpec = z.object({
  table: z.enum(['qualification', 'locality', 'alumni_school']).optional(),
  sources: z
    .array(
      z.object({
        role: z.enum(['father', 'mother', 'child']),
        field: z.union([FieldKey, z.literal('')]),
        classField: FieldKey.nullable().optional(),
      }),
    )
    .max(3)
    .optional(),
  school: z.string().trim().max(120).nullable().optional(),
  proof: FieldKey.nullable().optional(),
});
const PointRule = z
  .object({
    name: z.string().trim().min(2).max(80),
    logic: z.enum(['all', 'any']).default('all'),
    /** docs/design/48: fixed (conditions → points), from a score table, or a sibling checked */
    kind: z.enum(['fixed', 'table', 'sibling']).default('fixed'),
    conditions: z.array(Condition).max(10),
    points: z.number().min(-1000).max(1000),
    spec: PointSpec.default({}),
    cap: z.number().positive().max(1000).nullable().optional(),
  })
  .refine((r) => r.kind !== 'fixed' || r.conditions.length > 0, {
    message: 'Add at least one condition',
  })
  .refine((r) => r.kind === 'table' || r.points !== 0, { message: 'Points cannot be 0' })
  .refine(
    (r) => r.kind !== 'table' || (Boolean(r.spec.table) && (r.spec.sources?.length ?? 0) > 0),
    {
      message: 'Choose the table and the questions it reads',
    },
  );
export const SessionPointsSchema = z.object({
  /** the session's list, used by every class without its own */
  session: z.array(PointRule).max(40),
  /** the most a registration can score (none: no maximum) */
  max: z.number().positive().max(10000).nullable().optional(),
  classes: z
    .array(
      z.object({
        classId: IdSchema,
        own: z.boolean(),
        rules: z.array(PointRule).max(40),
        max: z.number().positive().max(10000).nullable().optional(),
      }),
    )
    .max(40),
});
export class SessionPointsDto extends createZodDto(SessionPointsSchema) {}
export type PointRuleInput = z.infer<typeof PointRule>;

// ---- late-entry passcodes (docs/design/41, part 4) --------------------------------------------------
export const PasscodeSchema = z.object({
  classId: IdSchema,
  email: z.string().trim().email().max(200),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number')
    .optional(),
  childName: z.string().trim().max(120).optional(),
  /** the last day it works (India time) */
  validUntil: DateSchema,
  note: z.string().trim().max(300).optional(),
});
export class PasscodeDto extends createZodDto(PasscodeSchema) {}
