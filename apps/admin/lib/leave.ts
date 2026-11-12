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
    excluded: number;
    given: number;
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
  bands: Array<{
    label: string;
    levels: string[];
    /** each level's people by name (an HOD or a reporting manager differs per employee: a note) */
    who: Array<{ name: string; people: string[]; need: 'any' | 'all'; note: string | null }>;
  }>;
}

export interface ApprovalRules {
  rules: ApprovalRule[];
  types: Array<{ id: string; code: string; name: string; auto: boolean }>;
  staff: Array<{ id: string; code: string; name: string }>;
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  bands: string[];
  can: { manage: boolean };
}

/** "Who approves" by employee: the approvers each employee has now. */
export interface ApproverChain {
  rule: { id: string; name: string; own: boolean } | null;
  levels: Array<{ name: string; need: 'any' | 'all'; people: string[] }>;
}
export interface ApproversByEmployee {
  rows: Array<{
    id: string;
    code: string | null;
    name: string;
    department: string | null;
    designation: string | null;
    signsIn: boolean;
    leave: Array<ApproverChain & { band: string }>;
    regularisation: ApproverChain;
    own: { leave: string | null; regularisation: string | null };
  }>;
  page: { page: number; size: number; total: number };
  departments: string[];
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
    correctionBackdateDays: number | null;
    missingPunchCc: string | null;
    deviceSerials: string[];
    sendEmail: boolean;
    sendWhatsapp: boolean;
    sendApp: boolean;
    sendSms: boolean;
    updatedAt: string;
  };
  shifts: Array<{ id: string; code: string; name: string }>;
  templates: Array<{
    code: string;
    channel: string;
    name: string;
    active: boolean;
    ready: boolean;
  }>;
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
  /** when the cancellation was asked */
  cancelRaisedAt?: string | null;
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
    /** approved days this leave year (April to March) */
    availed: number;
    policy: string | null;
  }>;
  types: LeaveFormType[];
  /** my leave touching From–To, with what I may do from the list */
  rows: Array<LeaveRequest & { can: { withdraw: boolean; requestCancel: boolean } }>;
  total: number;
  page: number;
  size: number;
  from: string | null;
  to: string | null;
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
  /** the first day I may apply from (null: any day of an open month); the office's entry is not held */
  earliest?: string | null;
  /** the last day (today) for a type not for days ahead, else null */
  latest?: string | null;
  /** the past-days rule in words: "not for past days", "up to 7 days back", "any day of an open month" */
  pastDays?: string;
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
  > & { fy: string; fyFrom: string; fyTo: string };
  rows: RegisterRow[];
  total: number;
  page: number;
  size: number;
  lists: {
    types: Array<{ id: string; name: string }>;
    employees: Array<{ id: string; name: string }>;
    departments: string[];
  };
}

/** A leave on the register (the old Approve / Reject Leave): its stage, last action, current approver, office rights. */
export interface RegisterRow extends LeaveRequest {
  /** Pending, L1 Approved, L2 Approved, Approved, Rejected, Withdrawn, Cancelled, LWP */
  stage: string;
  /** "CODE — Name" of who entered it (on behalf) */
  appliedPerson: string | null;
  lastAction: { words: string; by: string | null; at: string | null };
  /** LEVEL 2 PENDING and who; or APPROVED and by whom */
  approver: { head: string; people: string | null };
  can: { override: boolean; trim: boolean; cancel: boolean };
}

