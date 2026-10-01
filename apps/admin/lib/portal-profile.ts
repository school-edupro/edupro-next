/** Portal profile policy and profile approvals, as the API serves them (2026-10-01). */

export type PortalLevel = 'hidden' | 'view' | 'edit_approval' | 'edit_direct';
export type PortalAudience = 'parent' | 'student';

export type Approver =
  | { kind: 'office' }
  | { kind: 'class_teacher' }
  | { kind: 'role'; roleId: string; name?: string }
  | { kind: 'user'; userId: string; name?: string };
export type ApprovalRoute = Approver[];

export interface PortalPolicy {
  fields: Record<PortalAudience, Record<string, PortalLevel>>;
  proofs: Record<string, string>;
  window: {
    mode: 'open' | 'closed' | 'period';
    from?: string | null;
    to?: string | null;
    message?: string | null;
  };
  approval: {
    default: ApprovalRoute;
    sections: Record<string, ApprovalRoute>;
    fields: Record<string, ApprovalRoute>;
  };
}

export interface PolicyScreen {
  policy: PortalPolicy;
  saved: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  sections: Array<{ id: string; title: string }>;
  fields: Array<{
    key: string;
    section: string;
    label: string;
    sensitive: boolean;
    editable: boolean;
    /** A photo the family uploads (no proof document; the picture is the evidence). */
    photo?: boolean;
  }>;
  proofKinds: Array<{ id: string; label: string }>;
  roles: Array<{ id: string; name: string; code: string }>;
  staff: Array<{ userId: string; name: string; designation: string | null }>;
}

export const LEVEL_LABEL: Record<PortalLevel, string> = {
  hidden: 'Hidden',
  view: 'View only',
  edit_approval: 'Edit with approval',
  edit_direct: 'Edit direct',
};

export interface ChangeView {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  classSection: string | null;
  requestedBy: string | null;
  audience: string;
  entity: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'partially_approved' | 'cancelled';
  autoApplied: boolean;
  level: number;
  levels: number;
  route: Array<{ kind: string; label: string }>;
  waitingFor: string | null;
  items: Array<{
    key: string;
    label: string;
    section: string;
    /** A photo change: from / to are file ids, shown as pictures. */
    photo?: boolean;
    from: string | number | null;
    to: string | number | null;
    status: 'pending' | 'approved' | 'rejected';
    note: string | null;
  }>;
  proofs: Array<{ kind: string; label: string; fileId: string; fileName: string | null }>;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  canAct?: boolean;
  history?: Array<{
    level: number;
    decision: string;
    fields: Record<string, string>;
    note: string | null;
    actor: string | null;
    at: string;
  }>;
}

export interface Inbox {
  data: ChangeView[];
  page: { number: number; size: number; total: number };
  awaitingMe: number;
  canOverride: boolean;
  canSeeAll: boolean;
}

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export const STATUS_TONE: Record<
  ChangeView['status'],
  'success' | 'danger' | 'warning' | 'info' | 'neutral'
> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  partially_approved: 'info',
  cancelled: 'neutral',
};

export const STATUS_LABEL: Record<ChangeView['status'], string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Refused',
  partially_approved: 'Partly approved',
  cancelled: 'Withdrawn',
};
