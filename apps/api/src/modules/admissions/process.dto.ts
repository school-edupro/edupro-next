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
    /** days to decide at this level (none: no time limit; docs/design/47) */
    days: z.number().int().min(1).max(90).nullable().optional(),
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

/** An offer's email as the person changed it on the preview (docs/design/56). */
export const OfferMessageSchema = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  intro: z.string().trim().min(3).max(2000).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const DecideSchema = z.object({
  decision: z.enum(['approve', 'reject', 'hold', 'offer', 'waitlist']),
  remarks: Remarks.optional(),
  marks: z.number().min(0).max(10000).nullable().optional(),
  attendance: z.enum(['present', 'absent']).nullable().optional(),
  /** Document check: the fee category confirmed (or changed) */
  categoryId: IdSchema.optional(),
  /** an offer: the email as the person changed it on the preview (docs/design/56) */
  offerMessage: OfferMessageSchema.optional(),
  /** a test or interview with a paper: marks by part (part id → marks), the total decided on */
  parts: z.record(IdSchema, z.number().min(0).max(1000).nullable()).optional(),
});
export class DecideDto extends createZodDto(DecideSchema) {}

/** The offer email previewed, with the person's changes (docs/design/56). */
export const OfferPreviewSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  intro: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(1000).optional(),
});
export class OfferPreviewDto extends createZodDto(OfferPreviewSchema) {}

/** Several registrations at one stage and level decided alike (docs/design/47, part 3). */
export const BulkDecideSchema = z.object({
  ids: z.array(IdSchema).min(1).max(200),
  decision: z.enum(['approve', 'reject', 'hold']),
  remarks: Remarks.optional(),
});
export class BulkDecideDto extends createZodDto(BulkDecideSchema) {}

export const WaitingQuerySchema = z.object({
  size: z.coerce.number().int().min(1).max(50).default(10),
});
export class WaitingQueryDto extends createZodDto(WaitingQuerySchema) {}

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
        /** a class with a paper: marks by part (docs/design/57) */
        parts: z.record(IdSchema, z.number().min(0).max(1000).nullable()).optional(),
        decision: z.enum(['approve', 'reject', 'hold']),
        remarks: Remarks.optional(),
      }),
    )
    .min(1)
    .max(5000),
});
export class SlotResultsDto extends createZodDto(SlotResultsSchema) {}

export const SelectIdsSchema = z.object({
  applicationIds: z.array(IdSchema).min(1).max(5000),
  /** offers: the email's words as changed on the preview, the same for every family (docs/design/56) */
  offerMessage: OfferMessageSchema.optional(),
});
export class SelectIdsDto extends createZodDto(SelectIdsSchema) {}

export const DrawSchema = z.object({
  classId: IdSchema,
  categoryId: IdSchema.optional(),
  seats: z.number().int().min(1).max(5000),
  seed: z.string().trim().min(1).max(80).optional(),
  /** the families the preview showed as offered: the draw is refused if it would offer others */
  expect: z.array(IdSchema).max(5000).optional(),
  offerMessage: OfferMessageSchema.optional(),
});
export class SelectionDrawDto extends createZodDto(DrawSchema) {}

export const NextSchema = z.object({
  classId: IdSchema,
  categoryId: IdSchema.optional(),
  /** the family the preview showed as next: refused if someone else is next now */
  applicationId: IdSchema.optional(),
  offerMessage: OfferMessageSchema.optional(),
});
export class SelectionNextDto extends createZodDto(NextSchema) {}

/** A class's test or interview paper: its parts and the minimum total % (docs/design/57). */
export const PaperSchema = z.object({
  minPercent: z.number().gt(0).max(100).nullable().optional(),
  parts: z
    .array(
      z
        .object({
          id: IdSchema.optional(),
          /** the entry of the school's list (docs/design/57, follow-up); else its name */
          itemId: IdSchema.optional(),
          name: z.string().trim().min(1).max(60).optional(),
          maxMarks: z.number().gt(0).max(1000),
          passMarks: z.number().min(0).max(1000).nullable().optional(),
        })
        .refine((p) => p.itemId !== undefined || p.name !== undefined, {
          message: 'Pick the subject or parameter',
          path: ['itemId'],
        })
        .refine(
          (p) => p.passMarks === undefined || p.passMarks === null || p.passMarks <= p.maxMarks,
          {
            message: 'A pass mark cannot be more than the maximum',
            path: ['passMarks'],
          },
        ),
    )
    .max(30),
});
export class PaperDto extends createZodDto(PaperSchema) {}

/** The school's test subjects and interview parameters (docs/design/57, follow-up). */
export const PaperItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: z.string().trim().min(1).max(60),
        kind: z.enum(['test', 'interview', 'both']),
        maxMarks: z.number().gt(0).max(1000).nullable().optional(),
        status: z.enum(['active', 'inactive']).default('active'),
      }),
    )
    .max(300),
});
export class PaperItemsDto extends createZodDto(PaperItemsSchema) {}

export const CopyPaperSchema = z.object({
  fromClassId: IdSchema,
  toClassIds: z.array(IdSchema).min(1).max(100),
});
export class CopyPaperDto extends createZodDto(CopyPaperSchema) {}

/** A Selection offer previewed: the family and the words as changed (docs/design/56). */
export const SelectionOfferPreviewSchema = OfferPreviewSchema.extend({ applicationId: IdSchema });
export class SelectionOfferPreviewDto extends createZodDto(SelectionOfferPreviewSchema) {}
