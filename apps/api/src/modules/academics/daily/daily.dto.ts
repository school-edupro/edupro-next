import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
export const DailyWorkKindSchema = z.enum(['homework', 'classwork', 'assignment']);
export const AudienceSchema = z.enum(['everyone', 'students', 'employees']);
export const NoticeKindSchema = z.enum(['notice', 'circular']);
export const TargetTypeSchema = z.enum(['class', 'class_section', 'student', 'employee']);
export const HolidayKindSchema = z.enum(['holiday', 'vacation', 'working_day']);
export const AlmanacKindSchema = z.enum(['event', 'exam', 'meeting', 'activity', 'deadline']);

// ---- daily work ---------------------------------------------------------------------------------
export const CreateDailyWorkSchema = z
  .object({
    classSectionId: IdSchema,
    subjectId: IdSchema.optional(),
    kind: DailyWorkKindSchema,
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(8000).default(''),
    assignedOn: DateSchema.optional(),
    dueOn: DateSchema.optional(),
    fileIds: z.array(IdSchema).max(10).default([]),
  })
  .refine((v) => !v.dueOn || !v.assignedOn || v.dueOn >= v.assignedOn, {
    message: 'dueOn must not be before assignedOn',
    path: ['dueOn'],
  });
export class CreateDailyWorkDto extends createZodDto(CreateDailyWorkSchema) {}

export const UpdateDailyWorkSchema = z
  .object({
    subjectId: IdSchema.nullable(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(8000),
    assignedOn: DateSchema,
    dueOn: DateSchema.nullable(),
    fileIds: z.array(IdSchema).max(10),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateDailyWorkDto extends createZodDto(UpdateDailyWorkSchema) {}

export const ListDailyWorkQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  kind: DailyWorkKindSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListDailyWorkQueryDto extends createZodDto(ListDailyWorkQuerySchema) {}

// ---- notices ------------------------------------------------------------------------------------
export const TargetSchema = z.object({ type: TargetTypeSchema, id: IdSchema });

export const CreateNoticeSchema = z
  .object({
    kind: NoticeKindSchema.default('notice'),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20000),
    audience: AudienceSchema.default('everyone'),
    publishFrom: DateSchema.optional(),
    publishUntil: DateSchema.optional(),
    isPinned: z.boolean().default(false),
    targets: z.array(TargetSchema).max(200).default([]),
    fileIds: z.array(IdSchema).max(10).default([]),
    publish: z.boolean().default(false),
  })
  .refine((v) => !v.publishUntil || !v.publishFrom || v.publishUntil >= v.publishFrom, {
    message: 'publishUntil must not be before publishFrom',
    path: ['publishUntil'],
  });
export class CreateNoticeDto extends createZodDto(CreateNoticeSchema) {}

export const UpdateNoticeSchema = z
  .object({
    kind: NoticeKindSchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20000),
    audience: AudienceSchema,
    publishFrom: DateSchema,
    publishUntil: DateSchema.nullable(),
    isPinned: z.boolean(),
    targets: z.array(TargetSchema).max(200),
    fileIds: z.array(IdSchema).max(10),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateNoticeDto extends createZodDto(UpdateNoticeSchema) {}

export const ListNoticesQuerySchema = z.object({
  kind: NoticeKindSchema.optional(),
  status: z.enum(['draft', 'published', 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListNoticesQueryDto extends createZodDto(ListNoticesQuerySchema) {}

// ---- calendar -----------------------------------------------------------------------------------
export const CreateHolidaySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: HolidayKindSchema.default('holiday'),
    startsOn: DateSchema,
    endsOn: DateSchema.optional(),
    appliesTo: AudienceSchema.default('everyone'),
    campusId: IdSchema.optional(),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'endsOn must not be before startsOn',
    path: ['endsOn'],
  });
export class CreateHolidayDto extends createZodDto(CreateHolidaySchema) {}

export const CreateAlmanacEventSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    kind: AlmanacKindSchema.default('event'),
    startsOn: DateSchema,
    endsOn: DateSchema.optional(),
    startsAt: TimeSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    audience: AudienceSchema.default('everyone'),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'endsOn must not be before startsOn',
    path: ['endsOn'],
  });
export class CreateAlmanacEventDto extends createZodDto(CreateAlmanacEventSchema) {}

export const CalendarQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class CalendarQueryDto extends createZodDto(CalendarQuerySchema) {}

// ---- gallery ------------------------------------------------------------------------------------
export const CreateAlbumSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  eventOn: DateSchema.optional(),
  audience: AudienceSchema.default('everyone'),
  fileIds: z.array(IdSchema).max(100).default([]),
});
export class CreateAlbumDto extends createZodDto(CreateAlbumSchema) {}

export const AddAlbumItemsSchema = z.object({
  items: z
    .array(z.object({ fileId: IdSchema, caption: z.string().trim().max(200).optional() }))
    .min(1)
    .max(100),
});
export class AddAlbumItemsDto extends createZodDto(AddAlbumItemsSchema) {}
