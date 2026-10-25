import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);

/** "Ask the school" in the admission portal (docs/design/43, part 4). */
export const AskSchema = z.object({
  applicationId: Id,
  categoryCode: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(5).max(4000),
  fileIds: z.array(Id).max(3).default([]),
});
export class AskDto extends createZodDto(AskSchema) {}

export const AnswerBackSchema = z.object({
  body: z.string().trim().min(2).max(4000),
  fileIds: z.array(Id).max(3).default([]),
});
export class AnswerBackDto extends createZodDto(AnswerBackSchema) {}

export const ReopenAskSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
export class ReopenAskDto extends createZodDto(ReopenAskSchema) {}

export const RateAskSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export class RateAskDto extends createZodDto(RateAskSchema) {}
