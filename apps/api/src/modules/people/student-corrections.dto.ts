import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const value = z.union([z.string().trim().max(200), z.null()]);

export const CorrectionRequestSchema = z.object({
  // only the correction fields (CORRECTION_KEYS); anything else is refused in the service
  values: z.record(z.string().max(40), value),
  reason: z.string().trim().min(3).max(500),
});
export class CorrectionRequestDto extends createZodDto(CorrectionRequestSchema) {}

export const CorrectionWithdrawSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export class CorrectionWithdrawDto extends createZodDto(CorrectionWithdrawSchema) {}
