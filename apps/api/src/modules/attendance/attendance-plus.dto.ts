import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const blank = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    s.optional(),
  );
const Trip = z.enum(['pick', 'drop']);

export const BusRollQuerySchema = z.object({ routeId: IdSchema, date: DateSchema, trip: Trip });
export class BusRollQueryDto extends createZodDto(BusRollQuerySchema) {}

export const BusRollMarkSchema = z.object({
  routeId: IdSchema,
  date: DateSchema,
  trip: Trip,
  marks: z
    .array(
      z.object({
        studentId: IdSchema,
        code: z.enum(['P', 'A', 'LV', 'GP', 'OT']),
        remarks: blank(z.string().trim().max(200)),
      }),
    )
    .min(1)
    .max(300),
  notes: blank(z.string().trim().max(300)),
});
export class BusRollMarkDto extends createZodDto(BusRollMarkSchema) {}

export const RegisterQuerySchema = z.object({ month: Month });
export class RegisterQueryDto extends createZodDto(RegisterQuerySchema) {}
/** `both` (the default): the morning and the afternoon trip side by side. */
export const BusRegisterQuerySchema = z.object({
  routeId: IdSchema,
  trip: z.enum(['both', 'pick', 'drop']).default('both'),
  month: Month,
});
export class BusRegisterQueryDto extends createZodDto(BusRegisterQuerySchema) {}
export const ClassRegisterQuerySchema = z.object({ classSectionId: IdSchema, month: Month });
export class ClassRegisterQueryDto extends createZodDto(ClassRegisterQuerySchema) {}
const Format = z.enum(['xlsx', 'pdf']).default('xlsx');
export const BusRegisterFileSchema = BusRegisterQuerySchema.extend({ format: Format });
export class BusRegisterFileDto extends createZodDto(BusRegisterFileSchema) {}
export const ClassRegisterFileSchema = ClassRegisterQuerySchema.extend({ format: Format });
export class ClassRegisterFileDto extends createZodDto(ClassRegisterFileSchema) {}
export const DayQuerySchema = z.object({ date: DateSchema.optional() });
export class DayQueryDto extends createZodDto(DayQuerySchema) {}
export const MonthQuerySchema = z.object({ month: Month.optional() });
export class MonthQueryDto extends createZodDto(MonthQuerySchema) {}

/** The marking windows (blank = any time of the day) and who marks which route. */
export const AttendanceSetupSchema = z
  .object({
    classFrom: blank(Time),
    classTo: blank(Time),
    busPickFrom: blank(Time),
    busPickTo: blank(Time),
    busDropFrom: blank(Time),
    busDropTo: blank(Time),
    backDays: z.coerce.number().int().min(0).max(7).default(0),
    /** Left out: the route teachers stay as they are (they have their own add / remove / upload). */
    routeTeachers: z
      .array(z.object({ routeId: IdSchema, trip: Trip, employeeId: IdSchema }))
      .max(600)
      .optional(),
  })
  .refine(
    (v) =>
      (!v.classFrom || !v.classTo || v.classTo > v.classFrom) &&
      (!v.busPickFrom || !v.busPickTo || v.busPickTo > v.busPickFrom) &&
      (!v.busDropFrom || !v.busDropTo || v.busDropTo > v.busDropFrom),
    { message: 'A window must close after it opens', path: ['classTo'] },
  );
export class AttendanceSetupDto extends createZodDto(AttendanceSetupSchema) {}

/** A day opened again for the teacher of a class or of a route and trip. */
export const ReopenSchema = z
  .object({
    scope: z.enum(['class', 'bus']),
    classSectionId: blank(IdSchema),
    routeId: blank(IdSchema),
    trip: blank(Trip),
    date: DateSchema,
    hours: z.coerce.number().int().min(1).max(72).default(4),
    reason: z.string().trim().min(3).max(200),
  })
  .refine((v) => (v.scope === 'class' ? v.classSectionId : v.routeId && v.trip), {
    message: 'Choose the class, or the route and the trip',
    path: ['classSectionId'],
  });
export class ReopenDto extends createZodDto(ReopenSchema) {}

