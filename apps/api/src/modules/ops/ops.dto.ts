import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Sprints 22-23: cut-over runs, hypercare, feature flags, month-end close. */
export const OPS = {
  cutoverManage: 'platform.cutover.manage',
  hypercareReport: 'platform.hypercare.report',
  hypercareManage: 'platform.hypercare.manage',
  periodLock: 'fees.period.lock',
  periodView: 'fees.period.view',
} as const;

const IdSchema = z.string().regex(/^\d{1,18}$/);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MonthSchema = z.string().regex(/^\d{4}-\d{2}$/);

// ---- cut-over ----
export const CreateRunSchema = z.object({
  kind: z.enum(['rehearsal', 'final']).default('rehearsal'),
  name: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(2000).optional(),
});
export class CreateRunDto extends createZodDto(CreateRunSchema) {}

export const RunStatusSchema = z.object({
  status: z.enum(['running', 'done', 'aborted']),
  notes: z.string().trim().max(2000).optional(),
});
export class RunStatusDto extends createZodDto(RunStatusSchema) {}

export const StepSchema = z.object({
  status: z.enum(['pending', 'done', 'skipped', 'failed']),
  note: z.string().trim().max(1000).optional(),
  durationS: z
    .number()
    .int()
    .min(0)
    .max(86_400 * 3)
    .optional(),
});
export class StepDto extends createZodDto(StepSchema) {}

export const LegacyCountsSchema = z.object({
  counts: z.record(z.string().regex(/^[a-z_]{2,40}$/), z.union([z.number(), z.string()])),
});
export class LegacyCountsDto extends createZodDto(LegacyCountsSchema) {}

// ---- hypercare ----
export const IssueSchema = z.object({
  title: z.string().trim().min(3).max(200),
  detail: z.string().trim().max(5000).optional(),
  module: z.string().trim().min(2).max(40),
  severity: z.enum(['s1', 's2', 's3', 's4']).default('s3'),
  channel: z.enum(['admin', 'teacher_app', 'help_desk', 'email', 'phone']).default('admin'),
});
export class IssueDto extends createZodDto(IssueSchema) {}

export const IssueUpdateSchema = z.object({
  status: z.enum(['open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed']).optional(),
  severity: z.enum(['s1', 's2', 's3', 's4']).optional(),
  assignedRole: z.string().trim().max(40).optional(),
  assignedUserId: IdSchema.optional(),
  workaround: z.string().trim().max(2000).optional(),
  resolution: z.string().trim().max(5000).optional(),
  body: z.string().trim().max(5000).optional(),
});
export class IssueUpdateDto extends createZodDto(IssueUpdateSchema) {}

export const IssueListSchema = z.object({
  status: z.enum(['open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed']).optional(),
  severity: z.enum(['s1', 's2', 's3', 's4']).optional(),
  module: z.string().trim().max(40).optional(),
  mine: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class IssueListDto extends createZodDto(IssueListSchema) {}

// ---- month-end ----
export const MonthParamSchema = z.object({ month: MonthSchema });
export class MonthParamDto extends createZodDto(MonthParamSchema) {}

export const CloseMonthSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  /** queue the month-end pack (day book, head-wise tally, Tally XML, defaulters) */
  pack: z.boolean().default(true),
});
export class CloseMonthDto extends createZodDto(CloseMonthSchema) {}

export const ReopenMonthSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
export class ReopenMonthDto extends createZodDto(ReopenMonthSchema) {}

export const LockSchema = z.object({
  ledger: z.enum(['school', 'hostel', 'misc']).optional(),
  lockedThrough: DateSchema,
  note: z.string().trim().max(1000).optional(),
});
export class LockDto extends createZodDto(LockSchema) {}
