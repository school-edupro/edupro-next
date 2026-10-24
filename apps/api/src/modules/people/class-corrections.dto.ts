import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ClassCorrectionSchema = z.object({
  toSectionId: z.string().regex(/^\d{1,18}$/),
  /** From when the new class applies; the admission date (or the year's start) by default. */
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export class ClassCorrectionDto extends createZodDto(ClassCorrectionSchema) {}
