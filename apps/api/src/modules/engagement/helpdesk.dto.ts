import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const HELPDESK = {
  settingsManage: 'helpdesk.settings.manage',
  viewAll: 'helpdesk.ticket.viewall',
  raise: 'helpdesk.ticket.raise',
  respond: 'helpdesk.ticket.respond',
  provider: 'helpdesk.provider.respond',
} as const;

export const DeskSchema = z.enum(['parent', 'staff', 'provider']);
export type Desk = z.infer<typeof DeskSchema>;
export const PrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const Files = z.array(IdSchema).max(5).default([]);
const Code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'letters, digits and _ (2-40), starting with a letter');
const Email = z.string().trim().toLowerCase().email().max(200);

export const ListTicketsSchema = z.object({
  desk: DeskSchema.optional(),
  status: z.enum(['open', 'in_progress', 'answered', 'closed', 'active', 'overdue']).optional(),
  view: z.enum(['all', 'mine', 'assigned']).default('all'),
  head: z.string().trim().max(40).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class ListTicketsDto extends createZodDto(ListTicketsSchema) {}

/** The desk list as a file: the same filters, no paging. */
export const ExportTicketsSchema = ListTicketsSchema.omit({ page: true, size: true });
export class ExportTicketsDto extends createZodDto(ExportTicketsSchema) {}

export const CreateTicketSchema = z.object({
  desk: z.enum(['staff', 'provider']),
  categoryCode: Code,
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(5000),
  priority: PrioritySchema.default('normal'),
  module: z.string().trim().max(60).optional(),
  fileIds: Files,
});
export class CreateTicketDto extends createZodDto(CreateTicketSchema) {}

export const ReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  fileIds: Files,
  isInternal: z.boolean().default(false),
});
export class ReplyDto extends createZodDto(ReplySchema) {}

export const AssignTicketSchema = z
  .object({
    userId: IdSchema.optional(),
    roleCode: Code.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((x) => Boolean(x.userId) !== Boolean(x.roleCode), {
    message: 'Choose an employee or a role',
  });
export class AssignTicketDto extends createZodDto(AssignTicketSchema) {}

export const CloseTicketSchema = z.object({
  resolution: z.string().trim().min(3).max(5000),
  fileIds: Files,
});
export class CloseTicketDto extends createZodDto(CloseTicketSchema) {}

export const ReopenTicketSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  fileIds: Files,
});
export class ReopenTicketDto extends createZodDto(ReopenTicketSchema) {}

export const RateTicketSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export class RateTicketDto extends createZodDto(RateTicketSchema) {}

const LevelSchema = z
  .object({
    level: z.number().int().min(2).max(6),
    hours: z.number().min(0.5).max(2000),
    assignType: z.enum(['role', 'employee', 'email_only']),
    roleCode: Code.optional(),
    userId: IdSchema.optional(),
    emails: z.array(Email).max(10).default([]),
  })
  .refine((l) => l.assignType !== 'role' || l.roleCode, { message: 'Choose the role' })
  .refine((l) => l.assignType !== 'employee' || l.userId, { message: 'Choose the employee' })
  .refine((l) => l.assignType !== 'email_only' || l.emails.length > 0, {
    message: 'Give at least one email',
  });

export const HeadSchema = z
  .object({
    desk: DeskSchema,
    code: Code,
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional(),
    ownerType: z.enum(['class_teacher', 'role', 'employee', 'provider']),
    ownerRole: Code.optional(),
    ownerUserId: IdSchema.optional(),
    slaHours: z.number().min(0.5).max(2000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(999).default(0),
    active: z.boolean().default(true),
    levels: z.array(LevelSchema).max(5).default([]),
  })
  .refine((h) => h.ownerType !== 'role' || h.ownerRole, { message: 'Choose the owner role' })
  .refine((h) => h.ownerType !== 'employee' || h.ownerUserId, {
    message: 'Choose the owner employee',
  })
  .refine((h) => h.ownerType !== 'class_teacher' || h.desk === 'parent', {
    message: 'Only parent queries can go to the class teacher',
  })
  .refine((h) => (h.ownerType === 'provider') === (h.desk === 'provider'), {
    message: 'Tickets to the ERP provider are answered by the provider',
  })
  .refine((h) => new Set(h.levels.map((l) => l.level)).size === h.levels.length, {
    message: 'Each escalation level once',
  });
export class HeadDto extends createZodDto(HeadSchema) {}

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
export const HelpdeskSettingsSchema = z
  .object({
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    dayStart: Time,
    dayEnd: Time,
    reopenDays: z.number().int().min(0).max(60),
    providerName: z.string().trim().max(120).optional(),
    providerEmail: Email.optional().or(z.literal('')),
    providerSeniorName: z.string().trim().max(120).optional(),
    providerSeniorEmail: Email.optional().or(z.literal('')),
    providerSla: z.object({
      urgent: z.number().min(0.5).max(2000),
      high: z.number().min(0.5).max(2000),
      normal: z.number().min(0.5).max(2000),
      low: z.number().min(0.5).max(2000),
    }),
  })
  .refine((s) => s.dayEnd > s.dayStart, { message: 'The day must end after it starts' });
export class HelpdeskSettingsDto extends createZodDto(HelpdeskSettingsSchema) {}

export const HelpdeskReportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  desk: DeskSchema.optional(),
  bucket: z.enum(['raised', 'resolved', 'escalated', 'breached', 'open']).default('raised'),
});
export class HelpdeskReportDto extends createZodDto(HelpdeskReportSchema) {}
