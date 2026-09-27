import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const ATTENDANCE = {
  view: 'attendance.session.view',
  mark: 'attendance.session.mark',
  lock: 'attendance.session.lock',
  rfid: 'attendance.rfid.manage',
  busView: 'attendance.bus.view',
  punchView: 'attendance.punch.view',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
export const CodeSchema = z.enum(['P', 'A', 'L', 'SR', 'H', 'OD', 'SB']);

export const MarkSessionSchema = z
  .object({
    classSectionId: IdSchema,
    date: DateSchema,
    kind: z.enum(['day', 'subject']).default('day'),
    subjectId: IdSchema.optional(),
    periodId: IdSchema.optional(),
    marks: z
      .array(
        z.object({
          studentId: IdSchema,
          code: CodeSchema,
          remarks: z.string().trim().max(200).optional(),
        }),
      )
      .min(1)
      .max(500),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.kind === 'day' || v.subjectId, {
    message: 'subjectId is required for subject attendance',
    path: ['subjectId'],
  });
export class MarkSessionDto extends createZodDto(MarkSessionSchema) {}

export const SessionQuerySchema = z.object({
  classSectionId: IdSchema,
  date: DateSchema,
  kind: z.enum(['day', 'subject']).default('day'),
  subjectId: IdSchema.optional(),
  periodId: IdSchema.optional(),
});
export class SessionQueryDto extends createZodDto(SessionQuerySchema) {}

export const SummaryQuerySchema = z.object({ date: DateSchema.optional() });
export class SummaryQueryDto extends createZodDto(SummaryQuerySchema) {}

export const StudentRangeQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class StudentRangeQueryDto extends createZodDto(StudentRangeQuerySchema) {}

export const MineQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export class MineQueryDto extends createZodDto(MineQuerySchema) {}

export const LockSchema = z.object({ locked: z.boolean() });
export class LockDto extends createZodDto(LockSchema) {}

export const CreateDeviceSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,30}$/),
  name: z.string().trim().min(1).max(80),
  campusId: IdSchema.optional(),
  direction: z.enum(['in', 'out']).optional(),
  kind: z.enum(['gate', 'bus', 'biometric']).default('gate'),
  routeId: IdSchema.optional(),
});
export class CreateDeviceDto extends createZodDto(CreateDeviceSchema) {}

export const RfidIngestSchema = z.object({
  school: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,20}$/),
  device: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,30}$/),
  events: z
    .array(
      z.object({
        tag: z.string().trim().min(4).max(64),
        at: z.string().datetime({ offset: true }),
        direction: z.enum(['in', 'out']).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export class RfidIngestDto extends createZodDto(RfidIngestSchema) {}

export const RfidEventsQuerySchema = z.object({
  date: DateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export class RfidEventsQueryDto extends createZodDto(RfidEventsQuerySchema) {}

// ---- Sprint 10: bus readers, biometric punches, dashboards ----------------------------------------
export const DeviceKindSchema = z.enum(['gate', 'bus', 'biometric']);
export const PunchIngestSchema = z.object({
  school: z.string().trim().min(2).max(20),
  device: z.string().trim().min(1).max(40),
  events: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        at: z.string().datetime({ offset: true }),
        direction: z.enum(['in', 'out']).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export class PunchIngestDto extends createZodDto(PunchIngestSchema) {}
export const DayQuerySchema = z.object({ date: DateSchema.optional() });
export class DayQueryDto extends createZodDto(DayQuerySchema) {}
export const BusQuerySchema = z.object({
  date: DateSchema.optional(),
  routeId: IdSchema.optional(),
});
export class BusQueryDto extends createZodDto(BusQuerySchema) {}
