import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const ACTIVITY = {
  fill: 'staff.activity.fill',
  review: 'staff.activity.review',
  setup: 'staff.activity.setup',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

export const DateQuerySchema = z.object({ date: DateSchema.optional() });
export class DateQueryDto extends createZodDto(DateQuerySchema) {}

export const LEAVE_TYPES = [
  'Casual leave',
  'Sick leave',
  'Earned leave',
  'On duty',
  'Other',
] as const;
const LeaveSchema = z.object({
  kind: z.enum(['full', 'half']),
  type: z.string().trim().min(2).max(60),
  reason: z.string().trim().max(300).optional(),
});

export const SaveLogSchema = z.object({
  date: DateSchema,
  entries: z
    .array(
      z
        .object({
          from: TimeSchema,
          to: TimeSchema,
          categoryId: IdSchema,
          description: z.string().trim().min(2, 'Write what was done').max(1000),
          source: z.enum(['manual', 'timetable', 'substitution']).default('manual'),
        })
        .refine((v) => v.to > v.from, { message: 'To must be after From', path: ['to'] }),
    )
    .max(40),
  tomorrowPlan: z.string().trim().max(2000).optional(),
  pendingNote: z.string().trim().max(2000).optional(),
  /** The day is leave: a full day needs no activity, a half day has the rest of the day in rows. */
  leave: LeaveSchema.nullable().optional(),
  submit: z.boolean().default(false),
});
export class SaveLogDto extends createZodDto(SaveLogSchema) {}

export const DayQuerySchema = z.object({
  date: DateSchema.optional(),
  department: z.string().trim().max(120).optional(),
  state: z.enum(['submitted', 'reviewed', 'returned', 'draft', 'missing', 'leave']).optional(),
});
export class DayQueryDto extends createZodDto(DayQuerySchema) {}

export const ReviewSchema = z
  .object({
    action: z.enum(['reviewed', 'returned']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== 'returned' || !!v.note, {
    message: 'Write why the log is sent back',
    path: ['note'],
  });
export class ReviewDto extends createZodDto(ReviewSchema) {}

export const RangeQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  department: z.string().trim().max(120).optional(),
  employeeId: IdSchema.optional(),
});
export class RangeQueryDto extends createZodDto(RangeQuerySchema) {}

export const ActivityReportSchema = RangeQuerySchema.extend({
  report: z.enum(['compliance', 'category', 'employee', 'day']).default('compliance'),
  date: DateSchema.optional(),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class ActivityReportDto extends createZodDto(ActivityReportSchema) {}

export const ActivitySettingsSchema = z.object({
  cutoffTime: TimeSchema,
  backDays: z.coerce.number().int().min(0).max(30),
});
export class ActivitySettingsDto extends createZodDto(ActivitySettingsSchema) {}

export const CategorySchema = z.object({
  id: IdSchema.optional(),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  status: z.enum(['active', 'inactive']).default('active'),
});
export class CategoryDto extends createZodDto(CategorySchema) {}

/** The office marks an employee on leave for a day (they did not, or could not, do it themselves). */
export const MarkLeaveSchema = LeaveSchema.extend({
  employeeId: IdSchema,
  date: DateSchema,
});
export class MarkLeaveDto extends createZodDto(MarkLeaveSchema) {}

export const MyReportSchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  /** `1`: the file inside a JSON answer (the teacher app's own download route reads it). */
  wrap: z.enum(['1']).optional(),
});
export class MyReportDto extends createZodDto(MyReportSchema) {}
