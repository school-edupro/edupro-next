import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Remarks = z.string().trim().max(1000);

export const StagesSchema = z.object({
  stages: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(2).max(60),
        kind: z.enum(['document_check', 'test', 'interview', 'interaction', 'selection', 'custom']),
        maxMarks: z.number().positive().max(10000).nullable().optional(),
        status: z.enum(['active', 'inactive']).default('active'),
      }),
    )
    .min(1)
    .max(30),
});
export class StagesDto extends createZodDto(StagesSchema) {}

const Level = z
  .object({
    name: z.string().trim().min(2).max(60),
    by: z.enum(['anyone', 'role', 'designation', 'employees']),
    roleCode: z.string().max(60).nullable().optional(),
    designation: z.string().max(120).nullable().optional(),
    employeeIds: z.array(IdSchema).max(30).optional(),
  })
  .refine((l) => l.by !== 'role' || Boolean(l.roleCode), { message: 'Choose the role' })
  .refine((l) => l.by !== 'designation' || Boolean(l.designation), {
    message: 'Choose the designation',
  })
  .refine((l) => l.by !== 'employees' || (l.employeeIds?.length ?? 0) > 0, {
    message: 'Choose the employees',
  });

export const ProcessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  steps: z
    .array(z.object({ stageId: IdSchema, levels: z.array(Level).min(1).max(5) }))
    .min(1)
    .max(12),
  classIds: z.array(IdSchema).max(60).default([]),
  /** the change reaches applications already in progress: done only when confirmed */
  confirm: z.boolean().default(false),
});
export class ProcessDto extends createZodDto(ProcessSchema) {}

export const RegistrationsQuerySchema = z.object({
  cycleId: IdSchema.optional(),
  classId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  status: z
    .string()
    .regex(/^[a-z_]{3,20}$/)
    .optional(),
  stageId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class RegistrationsQueryDto extends createZodDto(RegistrationsQuerySchema) {}

export const DecideSchema = z.object({
  decision: z.enum(['approve', 'reject', 'hold', 'offer', 'waitlist']),
  remarks: Remarks.optional(),
  marks: z.number().min(0).max(10000).nullable().optional(),
  attendance: z.enum(['present', 'absent']).nullable().optional(),
  /** Document check: the fee category confirmed (or changed) */
  categoryId: IdSchema.optional(),
});
export class DecideDto extends createZodDto(DecideSchema) {}

export const SendBackSchema = z.object({
  fields: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/))
    .min(1)
    .max(80),
  remark: z.string().trim().min(3).max(1000),
  dueOn: DateSchema.optional(),
});
export class SendBackDto extends createZodDto(SendBackSchema) {}

export const UndoSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** back to this step (0-based): every decision from it onwards is undone; none: the last decision */
  toStep: z.number().int().min(0).max(20).optional(),
});
export class UndoDto extends createZodDto(UndoSchema) {}

/** The office corrects answers of a submitted application (docs/design/37, case 1b). */
export const OfficeCorrectSchema = z.object({
  answers: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.unknown())
    .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 40, {
      message: 'Correct between 1 and 40 answers at a time',
    }),
  reason: z.string().trim().min(3).max(500),
});
export class OfficeCorrectDto extends createZodDto(OfficeCorrectSchema) {}

/** The office confirms a registration's merit points, awarding a criterion differently with a reason. */
export const PointsCheckSchema = z.object({
  action: z.enum(['confirm', 'recalculate']),
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        points: z.number().min(-1000).max(1000),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .max(40)
    .default([]),
});
export class PointsCheckDto extends createZodDto(PointsCheckSchema) {}

export const SlotSchema = z.object({
  stageId: IdSchema,
  classId: IdSchema.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  minutes: z.number().int().min(5).max(600).default(60),
  venue: z.string().trim().min(2).max(160),
  capacity: z.number().int().min(1).max(5000),
  notes: z.string().trim().max(500).nullable().optional(),
});
export class SlotDto extends createZodDto(SlotSchema) {}

export const AllotSchema = z.object({
  /** these candidates; none: the next waiting candidates up to the room left */
  applicationIds: z.array(IdSchema).max(5000).optional(),
  notify: z.boolean().default(true),
});
export class AllotDto extends createZodDto(AllotSchema) {}

export const SlotResultsSchema = z.object({
  rows: z
    .array(
      z.object({
        applicationId: IdSchema,
        attendance: z.enum(['present', 'absent']).nullable().optional(),
        marks: z.number().min(0).max(10000).nullable().optional(),
        decision: z.enum(['approve', 'reject', 'hold']),
        remarks: Remarks.optional(),
      }),
    )
    .min(1)
    .max(5000),
});
export class SlotResultsDto extends createZodDto(SlotResultsSchema) {}

export const SelectIdsSchema = z.object({ applicationIds: z.array(IdSchema).min(1).max(5000) });
export class SelectIdsDto extends createZodDto(SelectIdsSchema) {}

export const DrawSchema = z.object({
  classId: IdSchema,
  categoryId: IdSchema.optional(),
  seats: z.number().int().min(1).max(5000),
  seed: z.string().trim().min(1).max(80).optional(),
});
export class SelectionDrawDto extends createZodDto(DrawSchema) {}

export const NextSchema = z.object({ classId: IdSchema, categoryId: IdSchema.optional() });
export class SelectionNextDto extends createZodDto(NextSchema) {}
