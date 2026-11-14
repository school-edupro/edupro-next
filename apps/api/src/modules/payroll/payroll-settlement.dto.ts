import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** an amount in rupees, up to two decimals, never below nothing */
const Rupees = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'an amount in rupees');

export const ComputeSchema = z.object({
  /** a fixed-term employee: gratuity after one year (the Code on Social Security, s.53) */
  fixedTerm: z.boolean().optional(),
  /** leave days to encash when payroll changes what the balance gives (with a reason) */
  encashDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.5)?$/, 'whole or half days')
    .nullable()
    .optional(),
  encashReason: z.string().trim().min(3).max(300).nullable().optional(),
  otherPayable: Rupees.nullable().optional(),
  otherRecovery: Rupees.nullable().optional(),
  /** a dismissal's gratuity forfeited (a checker) */
  forfeit: Rupees.nullable().optional(),
  forfeitReason: z.string().trim().min(10).max(300).nullable().optional(),
});
export class ComputeDto extends createZodDto(ComputeSchema) {}

export const SettlementListSchema = z.object({
  status: z
    .enum(['DRAFT', 'COMPUTED', 'APPROVED', 'STAGED', 'DUES', 'SETTLED', 'CANCELLED'])
    .optional(),
});
export class SettlementListDto extends createZodDto(SettlementListSchema) {}

export const ReasonSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const CollectedSchema = z.object({ reference: z.string().trim().min(3).max(120) });
export class CollectedDto extends createZodDto(CollectedSchema) {}
