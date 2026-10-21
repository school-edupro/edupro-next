import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const txt = (n: number) => z.string().trim().max(n);
/** A date and time as the browser gives it (YYYY-MM-DDTHH:MM), read as India time. */
const When = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'a date and a time')
  .transform((s) => `${s}:00+05:30`);

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
        /** an email to the candidate when this stage is scheduled (0204) */
        emailScheduled: z.boolean().default(true),
        /** an email of this stage's result: cleared (with the next stage) or not through */
        emailResult: z.boolean().default(true),
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

/** Publish on the careers page from one minute to another (India time); the rest is checked on save. */
export const VacancyPublishSchema = z
  .object({ opensAt: When, closesAt: When })
  .refine((x) => new Date(x.closesAt) > new Date(x.opensAt), {
    message: 'The last date and time come after the opening',
    path: ['closesAt'],
  });
export class VacancyPublishDto extends createZodDto(VacancyPublishSchema) {}

/** An approver's decision on the vacancy waiting with them: a note to approve, a reason to send back. */
export const VacancyApproveSchema = z.object({ note: txt(500).optional() });
export class VacancyApproveDto extends createZodDto(VacancyApproveSchema) {}
export const VacancySendBackSchema = z.object({
  note: txt(500).min(3, 'Say why it is sent back'),
});
export class VacancySendBackDto extends createZodDto(VacancySendBackSchema) {}

/**
 * Who approves a vacancy, level by level (Recruitment set-up): named employees, everyone holding a
 * designation, or the HOD of the vacancy's department. "role" keeps a level set under Workflow before.
 */
export const RecruitmentApprovalSchema = z.object({
  levels: z
    .array(
      z.object({
        name: txt(80).min(2),
        by: z.enum(['employees', 'designation', 'hod', 'role']),
        employeeIds: z.array(Id).max(30).default([]),
        designation: txt(80).optional(),
        roleCode: z
          .string()
          .regex(/^[a-z_]{2,40}$/)
          .optional(),
        slaHours: z.number().int().min(1).max(720).nullable().optional(),
      }),
    )
    .min(1, 'Keep at least one level')
    .max(6),
});
export class RecruitmentApprovalDto extends createZodDto(RecruitmentApprovalSchema) {}

export const VacancyNoteSchema = z.object({ note: txt(1000).optional() });
export class VacancyNoteDto extends createZodDto(VacancyNoteSchema) {}

export const VacancyListSchema = z.object({
  status: z
    .enum(['draft', 'pending', 'approved', 'rejected', 'published', 'closed', 'cancelled'])
    .optional(),
});
export class VacancyListDto extends createZodDto(VacancyListSchema) {}
