/** Digital file movement: the shapes the screens read. */
export interface FileNote {
  id: string;
  number: string;
  subject: string;
  status: 'pending' | 'returned' | 'approved' | 'rejected' | 'withdrawn';
  statusLabel: string;
  round: number;
  createdBy: string;
  designation: string | null;
  createdAt: string;
  submittedAt: string;
  closedAt: string | null;
  attachments: number;
  levels: number;
  approvedLevels: number;
  waitingOn: string | null;
  mineNow: boolean;
  mineFile: boolean;
}
export interface FileLevel {
  round: number;
  level: number;
  employeeId: string;
  name: string;
  designation: string | null;
  status: string;
  remark: string | null;
  actedAt: string | null;
  mine: boolean;
}
export interface FileNoteDetail extends FileNote {
  bodyHtml: string;
  files: Array<{ id: string; name: string }>;
  levelsNow: FileLevel[];
  history: Array<{
    round: number;
    action: string;
    level: number | null;
    remark: string | null;
    at: string;
    by: string;
  }>;
  isCreator: boolean;
  canDecide: boolean;
  canResubmit: boolean;
  canWithdraw: boolean;
  canDownload: boolean;
}
export interface FileDashboard {
  seesAll: boolean;
  counts: {
    total: number;
    pending: number;
    returned: number;
    approved: number;
    rejected: number;
    withdrawn: number;
  };
  averageHours: number | null;
  averageRounds: number | null;
  months: Array<{ m: string; raised: number; approved: number; rejected: number }>;
  holders: Array<{ name: string; count: number; oldest: string }>;
  oldest: FileNote[];
}
export const FILE_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral' | 'info'> = {
  pending: 'warning',
  returned: 'info',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};
export const FILE_ACTION: Record<string, string> = {
  submitted: 'Submitted',
  resubmitted: 'Corrected and submitted again',
  approved: 'Approved',
  returned: 'Sent back',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn by the creator',
};
export const fileWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
