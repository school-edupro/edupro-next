/** Helpdesk (0056): parent queries, staff queries and tickets to the ERP provider. */
export type Desk = 'parent' | 'staff' | 'provider';
export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'closed';

export const DESKS: Desk[] = ['parent', 'staff', 'provider'];
export const DESK_LABEL: Record<Desk, string> = {
  parent: 'Parent queries',
  staff: 'Staff queries',
  provider: 'ERP provider tickets',
};
export const DESK_ONE: Record<Desk, string> = {
  parent: 'Parent query',
  staff: 'Staff query',
  provider: 'ERP provider ticket',
};
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
export const STATUS_TONE: Record<TicketStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};
export const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};
export const OWNER_LABEL: Record<string, string> = {
  class_teacher: "The child's class teacher",
  role: 'A role',
  employee: 'A named employee',
  provider: 'The ERP provider',
};
export const EVENT_LABEL: Record<string, string> = {
  created: 'Raised, sent to',
  assigned: 'Handed to',
  replied: 'Reply',
  note: 'Internal note',
  escalated: 'Escalated to',
  breached: 'SLA missed at the last level',
  closed: 'Closed',
  reopened: 'Reopened',
  rated: 'Rated',
  status: 'Status changed',
};

export interface Ticket {
  id: string;
  number: string;
  desk: Desk;
  head: string;
  categoryCode: string;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  section: string | null;
  raisedBy: string | null;
  raisedByUserId: string;
  subject: string;
  body: string;
  fileIds: string[];
  status: TicketStatus;
  providerStatus: string | null;
  priority: string;
  module: string | null;
  level: number;
  dueAt: string | null;
  escalatedAt: string | null;
  breachedAt: string | null;
  overdue: boolean;
  assignedRole: string | null;
  assignedRoleName: string | null;
  assignedUserId: string | null;
  assignedTo: string | null;
  resolution: string | null;
  rating: number | null;
  ratingComment: string | null;
  reopenedCount: number;
  openedAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
}

export interface TicketDetail extends Ticket {
  replies: Array<{
    id: string;
    author: string | null;
    authorKind: string;
    mine: boolean;
    fromRaiser: boolean;
    body: string;
    fileIds: string[];
    isInternal: boolean;
    createdAt: string;
  }>;
  events: Array<{
    kind: string;
    level: number | null;
    at: string;
    actor: string | null;
    to: string | null;
    emails: string[];
  }>;
  you: {
    handler: boolean;
    raiser: boolean;
    canReply: boolean;
    canAssign: boolean;
    canClose: boolean;
    canReopen: boolean;
    canRate: boolean;
    reopenUntil: string | null;
  };
}

export interface TicketList {
  data: Ticket[];
  page: { number: number; size: number; total: number };
  counts: Array<{ desk: Desk; open: number; overdue: number }>;
  you: { viewAll: boolean; provider: boolean; family: boolean };
}

export interface Level {
  level: number;
  hours: number;
  assignType: 'role' | 'employee' | 'email_only';
  roleCode?: string | null;
  userId?: string | null;
  userName?: string | null;
  emails: string[];
}

export interface Head {
  id: string;
  desk: Desk;
  code: string;
  name: string;
  description: string;
  ownerType: 'class_teacher' | 'role' | 'employee' | 'provider';
  ownerRole: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  slaHours: number | null;
  sortOrder: number;
  active: boolean;
  used: number;
  levels: Level[];
}

export interface HelpdeskSettings {
  workingDays: number[];
  dayStart: string;
  dayEnd: string;
  reopenDays: number;
  providerName: string;
  providerEmail: string;
  providerSeniorName: string;
  providerSeniorEmail: string;
  providerSla: { urgent: number; high: number; normal: number; low: number };
}

export interface Setup {
  settings: HelpdeskSettings;
  heads: Head[];
  roles: Array<{ code: string; name: string }>;
  staff: Array<{ id: string; name: string; email: string | null }>;
}

export interface HelpdeskDashboard {
  months: Array<{
    month: string;
    desk: Desk;
    raised: number;
    resolved: number;
    escalated: number;
    breached: number;
    open: number;
    avgHours: number | null;
    withinSla: number | null;
    rating: number | null;
  }>;
  openNow: Array<{ desk: Desk; level: number; open: number; overdue: number }>;
  heads: Array<{ desk: Desk; head: string; raised: number; open: number; escalated: number }>;
  overdue: Ticket[];
}

export const isDesk = (v: string): v is Desk => (DESKS as string[]).includes(v);

/** "in 3 h", "2 d late" against the due time. */
export function dueText(t: Pick<Ticket, 'dueAt' | 'status'>): string {
  if (!t.dueAt || t.status === 'closed') return '';
  const ms = new Date(t.dueAt).getTime() - Date.now();
  const abs = Math.abs(ms);
  const span =
    abs >= 86_400_000
      ? `${String(Math.round(abs / 86_400_000))} d`
      : `${String(Math.max(1, Math.round(abs / 3_600_000)))} h`;
  return ms >= 0 ? `due in ${span}` : `${span} late`;
}

export const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';
