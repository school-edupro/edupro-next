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
    /** a new group rule placed in the order for you: just above the catch-all "all staff, any type" rule */
    place: z.enum(['auto']).optional(),
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
        need: z.enum(['any', 'all']).default('any'),
      }),
    )
    .max(3, 'Up to 3 levels'),
});
export class BandLevelsDto extends createZodDto(BandLevelsSchema) {}

/** A group rule one place up or down in the order the rules are checked. */
export const MoveRuleSchema = z.object({ direction: z.enum(['up', 'down']) });
export class MoveRuleDto extends createZodDto(MoveRuleSchema) {}

export const RuleStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export class RuleStatusDto extends createZodDto(RuleStatusSchema) {}

/** "Who approves" by employee: each employee's approvers as the rules give them, a page at a time. */
export const ApproversByEmployeeSchema = z.object({
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(100).optional(),
  /** only the employees with a rule of their own */
  own: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((v) => [25, 50, 100, 500].includes(v), '25, 50, 100 or 500 a page')
    .default(50),
});
export class ApproversByEmployeeDto extends createZodDto(ApproversByEmployeeSchema) {}

/** An employee's own rule (made from the approvers they have now when there is none yet). */
export const OwnRuleSchema = z.object({
  employeeId: Id,
  kind: z.enum(['leave', 'regularisation']),
});
export class OwnRuleDto extends createZodDto(OwnRuleSchema) {}

/** Approvers by employee from Excel: checked first (dryRun), then saved as the employees' own rules. */
export const ApproversImportSchema = z.object({
  file: z.string().min(10).max(6_000_000),
  dryRun: z.boolean().default(true),
});
export class ApproversImportDto extends createZodDto(ApproversImportSchema) {}

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

/** A From–To range on a list (either end may be left open); From may not be after To. */
const range = <T extends { from?: string; to?: string }>(d: T) =>
  !d.from || !d.to || d.from <= d.to;
const RANGE_MSG = { message: 'From must be on or before To', path: ['to'] };

/** My leave: a page of it, the leave touching From–To (docs/design/85, "the three tabs as the old screen"). */
export const MineQuerySchema = z
  .object({ ...Page, size: Page.size.default(25), from: Day.optional(), to: Day.optional() })
  .refine(range, RANGE_MSG);
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
  format: z.enum(['xlsx', 'pdf']).optional(),
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

// ---- phase C: staff attendance ---------------------------------------------------------------------------
const Month = z.string().regex(/^\d{4}-\d{2}$/);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a 24-hour time like 08:05');

export const RegisterMonthSchema = z.object({
  month: Month.optional(),
  department: z.string().trim().max(100).optional(),
  employeeId: Id.optional(),
  q: z.string().trim().max(80).optional(),
  /** staff with a day of this code in the month: P, A, HD, WO, H, HOLD, LOP, a leave code, late, missing, manual */
  status: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,20}$/)
    .optional(),
  /** 1: the staff not required in the reports too */
  all: z.enum(['0', '1']).optional(),
  format: z.enum(['xlsx']).optional(),
  ...Page,
});
export class RegisterMonthDto extends createZodDto(RegisterMonthSchema) {}

/**
 * My team's attendance: all my reportees as a grid (a column a day, up to 31 days), or one of them day by
 * day (up to 92 days); From–To, or the month as before; Excel or PDF.
 */
export const TeamAttendanceSchema = z
  .object({
    month: Month.optional(),
    from: Day.optional(),
    to: Day.optional(),
    employeeId: Id.optional(),
    ...Page,
    format: z.enum(['xlsx', 'pdf']).optional(),
  })
  .refine(range, RANGE_MSG);
export class TeamAttendanceDto extends createZodDto(TeamAttendanceSchema) {}

export const DayCorrectSchema = z.object({
  employeeId: Id,
  day: Day,
  /** empty: worked out from the times */
  dayType: z.enum(['P', 'HD', 'A', 'WO', 'H', 'HOLD']).nullable().optional(),
  in: Time.nullable().optional(),
  out: Time.nullable().optional(),
  reason: z.string().trim().min(3).max(300),
  /** yes, a weekly off or holiday becomes absent */
  confirmOff: z.boolean().optional(),
});
export class DayCorrectDto extends createZodDto(DayCorrectSchema) {}