/** A teacher for bus attendance on some routes: the morning trip, the afternoon trip or both. */
export const RouteTeachersSchema = z.object({
  employeeId: IdSchema,
  routeIds: z.array(IdSchema).min(1, 'Pick at least one route').max(200),
  trip: z.enum(['both', 'pick', 'drop']).default('both'),
});
export class RouteTeachersDto extends createZodDto(RouteTeachersSchema) {}

export const RouteTeacherRemoveSchema = z.object({
  employeeId: IdSchema,
  routeId: IdSchema,
  trip: z.enum(['both', 'pick', 'drop']).default('both'),
});
export class RouteTeacherRemoveDto extends createZodDto(RouteTeacherRemoveSchema) {}

export const RouteTeachersImportSchema = z.object({
  fileBase64: z.string().min(100).max(1_400_000),
});
export class RouteTeachersImportDto extends createZodDto(RouteTeachersImportSchema) {}

// ---- attendance from an Excel list (0093) ------------------------------------------------------------
export const BulkVerifySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  /** Every admission number of the file gets this. */
  code: z.enum(['P', 'A']),
  fileName: z.string().trim().max(200).optional(),
  fileBase64: z.string().min(100).max(1_400_000),
});
export class BulkVerifyDto extends createZodDto(BulkVerifySchema) {}

export const BulkCommitSchema = z.object({
  /** Change a mark that is already there and differs. */
  replace: z.boolean().default(false),
  /** With an Absent list: the others of those classes, not yet marked, are Present. */
  restPresent: z.boolean().default(false),
  sms: z.boolean().default(false),
  email: z.boolean().default(false),
});
export class BulkCommitDto extends createZodDto(BulkCommitSchema) {}

// ---- student leave (0088) ---------------------------------------------------------------------------
export const LeaveApplySchema = z
  .object({
    studentId: IdSchema,
    /** A code of the school's leave types master. */
    leaveType: z.string().trim().min(1).max(30),
    fromDate: DateSchema,
    toDate: DateSchema,
    reason: z.string().trim().min(5, 'Write the reason (at least 5 letters)').max(1000),
    fileIds: z.array(IdSchema).max(5).default([]),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: 'The last day cannot be before the first day',
    path: ['toDate'],
  });
export class LeaveApplyDto extends createZodDto(LeaveApplySchema) {}

export const LeaveDecideSchema = z
  .object({
    outcome: z.enum(['approved', 'rejected']),
    note: blank(z.string().trim().max(500)),
  })
  .refine((v) => v.outcome === 'approved' || (v.note && v.note.length >= 3), {
    message: 'Write the reason for not approving',
    path: ['note'],
  });
export class LeaveDecideDto extends createZodDto(LeaveDecideSchema) {}

export const LeaveListSchema = z.object({
  tab: z.enum(['inbox', 'pending', 'approved', 'rejected', 'all']).default('inbox'),
  q: blank(z.string().trim().max(80)),
});
export class LeaveListDto extends createZodDto(LeaveListSchema) {}

const LeaveLevel = z.object({
  chain: z.enum(['short', 'long']),
  label: z.string().trim().min(2).max(60),
  kind: z.enum(['class_teacher', 'role', 'employee']),
  roleCode: blank(z.string().trim().max(60)),
  employeeId: blank(IdSchema),
  active: z.boolean().default(true),
});
export const LeaveSetupSchema = z
  .object({
    longDays: z.coerce.number().int().min(1).max(30),
    backDays: z.coerce.number().int().min(0).max(30),
    levels: z.array(LeaveLevel).min(1).max(12),
  })
  .refine(
    (v) =>
      v.levels.every(
        (l) =>
          l.kind === 'class_teacher' ||
          (l.kind === 'role' && l.roleCode) ||
          (l.kind === 'employee' && l.employeeId),
      ),
    { message: 'Choose who approves at every level', path: ['levels'] },
  )
  .refine(
    (v) =>
      (['short', 'long'] as const).every((ch) => v.levels.some((l) => l.chain === ch && l.active)),
    {
      message: 'Keep at least one level for a short leave and one for a long leave',
      path: ['levels'],
    },
  );
export class LeaveSetupDto extends createZodDto(LeaveSetupSchema) {}
