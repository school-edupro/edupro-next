import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../classes/classes.dto';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
/** A date and time as the form gives it (school time), or a full ISO time. */
export const PublishAtSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
    'must be a date and time',
  );
export const DailyWorkKindSchema = z.enum(['homework', 'classwork', 'assignment']);
export const AudienceSchema = z.enum(['everyone', 'students', 'employees']);
export const NoticeKindSchema = z.enum(['notice', 'circular', 'office_order']);
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
    /** When the family sees it: now when left out. */
    publishAt: PublishAtSchema.optional(),
    /** The family is asked to acknowledge it. */
    ackRequired: z.boolean().default(false),
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
    publishAt: PublishAtSchema,
    ackRequired: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateDailyWorkDto extends createZodDto(UpdateDailyWorkSchema) {}

export const ListDailyWorkQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  subjectId: IdSchema.optional(),
  kind: DailyWorkKindSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListDailyWorkQueryDto extends createZodDto(ListDailyWorkQuerySchema) {}

// ---- the day's sheet: a row per subject, for one or more sections --------------------------------
const SheetText = z.string().trim().max(8000).default('');
const SheetFiles = z.array(IdSchema).max(10).default([]);
export const SheetModeSchema = z.enum(['daily', 'assignment']);
export const SheetQuerySchema = z.object({
  date: DateSchema.optional(),
  /** Section ids, comma-separated. */
  sections: z
    .string()
    .regex(/^\d{1,18}(,\d{1,18}){0,29}$/)
    .optional(),
  /** A class alone: every section of it the caller posts for. */
  classId: IdSchema.optional(),
  mode: SheetModeSchema.default('daily'),
});
export class SheetQueryDto extends createZodDto(SheetQuerySchema) {}

export const WorkReportQuerySchema = z.object({
  classSectionId: IdSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  /** Homework and classwork, or assignments; both when left out. */
  kind: SheetModeSchema.optional(),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  /** `1`: the file inside a JSON answer (the teacher app's own download route reads it). */
  wrap: z.enum(['1']).optional(),
});
export class WorkReportQueryDto extends createZodDto(WorkReportQuerySchema) {}

export const SaveSheetSchema = z.object({
  date: DateSchema,
  classSectionIds: z.array(IdSchema).min(1).max(30),
  mode: SheetModeSchema.default('daily'),
  /** When the families see the whole sheet: now when left out. */
  publishAt: PublishAtSchema.optional(),
  ackRequired: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        subjectId: IdSchema,
        homework: SheetText,
        classwork: SheetText,
        assignment: SheetText,
        dueOn: DateSchema.optional(),
        homeworkFileIds: SheetFiles,
        classworkFileIds: SheetFiles,
        assignmentFileIds: SheetFiles,
      }),
    )
    .min(1)
    .max(80),
});
export class SaveSheetDto extends createZodDto(SaveSheetSchema) {}

// ---- what the school decides for the module ---------------------------------------------------------
const ContactShowSchema = z.enum(['full', 'masked', 'hidden']);
const Mb = z.coerce.number().int().min(1).max(25);
export const UpdateAcademicSettingsSchema = z.object({
  publishTime: TimeSchema.nullable().optional(),
  teacherMobile: ContactShowSchema,
  teacherEmail: ContactShowSchema,
  maxMb: z.object({
    daily_work: Mb,
    assignment: Mb,
    documents: Mb,
    notices: Mb,
    gallery: Mb,
  }),
  maxNoticeFiles: z.coerce.number().int().min(1).max(10).default(5),
});
export class UpdateAcademicSettingsDto extends createZodDto(UpdateAcademicSettingsSchema) {}

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
    targets: z.array(TargetSchema).max(2500).default([]),
    /** Departments: every active employee of each becomes a target. */
    departments: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
    fileIds: z.array(IdSchema).max(10).default([]),
    publish: z.boolean().default(false),
    /** `html`: the body is formatted text from the editor (cleaned on the server). */
    bodyFormat: z.enum(['text', 'html']).default('text'),
    ackRequired: z.boolean().default(false),
    /** The time the portal starts to show it (after it is published): now when left out. */
    publishAt: PublishAtSchema.optional(),
    /** Also send it by e-mail to the people it is for, when it is published. */
    alsoEmail: z.boolean().default(false),
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
    bodyFormat: z.enum(['text', 'html']),
    ackRequired: z.boolean(),
    publishAt: PublishAtSchema.nullable(),
    alsoEmail: z.boolean(),
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

// ---- class documents, acknowledgements --------------------------------------------------------------
export const DocumentKindSchema = z.enum([
  'session_plan',
  'curriculum',
  'date_sheet',
  'magazine',
  'almanac',
  'other',
]);
export const CreateDocumentSchema = z.object({
  kind: DocumentKindSchema,
  title: z.string().trim().min(2).max(200),
  /** Written in the editor: kept as cleaned HTML. */
  remark: z.string().trim().max(20000).optional(),
  /** The classes it is for; none = the whole school (the office only). */
  classSectionIds: z.array(IdSchema).max(80).default([]),
  fileIds: z.array(IdSchema).min(1, 'Attach the file').max(5),
  publishAt: PublishAtSchema.optional(),
  ackRequired: z.boolean().default(false),
});
export class CreateDocumentDto extends createZodDto(CreateDocumentSchema) {}

export const ListDocumentsQuerySchema = z.object({
  kind: DocumentKindSchema.optional(),
  classSectionId: IdSchema.optional(),
  /** Published from / to (dates, school time). */
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class ListDocumentsQueryDto extends createZodDto(ListDocumentsQuerySchema) {}
export const DocumentReportQuerySchema = ListDocumentsQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  /** `1`: the file inside a JSON answer (the teacher app's own download route reads it). */
  wrap: z.enum(['1']).optional(),
});
export class DocumentReportQueryDto extends createZodDto(DocumentReportQuerySchema) {}

export const AckItemSchema = z.enum(['daily_work', 'document', 'notice']);
export const AckSchema = z.object({
  type: AckItemSchema,
  id: IdSchema,
  /** The child it is acknowledged for (a family); left out by an employee. */
  studentId: IdSchema.optional(),
});
export class AckDto extends createZodDto(AckSchema) {}
export const AckStatusQuerySchema = z.object({ type: AckItemSchema, id: IdSchema });
export class AckStatusQueryDto extends createZodDto(AckStatusQuerySchema) {}

export const NoticeReportQuerySchema = z.object({
  kind: NoticeKindSchema.optional(),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
export class NoticeReportQueryDto extends createZodDto(NoticeReportQuerySchema) {}

export const NoticeReachSchema = z.object({
  kind: NoticeKindSchema.default('notice'),
  audience: AudienceSchema.default('everyone'),
  targets: z.array(TargetSchema).max(2500).default([]),
  departments: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
});
export class NoticeReachDto extends createZodDto(NoticeReachSchema) {}

/** An Excel list of admission numbers (students) or employee codes, turned into the people it names. */
export const NoticeAudienceFileSchema = z.object({
  kind: z.enum(['student', 'employee']),
  fileBase64: z.string().min(100).max(1_400_000),
});
export class NoticeAudienceFileDto extends createZodDto(NoticeAudienceFileSchema) {}
