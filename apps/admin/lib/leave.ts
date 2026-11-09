/** Staff leave and attendance (docs/design/85): the shapes the admin pages read. */
import type { ApprovalLevel } from './recruitment';

export type LeaveScope = 'all' | 'department' | 'designation' | 'employee_type' | 'employee';
export const SCOPE_LABEL: Record<LeaveScope, string> = {
  all: 'All staff',
  department: 'Departments',
  designation: 'Designations',
  employee_type: 'Employee types',
  employee: 'Employees',
};

export interface LeaveOverview {
  counts: {
    types: number;
    policies: number;
    weekoffs: number;
    shifts: number;
    postings: number;
    timings: number;
    leaveRules: number;
    regRules: number;
    staff: number;
    noApprover: number;
    holidays: number;
  };
  types: Array<{
    id: string;
    code: string;
    name: string;
    keepsBalance: boolean;
    lossOfPay: boolean;
    autoApprove: boolean;
    deductOrder: number | null;
    policies: number;
    uncovered: number;
  }>;
  warnings: string[];
  can: { manage: boolean };
}

export interface ApprovalRule {
  id: string;
  kind: 'leave' | 'regularisation';
  name: string;
  scope: LeaveScope;
  scopeWords: string;
  scopeValues: string[];
  leaveType: { id: string; code: string; name: string } | null;
  priority: number;
  status: 'active' | 'inactive';
  bands: Array<{ label: string; levels: string[] }>;
}

export interface ApprovalRules {
  rules: ApprovalRule[];
  types: Array<{ id: string; code: string; name: string; auto: boolean }>;
  staff: Array<{ id: string; code: string; name: string }>;
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  bands: string[];
  can: { manage: boolean };
}

export interface ApprovalRuleDetail {
  rule: ApprovalRule;
  bands: Array<{ index: number; label: string; levels: ApprovalLevel[] }>;
  staff: Array<{
    id: string;
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    signsIn: boolean;
  }>;
  designations: Array<{ name: string; holders: number }>;
  departments: Array<{
    name: string;
    hod: { code: string; name: string; signsIn: boolean } | null;
  }>;
  roles: Array<{ code: string; name: string }>;
  can: { manage: boolean };
}

export interface ChainPreview {
  employee: string;
  band: string;
  rule: { id: string; name: string } | null;
  levels: Array<{ name: string; people: string[]; note: string | null }>;
  note: string | null;
}

export interface LeaveSettings {
  settings: {
    lateMarksPerLeave: number;
    missingPunchesPerLeave: number;
    lopAfterDays: number;
    punchGapMinutes: number;
    recheckDays: number;
    absentLookbackDays: number;
    exceptionsFrom: string | null;
    defaultShiftId: string | null;
    lateReducesHours: boolean;
    allowTimeEdit: boolean;
    allowOnBehalf: boolean;
    backdateDays: number | null;
    missingPunchCc: string | null;
    deviceSerials: string[];
    sendEmail: boolean;
    sendWhatsapp: boolean;
    sendApp: boolean;
    sendSms: boolean;
    updatedAt: string;
  };
  shifts: Array<{ id: string; code: string; name: string }>;
  can: { manage: boolean };
}

// ---- phase B: requests, approvals, register, balances --------------------------------------------------
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
export const LEAVE_STATUS: Record<
  LeaveStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'info' }
> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export interface LeaveRequest {
  id: string;
  number: string;
  employee: { id: string; name: string; code: string; department: string | null };
  leaveType: { id: string; code: string; name: string; lossOfPay: boolean };
  from: string;
  to: string;
  days: number;
  halfDay: boolean;
  session: 'first' | 'second' | null;
  reason: string;
  documentFileId: string | null;
  status: LeaveStatus;
  source: string;
  sourceWords: string;
  appliedBy: string | null;
  linkedRequestId: string | null;
  lopPartId: string | null;
  note: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  cancelStatus: 'pending' | 'approved' | 'rejected' | null;
  cancelReason: string | null;
  edits: number;
  appliedAt: string;
  waitingWith: string | null;
  level: number | null;
  levels: number | null;
}

export interface LeaveStep {
  level: number;
  name: string;
  people: string[];
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  overdue: boolean;
}

export interface LeaveDetail extends LeaveRequest {
  lopPart: LeaveRequest | null;
  dayRows: LeaveDay[];
  approval: LeaveStep[];
  cancellation: LeaveStep[];
  changes: Array<{ from: string; to: string; reason: string; by: string | null; at: string }>;
  can: {
    withdraw: boolean;
    requestCancel: boolean;
    decide: boolean;
    decideCancel: boolean;
    cancel: boolean;
    override: boolean;
    trim: boolean;
  };
}
/** the detail's day rows (the API sends them as `days` beside the count) */
export interface LeaveDay {
  day: string;
  portion: number;
  session: 'first' | 'second' | null;
  kind: 'work' | 'weekoff' | 'holiday' | 'optional';
  status: LeaveStatus;
}

export interface MyLeave {
  employee: { id: string; name: string; code: string; department: string | null } | null;
  balances: Array<{
    typeId: string;
    code: string;
    name: string;
    available: number;
    held: number;
    policy: string | null;
  }>;
  types: LeaveFormType[];
  rows: LeaveRequest[];
  total: number;
  page: number;
  size: number;
  waiting: number;
  can: { apply: boolean; office: boolean };
}

export interface LeaveFormType {
  id: string;
  code: string;
  name: string;
  keepsBalance: boolean;
  halfDay: boolean;
  documentNeeded: boolean;
  maxDays: number | null;
  approvedAtOnce: boolean;
}

