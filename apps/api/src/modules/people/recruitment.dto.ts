import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txt = (n: number) => z.string().trim().max(n);

/** The school's screening stages, the whole list at once (0197): stages left out switch off. */
export const RecruitmentStagesSchema = z.object({
  stages: z
    .array(
      z.object({
        id: Id.optional(),
        name: txt(80).min(2),
        kind: z.enum(['shortlist', 'test', 'interview', 'final']),
        maxMarks: z.number().min(1).max(1000).nullable().optional(),
        active: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(20),
});
export class RecruitmentStagesDto extends createZodDto(RecruitmentStagesSchema) {}

/** A vacancy as the office or an HOD raises it (0197); editable while a draft or sent back. */
export const VacancySchema = z.object({
  title: txt(120).min(2),
  designation: txt(80).nullable().optional(),
  department: txt(80).nullable().optional(),
  subject: txt(80).nullable().optional(),
  employeeType: txt(80).nullable().optional(),
  campusId: Id.nullable().optional(),
  posts: z.number().int().min(1).max(500).default(1),
  qualification: txt(1000).nullable().optional(),
  experience: txt(500).nullable().optional(),
  payBand: txt(120).nullable().optional(),
  description: txt(5000).nullable().optional(),
  stageIds: z.array(Id).max(20).default([]),
});
export class VacancyDto extends createZodDto(VacancySchema) {}

/** Publish on the careers page for a period. */
export const VacancyPublishSchema = z
  .object({ opensOn: Day, closesOn: Day })
  .refine((x) => x.closesOn >= x.opensOn, {
    message: 'The closing date is on or after the opening date',
    path: ['closesOn'],
  });
export class VacancyPublishDto extends createZodDto(VacancyPublishSchema) {}

export const VacancyNoteSchema = z.object({ note: txt(1000).optional() });
export class VacancyNoteDto extends createZodDto(VacancyNoteSchema) {}

export const VacancyListSchema = z.object({
  status: z
    .enum(['draft', 'pending', 'approved', 'rejected', 'published', 'closed', 'cancelled'])
    .optional(),
});
export class VacancyListDto extends createZodDto(VacancyListSchema) {}
