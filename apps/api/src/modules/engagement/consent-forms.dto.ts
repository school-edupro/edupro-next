import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';
import { FieldSchema } from './consent-fields';

/** Consent forms (docs/design/28-consent-forms.md). */
export const CONSENT = {
  manage: 'engagement.consent_form.manage',
  integrate: 'engagement.consent_form.integrate',
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

const Key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/);
const Money = z.number().min(0).max(10_000_000);
/**
 * The fee of an answer about a pupil, raised as a misc fee (after approval when the form needs it):
 * none, a fixed amount, or calculated: a base plus, per question, a rate per unit (numbers) or a price
 * per option (choices, yes / no).
 */
export const ConsentFeeSchema = z.object({
  mode: z.enum(['none', 'fixed', 'calc']).default('none'),
  amount: Money.optional(),
  base: Money.optional(),
  items: z
    .array(
      z.object({
        field: Key,
        rate: Money.optional(),
        prices: z.record(z.string().max(120), Money).optional(),
      }),
    )
    .max(20)
    .default([]),
  /** the last date to pay (empty: the day the form closes, else two weeks after the answer) */
  lastDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ConsentFee = z.infer<typeof ConsentFeeSchema>;
/** Who approves an answer, level by level: the pupil's class teacher, a role, or a named user. */
export const ConsentLevelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  resolver: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('class_teacher') }),
    z.object({
      kind: z.literal('role'),
      roleCode: z
        .string()
        .trim()
        .regex(/^[a-z_]{2,40}$/),
    }),
    z.object({ kind: z.literal('named_user'), userId: IdSchema }),
  ]),
});
export const ConsentApprovalSchema = z.object({
  on: z.boolean().default(false),
  levels: z.array(ConsentLevelSchema).max(5).default([]),
});
export type ConsentApproval = z.infer<typeof ConsentApprovalSchema>;

export const ConsentSettingsSchema = z.object({
  success: z.string().trim().max(500).optional(),
  opensAt: DateTime.optional(),
  closesAt: DateTime.optional(),
  repeat: z.enum(['once', 'many']).default('once'),
  /** the form closes when this many responses are in */
  cap: z.number().int().min(1).max(100_000).optional(),
  officeFill: z.boolean().default(true),
  /** families and staff may change their answer until then, while it is not yet approved */
  editUntil: DateTime.optional(),
  fee: ConsentFeeSchema.default({ mode: 'none', items: [] }),
  approval: ConsentApprovalSchema.default({ on: false, levels: [] }),
  /** the public link and QR: families without the app (admission no. + code) and / or outsiders */
  publicLink: z
    .object({
      on: z.boolean().default(false),
      families: z.boolean().default(true),
      outsiders: z.boolean().default(false),
    })
    .default({ on: false, families: true, outsiders: false }),
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

/** SMS / WhatsApp / email with the school's templates, through the usual message approval. */
export const ConsentChannelsSchema = z
  .array(z.object({ channel: z.enum(['sms', 'whatsapp', 'email']), templateId: IdSchema }))
  .max(3)
  .default([]);
export const ConsentStatusSchema = z.object({
  status: z.enum(['published', 'closed', 'archived', 'draft']),
  /** on publish: tell the audience in the app (push, and the card on the home screen) */
  push: z.boolean().default(true),
  channels: ConsentChannelsSchema,
});
export const ConsentNotifySchema = z.object({ channels: ConsentChannelsSchema });
export class ConsentNotifyDto extends createZodDto(ConsentNotifySchema) {}
export const ConsentDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export class ConsentDecideDto extends createZodDto(ConsentDecideSchema) {}
export class ConsentStatusDto extends createZodDto(ConsentStatusSchema) {}

export const ConsentListQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'closed', 'archived', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
});
export class ConsentListQueryDto extends createZodDto(ConsentListQuerySchema) {}

export const ConsentRegisterQuerySchema = z.object({
  tab: z.enum(['answered', 'pending']).default('answered'),
  /** answered: only those waiting for approval, approved or rejected */
  status: z.enum(['waiting', 'approved', 'rejected']).optional(),
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

/** A changed answer: a file or signature question may say "keep" to keep what was sent before. */
export const ConsentEditSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  signedName: z.string().trim().min(2).max(120).optional(),
});
export class ConsentEditDto extends createZodDto(ConsentEditSchema) {}

export const MineFormQuerySchema = z.object({
  studentId: IdSchema.optional(),
  /** changing an answer already given */
  responseId: IdSchema.optional(),
});
export class MineFormQueryDto extends createZodDto(MineFormQuerySchema) {}

// ---- the public link (no login) ----
const Mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number');
const Email = z.string().trim().toLowerCase().email().max(200);
/** A code to an outsider's mobile or email, or to the family mobile of a pupil (admission no.). */
export const PublicOtpSchema = z
  .object({
    mode: z.enum(['outsider', 'family']),
    mobile: Mobile.optional(),
    email: Email.optional(),
    admissionNo: z.string().trim().min(1).max(40).optional(),
    challenge: z.string().min(10).max(500),
    nonce: z.string().min(1).max(40),
  })
  .refine((v) => (v.mode === 'family' ? Boolean(v.admissionNo) : Boolean(v.mobile || v.email)), {
    message: 'give the admission number, or a mobile or an email',
  });
export class PublicOtpDto extends createZodDto(PublicOtpSchema) {}
export const PublicVerifySchema = z.object({
  mode: z.enum(['outsider', 'family']),
  mobile: Mobile.optional(),
  email: Email.optional(),
  admissionNo: z.string().trim().min(1).max(40).optional(),
  code: z.string().regex(/^\d{6}$/),
  /** an outsider's name */
  name: z.string().trim().min(2).max(120).optional(),
});
export class PublicVerifyDto extends createZodDto(PublicVerifySchema) {}
export const PublicUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});
export class PublicUploadDto extends createZodDto(PublicUploadSchema) {}
export const PublicRespondSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  signedName: z.string().trim().min(2).max(120).optional(),
});
export class PublicRespondDto extends createZodDto(PublicRespondSchema) {}

// ---- webhooks and API keys (part 4) ----
const EVENTS = z.enum(['submitted', 'changed', 'approved', 'rejected', 'paid']);
export const WebhookSchema = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(EVENTS).min(1).max(5),
});
export class WebhookDto extends createZodDto(WebhookSchema) {}
export const WebhookPatchSchema = z.object({
  url: z.string().trim().url().max(500).optional(),
  events: z.array(EVENTS).min(1).max(5).optional(),
  active: z.boolean().optional(),
});
export class WebhookPatchDto extends createZodDto(WebhookPatchSchema) {}
export const ApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scope: z.enum(['read', 'read_approve']),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export class ApiKeyDto extends createZodDto(ApiKeySchema) {}
export const ApiListQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
});
export class ApiListQueryDto extends createZodDto(ApiListQuerySchema) {}
export const ApiDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(400).optional(),
});
export class ApiDecideDto extends createZodDto(ApiDecideSchema) {}
