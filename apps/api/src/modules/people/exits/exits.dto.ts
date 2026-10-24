import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Code = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

const Approvers = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('office') }),
      z.object({ kind: z.literal('hod') }),
      z.object({ kind: z.literal('role'), code: z.string().trim().min(2).max(40) }),
      z.object({ kind: z.literal('user'), userId: Id }),
    ]),
  )
  .min(1)
  .max(10);

export const EMPLOYEE_TYPES = ['teaching', 'non_teaching', 'contract', 'visiting'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const ExitSetupSchema = z.object({
  types: z
    .array(
      z.object({
        code: Code,
        name: z.string().trim().min(2).max(80),
        staffMayApply: z.boolean().default(false),
        noticeApplies: z.boolean().default(false),
        active: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(20),
  noticeDays: z.record(z.enum(EMPLOYEE_TYPES), z.number().int().min(0).max(365)),
  departments: z
    .array(
      z.object({
        code: Code,
        name: z.string().trim().min(2).max(80),
        auto: z.enum(['library', 'assets']).nullable().default(null),
        active: z.boolean().default(true),
        /** Who clears it: the office, the employee's HOD, a role, or named users. */
        approvers: Approvers.default([{ kind: 'office' }]),
      }),
    )
    .max(20),
  /** Who approves the full and final statement (the principal by default). */
  fnfApprovers: Approvers.optional(),
});
export class ExitSetupDto extends createZodDto(ExitSetupSchema) {}

export const ExitApprovalSchema = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        by: z.enum(['employees', 'designation', 'hod', 'manager', 'role']),
        employeeIds: z.array(Id).max(30).default([]),
        designation: z.string().trim().max(80).optional(),
        roleCode: z.string().trim().max(40).optional(),
        slaHours: z.number().int().min(1).max(720).nullable().optional(),
      }),
    )
    .min(1)
    .max(6),
});
export class ExitApprovalDto extends createZodDto(ExitApprovalSchema) {}

const ExitFields = {
  exitType: Code,
  reason: z.string().trim().min(3).max(1000),
  letterFileId: Id.nullable().optional(),
  requestedOn: Day.optional(),
  proposedLastDay: Day.optional(),
};

/** The office creates an exit on an employee's behalf (any type). */
export const ExitCreateSchema = z.object({ employeeId: Id, ...ExitFields });
export class ExitCreateDto extends createZodDto(ExitCreateSchema) {}

/** The employee's own resignation (a type the staff may apply for). */
export const MyExitSchema = z.object(ExitFields);
export class MyExitDto extends createZodDto(MyExitSchema) {}

/** A request sent back is changed and sent again. */
export const ExitEditSchema = z.object({
  reason: z.string().trim().min(3).max(1000).optional(),
  letterFileId: Id.nullable().optional(),
  proposedLastDay: Day.optional(),
});
export class ExitEditDto extends createZodDto(ExitEditSchema) {}

export const ExitDecisionSchema = z.object({
  note: z.string().trim().max(500).optional(),
  /** approve: the last working day the school accepts (the proposed one by default). */
  acceptedLastDay: Day.optional(),
  /** approve: the notice shortfall is not held against the employee. */
  waiveNotice: z.boolean().optional(),
});
export class ExitDecisionDto extends createZodDto(ExitDecisionSchema) {}

export const ExitListSchema = z.object({
  status: z.enum(['pending', 'sent_back', 'approved', 'rejected', 'withdrawn', 'closed']).optional(),
  q: z.string().trim().max(80).optional(),
});
export class ExitListDto extends createZodDto(ExitListSchema) {}

export const ExitWithdrawSchema = z.object({ reason: z.string().trim().max(500).optional() });
export class ExitWithdrawDto extends createZodDto(ExitWithdrawSchema) {}

/** A department clears an exit, noting the dues (0 when nothing is owed). */
export const ClearSchema = z.object({
  dues: z.number().min(0).max(10_000_000).default(0),
  note: z.string().trim().max(500).optional(),
});
export class ClearDto extends createZodDto(ClearSchema) {}

export const ReopenSchema = z.object({ reason: z.string().trim().max(500).optional() });
export class ReopenDto extends createZodDto(ReopenSchema) {}

/** The full and final statement as accounts types it (the clearance dues are added by the system). */
export const FnfLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        kind: z.enum(['earning', 'deduction']),
        code: Code,
        label: z.string().trim().min(2).max(80),
        amount: z.number().min(0).max(100_000_000),
        note: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .max(40),
});
export class FnfLinesDto extends createZodDto(FnfLinesSchema) {}

export const FnfDecisionSchema = z.object({ note: z.string().trim().max(500).optional() });
export class FnfDecisionDto extends createZodDto(FnfDecisionSchema) {}

export const FnfPaidSchema = z.object({
  paidOn: Day.optional(),
  mode: z.string().trim().min(2).max(40),
  reference: z.string().trim().max(80).optional(),
});
export class FnfPaidDto extends createZodDto(FnfPaidSchema) {}

/** The leaving date: the accepted last working day by default; not later than today. */
export const CloseSchema = z.object({ leftOn: Day.optional() });
export class CloseDto extends createZodDto(CloseSchema) {}

export const RegisterSchema = z.object({
  from: Day.optional(),
  to: Day.optional(),
  exitType: Code.optional(),
});
export class RegisterDto extends createZodDto(RegisterSchema) {}
