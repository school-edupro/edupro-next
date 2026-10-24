import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AdmissionCancelSchema = z.object({
  /** refund: what was paid goes back through the refund approvals; retain: the school keeps it. */
  settlement: z.enum(['refund', 'retain']),
  reason: z.string().trim().min(3).max(500).optional(),
});
export class AdmissionCancelDto extends createZodDto(AdmissionCancelSchema) {}
