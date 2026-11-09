/** Staff leave in the staff app (docs/design/85): the shapes its pages read (as the admin app's). */

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

export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '—';
export const leaveDates = (r: {
  from: string;
  to: string;
  halfDay: boolean;
  session: string | null;
}) =>
  `${dmy(r.from)}${r.to !== r.from ? ` to ${dmy(r.to)}` : ''}${r.halfDay ? ` (${r.session === 'first' ? 'first' : 'second'} half)` : ''}`;

// ---- phase C: attendance --------------------------------------------------------------------------------
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
