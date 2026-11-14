import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');

export const RevisionSchema = z
  .object({
    kind: z.enum(['RATE', 'FORMULA']),
    rateCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,29}$/)
      .optional(),
    newValue: z.string().trim().optional(),
    headCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,19}$/)
      .optional(),
    formula: z.string().trim().max(255).optional(),
    effectiveFrom: Day,
    notifiedOn: Day.nullable().optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'RATE' && (!v.rateCode || !v.newValue))
      ctx.addIssue({ code: 'custom', path: ['rateCode'], message: 'The rate and its new value' });
    if (v.kind === 'FORMULA' && (!v.headCode || !v.formula))
      ctx.addIssue({ code: 'custom', path: ['headCode'], message: 'The head and its new formula' });
    if (!v.effectiveFrom.endsWith('-01'))
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveFrom'],
        message: 'From the first of a month',
      });
  });
export class RevisionDto extends createZodDto(RevisionSchema) {}

export const DueQuerySchema = z.object({ month: Month });
export class DueQueryDto extends createZodDto(DueQuerySchema) {}

export const ProposeSchema = z.object({
  month: Month,
  employeeIds: z.array(Id).min(1).max(1000),
  reason: z.string().trim().min(3).max(300).default('Yearly increment'),
});
export class ProposeDto extends createZodDto(ProposeSchema) {}
