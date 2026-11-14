import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Month } from './payroll-inputs.dto';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');

export const FySchema = z.object({ fy: z.coerce.number().int().min(2000).max(2100) });
export class FyDto extends createZodDto(FySchema) {}

export const DoneSchema = z.object({
  ackNo: z.string().trim().min(3).max(60),
  ackDate: Day,
  amountPaid: z
    .string()
    .trim()
    .regex(/^\d{1,11}(\.\d{1,2})?$/, 'an amount (rupees)')
    .transform((v) => Number(v).toFixed(2))
    .nullable()
    .default(null),
});
export class DoneDto extends createZodDto(DoneSchema) {}

export const ReopenSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class ReopenDto extends createZodDto(ReopenSchema) {}

export const VoucherSchema = z.object({ month: Month });
export class VoucherDto extends createZodDto(VoucherSchema) {}

export const VoucherFileSchema = z.object({
  month: Month,
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});
export class VoucherFileDto extends createZodDto(VoucherFileSchema) {}
