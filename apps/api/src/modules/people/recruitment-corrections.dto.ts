import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const reason = z.string().trim().min(3, 'Give the reason').max(500);

/** The steps of the careers form a correction may ask for (part 8). */
export const CORRECTION_STEP_IDS = [
  'personal',
  'contact',
  'education',
  'more',
  'documents',
] as const;

/** Who may undo decisions and move stages, and the time a candidate gets to correct (Recruitment set-up). */
export const CorrectionSettingsSchema = z.object({
  undoHours: z.number().int().min(0).max(720),
  undoRoles: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z_]{2,40}$/),
    )
    .max(20),
  undoEmployeeIds: z.array(Id).max(50),
  correctionDays: z.number().int().min(1).max(60),
});
export class CorrectionSettingsDto extends createZodDto(CorrectionSettingsSchema) {}

export const UndoSchema = z.object({ reason });
export class UndoDto extends createZodDto(UndoSchema) {}

export const MoveStageSchema = z.object({ stageId: Id, reason });
export class MoveStageDto extends createZodDto(MoveStageSchema) {}

export const SendBackSchema = z.object({
  remark: z.string().trim().min(3, 'Say what to correct').max(1000),
  steps: z
    .array(z.enum(CORRECTION_STEP_IDS))
    .min(1, 'Tick what the candidate should correct')
    .max(5),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date'),
});
export class SendBackDto extends createZodDto(SendBackSchema) {}

export const CancelCorrectionSchema = z.object({ reason: z.string().trim().max(500).optional() });
export class CancelCorrectionDto extends createZodDto(CancelCorrectionSchema) {}
