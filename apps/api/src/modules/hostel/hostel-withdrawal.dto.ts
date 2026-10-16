import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const HOSTEL_WD = {
  view: 'hostel.withdrawal.view',
  manage: 'hostel.withdrawal.manage',
  clear: 'hostel.withdrawal.clear',
} as const;

export const REASONS = ['parent_request', 'discipline', 'health', 'other'] as const;

const FileRef = z.object({ fileId: IdSchema });

export const StartHostelWithdrawalSchema = z.object({
  /** the day the request reached the hostel office (the notice is counted from it); today when empty */
  requestedOn: DateSchema.optional(),
  leavingOn: DateSchema,
  reason: z.enum(REASONS),
  remarks: z.string().trim().max(1000).optional(),
  documents: z.array(FileRef).max(5).default([]),
  /** found at the room check: put on the pupil as a misc fee on the last approval */
  damageCharge: z.number().min(0).max(1_000_000).default(0),
  /** mess dues left: a misc fee on the last approval */
  messCharge: z.number().min(0).max(1_000_000).default(0),
  chargeRemarks: z.string().trim().max(500).optional(),
});
export class StartHostelWithdrawalDto extends createZodDto(StartHostelWithdrawalSchema) {}

export const DecideHostelWithdrawalSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
  /** the last level: paid hostel months after the fee stops are carried forward or refunded */
  feeChoice: z.enum(['carry', 'refund']).optional(),
});
export class DecideHostelWithdrawalDto extends createZodDto(DecideHostelWithdrawalSchema) {}

export const CompleteHostelWithdrawalSchema = z.object({
  feeChoice: z.enum(['carry', 'refund']).optional(),
});
export class CompleteHostelWithdrawalDto extends createZodDto(CompleteHostelWithdrawalSchema) {}

export const ListHostelWithdrawalsSchema = z.object({
  status: z
    .enum(['requested', 'cleared', 'completed', 'cancelled', 'rejected', 'open', 'all'])
    .default('open'),
  /** only those whose current step waits for me */
  mine: z.coerce.boolean().optional(),
  hostelId: IdSchema.optional(),
  leavingFrom: DateSchema.optional(),
  leavingTo: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});
export class ListHostelWithdrawalsDto extends createZodDto(ListHostelWithdrawalsSchema) {}

export const HostelWithdrawalsFileSchema = ListHostelWithdrawalsSchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class HostelWithdrawalsFileDto extends createZodDto(HostelWithdrawalsFileSchema) {}

export const HostelWithdrawalSettingsSchema = z.object({
  /** a leaving date fewer days than this after the request keeps the next month's hostel fee */
  noticeDays: z.number().int().min(0).max(120),
  noticeCharge: z.boolean(),
});
export class HostelWithdrawalSettingsDto extends createZodDto(HostelWithdrawalSettingsSchema) {}
