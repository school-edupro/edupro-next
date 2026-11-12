import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Id = z.string().regex(/^\d{1,18}$/);

export const RunCreateSchema = z
  .object({
    month: Month,
    runType: z.enum(['REGULAR', 'SUPPLEMENTARY', 'BONUS']),
    /** a supplementary run's staff */
    employeeIds: z.array(Id).max(500).optional(),
    remark: z.string().trim().max(200).nullable().optional(),
  })
  .refine((d) => d.runType !== 'SUPPLEMENTARY' || (d.employeeIds?.length ?? 0) > 0, {
    message: 'A supplementary run names its staff',
    path: ['employeeIds'],
  });
export class RunCreateDto extends createZodDto(RunCreateSchema) {}

export const RunListSchema = z.object({
  /** a financial year's start (2026 for 2026-27); default the current one */
  fy: z.coerce.number().int().min(2000).max(2100).optional(),
});
export class RunListDto extends createZodDto(RunListSchema) {}

export const CommentSchema = z.object({ comment: z.string().trim().min(3).max(500) });
export class CommentDto extends createZodDto(CommentSchema) {}
export const DropSchema = z.object({ reason: z.string().trim().min(10).max(500) });
export class DropDto extends createZodDto(DropSchema) {}

export const RecordListSchema = z.object({
  q: z.string().trim().max(60).optional(),
  show: z.enum(['all', 'failed', 'held', 'flagged', 'topup']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
});
export class RecordListDto extends createZodDto(RecordListSchema) {}

export const HoldRecordSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export class HoldRecordDto extends createZodDto(HoldRecordSchema) {}

export const RecoverySchema = z.object({
  /** the monthly instalment of the shortfall's recovery */
  emi: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/),
});
export class RecoveryDto extends createZodDto(RecoverySchema) {}
