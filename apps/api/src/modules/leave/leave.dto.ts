import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LEAVE = {
  setupView: 'leave.setup.view',
  setupManage: 'leave.setup.manage',
} as const;

export const SCOPES = ['all', 'department', 'designation', 'employee_type', 'employee'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * The day bands of a leave approval rule (legacy "approval strategy"): up to 7 days, more than 7 up to 30,
 * more than 30 up to 365. At a boundary the lower band wins (7 days → the first band).
 */
export const BANDS = [
  { from: 0, to: 7, label: 'Up to 7 days' },
  { from: 7, to: 30, label: 'More than 7, up to 30 days' },
  { from: 30, to: 365, label: 'More than 30 days' },
] as const;
/** a regularisation (attendance correction) has one chain */
export const REG_BAND = { from: 0, to: 999, label: 'Every correction' } as const;

/** A rule's who and what: the bands' levels are set one band at a time. */
export const ApprovalRuleSchema = z
  .object({
    kind: z.enum(['leave', 'regularisation']),
    name: z.string().trim().min(2).max(100),
    scope: z.enum(SCOPES),
    scopeValues: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    leaveTypeId: Id.nullable().optional(),
    priority: z.number().int().min(1).max(9999).default(100),
  })
  .refine((r) => r.scope === 'all' || r.scopeValues.length > 0, {
    message: 'Name the departments, designations, employee types or employees the rule is for',
    path: ['scopeValues'],
  });
export class ApprovalRuleDto extends createZodDto(ApprovalRuleSchema) {}

export const BandLevelsSchema = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        by: z.enum(['employees', 'designation', 'hod', 'manager', 'role']),
        employeeIds: z.array(Id).max(30).default([]),
        designation: z.string().trim().max(80).nullable().optional(),
        roleCode: z.string().trim().max(40).nullable().optional(),
        slaHours: z.number().int().min(1).max(720).nullable().optional(),
      }),
    )
    .max(3, 'Up to 3 levels'),
});
export class BandLevelsDto extends createZodDto(BandLevelsSchema) {}

export const RuleStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export class RuleStatusDto extends createZodDto(RuleStatusSchema) {}

export const ChainPreviewSchema = z.object({
  employeeId: Id,
  kind: z.enum(['leave', 'regularisation']).default('leave'),
  leaveTypeId: Id.optional(),
  days: z.coerce.number().min(0.5).max(365).default(1),
});
export class ChainPreviewDto extends createZodDto(ChainPreviewSchema) {}

export const LeaveSettingsSchema = z.object({
  lateMarksPerLeave: z.number().int().min(1).max(10),
  missingPunchesPerLeave: z.number().int().min(1).max(10),
  lopAfterDays: z.number().int().min(0).max(60),
  punchGapMinutes: z.number().int().min(1).max(120),
  recheckDays: z.number().int().min(1).max(60),
  absentLookbackDays: z.number().int().min(1).max(62),
  exceptionsFrom: Day.nullable(),
  defaultShiftId: Id.nullable(),
  lateReducesHours: z.boolean(),
  allowTimeEdit: z.boolean(),
  allowOnBehalf: z.boolean(),
  backdateDays: z.number().int().min(0).max(366).nullable(),
  missingPunchCc: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) =>
        !v ||
        v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)),
      'E-mail addresses, comma-separated',
    )
    .nullable(),
  deviceSerials: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(60)
        .regex(/^[\w.-]+$/),
    )
    .max(50),
  sendEmail: z.boolean(),
  sendWhatsapp: z.boolean(),
  sendApp: z.boolean(),
  sendSms: z.boolean(),
});
export class LeaveSettingsDto extends createZodDto(LeaveSettingsSchema) {}

// ---- phase B: applying, deciding, cancelling, balances --------------------------------------------------
export const LEAVE_OWN = 'leave.own.apply';
export const LEAVE_OFFICE = 'leave.office.manage';

const ApplyFields = {
  leaveTypeId: Id,
  from: Day,
  to: Day,
  halfDay: z.boolean().default(false),
  session: z.enum(['first', 'second']).nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
  documentFileId: Id.nullable().optional(),
  /** the sandwich across two leaves (the bridge) was shown and accepted */
  bridgeOk: z.boolean().default(false),
  /** a balance too short: the paid part + loss of pay was shown and accepted */
  splitOk: z.boolean().default(false),
};
export const ApplySchema = z.object(ApplyFields);
export class ApplyDto extends createZodDto(ApplySchema) {}

/** The office applies for an employee: approved at once, replacing leave already on those days. */
export const OnBehalfSchema = z.object({ ...ApplyFields, employeeId: Id });
export class OnBehalfDto extends createZodDto(OnBehalfSchema) {}

export const DecideSchema = z
  .object({
    outcome: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).default(''),
  })
  .refine((d) => d.outcome === 'approved' || d.note.length >= 3, {
    message: 'Say why it is not approved',
    path: ['note'],
  });
export class DecideDto extends createZodDto(DecideSchema) {}

export const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const WithdrawSchema = z.object({ reason: z.string().trim().max(500).default('') });
export class WithdrawDto extends createZodDto(WithdrawSchema) {}

export const OverrideSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(400),
});
export class OverrideDto extends createZodDto(OverrideSchema) {}

export const TrimSchema = z.object({
  from: Day,
  to: Day,
  reason: z.string().trim().min(3).max(400),
});
export class TrimDto extends createZodDto(TrimSchema) {}

const Page = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((v) => [25, 50, 100].includes(v), '25, 50 or 100 a page')
    .default(50),
};
export const RegisterQuerySchema = z.object({
  leaveTypeId: Id.optional(),
  employeeId: Id.optional(),
  department: z.string().trim().max(100).optional(),
  from: Day.optional(),
  to: Day.optional(),
  source: z.enum(['self', 'on_behalf', 'system']).optional(),
  /** the figure clicked: pending, waiting at L2, at L3+, approved, rejected, cancelled, withdrawn, loss of pay */
  bucket: z
    .enum(['pending', 'l1', 'l2', 'approved', 'rejected', 'cancelled', 'withdrawn', 'lop'])
    .optional(),
  q: z.string().trim().max(80).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
  ...Page,
});
export class RegisterQueryDto extends createZodDto(RegisterQuerySchema) {}

export const MineQuerySchema = z.object({ ...Page, size: Page.size.default(25) });
export class MineQueryDto extends createZodDto(MineQuerySchema) {}

export const BalanceQuerySchema = z.object({
  employeeId: Id.optional(),
  leaveTypeId: Id.optional(),
  department: z.string().trim().max(100).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(80).optional(),
  ...Page,
});
export class BalanceQueryDto extends createZodDto(BalanceQuerySchema) {}

export const AdjustSchema = z.object({
  employeeId: Id,
  leaveTypeId: Id,
  days: z
    .number()
    .min(-999)
    .max(999)
    .refine((v) => v !== 0, 'Give the days to add (or take off with a minus)'),
  reason: z.string().trim().min(3).max(200),
});
export class AdjustDto extends createZodDto(AdjustSchema) {}

export const BalanceImportSchema = z.object({
  file: z.string().min(10).max(4_000_000),
  dryRun: z.boolean().default(true),
});
export class BalanceImportDto extends createZodDto(BalanceImportSchema) {}
