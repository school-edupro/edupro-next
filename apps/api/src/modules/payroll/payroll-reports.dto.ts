import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Id = z.string().regex(/^\d{1,18}$/);
const Fy = z.string().regex(/^\d{4}-\d{2}$/, 'a financial year (2026-27)');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');
const Code = z.string().regex(/^[a-z0-9_:A-Z]{1,40}$/);

export const ReportQuerySchema = z.object({
  month: Month.optional(),
  fy: Fy.optional(),
  asOf: Day.optional(),
  runId: Id.optional(),
  department: z.string().trim().min(1).max(100).optional(),
  staffType: z.string().trim().min(1).max(40).optional(),
  employeeId: Id.optional(),
  view: z
    .string()
    .regex(/^[a-z]{2,20}$/)
    .optional(),
  /** the register's columns, comma-separated (a preset or the picker) */
  columns: z
    .string()
    .max(4000)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(Code).max(200))
    .optional(),
  groupBy: z.enum(['department', 'designation', 'staff_type', 'category']).optional(),
  threshold: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/)
    .optional(),
  format: z.enum(['xlsx', 'pdf', 'csv']).default('xlsx'),
});
export class ReportQueryDto extends createZodDto(ReportQuerySchema) {}

export const OptionsQuerySchema = z.object({ month: Month });
export class OptionsQueryDto extends createZodDto(OptionsQuerySchema) {}

export const PresetQuerySchema = z.object({ report: z.string().regex(/^[a-z_]{2,40}$/) });
export class PresetQueryDto extends createZodDto(PresetQuerySchema) {}

export const PresetSchema = z.object({
  report: z.string().regex(/^[a-z_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  columns: z.array(Code).min(1).max(200),
  shared: z.boolean().default(false),
});
export class PresetDto extends createZodDto(PresetSchema) {}

export const HomeQuerySchema = z.object({ month: Month.optional() });
export class HomeQueryDto extends createZodDto(HomeQuerySchema) {}

export const AsOfSchema = z.object({ asOf: Day });
export class AsOfDto extends createZodDto(AsOfSchema) {}

const Money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'an amount in rupees');
export const BonusRuleSchema = z
  .object({
    kind: z.enum(['PERCENT', 'FIXED', 'STATUTORY']),
    rate: z
      .string()
      .regex(/^0(\.\d{1,4})?$|^1(\.0{1,4})?$/, 'a rate between 0 and 1 (8.33 % is 0.0833)')
      .nullable()
      .default(null),
    amount: Money.nullable().default(null),
    prorate: z.boolean().default(true),
    minMonths: z.number().int().min(0).max(12).default(0),
    minDays: z
      .string()
      .regex(/^\d{1,3}(\.\d)?$/)
      .default('0'),
    maxWage: Money.nullable().default(null),
    wageCap: Money.nullable().default(null),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'FIXED' && !v.amount)
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'The sum for each employee' });
    if (v.kind !== 'FIXED' && !v.rate)
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'The rate' });
  });
export class BonusRuleDto extends createZodDto(BonusRuleSchema) {}

export const BonusPostSchema = z.object({ month: Month, dryRun: z.boolean().default(true) });
export class BonusPostDto extends createZodDto(BonusPostSchema) {}

export const AuditQuerySchema = z.object({
  from: Day.optional(),
  to: Day.optional(),
  kind: z.enum(['Change', 'Event', 'Read']).optional(),
  table: z
    .string()
    .regex(/^[a-z_]{2,63}$/)
    .optional(),
  action: z
    .string()
    .regex(/^[a-z_.]{2,80}$/)
    .optional(),
  who: z.string().trim().min(1).max(80).optional(),
  record: z.string().trim().min(1).max(64).optional(),
  contains: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n), 'page sizes are 25, 50 or 100')
    .default(50),
});
export class AuditQueryDto extends createZodDto(AuditQuerySchema) {}

export const FyOnlySchema = z.object({ fy: Fy });
export class FyOnlyDto extends createZodDto(FyOnlySchema) {}
