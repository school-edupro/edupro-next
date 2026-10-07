import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const PLANNER = {
  planView: 'academics.lesson_plan.view',
  planManage: 'academics.lesson_plan.manage',
  subView: 'academics.substitution.view',
  subManage: 'academics.substitution.manage',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const TopicSchema = z.object({
  day: z.number().int().min(1).max(6),
  topic: z.string().trim().min(1).max(200),
  activities: z.string().trim().max(2000).optional(),
  resources: z.string().trim().max(1000).optional(),
  homework: z.string().trim().max(1000).optional(),
  /** The syllabus topic this day teaches (0094). */
  topicId: IdSchema.optional(),
});
export const CreateLessonPlanSchema = z.object({
  classSectionId: IdSchema,
  subjectId: IdSchema,
  weekStart: DateSchema,
  title: z.string().trim().min(3).max(160),
  objectives: z.string().trim().max(4000).optional(),
  topics: z.array(TopicSchema).max(12).default([]),
  assessment: z.string().trim().max(2000).optional(),
  submit: z.boolean().default(false),
});
export class CreateLessonPlanDto extends createZodDto(CreateLessonPlanSchema) {}
export const UpdateLessonPlanSchema = CreateLessonPlanSchema.omit({
  classSectionId: true,
  subjectId: true,
  weekStart: true,
}).partial();
export class UpdateLessonPlanDto extends createZodDto(UpdateLessonPlanSchema) {}
export const ListLessonPlansSchema = z.object({
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'returned']).optional(),
  classSectionId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  weekStart: DateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListLessonPlansDto extends createZodDto(ListLessonPlansSchema) {}

export const CreateSubstitutionSchema = z.object({
  onDate: DateSchema,
  classSectionId: IdSchema,
  periodId: IdSchema,
  substituteEmployeeId: IdSchema,
  reason: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});
export class CreateSubstitutionDto extends createZodDto(CreateSubstitutionSchema) {}
export const SubstitutionQuerySchema = z.object({
  date: DateSchema.optional(),
  employeeId: IdSchema.optional(),
});
export class SubstitutionQueryDto extends createZodDto(SubstitutionQuerySchema) {}
export const FreeTeachersQuerySchema = z.object({
  date: DateSchema,
  periodId: IdSchema,
  absentEmployeeId: IdSchema.optional(),
});
export class FreeTeachersQueryDto extends createZodDto(FreeTeachersQuerySchema) {}

// ---- the syllabus and its coverage (0094) -----------------------------------------------------------
const Name = z.string().trim().min(1).max(300);
export const SaveChapterSchema = z.object({
  id: IdSchema.optional(),
  classId: IdSchema,
  subjectId: IdSchema,
  number: z.coerce.number().int().min(1).max(200),
  name: Name,
  term: z.string().trim().max(40).optional(),
  plannedMonth: z.coerce.number().int().min(1).max(12).optional(),
});
export class SaveChapterDto extends createZodDto(SaveChapterSchema) {}
export const SaveTopicSchema = z.object({
  id: IdSchema.optional(),
  chapterId: IdSchema,
  number: z.coerce.number().int().min(1).max(500),
  name: Name,
  plannedPeriods: z.coerce.number().int().min(1).max(60).default(1),
});
export class SaveTopicDto extends createZodDto(SaveTopicSchema) {}
export const SyllabusTreeSchema = z.object({
  classId: IdSchema,
  subjectId: IdSchema,
  classSectionId: IdSchema.optional(),
});
export class SyllabusTreeDto extends createZodDto(SyllabusTreeSchema) {}
export const SyllabusImportSchema = z.object({ fileBase64: z.string().min(100).max(2_800_000) });
export class SyllabusImportDto extends createZodDto(SyllabusImportSchema) {}
export const MarkTopicSchema = z.object({
  classSectionId: IdSchema,
  topicId: IdSchema,
  status: z.enum(['done', 'partial', 'not_done']),
  doneOn: DateSchema.optional(),
  reason: z.string().trim().max(300).optional(),
});
export class MarkTopicDto extends createZodDto(MarkTopicSchema) {}
export const CoverageQuerySchema = z.object({
  classId: IdSchema.optional(),
  subjectId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
});
export class CoverageQueryDto extends createZodDto(CoverageQuerySchema) {}
export const SyllabusReportSchema = CoverageQuerySchema.extend({
  report: z.enum(['coverage', 'topics', 'missing']).default('coverage'),
  classSectionId: IdSchema.optional(),
  week: DateSchema.optional(),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  /** `1`: the file inside a JSON answer. */
  wrap: z.enum(['1']).optional(),
});
export class SyllabusReportDto extends createZodDto(SyllabusReportSchema) {}
export const WeekQuerySchema = z.object({ week: DateSchema.optional() });
export class WeekQueryDto extends createZodDto(WeekQuerySchema) {}
