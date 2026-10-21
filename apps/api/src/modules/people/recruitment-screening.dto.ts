import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const txt = (n: number) => z.string().trim().max(n);
/** A date and time as the browser gives it (YYYY-MM-DDTHH:MM), read as India time; null clears it. */
const When = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((s) => `${s}:00+05:30`);

export const ApplicationListSchema = z.object({
  vacancy: Id.optional(),
  status: z
    .enum([
      'submitted',
      'screening',
      'selected',
      'rejected',
      'on_hold',
      'withdrawn',
      'joined',
      'returned',
    ])
    .optional(),
  stage: Id.optional(),
  q: txt(80).optional(),
  match: z
    .enum(['1', 'true'])
    .optional()
    .transform((x) => (x ? true : undefined)),
});
export class ApplicationListDto extends createZodDto(ApplicationListSchema) {}

/** A stage of one application: when and where, the panel; once held, the marks and the result. */
export const StageResultSchema = z.object({
  scheduledAt: When.nullable().optional(),
  venue: txt(200).optional(),
  panel: txt(300).optional(),
  marks: z.number().min(0).max(1000).nullable().optional(),
  result: z.enum(['pass', 'fail', 'hold']).optional(),
  remarks: txt(1000).optional(),
});
export class StageResultDto extends createZodDto(StageResultSchema) {}

/** The same result (and schedule) for several candidates at one stage. */
export const ApplicationBulkSchema = z.object({
  ids: z.array(Id).min(1).max(200),
  stageId: Id,
  result: z.enum(['pass', 'fail', 'hold']).optional(),
  remarks: txt(1000).optional(),
  scheduledAt: When.nullable().optional(),
  venue: txt(200).optional(),
  panel: txt(300).optional(),
});
export class ApplicationBulkDto extends createZodDto(ApplicationBulkSchema) {}

export const ApplicationNoteSchema = z.object({ note: txt(1000).optional() });
export class ApplicationNoteDto extends createZodDto(ApplicationNoteSchema) {}

/** A candidate the office adds: the essentials, checked as the employee master checks them. */
export const WalkInSchema = z.object({
  vacancyId: Id,
  firstName: txt(80).min(1),
  lastName: txt(80).optional(),
  gender: txt(20).min(1),
  dob: txt(20).optional(),
  mobile: txt(20).min(10),
  email: txt(200).optional(),
});
export class WalkInDto extends createZodDto(WalkInSchema) {}

/** Which notices go to candidates, and by which channels. */
export const RecruitmentNoticesSchema = z.object({
  applied: z.boolean(),
  scheduled: z.boolean(),
  selected: z.boolean(),
  rejected: z.boolean(),
  sms: z.boolean(),
  whatsapp: z.boolean(),
  email: z.boolean(),
});
export class RecruitmentNoticesDto extends createZodDto(RecruitmentNoticesSchema) {}
