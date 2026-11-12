import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Payroll run rights (0366); the payroll admin stays `payroll.settings.manage`. */
export const RUN = {
  view: 'payroll.run.view',
  manage: 'payroll.run.manage',
  approve: 'payroll.run.approve',
} as const;

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');
/** a pay month as YYYY-MM */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a month (YYYY-MM)');
const Money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'an amount in rupees with up to 2 decimals');
const Days = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'days with up to 2 decimals');
const Hours = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'hours with up to 2 decimals');
const Reason = z.string().trim().min(3).max(200);
const Paging = {
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
};

export const MonthQuerySchema = z.object({ month: Month });
export class MonthQueryDto extends createZodDto(MonthQuerySchema) {}

// ---- attendance for payroll --------------------------------------------------------------------------------
export const AttendanceListSchema = z.object({
  month: Month,
  q: z.string().trim().max(60).optional(),
  show: z.enum(['all', 'missing', 'open', 'finalised', 'manual', 'warnings']).default('all'),
  ...Paging,
});
export class AttendanceListDto extends createZodDto(AttendanceListSchema) {}

export const PullSchema = z.object({
  month: Month,
  /** only these employees (empty: everyone not finalised) */
  employeeIds: z.array(Id).max(2000).optional(),
});
export class PullDto extends createZodDto(PullSchema) {}

export const ManualAttendanceSchema = z.object({
  month: Month,
  presentDays: Days.nullable().optional(),
  paidLeaveDays: Days.nullable().optional(),
  lopDays: Days,
  otHours: Hours.nullable().optional(),
  reason: Reason,
});
export class ManualAttendanceDto extends createZodDto(ManualAttendanceSchema) {}

export const MarkPresentSchema = z.object({
  month: Month,
  reason: Reason,
  /** everyone else not finalised is marked present for the whole month */
  exceptions: z
    .array(
      z.object({
        employeeId: Id,
        lopDays: Days.nullable().optional(),
        paidLeaveDays: Days.nullable().optional(),
        otHours: Hours.nullable().optional(),
      }),
    )
    .max(2000)
    .default([]),
  dryRun: z.boolean().default(true),
});
export class MarkPresentDto extends createZodDto(MarkPresentSchema) {}

export const UnfinaliseSchema = z.object({ month: Month, reason: Reason });
export class UnfinaliseDto extends createZodDto(UnfinaliseSchema) {}

export const AttendanceImportSchema = z.object({
  month: Month,
  file: z.string().min(10).max(8_000_000),
  reason: Reason,
  dryRun: z.boolean().default(true),
});
export class AttendanceImportDto extends createZodDto(AttendanceImportSchema) {}

// ---- salary hold and a typed month's tax ------------------------------------------------------------------------
export const HoldSchema = z.object({
  month: Month,
  employeeId: Id,
  mode: z.enum(['HOLD', 'SKIP']),
  reason: Reason,
});
export class HoldDto extends createZodDto(HoldSchema) {}
export const LiftSchema = z.object({ reason: Reason });
export class LiftDto extends createZodDto(LiftSchema) {}

export const TdsManualSchema = z.object({
  month: Month,
  employeeId: Id,
  itAmount: Money,
  cessAmount: Money,
  reason: Reason,
});
export class TdsManualDto extends createZodDto(TdsManualSchema) {}

// ---- loans and advances ---------------------------------------------------------------------------------------
const LoanTerms = {
  principal: Money,
  emi: Money,
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,3})?$/, 'a year’s per cent (9.5)')
    .default('0'),
  method: z.enum(['NONE', 'FLAT', 'REDUCING']).default('NONE'),
  startMonth: Month,
};
export const LoanScheduleSchema = z.object(LoanTerms);
export class LoanScheduleDto extends createZodDto(LoanScheduleSchema) {}
export const LoanSchema = z.object({
  ...LoanTerms,
  employeeId: Id,
  loanType: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_ ]{0,39}$/, 'a kind of loan (ADVANCE, FESTIVAL, LOAN …)'),
  remarks: z.string().trim().max(300).nullable().optional(),
});
export class LoanDto extends createZodDto(LoanSchema) {}
export const LoanStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'HOLD', 'CLOSED']),
  reason: Reason,
});
export class LoanStatusDto extends createZodDto(LoanStatusSchema) {}
export const LoanListSchema = z.object({
  status: z.enum(['all', 'ACTIVE', 'HOLD', 'CLOSED']).default('ACTIVE'),
  q: z.string().trim().max(60).optional(),
  ...Paging,
});
export class LoanListDto extends createZodDto(LoanListSchema) {}

