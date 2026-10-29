import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** A registration sent to another school of the group, with the reason (docs/design/64). */
export const MoveRequestSchema = z.object({
  toSchoolId: IdSchema,
  reason: z.string().trim().min(3, 'Give the reason (3 letters or more)').max(500),
});
export class MoveRequestDto extends createZodDto(MoveRequestSchema) {}

/** The receiving school's session and class for the registration. */
export const MoveAcceptSchema = z.object({
  cycleId: IdSchema,
  classId: IdSchema,
  note: z.string().trim().max(500).optional(),
});
export class MoveAcceptDto extends createZodDto(MoveAcceptSchema) {}

/** Refused by the receiving school, or withdrawn by the first: the reason. */
export const MoveCloseSchema = z.object({
  note: z.string().trim().min(3, 'Give the reason (3 letters or more)').max(500),
});
export class MoveCloseDto extends createZodDto(MoveCloseSchema) {}

export const MovesQuerySchema = z.object({
  box: z.enum(['incoming', 'outgoing', 'all']).optional(),
  status: z.enum(['requested', 'accepted', 'refused', 'withdrawn']).optional(),
});
export class MovesQueryDto extends createZodDto(MovesQuerySchema) {}

export const MovesExportSchema = MovesQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class MovesExportDto extends createZodDto(MovesExportSchema) {}
