import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Id = z.string().regex(/^\d{1,18}$/);

export const StartSchema = z.object({
  historyFrom: z
    .string()
    .regex(/^\d{4}-04-01$/, 'the 1st of April of a year')
    .optional(),
});
export class StartDto extends createZodDto(StartSchema) {}

export const MonthsSchema = z.object({ months: z.array(Month).min(1).max(24) });
export class MonthsDto extends createZodDto(MonthsSchema) {}

export const ResultsQuerySchema = z.object({
  status: z.enum(['MATCH', 'OPEN', 'EXPLAINED']).optional(),
  component: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,29}$/)
    .optional(),
  month: Month.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
});
export class ResultsQueryDto extends createZodDto(ResultsQuerySchema) {}

export const ExplainSchema = z
  .object({
    resultIds: z.array(Id).min(1).max(1000),
    code: z.enum([
      'ROUNDING',
      'LEGACY_DEFECT',
      'LABOUR_CODE',
      'SETUP_GAP',
      'MISSING_INPUT',
      'OTHER',
    ]),
    defect: z.string().trim().max(60).nullable().optional(),
    note: z.string().trim().min(10).max(480),
  })
  .superRefine((v, ctx) => {
    if (v.code === 'LEGACY_DEFECT' && !v.defect)
      ctx.addIssue({
        code: 'custom',
        path: ['defect'],
        message: 'Which defect of the old payroll',
      });
  });
export class ExplainDto extends createZodDto(ExplainSchema) {}

export const SwitchSchema = z.object({ month: Month });
export class SwitchDto extends createZodDto(SwitchSchema) {}

export const RollbackSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class RollbackDto extends createZodDto(RollbackSchema) {}
