/**
 * Staff leave and attendance (docs/design/85): the shapes the Employee Leave / Attendance page reads, shared by
 * the admin and the staff website (docs/design/99).
 */
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

export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '—';
export const leaveDates = (r: {
  from: string;
  to: string;
  halfDay: boolean;
  session: string | null;
}) =>
  `${dmy(r.from)}${r.to !== r.from ? ` to ${dmy(r.to)}` : ''}${r.halfDay ? ` (${r.session === 'first' ? 'first' : 'second'} half)` : ''}`;

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
    reason: string; /** the level and its approvers it waits for; who decided it, when, why */
    waiting?: string | null;
    decided_by?: string | null;
    decided_at?: string | null;
    decided_note?: string | null;
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
  /** the first day I may ask to correct (null: any day of an open month) */
  correctionFrom?: string | null;
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
    decided_by?: string | null;
    decided_at?: string | null;
    decided_note?: string | null;
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

/** Who a correction waits for or who decided it, in words (both apps' days and months). */
export function correctionPeople(g: {
  status: string;
  waiting?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decided_note?: string | null;
}): string | null {
  const when = g.decided_at
    ? new Date(g.decided_at).toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';
  if (g.status === 'pending')
    return g.waiting ? `Waiting for ${g.waiting}` : 'Waiting for the approver';
  if (g.status === 'approved' && g.decided_by)
    return `Approved by ${g.decided_by}${when ? ` on ${when}` : ''}`;
  if (g.status === 'rejected' && g.decided_by)
    return `Not approved by ${g.decided_by}${when ? ` on ${when}` : ''}${g.decided_note ? `: ${g.decided_note}` : ''}`;
  return null;
}
