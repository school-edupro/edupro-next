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
  body: z.string().min(1).max(4000),
  /** Declared placeholders; derived from the body when omitted. */
  variables: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
    .max(50)
    .optional(),
  dltTemplateId: z.string().trim().max(40).optional(),
  dltEntityId: z.string().trim().max(40).optional(),
  senderId: z.string().trim().max(120).optional(),
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
