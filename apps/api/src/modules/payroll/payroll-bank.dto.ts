import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LayoutSchema } from './payroll-bank';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');
const Code = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
  z.string().regex(/^[A-Z]{4}$/, 'the first four letters of the bank’s IFSC'),
);

export const BankAccountSchema = z
  .object({
    bankCode: Code,
    bankName: z.string().trim().min(2).max(80),
    branch: z.string().trim().max(120).nullable().optional(),
    accountNo: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{6,20}$/, 'the account number: 6 to 20 letters or digits'),
    fileFormat: z.enum(['GENERIC_CSV', 'CUSTOM_CSV', 'BANK_LETTER']).default('GENERIC_CSV'),
    layout: LayoutSchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.fileFormat === 'CUSTOM_CSV' && !v.layout)
      ctx.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'A custom file needs its columns, from the bank’s sample file',
      });
  });
export class BankAccountDto extends createZodDto(BankAccountSchema) {}

export const LayoutCheckSchema = z.object({ layout: LayoutSchema });
export class LayoutCheckDto extends createZodDto(LayoutCheckSchema) {}

export const BatchCreateSchema = z.object({
  /** one bank (the IFSC's first four letters); left out, every payment of the run together */
  bankCode: Code.nullable().optional(),
  valueDate: Day.nullable().optional(),
});
export class BatchCreateDto extends createZodDto(BatchCreateSchema) {}

export const ConfirmSchema = z.object({ utr: z.string().trim().min(4).max(60) });
export class ConfirmDto extends createZodDto(ConfirmSchema) {}

export const CancelSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class CancelDto extends createZodDto(CancelSchema) {}

export const RejectLineSchema = z.object({ reason: z.string().trim().min(3).max(180) });
export class RejectLineDto extends createZodDto(RejectLineSchema) {}

export const MarkPaidSchema = z.object({
  mode: z.enum(['CASH', 'CHEQUE']),
  reference: z.string().trim().min(3).max(60),
});
export class MarkPaidDto extends createZodDto(MarkPaidSchema) {}

export const BankFileSchema = z.object({ as: z.enum(['file', 'letter', 'pdf']).default('file') });
export class BankFileDto extends createZodDto(BankFileSchema) {}
