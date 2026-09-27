import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const ShortlistSchema = z
  .object({
    classId: IdSchema,
    count: z.number().int().min(1).max(5000).optional(),
    minScore: z.number().min(0).max(1000).optional(),
  })
  .refine((v) => v.count !== undefined || v.minScore !== undefined, {
    message: 'give count or minScore',
    path: ['count'],
  });
export class ShortlistDto extends createZodDto(ShortlistSchema) {}

export const DrawSchema = z.object({
  classId: IdSchema,
  seats: z.number().int().min(1).max(5000).optional(),
  seed: z.string().trim().min(1).max(80).optional(),
});
export class DrawDto extends createZodDto(DrawSchema) {}

export const RequestApprovalsSchema = z.object({ classId: IdSchema.optional() });
export class RequestApprovalsDto extends createZodDto(RequestApprovalsSchema) {}

export const AdmitSchema = z.object({
  classSectionId: IdSchema.optional(),
  rollNo: z.number().int().min(1).max(999).optional(),
  /** Administrators may admit before the fee is paid (fee collected offline). */
  waiveFeeCheck: z.boolean().default(false),
});
export class AdmitDto extends createZodDto(AdmitSchema) {}

export const ADMISSIONS_DECIDE = { admit: 'admissions.application.admit' } as const;
