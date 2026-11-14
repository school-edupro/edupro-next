import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');

export const StatMonthSchema = z.object({ month: Month });
export class StatMonthDto extends createZodDto(StatMonthSchema) {}

export const EcrFileSchema = z.object({
  month: Month,
  part: z.enum(['main', 'arrear']).default('main'),
});
export class EcrFileDto extends createZodDto(EcrFileSchema) {}

export const ReturnFileSchema = z.object({ part: z.enum(['main', 'arrear']).default('main') });
export class ReturnFileDto extends createZodDto(ReturnFileSchema) {}

export const EcrFiledSchema = z.object({
  month: Month,
  ackNo: z.string().trim().min(4).max(60),
  filedOn: Day,
});
export class EcrFiledDto extends createZodDto(EcrFiledSchema) {}

export const WithdrawSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class WithdrawDto extends createZodDto(WithdrawSchema) {}

export const RegisterFileSchema = z.object({
  month: Month,
  kind: z.enum(['pf', 'esi', 'pt', 'lwf']),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class RegisterFileDto extends createZodDto(RegisterFileSchema) {}
