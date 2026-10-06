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
    /** route_incharge = the in-charge named for the request's route (else the school's in-charges). */
    kind: z.enum(['role', 'designation', 'employee', 'route_incharge']),
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
  /** Who is in charge of transport: `routeId` blank = of the whole school, else of that route. */
  incharges: z
    .array(z.object({ routeId: blank(IdSchema), employeeId: IdSchema }))
    .max(200)
    .default([]),
});
export class TransportSetupDto extends createZodDto(TransportSetupSchema) {}

/** Several requests decided in one go (the fee department after an Excel upload). */
export const DecideManySchema = z
  .object({
    ids: z.array(IdSchema).min(1).max(300),
    outcome: z.enum(['approved', 'rejected']),
    note: blank(z.string().trim().max(300)),
  })
  .refine((v) => v.outcome !== 'rejected' || v.note, {
    message: 'Give the reason',
    path: ['note'],
  });
export class DecideManyDto extends createZodDto(DecideManySchema) {}

/** Requests for many pupils from one Excel sheet (the start of a session). */
export const ImportRequestsSchema = z.object({
  fileName: blank(z.string().trim().max(200)),
  fileBase64: z.string().min(100).max(950_000),
});
export class ImportRequestsDto extends createZodDto(ImportRequestsSchema) {}

export const PapersSchema = z.object({
  state: z.enum(['expired', 'soon', 'valid', 'missing', 'all']).default('soon'),
  kind: z.enum(['insurance', 'fitness', 'permit', 'puc', 'licence']).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  q: z.string().trim().max(80).optional(),
});
export class PapersDto extends createZodDto(PapersSchema) {}

/** A vehicle is off the road: another vehicle (and crew) runs its routes for these days. */
export const ReplacementSchema = z
  .object({
    vehicleId: IdSchema,
    replacementVehicleId: IdSchema,
    driverId: blank(IdSchema),
    conductorId: blank(IdSchema),
    attendantId: blank(IdSchema),
    fromDate: DateSchema,
    toDate: DateSchema,
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: 'The last day cannot be before the first day',
    path: ['toDate'],
  })
  .refine((v) => v.vehicleId !== v.replacementVehicleId, {
    message: 'Choose a different vehicle as the replacement',
    path: ['replacementVehicleId'],
  });
export class ReplacementDto extends createZodDto(ReplacementSchema) {}
export const EndReplacementSchema = z.object({ note: blank(z.string().trim().max(300)) });
export class EndReplacementDto extends createZodDto(EndReplacementSchema) {}
export const ReplacementListSchema = z.object({
  tab: z.enum(['now', 'upcoming', 'past', 'all']).default('now'),
});
export class ReplacementListDto extends createZodDto(ReplacementListSchema) {}

export const TransportReportSchema = z.object({
  routeId: blank(IdSchema),
  service: blank(z.enum(['both', 'pick', 'drop'])),
  fromMonth: blank(Month),
  toMonth: blank(Month),
  from: blank(DateSchema),
  to: blank(DateSchema),
  measure: z.enum(['projected', 'collected', 'balance']).default('projected'),
  q: blank(z.string().trim().max(80)),
});
export class TransportReportDto extends createZodDto(TransportReportSchema) {}

export const TransportReportExportSchema = TransportReportSchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class TransportReportExportDto extends createZodDto(TransportReportExportSchema) {}