export type ApplyResult =
  | {
      ok: true;
      id: string;
      number: string;
      status: LeaveStatus;
      days: number;
      lopNumber?: string;
      note: string | null;
      replaced?: string[];
    }
  | {
      ok: 'confirm';
      kind: 'bridge' | 'split';
      message: string;
      documentFileId: string | null;
    }
  | { ok: false; error: string };

export interface LeaveRegister {
  figures: Record<
    'total' | 'pending' | 'l1' | 'l2' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn' | 'lop',
    number
  > & { fy: string };
  rows: LeaveRequest[];
  total: number;
  page: number;
  size: number;
  lists: {
    types: Array<{ id: string; name: string }>;
    employees: Array<{ id: string; name: string }>;
    departments: string[];
  };
}

export interface LeaveBalances {
  month: string;
  monthWords: string;
  current: boolean;
  rows: Array<{
    id: string;
    employee: { id: string; name: string; code: string; department: string | null };
    leaveType: { id: string; code: string; name: string };
    policy: string | null;
    month: string;
    opening: number;
    credited: number;
    held: number;
    correction: number;
    available: number;
    closing: number | null;
    lapsed: number;
    closed: boolean;
    trail: string[];
  }>;
  total: number;
  page: number;
  size: number;
  lists: {
    types: Array<{ id: string; name: string }>;
    employees: Array<{ id: string; name: string }>;
    departments: string[];
  };
}

export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '—';
export const leaveDates = (r: {
  from: string;
  to: string;
  halfDay: boolean;
  session: string | null;
}) =>
  `${dmy(r.from)}${r.to !== r.from ? ` to ${dmy(r.to)}` : ''}${r.halfDay ? ` (${r.session === 'first' ? 'first' : 'second'} half)` : ''}`;

// ---- phase C: staff attendance -------------------------------------------------------------------------
export interface AttendanceRegister {
  month: string;
  monthWords: string;
  dates: string[];
  types: string[];
  rows: Array<{
    employee: { id: string; name: string; code: string; department: string | null };
    cells: Array<{
      day: string;
      code: string;
      late?: boolean;
      missing?: boolean;
      manual?: boolean;
      title: string;
    }>;
    totals: Record<string, number>;
    payable: number;
    /** past days not worked out yet */
    unmarked: number;
  }>;
  total: number;
  page: number;
  size: number;
  lock: { locked: boolean; at: string; by: string | null; unlockReason: string | null } | null;
  mayLock: boolean;
  departments: string[];
}

export interface AttendanceDay {
  employee: { id: string; name: string; code: string; department: string | null };
  day: string;
  row: {
    dayType: string;
    words: string;
    leave: string | null;
    in: string | null;
    out: string | null;
    worked: number | null;
    overtime: number;
    late: number;
    early: number;
    manual: boolean;
    source: string;
    remark: string | null;
    how: string;
  } | null;
  punches: Array<{ at: string; time: string | null; date: string; source: string; device: string }>;
  history: Array<{ from: string; to: string; reason: string | null; by: string; at: string }>;
  marks: Array<{ kind: string; status: string; detail: string; reason: string | null }>;
  leave: Array<{ id: string; number: string; code: string; portion: number; status: string }>;
  regularisations: Array<{
    id: string;
    status: string;
    in_time: string | null;
    out_time: string | null;
    day_type: string | null;
    reason: string;
  }>;
  locked: boolean;
  can: { mine: boolean; decide: string | null; correct: boolean; regularise: boolean };
}

export interface MyAttendance {
  employee: { id: string; name: string; code: string } | null;
  month: string;
  monthWords?: string;
  locked?: boolean;
  days: Array<{
    day: string;
    dayType: string;
    code: string;
    words: string;
    in: string | null;
    out: string | null;
    worked: number | null;
    late: number;
    early: number;
    manual: boolean;
    remark: string | null;
  }>;
  regularisations: Array<{
    id: string;
    day: string;
    status: string;
    in_time: string | null;
    out_time: string | null;
    day_type: string | null;
    reason: string;
    waiting: string | null;
  }>;
}

export interface RegApproval {
  id: string;
  day: string;
  status: string;
  in_time: string | null;
  out_time: string | null;
  day_type: string | null;
  reason: string;
  employee: string;
  code: string;
  employee_id: string;
  since: string;
  mayDecide: boolean;
}

export interface AttendanceExceptions {
  month: string;
  monthWords: string;
  kind: 'late' | 'missing' | 'regularisation';
  counts: Record<string, number>;
  rows: Array<{
    id: string;
    day: string;
    employee: string;
    code: string;
    employee_id: string;
    status: string;
    detail: string;
    note: string | null;
    leave: string | null;
  }>;
  total: number;
  page: number;
  size: number;
}

export interface Timings {
  rows: Array<{
    id: string;
    kind: 'department' | 'special';
    department: string | null;
    employee: string | null;
    employee_id: string | null;
    from_date: string | null;
    to_date: string | null;
    starts_at: string;
    ends_at: string;
    grace_minutes: number;
    present_hours: string;
    half_day_hours: string;
    late_over_minutes: number | null;
    late_action: string;
    late_type_id: string | null;
    early_over_minutes: number | null;
    early_action: string;
    early_type_id: string | null;
    note: string | null;
  }>;
  departments: string[];
  employees: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string }>;
  can: { manage: boolean };
}

export const DAY_CODE_TONE: Record<string, string> = {
  P: 'present',
  HD: 'half',
  A: 'absent',
  WO: 'off',
  H: 'holiday',
  HOLD: 'absent',
};
