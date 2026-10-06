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