// ---- one-off items and fee recovery ------------------------------------------------------------------------------
export const AdhocListSchema = z.object({
  month: Month,
  q: z.string().trim().max(60).optional(),
  ...Paging,
});
export class AdhocListDto extends createZodDto(AdhocListSchema) {}
export const AdhocSchema = z.object({
  month: Month,
  employeeId: Id,
  payHeadId: Id,
  amount: Money,
  remarks: z.string().trim().min(3).max(200),
});
export class AdhocDto extends createZodDto(AdhocSchema) {}

export const WardLinkSchema = z.object({ employeeId: Id, studentId: Id });
export class WardLinkDto extends createZodDto(WardLinkSchema) {}
export const EmployeeQuerySchema = z.object({ employeeId: Id });
export class EmployeeQueryDto extends createZodDto(EmployeeQuerySchema) {}
export const FeeRecoverySchema = z.object({
  month: Month,
  employeeId: Id,
  /** the deduction head (WARDFEE) */
  payHeadId: Id,
  /** the dues picked: a child and a due date */
  items: z
    .array(z.object({ studentId: Id, dueOn: Day }))
    .min(1)
    .max(60),
});
export class FeeRecoveryDto extends createZodDto(FeeRecoverySchema) {}

// ---- recurring deductions and payees ---------------------------------------------------------------------------------
export const PayeeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  partyType: z.enum(['LIC', 'SOCIETY', 'UNION', 'COURT', 'OTHER']),
  payeeAccount: z.string().trim().max(80).nullable().optional(),
  remarks: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().default(true),
});
export class PayeeDto extends createZodDto(PayeeSchema) {}
export const RecurringSchema = z.object({
  employeeId: Id,
  payHeadId: Id,
  payeeId: Id.nullable().optional(),
  amount: Money,
  referenceNo: z.string().trim().max(60).nullable().optional(),
  startMonth: Month,
  endMonth: Month.nullable().optional(),
  remarks: z.string().trim().max(200).nullable().optional(),
});
export class RecurringDto extends createZodDto(RecurringSchema) {}
export const RecurringStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'HOLD', 'ENDED']),
  /** the last month deducted, when ending (default: the month before the next open one) */
  endMonth: Month.nullable().optional(),
  reason: Reason,
});
export class RecurringStatusDto extends createZodDto(RecurringStatusSchema) {}
export const RecurringListSchema = z.object({
  status: z.enum(['all', 'ACTIVE', 'HOLD', 'ENDED']).default('ACTIVE'),
  q: z.string().trim().max(60).optional(),
  payeeId: Id.optional(),
  ...Paging,
});
export class RecurringListDto extends createZodDto(RecurringListSchema) {}

// ---- claims --------------------------------------------------------------------------------------------------------
export const ClaimSchema = z.object({
  employeeId: Id,
  payHeadId: Id,
  amountClaimed: Money,
  billDate: Day.nullable().optional(),
  description: z.string().trim().min(3).max(300),
  proofFileId: Id.nullable().optional(),
});
export class ClaimDto extends createZodDto(ClaimSchema) {}
export const ClaimDecideSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    amountApproved: Money.nullable().optional(),
    payMonth: Month.nullable().optional(),
    remark: z.string().trim().max(300).nullable().optional(),
  })
  .refine((d) => d.decision === 'REJECTED' || (!!d.amountApproved && !!d.payMonth), {
    message: 'An approved claim needs the amount and the month it is paid in',
  })
  .refine((d) => d.decision === 'APPROVED' || (d.remark ?? '').length >= 3, {
    message: 'Say why the claim is rejected',
    path: ['remark'],
  });
export class ClaimDecideDto extends createZodDto(ClaimDecideSchema) {}
export const ClaimListSchema = z.object({
  status: z.enum(['all', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID']).default('SUBMITTED'),
  q: z.string().trim().max(60).optional(),
  ...Paging,
});
export class ClaimListDto extends createZodDto(ClaimListSchema) {}

// ---- overtime ------------------------------------------------------------------------------------------------------
export const OvertimeSchema = z.object({
  month: Month,
  employeeId: Id,
  basis: z.enum(['DAY', 'HOUR']),
  qty: Hours,
  /** paid instead of the derived amount, with a reason */
  amount: Money.nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
});
export class OvertimeDto extends createZodDto(OvertimeSchema) {}
