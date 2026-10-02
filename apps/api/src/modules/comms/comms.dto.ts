import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const IdSchema = z.string().regex(/^[0-9]{1,18}$/, 'must be a numeric id');
export const ChannelSchema = z.enum(['sms', 'whatsapp', 'email', 'push']);
export type Channel = z.infer<typeof ChannelSchema>;

const TemplateBase = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,59}$/, 'lower snake case, 2 to 60 characters'),
  channel: ChannelSchema,
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().max(200).optional(),
  /** Text for SMS / WhatsApp; HTML for email templates in the HTML editor (sanitised). */
  body: z.string().min(1).max(100_000),
  format: z.enum(['text', 'html']).optional(),
  category: z.enum(['service', 'general']).optional(),
  /** Declared placeholders; derived from the body when omitted. */
  variables: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
    .max(50)
    .optional(),
  dltTemplateId: z.string().trim().max(40).optional(),
  dltEntityId: z.string().trim().max(40).optional(),
  senderId: z.string().trim().max(120).optional(),
  /** WhatsApp: the template name and language Meta approved, and the variable for each {{1}}, {{2}}... */
  waTemplateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and _ as approved by Meta')
    .optional()
    .or(z.literal('')),
  waLanguage: z.string().trim().max(10).optional(),
  waParams: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
    .max(20)
    .optional(),
  waHeader: z.enum(['none', 'text', 'image', 'document']).optional(),
  providerTemplateId: z.string().trim().max(60).optional(),
});

export const CreateTemplateSchema = TemplateBase.refine(
  (v) => v.channel !== 'sms' || (v.dltTemplateId && v.dltTemplateId.length > 0),
  { message: 'SMS templates need the DLT content template id', path: ['dltTemplateId'] },
).refine((v) => v.channel !== 'email' || (v.subject && v.subject.length > 0), {
  message: 'Email templates need a subject',
  path: ['subject'],
});
export class CreateTemplateDto extends createZodDto(CreateTemplateSchema) {}

