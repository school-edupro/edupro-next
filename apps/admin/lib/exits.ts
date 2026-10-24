/** Employee exit (docs/design/38): the shapes the admin screens read. */
export type ExitStatus = 'pending' | 'sent_back' | 'approved' | 'rejected' | 'withdrawn' | 'closed';
export type EmployeeType = 'teaching' | 'non_teaching' | 'contract' | 'visiting';

export interface ExitRow {
  id: string;
  employee: {
    id: string;
    code: string;
    name: string;
    type: EmployeeType;
    typeName: string;
    department: string | null;
    designation: string | null;
  };
  exitType: { code: string; name: string };
  reason: string;
  letterFileId: string | null;
  requestedOn: string;
  proposedLastDay: string;
  noticeDays: number;
  expectedLastDay: string;
  shortfallDays: number;
  acceptedLastDay: string | null;
  noticeWaived: boolean;
  status: ExitStatus;
  bySelf: boolean;
  raisedBy: string | null;
  sentBackNote: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  waitingAt: string | null;
}
export type ClearanceApprover =
  | { kind: 'office' }
  | { kind: 'hod' }
  | { kind: 'role'; code: string }
  | { kind: 'user'; userId: string };
export interface ClearanceRow {
  department: string;
  name: string;
  auto: 'library' | 'assets' | null;
  status: 'pending' | 'cleared';
  dues: number;
  note: string | null;
  actedBy: string | null;
  actedAt: string | null;
  approvers: string[];
  check: { kind: string; due: boolean; amount: number; detail: string } | null;
  mayClear: boolean;
}
export interface BoardExit {
  id: string;
  employee: {
    id: string;
    name: string;
    code: string;
    department: string | null;
    designation: string | null;
  };
  exitType: string;
  lastDay: string | null;
  clearances: ClearanceRow[];
  pending: number;
  dues: number;
}
export interface ExitDetail extends ExitRow {
  clearances: ClearanceRow[];
  events: Array<{ what: string; note: string | null; by: string | null; at: string }>;
  steps: Array<{
    level: number;
    name: string;
    status: string;
    assignees: string[];
    actedBy: string | null;
    actedAt: string | null;
    note: string | null;
  }>;
  may: { decide: boolean; withdraw: boolean; edit: boolean };
  /** what the close ended, to re-assign */
  handover?: Array<{ kind: string; what: string }> | null;
  leftOn?: string | null;
}
export interface ExitSetup {
  types: Array<{
    code: string;
    name: string;
    staffMayApply: boolean;
    noticeApplies: boolean;
    active: boolean;
  }>;
  noticeDays: Record<EmployeeType, number>;
  departments: Array<{
    code: string;
    name: string;
    auto: 'library' | 'assets' | null;
    active: boolean;
    approvers: ClearanceApprover[];
  }>;
  roles: Array<{ code: string; name: string }>;
  fnfApprovers: ClearanceApprover[];
  employeeTypes: Array<{ code: EmployeeType; name: string }>;
  can: { manage: boolean };
}

export const EXIT_STATUS: Record<
  ExitStatus,
  { label: string; tone: 'warning' | 'info' | 'success' | 'danger' | 'neutral' }
> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  sent_back: { label: 'Sent back', tone: 'info' },
  approved: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Not accepted', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  closed: { label: 'Left', tone: 'neutral' },
};
export const EXIT_EVENT: Record<string, string> = {
  submitted: 'Asked',
  sent_back: 'Sent back',
  resubmitted: 'Sent again',
  terms: 'Terms set',
  approved: 'Accepted',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
  approval_moved: 'Approvers changed',
  cleared: 'Cleared',
  all_cleared: 'Every department has cleared',
  reopened: 'Clearance opened again',
  fnf_submitted: 'Full and final sent for approval',
  fnf_returned: 'Full and final sent back',
  fnf_approved: 'Full and final approved',
  fnf_paid: 'Full and final settled',
  closed: 'Closed',
};
export const dmy = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—';

export interface FnfLine {
  kind: 'earning' | 'deduction';
  code: string;
  label: string;
  amount: number;
  note: string | null;
  fromClearance?: boolean;
}
export interface FnfStatement {
  status: 'draft' | 'submitted' | 'approved' | 'paid';
  lines: FnfLine[];
  earnings: number;
  deductions: number;
  net: number;
  preparedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  paidOn: string | null;
  paidMode: string | null;
  paidReference: string | null;
  clearancePending: number;
  may: { edit: boolean; submit: boolean; decide: boolean; pay: boolean };
}
export interface ExitRegisterRow {
  id: string;
  code: string;
  name: string;
  employeeType: string;
  designation: string | null;
  department: string | null;
  exitType: string;
  reason: string;
  requestedOn: string;
  lastDay: string;
  leftOn: string | null;
  status: string;
  noticeWaived: boolean;
  net: number | null;
  fnfStatus: string | null;
  paidOn: string | null;
}
