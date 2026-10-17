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
  /** started from a parent's request in the parent app (0163) */
  exitRequestId: IdSchema.optional(),
});
export class StartHostelWithdrawalDto extends createZodDto(StartHostelWithdrawalSchema) {}

// ---- part 4 (0163): the parent's request, the room check-out list ---------------------------------------
export const ExitRequestSchema = z.object({
  studentId: IdSchema,
  leavingOn: DateSchema,
  reason: z.enum(['parent_request', 'health', 'other']),
  note: z.string().trim().max(1000).optional(),
});
export class ExitRequestDto extends createZodDto(ExitRequestSchema) {}
export const DeclineExitSchema = z.object({ note: z.string().trim().min(3).max(500) });
export class DeclineExitDto extends createZodDto(DeclineExitSchema) {}
export const ExitRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'started', 'declined', 'withdrawn', 'all']).default('pending'),
});
export class ExitRequestsQueryDto extends createZodDto(ExitRequestsQuerySchema) {}

export const CheckoutItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(1).max(60),
        charge: z.number().min(0).max(1_000_000),
        active: z.boolean().default(true),
      }),
    )
    .max(60),
});
export class CheckoutItemsDto extends createZodDto(CheckoutItemsSchema) {}
export const CheckoutSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: IdSchema.optional(),
        name: z.string().trim().min(1).max(60),
        condition: z.enum(['ok', 'missing', 'damaged']),
        charge: z.number().min(0).max(1_000_000).default(0),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(60),
});
export class CheckoutDto extends createZodDto(CheckoutSchema) {}

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

// ---- part 5 (0164): revoking a completed hostel withdrawal ---------------------------------------------
export const RevokeHostelWithdrawalSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    /** continue: as if never left (same bed, the months away charged); from_date: back from a day */
    mode: z.enum(['continue', 'from_date']),
    fromDate: DateSchema.optional(),
    /** from_date: another bed when the old one is taken (the old one when empty) */
    bedId: IdSchema.optional(),
  })
  .refine((v) => v.mode === 'continue' || !!v.fromDate, {
    message: 'Give the day the pupil is back',
    path: ['fromDate'],
  });
export class RevokeHostelWithdrawalDto extends createZodDto(RevokeHostelWithdrawalSchema) {}
export const DecideRevokeSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export class DecideRevokeDto extends createZodDto(DecideRevokeSchema) {}