/** The balance ledger: one row per employee × leave type × month, every month newest first (or one month). */
export interface LeaveBalances {
  /** the month asked, or null for every month */
  month: string | null;
  /** this month (YYYY-MM-01): the one a correction goes to */
  current: string;
  monthWords: string;
  rows: Array<{
    id: string;
    employee: {
      id: string;
      name: string;
      code: string;
      department: string | null;
      designation: string | null;
    };
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
    current: boolean;
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

/** Leave waiting for me / decided by me: a page, the figures and the lists to filter by. */
export interface LeaveApprovals {
  view: 'waiting' | 'decided';
  rows: Array<
    LeaveRequest & {
      what: 'leave' | 'cancellation';
      /** waiting: since it reached my level; decided: when I acted */
      since: string;
      decided: 'approved' | 'rejected' | null;
    }
  >;
  total: number;
  page: number;
  size: number;
  figures: { n: number; overdue: number; cancels: number; approved: number; rejected: number };
  lists: {
    employees: Array<{ id: string; name: string; code: string }>;
    departments: string[];
    types: Array<{ id: string; code: string; name: string }>;
  };
}

/** A balance row's Leave Details (GET /leave/balances/detail): the policy, the month's credit worked out, the days. */
export interface BalanceDetail {
  month: string;
  current: boolean;
  /** "November 2026 (credited from … attendance)" */
  note: string;
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    joinedOn: string | null;
  };
  leaveType: { id: string; code: string; name: string };
  policy: { name: string; annualDays: number; accrual: string } | null;
  accrual: {
    /** credit: this month's credit; towards: the next credit's period so far; none: not credited */
    kind: 'credit' | 'towards' | 'none';
    credit: string | null;
    /** the period counted ("April – September 2026"), or the month */
    words: string;
    period: { from: string; to: string } | null;
    shown: { from: string; to: string };
    daysInPeriod: number;
    daysShown: number;
    presentDays: number;
    lostDays: number;
    accrued: number;
    onRow: number;
    expected: number | null;
    formula: string | null;
    rule: string | null;
    remark: string | null;
  };
  days: Array<{
    day: string;
    code: string;
    words: string;
    present: 'Yes' | 'Half' | 'No' | '—';
    lop: boolean;
    lopPct: number | null;
  }>;
  balance: {
    opening: number;
    credited: number;
    held: number;
    correction: number;
    closing: number | null;
    lapsed: number;
    available: number;
    closed: boolean;
    trail: string[];
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
      /** as stored (LV for leave) */
      type?: string;
      in?: string | null;
      out?: string | null;
      hrs?: number | null;
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
  /** the range shown (a month, or My team's From–To) */
  from?: string;
  to?: string;
  /** the team view: how many report to me */
  team?: number;
}

/** The corrections log: who changed which day, how, why and when (newest first). */
export interface CorrectionsLog {
  month: string;
  monthWords: string;
  rows: Array<{
    id: string;
    employee: { id: string; name: string; code: string; department: string | null };
    day: string;
    changes: Array<{ what: string; from: string; to: string }>;
    reason: string | null;
    by: { code: string | null; name: string } | null;
    at: string;
  }>;
  total: number;
  page: number;
  size: number;
}

/** The office's attendance register (as the old Payroll / Attendance Register). */
export interface AttendanceRegisterPage extends AttendanceRegister {
  status: string | null;
  all: boolean;
  /** every active employee, for Bulk Update and Apply Leave */
  employees: Array<{ id: string; name: string; code: string; department: string | null }>;
  /** staff on the Not required in the reports list, left out unless asked */
  excluded: number;
  /** what the payroll lock looks at first */
  checks: {
    missing: Array<{ name: string; code: string; day: string }>;
    missingTotal: number;
    noDepartment: Array<{ name: string; code: string }>;
  };
}

/** My team's attendance (My leave → Reporties Attendance): all of them a column a day, or one day by day. */
export type TeamAttendance =
  | (AttendanceRegister & {
      mode: 'grid';
      from: string;
      to: string;
      team: number;
      employees: TeamEmployee[];
    })
  | {
      mode: 'days';
      from: string;
      to: string;
      team: number;
      employees: TeamEmployee[];
      employee: TeamEmployee;
      days: TeamDay[];
      /** P, HD, A, WO, H, the leave codes, late, missing over the range */
      totals: Record<string, number>;
      total: number;
      page: number;
      size: number;
    };
export interface TeamEmployee {
  id: string;
  name: string;
  code: string;
}
export interface TeamDay {
  day: string;
  weekday: string;
  dayType: string | null;
  code: string;
  words: string | null;
  in: string | null;
  out: string | null;
  worked: number | null;
  late: number;
  early: number;
  lateEarly: string;
  missing: boolean;
  manual: boolean;
  remark: string | null;
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
  can: {
    mine: boolean;
    team?: boolean;
    decide: string | null;
    correct: boolean;
    regularise: boolean;
  };
  /** my own day too far back to ask for a correction: why (0363) */
  correctionNote?: string | null;
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
  employees: Array<{ id: string; name: string; department: string | null }>;
  types: Array<{ id: string; name: string }>;
  can: { manage: boolean };
}

/** The timings list, a page at a time (Department and special timings). */
export interface TimingList {
  rows: Array<{
    id: string;
    kind: 'department' | 'special';
    department: string | null;
    employee: string | null;
    employee_id: string | null;
    employee_department: string | null;
    from_date: string | null;
    to_date: string | null;
    starts_at: string;
    ends_at: string;
    grace_minutes: number;
    present_hours: string;
    half_day_hours: string;
    late_over_minutes: number | null;
    late_action: string;
    late_type: string | null;
    early_over_minutes: number | null;
    early_action: string;
    early_type: string | null;
    note: string | null;
  }>;
  page: { page: number; size: number; total: number };
  counts: { department: number; special: number };
}

/** The timing change log, a page at a time. */
export interface TimingLogPage {
  rows: Array<{
    id: string;
    timing_id: string;
    kind: 'department' | 'special';
    subject: string;
    department: string | null;
    action: 'added' | 'changed' | 'ended' | 'removed';
    from_date: string | null;
    to_date: string | null;
    changes: Array<{ field: string; old: unknown; new: unknown }>;
    by: string | null;
    at: string;
  }>;
  page: { page: number; size: number; total: number };
}

export const DAY_CODE_TONE: Record<string, string> = {
  P: 'present',
  HD: 'half',
  A: 'absent',
  WO: 'off',
  H: 'holiday',
  HOLD: 'absent',
};

// ---- phase D: the dashboard and the reports ------------------------------------------------------------
export interface LeaveDashboard {
  today: string;
  monthWords: string;
  fyFrom: string;
  figures: {
    staff: number;
    punched: number;
    onLeave: number;
    notIn: number;
    late: number;
    off: number;
    waiting: number;
    corrections: number;
    lateMarks: number;
    missing: number;
    lopDays: number;
    attendance: number | null;
  };
  lastMonth: { words: string; month: string; locked: boolean };
  departments: Array<{
    department: string;
    staff: number;
    punched: number;
    onLeave: number;
    notIn: number;
    late: number;
    off: number;
  }>;
  onLeave: Array<{
    id: string;
    name: string;
    code: string;
    department: string | null;
    type: string;
    from_date: string;
    to_date: string;
    half: boolean;
  }>;
  lateToday: Array<{
    id: string;
    name: string;
    code: string;
    department: string | null;
    at: string;
    minutes: number;
  }>;
  waiting: Array<{
    kind: string;
    id: string;
    label: string;
    name: string;
    since: string;
    href: string;
  }>;
  byDay: Array<{ day: string; percent: number | null }>;
  byType: Array<{ code: string; name: string; days: number }>;
}

export type LeaveReportFilter =
  | 'day'
  | 'period'
  | 'month'
  | 'months'
  | 'asOn'
  | 'department'
  | 'employeeType'
  | 'employee'
  | 'type'
  | 'status';
export interface LeaveReportCatalogue {
  reports: Array<{
    code: string;
    name: string;
    group: string;
    filters: LeaveReportFilter[];
    help: string;
  }>;
  departments: string[];
  employeeTypes: Array<{ code: string; name: string }>;
  employees: Array<{ id: string; name: string; code: string }>;
  types: Array<{ id: string; code: string; name: string }>;
  manage: boolean;
  all: boolean;
}
export interface LeaveReportResult {
  report: string;
  name: string;
  words: string;
  filters: {
    day: string;
    from: string;
    to: string;
    month: string;
    fromMonth: string;
    toMonth: string;
    status: string | null;
  };
  columns: Array<{
    label: string;
    type?: 'text' | 'number' | 'date';
    group?: string;
    center?: boolean;
  }>;
  rows: Array<Array<string | number | null>>;
  headings: number[];
  strong: number[];
  links: Array<string | null> | null;
  /** the figures over the table; one with a key lists only its rows when picked */
  kpis: Array<{ key?: string; label: string; value: string | number }> | null;
  /** the figure picked (its key), or null for everyone */
  pick: string | null;
  note: string | null;
  more: boolean;
  total: number;
}
export interface LeaveReportAccess {
  reports: Array<{
    code: string;
    name: string;
    group: string;
    people: Array<{ id: string; name: string; code: string | null }>;
  }>;
  people: Array<{ id: string; name: string; code: string }>;
  manage: boolean;
}

// ---- phase E: moving from the old module -------------------------------------------------------------
export type CutoverStep = 'setup' | 'balances' | 'history';
export interface CutoverProblem {
  step: CutoverStep;
  what: string;
  count: number;
  examples: string[];
}
export interface CutoverOverview {
  today: string;
  parallelMonth: string | null;
  parallelWords: string | null;
  freezeOn: string | null;
  status: 'setup' | 'parallel' | 'switched';
  read: {
    requestedAt: string | null;
    startedAt: string | null;
    at: string | null;
    error: string | null;
    counts: Record<string, number>;
    waiting: boolean;
  };
  staged: Record<string, number>;
  steps: Record<
    string,
    { at: string; by: string | null; counts: Record<string, number>; problems?: CutoverProblem[] }
  >;
  started: boolean;
  switchedAt: string | null;
  canSwitch: boolean;
}
export interface CutoverPreview {
  steps: Array<{
    step: CutoverStep;
    ready: boolean;
    why: string | null;
    counts: Record<string, number>;
    problems: CutoverProblem[];
  }>;
}
export interface CutoverCompare {
  month: string;
  from: string;
  to: string;
  readAt: string | null;
  days: {
    compared: number;
    differ: number | string;
    rows: Array<{
      emp: string;
      code: string;
      name: string;
      day: string;
      old: string | null;
      new: string | null;
      old_in: string | null;
      old_out: string | null;
      new_in: string | null;
      new_out: string | null;
    }>;
  };
  balances: {
    compared: number;
    differ: number | string;
    rows: Array<{
      code: string;
      name: string;
      type: string;
      old: number;
      new: number | null;
      old_credit: number;
      new_credit: number | null;
    }>;
  };
}

/** The shift calendar: a month of who works which shift (Leave & attendance set-up → Shift calendar). */
export interface ShiftCalendar {
  month: string;
  days: Array<{ date: string; day: number; dow: string }>;
  departments: string[];
  locked: boolean;
  shifts: Array<{
    id: string;
    code: string;
    name: string;
    kind: string;
    starts_at: string;
    ends_at: string;
    colour: string;
  }>;
  defaultShiftId: string | null;
  rows: Array<{
    id: string;
    code: string;
    name: string;
    department: string | null;
    posted: boolean;
    cells: Array<{ s: string | null; src: 'posted' | 'default' | 'day'; wo: boolean; h: boolean }>;
  }>;
  page: { page: number; size: number; total: number };
  counts: { unposted: number };
  today: string;
  can: { manage: boolean };
}
export interface ShiftAssignResult {
  dryRun: boolean;
  shift: string;
  changed: number;
  same: number;
  lines: Array<{ employee: string; changes: string[] }>;
  worked: number;
  pastFrom: string | null;
}
export interface ShiftCopyResult {
  dryRun: boolean;
  source: string;
  target: string;
  copied: number;
  postings: number;
  lines: Array<{ employee: string; changes: string[] }>;
  skipped: string[];
  nothing: number;
  worked: number;
}
export interface ShiftLogPage {
  rows: Array<{
    id: string;
    subject: string;
    department: string | null;
    shift: string;
    action: 'added' | 'changed' | 'ended' | 'removed';
    from_date: string | null;
    to_date: string | null;
    changes: Array<{ field: string; old: unknown; new: unknown }>;
    by: string | null;
    at: string;
  }>;
  page: { page: number; size: number; total: number };
}

/**
 * My leave → Reporties leave: what waits at my approval level (`waiting`), or my reportees' leave, with the
 * filters' lists; each row says whether I decide it here (a leave, or its cancellation).
 */
export interface TeamLeave {
  from: string | null;
  to: string | null;
  status: string | null;
  team: number;
  /** leave and cancellations waiting at my level */
  waiting: number;
  rows: Array<
    LeaveRequest & {
      what: 'leave' | 'cancellation';
      can: { decide: boolean; decideCancel: boolean };
    }
  >;
  total: number;
  page: number;
  size: number;
  filters: {
    employees: TeamEmployee[];
    types: Array<{ id: string; code: string; name: string }>;
  };
}

/** The staff punch log (docs/design/85): the machines, the other sources and the lists to pick from. */
export interface PunchOverview {
  today: string;
  devices: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    lastSeen: string | null;
    today: number;
    lastPunch: string | null;
    waiting: number;
    unknown: number;
  }>;
  others: Array<{
    source: string;
    words: string;
    punches: number;
    waiting: number;
    last: string | null;
  }>;
  lists: {
    employees: Array<{ id: string; name: string; code: string | null; biometricId: string | null }>;
    departments: string[];
  };
  can: { assign: boolean; process: boolean };
}

/** A department's or an employee's raw punches, a page at a time. */
export interface PunchLog {
  mode: 'department' | 'team' | 'employee';
  from: string;
  to: string;
  words: string;
  figures: { n: number; people: number; days: number; waiting: number };
  rows: Array<{
    id: string;
    employee: { id: string; code: string; name: string; department: string | null };
    day: string;
    weekday: string;
    time: string;
    device: string | null;
    source: string;
    sourceWords: string;
    processed: boolean;
    marked: string | null;
  }>;
  total: number;
  page: number;
  size: number;
}

/** Whose punches I may see: everyone (the punch-log right) or my reportees. */
export interface PunchTeam {
  all: boolean;
  reportees: Array<{ id: string; code: string; name: string; department: string | null }>;
}

/** Every version of an employee's days: the one in force (active) and the ones it replaced. */
export interface DayVersions {
  employee: { id: string; code: string; name: string; department: string | null };
  from: string;
  to: string;
  words: string;
  rows: Array<{
    day: string;
    weekday: string;
    attendance: string;
    in: string;
    out: string;
    active: boolean;
    by: string;
    at: string | null;
    remark: string;
    trace: Array<[string, string]> | null;
  }>;
  days: number;
  changed: number;
}

/** The punches of an unknown ID and the double taps. */
export interface UnmatchedPunches {
  from: string;
  to: string;
  rows: Array<{
    id: string;
    kind: 'unknown' | 'double';
    device: string;
    punches: number;
    days: number;
    first: string;
    last: string;
    employee: { id: string; code: string | null; name: string | null } | null;
    holder: string | null;
  }>;
  unknown: number;
  double: number;
  can: { assign: boolean };
}
