/** Transport v2 (0077): the shapes and labels the transport screens share. */
import type { TemplateStatus } from '@/components/MessageTemplates';

export type Service = 'pick' | 'drop' | 'both';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TransportRequest {
  id: string;
  number: string;
  kind: 'join' | 'change' | 'leave';
  kindLabel: string;
  source: 'parent' | 'office';
  service: Service | null;
  serviceLabel: string | null;
  status: RequestStatus;
  studentId: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  pickRoute: string | null;
  pickStop: string | null;
  pickTime: string | null;
  dropRoute: string | null;
  dropStop: string | null;
  dropTime: string | null;
  slab: string | null;
  monthlyAmount: number | null;
  fromMonth: string | null;
  toMonth: string | null;
  what: string;
  note: string | null;
  feeNote: string | null;
  decisionNote: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  approvedLevels: number;
  levels: number;
  waitingOn: string | null;
}
export interface TransportPeriod {
  id: string;
  studentId: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  service: Service;
  serviceLabel: string;
  pickRoute: string | null;
  pickStop: string | null;
  pickTime: string | null;
  dropRoute: string | null;
  dropStop: string | null;
  dropTime: string | null;
  slab: string | null;
  monthlyAmount: number;
  fromMonth: string;
  toMonth: string;
  status: string;
  phase: 'running' | 'upcoming' | 'over' | 'cancelled';
  requestId: string | null;
  requestNo: string | null;
  source: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  vehicle: string | null;
  endedBy: string | null;
}
export interface TransportApproval {
  seq: number;
  label: string;
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
  approvers: string | null;
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  mine: boolean;
}
export interface TransportRequestDetail extends TransportRequest {
  approvals: TransportApproval[];
  canDecide: boolean;
  periods: TransportPeriod[];
}
export interface RideStop {
  id: string;
  name: string;
  pickupTime: string | null;
  dropTime: string | null;
  slab: string | null;
  amount: number | null;
}
export interface RideOptions {
  settings: { oneWayPercent: number; twoStopRule: 'higher' | 'pick' | 'sum' };
  routes: Array<{
    id: string;
    code: string;
    name: string;
    vehicle: string | null;
    stops: RideStop[];
  }>;
  months: string[];
  thisMonth: string;
  periods: TransportPeriod[];
  riding: boolean;
}
export interface TransportLevel {
  id?: string;
  source: 'parent' | 'office';
  label: string;
  kind: 'role' | 'designation' | 'employee' | 'route_incharge';
  roleCode: string | null;
  designation: string | null;
  employeeId: string | null;
  active: boolean;
}
export interface TransportSetup {
  settings: {
    oneWayPercent: number;
    twoStopRule: 'higher' | 'pick' | 'sum';
    parentCanApply: boolean;
    notifyEmail: boolean;
  };
  levels: TransportLevel[];
  incharges: Array<{
    routeId: string | null;
    employeeId: string;
    name?: string;
    mobile?: string | null;
    login?: boolean;
  }>;
  routes: Array<{ id: string; name: string }>;
  roles: Array<{ code: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  designations: string[];
  templates: TemplateStatus[];
}

export const STATUS_TONE: Record<RequestStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};
export const PHASE_TONE: Record<string, 'success' | 'info' | 'neutral' | 'danger'> = {
  running: 'success',
  upcoming: 'info',
  over: 'neutral',
  cancelled: 'danger',
};
export const PHASE_LABEL: Record<string, string> = {
  running: 'Riding now',
  upcoming: 'To start',
  over: 'Over',
  cancelled: 'Cancelled',
};
export const APPROVAL_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral' | 'info'> =
  {
    waiting: 'neutral',
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    skipped: 'neutral',
  };
export const APPROVAL_LABEL: Record<string, string> = {
  waiting: 'Not yet',
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

/** 2026-10 → Oct 2026. */
export const monthLabel = (m: string | null | undefined): string =>
  m
    ? new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
export const rupees = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `₹${n.toLocaleString('en-IN')}`;
export const approvalLine = (r: TransportRequest): string =>
  r.status === 'pending'
    ? `${String(r.approvedLevels)} of ${String(r.levels)} approved${r.waitingOn ? ` · with ${r.waitingOn}` : ''}`
    : `${String(r.approvedLevels)} of ${String(r.levels)} approved`;
export const whoLine = (r: { section: string | null; admissionNo: string | null }): string =>
  [r.section, r.admissionNo ? `Adm. no. ${r.admissionNo}` : null].filter(Boolean).join(' · ');
/** Where the bus picks and drops, on two short lines. */
export const rideLines = (r: {
  service: Service | null;
  pickRoute: string | null;
  pickStop: string | null;
  pickTime: string | null;
  dropRoute: string | null;
  dropStop: string | null;
  dropTime: string | null;
}): string[] =>
  [
    r.service !== 'drop' && r.pickStop
      ? `Pick: ${r.pickStop} · ${r.pickRoute ?? ''}${r.pickTime ? ` · ${r.pickTime}` : ''}`
      : null,
    r.service !== 'pick' && r.dropStop
      ? `Drop: ${r.dropStop} · ${r.dropRoute ?? ''}${r.dropTime ? ` · ${r.dropTime}` : ''}`
      : null,
  ].filter((x): x is string => Boolean(x));

export interface Replacement {
  id: string;
  number: string;
  vehicleId: string;
  vehicle: string;
  vehicleName: string | null;
  replacement: string;
  replacementName: string | null;
  seats: number | null;
  replacementSeats: number | null;
  replacementGps: boolean;
  driver: string | null;
  driverMobile: string | null;
  conductor: string | null;
  conductorMobile: string | null;
  attendant: string | null;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
  phase: 'running' | 'upcoming' | 'over' | 'cancelled';
  routes: string;
  notified: number;
  notifiedAt: string | null;
  backNotifiedAt: string | null;
  endedNote: string | null;
  createdBy: string | null;
  createdAt: string;
}
export interface FleetPaper {
  owner: 'vehicle' | 'crew';
  ownerId: string;
  name: string;
  detail: string | null;
  kind: string;
  paper: string;
  validTill: string | null;
  daysLeft: number | null;
}
export const dayLabel = (d: string | null | undefined): string =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
