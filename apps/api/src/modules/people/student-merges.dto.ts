import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);

export const StudentMergeSchema = z.object({
  /** The record that stays. */
  keepId: Id,
  /** The record merged into it and closed. */
  duplicateId: Id,
  reason: z.string().trim().min(3).max(500).optional(),
});
export class StudentMergeDto extends createZodDto(StudentMergeSchema) {}
