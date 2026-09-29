import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Sprint 20: data-principal requests (DPDP), breach log. */
export const PRIVACY = {
  manage: 'platform.privacy.manage',
  request: 'platform.privacy.request',
  erase: 'platform.privacy.erase',
  breach: 'platform.breach.manage',
} as const;

const IdSchema = z.string().regex(/^\d{1,18}$/);

export const DsrKind = z.enum(['access', 'correction', 'erasure', 'grievance']);
export const PrincipalKind = z.enum(['student', 'guardian', 'employee']);

/** A family or a staff member raises a request for themselves or one of their children. */
export const MyDsrSchema = z.object({
  kind: z.enum(['access', 'correction', 'grievance']),
  /** a child of the family; omitted = the person themself (guardian or employee) */
  studentId: IdSchema.optional(),
  detail: z.string().trim().min(3).max(2000),
});
export class MyDsrDto extends createZodDto(MyDsrSchema) {}

/** The office records a request received by any channel, including erasure. */
export const OfficeDsrSchema = z.object({
  kind: DsrKind,
  principalKind: PrincipalKind,
  principalId: IdSchema,
  channel: z.enum(['office', 'email', 'letter']).default('office'),
  detail: z.string().trim().max(2000).optional(),
});
export class OfficeDsrDto extends createZodDto(OfficeDsrSchema) {}

export const DsrStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'refused']),
  outcome: z.string().trim().max(2000).optional(),
  changeRequestId: IdSchema.optional(),
});
export class DsrStatusDto extends createZodDto(DsrStatusSchema) {}

export const EraseSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export class EraseDto extends createZodDto(EraseSchema) {}

export const DsrListSchema = z.object({
  status: z.enum(['received', 'in_progress', 'completed', 'refused']).optional(),
  kind: DsrKind.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class DsrListDto extends createZodDto(DsrListSchema) {}

export const BreachSchema = z.object({
  title: z.string().trim().min(3).max(200),
  detectedAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  description: z.string().trim().min(10).max(5000),
  dataClasses: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  principalsAffected: z.number().int().min(0).default(0),
});
export class BreachDto extends createZodDto(BreachSchema) {}

export const BreachUpdateSchema = z.object({
  status: z.enum(['open', 'contained', 'notified', 'closed']).optional(),
  actions: z.string().trim().max(5000).optional(),
  boardNotified: z.boolean().optional(),
  principalsNotified: z.boolean().optional(),
  principalsAffected: z.number().int().min(0).optional(),
});
export class BreachUpdateDto extends createZodDto(BreachUpdateSchema) {}
