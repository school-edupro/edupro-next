/** Gate pass v2 (0069): the shapes and labels the ERP screens share. */
export type PassState =
  'pending' | 'approved' | 'rejected' | 'cancelled' | 'handed_over' | 'out' | 'returned';
export type PassKind = 'early_leave' | 'late_arrival' | 'rgp' | 'nrgp';

export interface GatePass {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  kind: PassKind;
  source: string;
  state: PassState;
  stage: string;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  reason: string;
  destination: string | null;
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  employee: string | null;
  employeeCode: string | null;
  designation: string | null;
  escortKind: string | null;
  escortName: string | null;
  escortRelation: string | null;
  escortMobile: string | null;
  passNo: string | null;
  passCode: string | null;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  approvedLevels: number;
  levels: number;
  waitingOn: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  handoverAt: string | null;
  handoverBy: string | null;
  otpVerified: boolean;
  outAt: string | null;
  outGate: string | null;
  inAt: string | null;
  gateNote: string | null;
  cancelReason: string | null;
  requestedBy: string | null;
  createdAt: string;
  hasPhoto: boolean;
  items: number;
  itemsDue: number;
}
export interface PassApproval {
  seq: number;
  label: string;
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
  approvers: string | null;
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  mine: boolean;
}
export interface PassItem {
  id: string;
  name: string;
  qty: number;
  serialNo: string | null;
  returnable: boolean;
  returnedQty: number;
  returnedAt: string | null;
}
export interface GatePassDetail extends GatePass {
  who: string;
  kindLabel: string;
  approvals: PassApproval[];
  canDecide: boolean;
  itemList: PassItem[];
  photos: {
    student: boolean;
    father: boolean;
    mother: boolean;
    guardian: boolean;
    collector: boolean;
  };
  guardians: Array<{ relation: string; name: string; mobileEnd: string | null }>;
  otpNeeded: boolean;
  qr: string | null;
  barcode: string | null;
  school: string;
}
export interface PassCounts {
  approval: number;
  handover: number;
  gate: number;
  out: number;
  today: number;
}
export interface GatePassLevel {
  audience: 'student' | 'staff';
  label: string;
  kind: 'class_teacher' | 'role' | 'designation' | 'employee';
  roleCode: string | null;
  designation: string | null;
  employeeId: string | null;
  employeeName?: string | null;
  active: boolean;
}
export interface GatePassSetup {
  settings: {
    studentMode: 'sequence' | 'any';
    studentNeed: number;
    staffMode: 'sequence' | 'any';
    staffNeed: number;
    handoverOtp: boolean;
    notifyEmail: boolean;
  };
  levels: GatePassLevel[];
  roles: Array<{ code: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  designations: string[];
}

export const KIND_LABEL: Record<PassKind, string> = {
  early_leave: 'Early leave',
  late_arrival: 'Late arrival',
  rgp: 'RGP · returnable',
  nrgp: 'NRGP · non-returnable',
};
export const STATE_TONE: Record<PassState, 'warning' | 'success' | 'danger' | 'info' | 'neutral'> =
  {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'neutral',
    handed_over: 'info',
    out: 'info',
    returned: 'neutral',
  };
export const APPROVAL_LABEL: Record<PassApproval['status'], string> = {
  waiting: 'Waits its turn',
  pending: 'To decide now',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Skipped',
};
export const APPROVAL_TONE: Record<
  PassApproval['status'],
  'warning' | 'success' | 'danger' | 'info' | 'neutral'
> = {
  waiting: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  skipped: 'neutral',
};

/** The person a pass is for: pupil with class and admission number, or employee with code. */
export const whoOfPass = (p: GatePass): string =>
  p.audience === 'student'
    ? `${p.student ?? 'Student'}${p.section ? ` (${p.section})` : ''}${p.admissionNo ? ` · Adm. no. ${p.admissionNo}` : ''}`
    : `${p.employee ?? 'Employee'}${p.employeeCode ? ` · ${p.employeeCode}` : ''}`;
/** Where the approval stands on one line: 2 of 3 · waiting on Principal. */
export const approvalLine = (p: GatePass): string => {
  const of = p.approvalMode === 'any' ? p.approvalNeed : p.levels;
  const base = `${String(p.approvedLevels)} of ${String(of)} approved`;
  return p.state === 'pending' && p.waitingOn ? `${base} · waiting on ${p.waitingOn}` : base;
};
export const escortLine = (p: GatePass): string | null =>
  p.escortName ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}` : null;
