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
      }),
    )
    .max(800),
});
export class SessionFeesDto extends createZodDto(SessionFeesSchema) {}

export const SessionSettingsSchema = z.object({
  refundDeductionPct: z.number().min(0).max(100),
});
export class SessionSettingsDto extends createZodDto(SessionSettingsSchema) {}
