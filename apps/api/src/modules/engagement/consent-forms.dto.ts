import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';
import { FieldSchema } from './consent-fields';

/** Consent forms (docs/design/28-consent-forms.md). */
export const CONSENT = {
  manage: 'engagement.consent_form.manage',
  familyView: 'engagement.family.view',
} as const;

const DateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'a date and time');
const Ids = z.array(IdSchema).max(5000).default([]);
const Names = z.array(z.string().trim().min(1).max(120)).max(200).default([]);

/** Who is asked. Families: every pupil, a filter (all filters given must hold), or pupils by name. */
export const ConsentAudienceSchema = z.object({
  pupils: z.enum(['all', 'filter', 'pupils']).default('all'),
  classIds: Ids,
  sectionIds: Ids,
  houses: Names,
  routeIds: Ids,
  boarders: z.boolean().default(false),
  studentIds: Ids,
  /** pupils by admission number (turned into studentIds when saved) */
  admissionNos: Names,
  staff: z.enum(['all', 'filter', 'people']).default('all'),
  departments: Names,
  designations: Names,
  employeeIds: Ids,
  /** staff by employee code (turned into employeeIds when saved) */
  employeeCodes: Names,
});
export type ConsentAudience = z.infer<typeof ConsentAudienceSchema>;

export const ConsentSettingsSchema = z.object({
  success: z.string().trim().max(500).optional(),
  opensAt: DateTime.optional(),
  closesAt: DateTime.optional(),
  repeat: z.enum(['once', 'many']).default('once'),
  /** the form closes when this many responses are in */
  cap: z.number().int().min(1).max(100_000).optional(),
  officeFill: z.boolean().default(true),
});
export type ConsentSettings = z.infer<typeof ConsentSettingsSchema>;

export const ConsentFormSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).optional(),
    respondents: z.enum(['family', 'staff', 'both']).default('family'),
    fields: z.array(FieldSchema).min(1).max(80),
    audience: ConsentAudienceSchema.default({}),
    settings: ConsentSettingsSchema.default({}),
  })
  .refine(
    (v) => !v.settings.opensAt || !v.settings.closesAt || v.settings.opensAt < v.settings.closesAt,
    {
      message: 'the form must open before it closes',
      path: ['settings', 'closesAt'],
    },
  );
export class ConsentFormDto extends createZodDto(ConsentFormSchema) {}

export const ConsentStatusSchema = z.object({
  status: z.enum(['published', 'closed', 'archived', 'draft']),
  /** on publish: tell the audience in the app (push, and the card on the home screen) */
  push: z.boolean().default(true),
});
export class ConsentStatusDto extends createZodDto(ConsentStatusSchema) {}

export const ConsentListQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'closed', 'archived', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
});
export class ConsentListQueryDto extends createZodDto(ConsentListQuerySchema) {}

export const ConsentRegisterQuerySchema = z.object({
  tab: z.enum(['answered', 'pending']).default('answered'),
  sectionId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ConsentRegisterQueryDto extends createZodDto(ConsentRegisterQuerySchema) {}
export const ConsentFileQuerySchema = ConsentRegisterQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class ConsentFileQueryDto extends createZodDto(ConsentFileQuerySchema) {}

const AnswerSchema = z.union([
  z.string().max(400_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);
/** A response: about a pupil (family, or the office for a family) or by / for a staff member. */
export const ConsentRespondSchema = z.object({
  studentId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  answers: z.record(z.string(), AnswerSchema),
  signedName: z.string().trim().min(2).max(120).optional(),
});
export class ConsentRespondDto extends createZodDto(ConsentRespondSchema) {}

export const MineFormQuerySchema = z.object({ studentId: IdSchema.optional() });
export class MineFormQueryDto extends createZodDto(MineFormQuerySchema) {}
