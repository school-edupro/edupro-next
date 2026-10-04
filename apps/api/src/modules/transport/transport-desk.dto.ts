import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** Blank form fields arrive as empty strings (and unset ones as null). */
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    s.optional(),
  );

/** How the pupil rides: only to school, only back home, or both. */
export const SERVICES = ['pick', 'drop', 'both'] as const;
export type Service = (typeof SERVICES)[number];

/** A request to start riding, to change how or from where, or to stop from a month. */
export const ApplySchema = z
  .object({
    studentId: IdSchema,
    kind: z.enum(['join', 'change', 'leave']),
    service: blank(z.enum(SERVICES)),
    pickRouteId: blank(IdSchema),
    pickStopId: blank(IdSchema),
    dropRouteId: blank(IdSchema),
    dropStopId: blank(IdSchema),
    /** The first month it applies to (for leaving: the first month without the bus). */
    fromMonth: Month,
    /** The last month (blank = to the end of the session). */
    toMonth: blank(Month),
    note: blank(z.string().trim().max(300)),
  })
  .refine((v) => v.kind === 'leave' || v.service, {
    message: 'Choose pick, drop, or pick and drop',
    path: ['service'],
  })
  .refine((v) => v.kind === 'leave' || v.service === 'drop' || (v.pickRouteId && v.pickStopId), {
    message: 'Choose the route and the stoppage for the pick',
    path: ['pickStopId'],
  })
  .refine((v) => v.kind === 'leave' || v.service !== 'drop' || (v.dropRouteId && v.dropStopId), {
    message: 'Choose the route and the stoppage for the drop',
    path: ['dropStopId'],
  })
  .refine((v) => !v.toMonth || v.toMonth >= v.fromMonth, {
    message: 'The last month cannot be before the first month',
    path: ['toMonth'],
  });
export class ApplyDto extends createZodDto(ApplySchema) {}

export const QuoteSchema = z.object({
  service: z.enum(SERVICES),
  pickStopId: blank(IdSchema),
  dropStopId: blank(IdSchema),
});
export class QuoteDto extends createZodDto(QuoteSchema) {}

export const DeskDecideSchema = z
  .object({
    outcome: z.enum(['approved', 'rejected']),
    note: blank(z.string().trim().max(300)),
  })
  .refine((v) => v.outcome !== 'rejected' || v.note, {
    message: 'Give the reason',
    path: ['note'],
  });
export class DeskDecideDto extends createZodDto(DeskDecideSchema) {}

export const DeskListSchema = z.object({
  tab: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  source: z.enum(['parent', 'office']).optional(),
  kind: z.enum(['join', 'change', 'leave']).optional(),
  routeId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class DeskListDto extends createZodDto(DeskListSchema) {}
export const DeskExportSchema = DeskListSchema.omit({ page: true, size: true });
export class DeskExportDto extends createZodDto(DeskExportSchema) {}

export const HistorySchema = z.object({
  /** now = riding this month, upcoming, past, all. */
  when: z.enum(['now', 'upcoming', 'past', 'all']).default('now'),
  studentId: IdSchema.optional(),
  routeId: IdSchema.optional(),
  service: z.enum(SERVICES).optional(),
  month: Month.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(5).max(100).default(25),
});
export class HistoryDto extends createZodDto(HistorySchema) {}
export const HistoryExportSchema = HistorySchema.omit({ page: true, size: true });
export class HistoryExportDto extends createZodDto(HistoryExportSchema) {}

const LevelSchema = z
  .object({
    source: z.enum(['parent', 'office']),
    label: z.string().trim().min(2).max(60),
    kind: z.enum(['role', 'designation', 'employee']),
    roleCode: blank(z.string().trim().max(60)),
    designation: blank(z.string().trim().max(80)),
    employeeId: blank(IdSchema),
    active: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'role' || v.roleCode, { message: 'Pick the role', path: ['roleCode'] })
  .refine((v) => v.kind !== 'designation' || v.designation, {
    message: 'Give the designation',
    path: ['designation'],
  })
  .refine((v) => v.kind !== 'employee' || v.employeeId, {
    message: 'Pick the employee',
    path: ['employeeId'],
  });
export const TransportSetupSchema = z.object({
  oneWayPercent: z.coerce.number().min(0).max(100),
  twoStopRule: z.enum(['higher', 'pick', 'sum']),
  parentCanApply: z.boolean(),
  notifyEmail: z.boolean(),
  /** In the order they approve; each source keeps its own order. */
  levels: z.array(LevelSchema).max(12),
});
export class TransportSetupDto extends createZodDto(TransportSetupSchema) {}
