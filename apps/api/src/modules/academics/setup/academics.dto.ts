import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema, RowStatusSchema } from '../classes/classes.dto';

export const SubjectKindSchema = z.enum(['scholastic', 'co_scholastic', 'language', 'vocational']);
export const AssignmentKindSchema = z.enum([
  'class_teacher',
  'subject_teacher',
  'coordinator',
  'indicator',
]);
export const PeriodKindSchema = z.enum(['teaching', 'break', 'assembly', 'activity']);
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

// ---- subjects -----------------------------------------------------------------------------------
export const CreateSubjectSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  kind: SubjectKindSchema.default('scholastic'),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
  /** The report-card subject this teaching subject belongs to (Physics under Science). */
  parentId: IdSchema.nullish(),
});
export class CreateSubjectDto extends createZodDto(CreateSubjectSchema) {}

export const UpdateSubjectSchema = CreateSubjectSchema.extend({ status: RowStatusSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export class UpdateSubjectDto extends createZodDto(UpdateSubjectSchema) {}

export const ListSubjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(100),
  q: z.string().trim().max(100).optional(),
  kind: SubjectKindSchema.optional(),
  status: RowStatusSchema.optional(),
});
export class ListSubjectsQueryDto extends createZodDto(ListSubjectsQuerySchema) {}

/** Replaces the subject list of a class for the working year. */
export const SetClassSubjectsSchema = z.object({
  subjects: z
    .array(
      z.object({
        subjectId: IdSchema,
        isElective: z.boolean().default(false),
        periodsPerWeek: z.number().int().min(0).max(60).optional(),
      }),
    )
    .max(50),
});
export class SetClassSubjectsDto extends createZodDto(SetClassSubjectsSchema) {}

// ---- teacher assignments ------------------------------------------------------------------------
export const CreateTeacherAssignmentSchema = z
  .object({
    employeeId: IdSchema,
    classSectionId: IdSchema,
    kind: AssignmentKindSchema,
    subjectId: IdSchema.optional(),
    canMarkAttendance: z.boolean().default(true),
    canPostHomework: z.boolean().default(true),
    canAnswerQueries: z.boolean().default(true),
    validFrom: DateSchema.optional(),
    isActual: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'subject_teacher' || v.subjectId, {
    message: 'subjectId is required for a subject teacher',
    path: ['subjectId'],
  });
export class CreateTeacherAssignmentDto extends createZodDto(CreateTeacherAssignmentSchema) {}

/** One teacher, one type, many classes and many subjects: every class with every subject. */
export const BulkTeacherAssignmentSchema = z
  .object({
    employeeId: IdSchema,
    kind: AssignmentKindSchema,
    classSectionIds: z.array(IdSchema).min(1, 'Pick at least one class').max(80),
    subjectIds: z.array(IdSchema).max(40).default([]),
    /** Class teacher only: the actual class teacher of the section (else a co-class teacher). */
    isActual: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'subject_teacher' || v.subjectIds.length > 0, {
    message: 'Pick at least one subject for a subject teacher',
    path: ['subjectIds'],
  });
export class BulkTeacherAssignmentDto extends createZodDto(BulkTeacherAssignmentSchema) {}

export const ImportTeacherAssignmentsSchema = z.object({
  fileBase64: z.string().min(100).max(1_400_000),
});
export class ImportTeacherAssignmentsDto extends createZodDto(ImportTeacherAssignmentsSchema) {}

export const ListTeacherAssignmentsQuerySchema = z.object({
  employeeId: IdSchema.optional(),
  classSectionId: IdSchema.optional(),
  kind: AssignmentKindSchema.optional(),
  includeEnded: z.coerce.boolean().default(false),
});
export class ListTeacherAssignmentsQueryDto extends createZodDto(
  ListTeacherAssignmentsQuerySchema,
) {}

// ---- timetable ----------------------------------------------------------------------------------
export const CreatePeriodSchema = z
  .object({
    number: z.number().int().min(1).max(20),
    name: z.string().trim().min(1).max(40),
    startsAt: TimeSchema,
    endsAt: TimeSchema,
    kind: PeriodKindSchema.default('teaching'),
    campusId: IdSchema.optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export class CreatePeriodDto extends createZodDto(CreatePeriodSchema) {}

export const SetSlotSchema = z.object({
  classSectionId: IdSchema,
  weekday: z.number().int().min(1).max(7),
  periodId: IdSchema,
  subjectId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  room: z.string().trim().max(40).optional(),
});
export class SetSlotDto extends createZodDto(SetSlotSchema) {}

export const TimetableQuerySchema = z
  .object({
    classSectionId: IdSchema.optional(),
    employeeId: IdSchema.optional(),
  })
  .refine((v) => Boolean(v.classSectionId) !== Boolean(v.employeeId), {
    message: 'pass exactly one of classSectionId or employeeId',
  });
export class TimetableQueryDto extends createZodDto(TimetableQuerySchema) {}