export const UpdateTemplateSchema = TemplateBase.omit({ code: true, channel: true })
  .extend({ status: z.enum(['active', 'inactive']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export const PreviewTemplateSchema = z.object({
  channel: ChannelSchema,
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(100_000),
  format: z.enum(['text', 'html']).default('text'),
});
export class PreviewTemplateDto extends createZodDto(PreviewTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(UpdateTemplateSchema) {}

export const ListTemplatesQuerySchema = z.object({
  channel: ChannelSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export class ListTemplatesQueryDto extends createZodDto(ListTemplatesQuerySchema) {}

export const SendMessageSchema = z
  .object({
    templateId: IdSchema.optional(),
    templateCode: z.string().trim().min(2).max(60).optional(),
    channel: ChannelSchema.optional(),
    recipientUserId: IdSchema.optional(),
    recipientAddress: z.string().trim().min(3).max(320).optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((v) => v.templateId || (v.templateCode && v.channel), {
    message: 'templateId, or templateCode with channel, is required',
    path: ['templateId'],
  })
  .refine((v) => v.recipientUserId || v.recipientAddress, {
    message: 'recipientUserId or recipientAddress is required',
    path: ['recipientUserId'],
  });
export class SendMessageDto extends createZodDto(SendMessageSchema) {}

export const ListMessagesQuerySchema = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled']).optional(),
  channel: ChannelSchema.optional(),
  recipientUserId: IdSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListMessagesQueryDto extends createZodDto(ListMessagesQuerySchema) {}

// ---- Sprint 10: message requests, groups, consent, delivery receipts -------------------------------
const Values = z.array(z.string().trim().min(1).max(80)).max(200).optional();
/** Master-wise selection: students by class / section / house / category..., employees by department... */
export const RuleSchema = z.object({
  people: z.enum(['students', 'employees', 'both']).optional(),
  classIds: z.array(IdSchema).max(200).optional(),
  sectionIds: z.array(IdSchema).max(500).optional(),
  houses: Values,
  categories: Values,
  genders: Values,
  streams: Values,
  religions: Values,
  routeIds: z.array(IdSchema).max(200).optional(),
  departments: Values,
  designations: Values,
  employeeTypes: Values,
});
export const AudienceKindSchema = z.enum([
  'everyone',
  'students',
  'employees',
  'class',
  'class_section',
  'route',
  'group',
  'individuals',
  'filter',
  'upload',
]);
export const RequestTargetSchema = z.object({
  type: z.enum([
    'class',
    'class_section',
    'route',
    'group',
    'user',
    'student',
    'employee',
    'guardian',
    'contact',
  ]),
  id: IdSchema,
});
export const UploadRowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mobile: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  vars: z.record(z.string().max(60), z.string().max(500)).optional(),
});
export const CreateRequestSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    category: z.enum(['service', 'general']).default('general'),
    /** one channel (older callers) ... */
    templateId: IdSchema.optional(),
    /** ... or several at once: SMS + WhatsApp + email */
    channels: z
      .array(
        z
          .object({
            channel: z.enum(['sms', 'whatsapp', 'email']),
            templateId: IdSchema.optional(),
            /** email only: written in compose, no template (subject + body from the request) */
            custom: z.boolean().optional(),
          })
          .refine((v) => (v.custom ? v.channel === 'email' : Boolean(v.templateId)), {
            message: 'choose a template (only an email can be written without one)',
          }),
      )
      .max(3)
      .optional(),
    /** the message merged into each template's {{body}}; HTML from the email editor when bodyFormat is html */
    /** needed only when a chosen template has {{body}} (and for an own email) */
    body: z.string().trim().max(100_000).default(''),
    bodyFormat: z.enum(['text', 'html']).default('text'),
    /** email subject when the template's subject is just {{title}} or empty */
    subject: z.string().trim().max(200).optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    audience: AudienceKindSchema,
    targets: z.array(RequestTargetSchema).max(5000).default([]),
    rule: RuleSchema.optional(),
    upload: z.array(UploadRowSchema).max(10_000).optional(),
    sendTo: z.enum(['primary', 'parents', 'student', 'student_parents']).default('primary'),
    attachments: z.array(IdSchema).max(5).default([]),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((v) => v.templateId || v.channels?.length, {
    message: 'choose at least one channel and its template',
    path: ['channels'],
  })
  .refine(
    (v) =>
      ['everyone', 'students', 'employees'].includes(v.audience) ||
      (v.audience === 'filter' && Boolean(v.rule)) ||
      (v.audience === 'upload' && Boolean(v.upload?.length)) ||
      v.targets.length > 0,
    { message: 'choose who receives the message', path: ['targets'] },
  );
export class CreateRequestDto extends createZodDto(CreateRequestSchema) {}
export const RecipientSheetSchema = z
  .object({
    csv: z.string().max(2_000_000).optional(),
    contentBase64: z.string().max(6_000_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'send csv text or an xlsx file',
  });
export class RecipientSheetDto extends createZodDto(RecipientSheetSchema) {}
export const ListRequestsQuerySchema = z.object({
  status: z
    .enum(['draft', 'pending_approval', 'approved', 'rejected', 'sending', 'sent', 'cancelled'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListRequestsQueryDto extends createZodDto(ListRequestsQuerySchema) {}

export const GroupKindSchema = z.enum([
  'student',
  'employee',
  'student_teacher',
  'external',
  'mixed',
]);
export const MemberRefSchema = z.object({
  type: z.enum(['student', 'employee', 'guardian', 'contact', 'user']),
  id: IdSchema,
});
export const CreateGroupSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{2,40}$/, 'lowercase letters, digits, _ or -'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  kind: GroupKindSchema.optional(),
  mode: z.enum(['static', 'rule']).optional(),
  rule: RuleSchema.optional(),
  /** older callers: logins of school members */
  userIds: z.array(IdSchema).max(2000).default([]),
  members: z.array(MemberRefSchema).max(5000).default([]),
});
export class CreateGroupDto extends createZodDto(CreateGroupSchema) {}
export const UpdateGroupSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  rule: RuleSchema.optional(),
});
export class UpdateGroupDto extends createZodDto(UpdateGroupSchema) {}
export const GroupMembersSchema = z.object({
  add: z
    .array(z.union([IdSchema, MemberRefSchema]))
    .max(5000)
    .default([]),
  remove: z
    .array(z.union([IdSchema, MemberRefSchema]))
    .max(5000)
    .default([]),
});
export class GroupMembersDto extends createZodDto(GroupMembersSchema) {}
export const GroupUploadSchema = z
  .object({
    csv: z.string().max(2_000_000).optional(),
    contentBase64: z.string().max(6_000_000).optional(),
    mode: z.enum(['add', 'replace']).default('add'),
    dryRun: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.contentBase64), {
    message: 'send csv text or an xlsx file',
  });
export class GroupUploadDto extends createZodDto(GroupUploadSchema) {}
export const PeopleSearchSchema = z.object({
  q: z.string().trim().min(2).max(60),
  types: z
    .string()
    .default('student,employee')
    .transform((v) =>
      v
        .split(',')
        .filter((x): x is 'student' | 'employee' | 'guardian' =>
          ['student', 'employee', 'guardian'].includes(x),
        ),
    ),
});
export class PeopleSearchDto extends createZodDto(PeopleSearchSchema) {}

export const ConsentStatusSchema = z.enum(['granted', 'withdrawn']);
export const RecordConsentSchema = z.object({
  userId: IdSchema,
  studentId: IdSchema.optional(),
  purposeCode: z.string().trim().min(2).max(60),
  status: ConsentStatusSchema,
  note: z.string().trim().max(300).optional(),
});
export class RecordConsentDto extends createZodDto(RecordConsentSchema) {}
export const SelfConsentSchema = z.object({
  purposeCode: z.string().trim().min(2).max(60),
  status: ConsentStatusSchema,
});
export class SelfConsentDto extends createZodDto(SelfConsentSchema) {}
export const ConsentQuerySchema = z.object({ userId: IdSchema.optional() });
export class ConsentQueryDto extends createZodDto(ConsentQuerySchema) {}

export const DeliveryReceiptSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  messageId: z.string().trim().min(1).max(120),
  status: z.enum(['delivered', 'failed']),
  reason: z.string().trim().max(300).optional(),
  receiptId: z.string().trim().max(120).optional(),
});
export class DeliveryReceiptDto extends createZodDto(DeliveryReceiptSchema) {}

// ---- communication v2: settings, providers, credits -------------------------------------------------
const Time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
  .or(z.literal(''))
  .optional();
export const CommsSettingsSchema = z.object({
  approvalThreshold: z.number().int().min(0).max(100_000),
  approvalExemptRoles: z.array(z.string().trim().min(1).max(60)).max(50),
  quietFrom: Time,
  quietTo: Time,
  attachmentMaxMb: z.number().int().min(1).max(25),
  rates: z.object({
    sms: z.number().min(0).max(100),
    whatsapp: z.number().min(0).max(100),
    email: z.number().min(0).max(100),
  }),
  lowBalance: z.object({
    sms: z.number().min(0).max(10_000_000).optional(),
    whatsapp: z.number().min(0).max(10_000_000).optional(),
    email: z.number().min(0).max(10_000_000).optional(),
  }),
  pushEvents: z
    .array(
      z.enum([
        'school_message',
        'attendance',
        'fees',
        'transport',
        'queries',
        'notices',
        'homework',
        'approvals',
      ]),
    )
    .max(8)
    .optional(),
});
export class CommsSettingsDto extends createZodDto(CommsSettingsSchema) {}
export const ProviderChannelSchema = z.enum(['sms', 'whatsapp', 'email']);
export const ProviderSchema = z.object({
  provider: z.enum([
    'msg91',
    'smsbhejo',
    'meta_whatsapp',
    'ems_whatsapp',
    'smtp',
    'fcm',
    'console',
  ]),
  /** non-secret: senderId, route, dltEntityId, phoneNumberId, wabaId, apiVersion, host, port, secure, user, fromEmail, fromName, replyTo */
  config: z
    .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean()]))
    .default({}),
  /** secret: authKey, accessToken, appSecret, password; empty keeps the saved value */
  secrets: z.record(z.string().max(40), z.string().max(10_000)).optional(),
  active: z.boolean().default(true),
});
export class ProviderDto extends createZodDto(ProviderSchema) {}
export const ProviderTestSchema = z.object({
  to: z.string().trim().min(5).max(200),
  text: z.string().trim().max(500).optional(),
  templateId: IdSchema.optional(),
});
export class ProviderTestDto extends createZodDto(ProviderTestSchema) {}
export const CreditSchema = z.object({
  channel: ProviderChannelSchema,
  units: z
    .number()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((v) => v !== 0, 'not zero'),
  amount: z.number().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(300).optional(),
  onDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export class CreditDto extends createZodDto(CreditSchema) {}

export const CustomVariableSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lower case letters, digits and _, starting with a letter'),
  label: z.string().trim().min(2).max(80),
  value: z.string().max(500).default(''),
});
export class CustomVariableDto extends createZodDto(CustomVariableSchema) {}

export const InboxQuerySchema = z.object({
  studentId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
export class InboxQueryDto extends createZodDto(InboxQuerySchema) {}
export const InboxReadSchema = z.object({ ids: z.array(IdSchema).min(1).max(200) });
export class InboxReadDto extends createZodDto(InboxReadSchema) {}

export const ApproversSchema = z.object({
  roleCodes: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z_]{2,40}$/),
    )
    .max(20)
    .default([]),
  employeeIds: z.array(IdSchema).max(50).default([]),
  /** approvers saved before (by login), kept as they are */
  keepUserIds: z.array(IdSchema).max(50).default([]),
});
export class ApproversDto extends createZodDto(ApproversSchema) {}

export const PushDeviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  app: z.enum(['parent', 'teacher']),
  userAgent: z.string().trim().max(300).optional(),
});
export class PushDeviceDto extends createZodDto(PushDeviceSchema) {}
