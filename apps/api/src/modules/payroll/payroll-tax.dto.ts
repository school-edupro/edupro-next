import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');
const Fy = z.string().regex(/^\d{4}-\d{2}$/, 'a financial year (2026-27)');
const Money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/,/g, '').trim())
  .pipe(z.string().regex(/^\d{1,11}(\.\d{1,2})?$/, 'an amount in rupees'))
  .transform((v) => Number(v).toFixed(2));
const Pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'a PAN (ABCDE1234F)');

export const FyQuerySchema = z.object({ fy: Fy.optional() });
export class FyQueryDto extends createZodDto(FyQuerySchema) {}

export const HraDetailSchema = z.object({
  months: z
    .array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), rent: Money }))
    .min(1)
    .max(12),
  city: z.string().trim().min(2).max(60),
  landlord: z.object({
    name: z.string().trim().min(2).max(100),
    pan: Pan.nullable().optional(),
    address: z.string().trim().min(5).max(250),
    relation: z.string().trim().min(2).max(60),
  }),
});

export const DeclareSchema = z.object({
  fy: Fy,
  /** payroll staff for an employee without a sign-in */
  employeeId: Id.optional(),
  lineCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  /** HRA: the months' rent add up to it */
  amount: Money.optional(),
  hra: HraDetailSchema.optional(),
  proofFileIds: z.array(Id).max(10).default([]),
});
export class DeclareDto extends createZodDto(DeclareSchema) {}

export const DecideSchema = z
  .object({
    action: z.enum(['verify', 'reject', 'reopen']),
    verified: Money.optional(),
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'reject' && !v.reason)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say why it is rejected' });
  });
export class DecideDto extends createZodDto(DecideSchema) {}

export const PrevSchema = z
  .object({
    fy: Fy,
    employeeId: Id.optional(),
    employerName: z.string().trim().min(2).max(150),
    employerTan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, 'a TAN (ABCD12345E)')
      .nullable()
      .optional(),
    periodFrom: Day.nullable().optional(),
    periodTo: Day.nullable().optional(),
    gross: Money,
    exempt: Money.default('0.00'),
    pf: Money.default('0.00'),
    pt: Money.default('0.00'),
    tds: Money.default('0.00'),
    proofFileIds: z.array(Id).max(5).default([]),
  })
  .superRefine((v, ctx) => {
    if (Number(v.exempt) > Number(v.gross))
      ctx.addIssue({ code: 'custom', path: ['exempt'], message: 'More than the gross salary' });
    if (Number(v.tds) > Number(v.gross))
      ctx.addIssue({ code: 'custom', path: ['tds'], message: 'More than the gross salary' });
  });
export class PrevDto extends createZodDto(PrevSchema) {}

export const RegimeSchema = z.object({
  fy: Fy,
  regime: z.enum(['NEW', 'OLD']),
  employeeId: Id.optional(),
  reason: z.string().trim().min(3).max(200).optional(),
});
export class RegimeDto extends createZodDto(RegimeSchema) {}

export const PerqSchema = z.object({
  fy: Fy,
  employeeId: Id,
  perqType: z.enum(['EDUCATION', 'ACCOMMODATION', 'VEHICLE', 'LOAN_INTEREST', 'MEDICAL', 'OTHER']),
  amount: Money,
  description: z.string().trim().max(200).nullable().optional(),
});
export class PerqDto extends createZodDto(PerqSchema) {}

export const FinalSchema = z.object({
  fy: Fy,
  employeeId: Id,
  annual: Money,
  spreadMonths: z.number().int().min(1).max(12).nullable().optional(),
  reason: z.string().trim().min(3).max(200),
});
export class FinalDto extends createZodDto(FinalSchema) {}

export const ClearFinalSchema = z.object({ fy: Fy, employeeId: Id });
export class ClearFinalDto extends createZodDto(ClearFinalSchema) {}

export const ChallanSchema = z.object({
  fy: Fy,
  quarter: z.number().int().min(1).max(4),
  bsrCode: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'the 7-digit BSR code'),
  challanNo: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, 'the challan serial (up to 5 digits)'),
  depositedOn: Day,
  amount: Money,
  interest: Money.default('0.00'),
  lateFee: Money.default('0.00'),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(3),
});
export class ChallanDto extends createZodDto(ChallanSchema) {}

export const ReasonSchema = z.object({ reason: z.string().trim().min(10).max(300) });
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const TaxYearSchema = z
  .object({
    declareFrom: Day,
    declareTo: Day,
    proofDue: Day,
    listedCities: z.array(z.string().trim().min(2).max(60)).max(30),
  })
  .superRefine((v, ctx) => {
    if (v.declareTo < v.declareFrom)
      ctx.addIssue({ code: 'custom', path: ['declareTo'], message: 'Before the window opens' });
  });
export class TaxYearDto extends createZodDto(TaxYearSchema) {}

export const DeclListSchema = z.object({
  fy: Fy.optional(),
  status: z.enum(['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALL']).default('SUBMITTED'),
  q: z.string().trim().max(60).optional(),
});
export class DeclListDto extends createZodDto(DeclListSchema) {}
