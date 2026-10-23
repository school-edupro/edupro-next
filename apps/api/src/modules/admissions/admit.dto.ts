import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AdmitSchema = z.object({
  classSectionId: IdSchema,
  rollNo: z.number().int().min(1).max(999).optional(),
  /** the day the pupil joins (default: the first day of the session's year) */
  joinedOn: DateSchema.optional(),
});
export class AdmitDto extends createZodDto(AdmitSchema) {}

export const AdmitBulkSchema = z.object({
  items: z
    .array(
      z.object({
        applicationId: IdSchema,
        classSectionId: IdSchema,
        rollNo: z.number().int().min(1).max(999).optional(),
      }),
    )
    .min(1)
    .max(500),
  joinedOn: DateSchema.optional(),
});
export class AdmitBulkDto extends createZodDto(AdmitBulkSchema) {}

export const CancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class CancelDto extends createZodDto(CancelSchema) {}

export const RefundsQuerySchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'paid']).optional(),
  cycleId: IdSchema.optional(),
});
export class RefundsQueryDto extends createZodDto(RefundsQuerySchema) {}

export const RefundDecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export class RefundDecisionDto extends createZodDto(RefundDecisionSchema) {}

export const RefundPaySchema = z.object({
  mode: z.enum(['cash', 'bank', 'cheque', 'gateway']),
  reference: z.string().trim().max(80).optional(),
  paidOn: DateSchema.optional(),
});
export class RefundPayDto extends createZodDto(RefundPaySchema) {}
