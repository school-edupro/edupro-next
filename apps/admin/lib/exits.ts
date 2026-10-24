/** Employee exit (docs/design/38): the shapes the admin screens read. */
export type ExitStatus = 'pending' | 'sent_back' | 'approved' | 'rejected' | 'withdrawn';
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
export interface ExitDetail extends ExitRow {
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
  }>;
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
};
export const dmy = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—';