/** Bulk update: one status for many employees (or a department) over a few days, with the reason. */
export const BulkDaysSchema = z
  .object({
    employeeIds: z.array(Id).max(500).optional(),
    department: z.string().trim().min(1).max(100).optional(),
    from: Day,
    to: Day,
    dayType: z.enum(['P', 'A', 'HD', 'WO', 'H']),
    reason: z.string().trim().min(3).max(300),
    confirmOff: z.boolean().optional(),
  })
  .refine((d) => (d.employeeIds?.length ?? 0) > 0 || !!d.department, {
    message: 'Pick the employees or a department',
    path: ['employeeIds'],
  })
  .refine((d) => d.from <= d.to, { message: 'From must be on or before To', path: ['to'] })
  .refine((d) => (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000 < 62, {
    message: 'At most 62 days at once',
    path: ['to'],
  });
export class BulkDaysDto extends createZodDto(BulkDaysSchema) {}

export const RegulariseSchema = z
  .object({
    day: Day,
    in: Time.nullable().optional(),
    out: Time.nullable().optional(),
    dayType: z.enum(['P', 'HD', 'A', 'WO', 'H']).nullable().optional(),
    reason: z.string().trim().min(3).max(500),
    documentFileId: Id.nullable().optional(),
  })
  .refine((r) => r.in || r.out || r.dayType, {
    message: 'Give the IN or OUT time (or what the day was)',
    path: ['in'],
  });
export class RegulariseDto extends createZodDto(RegulariseSchema) {}

export const MyMonthSchema = z.object({ month: Month.optional() });
export class MyMonthDto extends createZodDto(MyMonthSchema) {}

export const ExceptionsSchema = z.object({
  month: Month.optional(),
  kind: z.enum(['late', 'missing', 'regularisation']).default('late'),
  status: z.string().trim().max(20).optional(),
  employeeId: Id.optional(),
  department: z.string().trim().max(100).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
  ...Page,
});
export class ExceptionsDto extends createZodDto(ExceptionsSchema) {}

export const LockSchema = z.object({
  month: Month,
  reason: z.string().trim().max(300).default(''),
});
export class LockDto extends createZodDto(LockSchema) {}

export const RunSchema = z.object({
  what: z.enum(['sync', 'nightly', 'recompute', 'deduct']),
  from: Day.optional(),
  to: Day.optional(),
  month: Month.optional(),
});
export class RunDto extends createZodDto(RunSchema) {}

export const TimingSchema = z
  .object({
    kind: z.enum(['department', 'special']),
    department: z.string().trim().max(100).nullable().optional(),
    employeeId: Id.nullable().optional(),
    from: Day.nullable().optional(),
    to: Day.nullable().optional(),
    startsAt: Time,
    endsAt: Time,
    grace: z.number().int().min(0).max(240),
    presentHours: z.number().min(0).max(24),
    halfDayHours: z.number().min(0).max(24),
    lateOver: z.number().int().min(1).max(720).nullable().optional(),
    lateAction: z.enum(['none', 'HD', 'A', 'leave']).default('none'),
    lateTypeId: Id.nullable().optional(),
    earlyOver: z.number().int().min(1).max(720).nullable().optional(),
    earlyAction: z.enum(['none', 'HD', 'A', 'leave']).default('none'),
    earlyTypeId: Id.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    /** a new special timing for several employees at once (the same dates and hours) */
    employeeIds: z.array(Id).max(1000).optional(),
    /**
     * changing a department timing in force: the change applies from this day (the version ends the day
     * before and a new one starts); empty or on / before its own start: the version itself is changed
     */
    applyFrom: Day.nullable().optional(),
  })
  .refine(
    (t) =>
      t.kind === 'department'
        ? !!t.department
        : !!((t.employeeId || t.employeeIds?.length) && t.from && t.to),
    {
      message:
        'A department timing names the department; a special timing the employee(s) and the dates',
      path: ['kind'],
    },
  )
  .refine((t) => !(t.from && t.to) || t.to >= t.from, {
    message: 'The To date is before the From date',
    path: ['to'],
  });
export class TimingDto extends createZodDto(TimingSchema) {}

/** The timing change log, a page at a time, filtered; Excel or PDF of the same. */
export const TimingLogSchema = z.object({
  kind: z.enum(['department', 'special']).optional(),
  /** the history of one department's timings (all its versions) */
  department: z.string().trim().max(100).optional(),
  /** the history of one timing */
  timingId: Id.optional(),
  q: z.string().trim().max(80).optional(),
  from: Day.optional(),
  to: Day.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((v) => [25, 50, 100, 500].includes(v), '25, 50, 100 or 500 a page')
    .default(50),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class TimingLogDto extends createZodDto(TimingLogSchema) {}

/** What the timing dialogs need: only the department timings, and the one being edited. */
export const TimingsQuerySchema = z.object({
  only: z.enum(['department']).optional(),
  id: Id.optional(),
});
export class TimingsQueryDto extends createZodDto(TimingsQuerySchema) {}

/** The timings list, a page at a time, filtered; Excel or PDF of the same. */
export const TimingListSchema = z.object({
  kind: z.enum(['department', 'special']).default('department'),
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(100).optional(),
  /** department timings: in force now and scheduled (the default), past ones, or all */
  when: z.enum(['now', 'past', 'all']).default('now'),
  /** special timings that cover any day from … to … */
  from: Day.optional(),
  to: Day.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((v) => [25, 50, 100, 500].includes(v), '25, 50, 100 or 500 a page')
    .default(50),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class TimingListDto extends createZodDto(TimingListSchema) {}

/**
 * Bulk edit of special timings: the ticked fields only, onto the special timings of exactly these dates
 * (existing), or onto every employee of a department (the missing ones made). dryRun checks and shows.
 */
export const TimingBulkSchema = z
  .object({
    scope: z.enum(['existing', 'department']),
    /** empty: all departments (only with existing) */
    department: z.string().trim().max(100).nullable().optional(),
    from: Day,
    to: Day,
    fields: z
      .object({
        startsAt: Time.optional(),
        endsAt: Time.optional(),
        grace: z.number().int().min(0).max(240).optional(),
        presentHours: z.number().min(0).max(24).optional(),
        halfDayHours: z.number().min(0).max(24).optional(),
        note: z.string().trim().max(200).nullable().optional(),
      })
      .default({}),
    dryRun: z.boolean().default(true),
  })
  .refine((b) => b.to >= b.from, { message: 'The To date is before the From date', path: ['to'] })
  .refine((b) => b.scope === 'existing' || !!b.department, {
    message: 'Pick the department whose employees get the timing',
    path: ['department'],
  })
  .refine((b) => b.dryRun || Object.keys(b.fields).length > 0, {
    message: 'Tick at least one field to change',
    path: ['fields'],
  });
export class TimingBulkDto extends createZodDto(TimingBulkSchema) {}

export const SheetSchema = z.object({
  file: z.string().min(10).max(4_000_000),
  dryRun: z.boolean().default(true),
});
export class SheetDto extends createZodDto(SheetSchema) {}

// ---- phase D: the reports ----------------------------------------------------------------------------------
export const LEAVE_REPORT_CODES = [
  'daily',
  'in_out',
  'monthly_summary',
  'monthly_employee',
  'monthly_register',
  'card',
  'shift_roster',
  'basic_work',
  'monthly_cumulative',
  'annual',
  'employee_yearly',
  'year_on_year',
  'late_arrival',
  'early_going',
  'forgot_punch',
  'leave_availed',
  'leave_deduction',
  'balance_as_on',
  'opening_closing',
] as const;
export type LeaveReport = (typeof LEAVE_REPORT_CODES)[number];

export const LeaveReportQuerySchema = z.object({
  day: Day.optional(),
  from: Day.optional(),
  to: Day.optional(),
  month: Month.optional(),
  fromMonth: Month.optional(),
  toMonth: Month.optional(),
  department: z.string().trim().max(100).optional(),
  employeeType: z.string().trim().max(40).optional(),
  employeeId: Id.optional(),
  typeId: Id.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'cancelled', 'all']).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class LeaveReportQueryDto extends createZodDto(LeaveReportQuerySchema) {}

export const ReportAccessSchema = z.object({ userIds: z.array(Id).max(200) });
export class ReportAccessDto extends createZodDto(ReportAccessSchema) {}

// ---- phase E: moving from the old module -------------------------------------------------------------------
export const CutoverSettingsSchema = z.object({
  parallelMonth: Month,
  freezeOn: Day.nullable().optional(),
});
export class CutoverSettingsDto extends createZodDto(CutoverSettingsSchema) {}

// ---- the shift calendar ---------------------------------------------------------------------------------
const PageSize = z.coerce
  .number()
  .int()
  .refine((v) => [25, 50, 100, 500].includes(v), '25, 50, 100 or 500 a page')
  .default(50);

/** A month of who works which shift, a page of employees at a time; Excel or PDF of the same. */
export const ShiftCalendarSchema = z.object({
  month: Month.optional(),
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(100).optional(),
  /** employees working this shift on some day of the month */
  shiftId: Id.optional(),
  /** only the employees with no shift posted for any day of the month (they work the default shift) */
  unposted: z
    .enum(['1', 'true'])
    .transform(() => true)
    .optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: PageSize,
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class ShiftCalendarDto extends createZodDto(ShiftCalendarSchema) {}

/**
 * Post a shift to employees from a day (to a day; none: until changed). One day (from = to) changes that
 * day only. What is posted inside those days already gives way; dryRun shows what would change.
 */
export const ShiftAssignSchema = z
  .object({
    employeeIds: z.array(Id).min(1).max(2000),
    shiftId: Id,
    from: Day,
    to: Day.nullable().optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((v) => !v.to || v.to >= v.from, {
    message: 'the To date is on or after the From date',
    path: ['to'],
  });
export class ShiftAssignDto extends createZodDto(ShiftAssignSchema) {}

/** Take a day back to the shift around it: the one-day posting of that day is removed. */
export const ShiftClearDaySchema = z.object({ employeeId: Id, day: Day });
export class ShiftClearDayDto extends createZodDto(ShiftClearDaySchema) {}

/**
 * Copy a month's posted shifts onto another month, date for date, for the employees of the filter (or
 * those named). Employees with a shift already posted in the target month are left as they are.
 */
export const ShiftCopySchema = z
  .object({
    source: Month,
    target: Month,
    q: z.string().trim().max(80).optional(),
    department: z.string().trim().max(100).optional(),
    employeeIds: z.array(Id).max(2000).optional(),
    dryRun: z.boolean().default(true),
  })
  .refine((v) => v.source !== v.target, { message: 'copy onto another month', path: ['target'] });
export class ShiftCopyDto extends createZodDto(ShiftCopySchema) {}

/** The shift posting change log. */
export const ShiftLogSchema = z.object({
  q: z.string().trim().max(80).optional(),
  department: z.string().trim().max(100).optional(),
  employeeId: Id.optional(),
  from: Day.optional(),
  to: Day.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: PageSize,
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class ShiftLogDto extends createZodDto(ShiftLogSchema) {}

// ---- My leave as one page: the reporties' leave, the downloads ---------------------------------------
/** The leave of the staff reporting to me that touches a month, a page at a time; Excel or PDF. */
/**
 * Reporties leave: `waiting` is everything at my approval level (anyone's), the other statuses my
 * reportees' leave; the leave touching From–To (or the month, as before).
 */
export const TeamLeaveSchema = z
  .object({
    month: Month.optional(),
    from: Day.optional(),
    to: Day.optional(),
    employeeId: Id.optional(),
    leaveTypeId: Id.optional(),
    status: z
      .enum(['waiting', 'pending', 'approved', 'rejected', 'withdrawn', 'cancelled'])
      .optional(),
    q: z.string().trim().max(80).optional(),
    ...Page,
    size: Page.size.default(25),
    format: z.enum(['xlsx', 'pdf']).optional(),
  })
  .refine(range, RANGE_MSG);
export class TeamLeaveDto extends createZodDto(TeamLeaveSchema) {}

/** My leave or my month's attendance as a file. */
export const MyFileSchema = z
  .object({
    month: Month.optional(),
    from: Day.optional(),
    to: Day.optional(),
    format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  })
  .refine(range, RANGE_MSG);
export class MyFileDto extends createZodDto(MyFileSchema) {}
