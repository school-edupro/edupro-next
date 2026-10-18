/** Employee ACR (docs/design/32-employee-acr.md): shapes from people/acr. */
export type StaffGroup = 'teaching' | 'non_teaching';
export type LevelKind =
  'acr_hod' | 'approver_l1' | 'approver_l2' | 'approver_l3' | 'role' | 'designation' | 'employee';

export interface AcrLevel {
  seq?: number;
  label: string;
  kind: LevelKind;
  roleCode: string | null;
  designation: string | null;
  employeeId: string | null;
  employeeName?: string | null;
  action: 'rate' | 'review';
}
export interface AcrQuestion {
  id: string;
  part: 'self' | 'rate';
  staffGroup: StaffGroup | 'both';
  section: string;
  text: string;
  kind: 'scale' | 'text';
  weight: number;
  required: boolean;
  sortOrder: number;
  active: boolean;
}
export interface AcrBand {
  minPct: number;
  label: string;
  adverse: boolean;
}
export interface AcrCycle {
  id: string;
  academicYearId: string;
  year: string;
  name: string;
  selfFrom: string;
  selfTo: string;
  reviewBy: string | null;
  status: 'draft' | 'open' | 'closed';
  reports: number;
  closed: number;
}
export interface AcrSetup {
  settings: { scaleLabels: string[]; representationDays: number; staffLateAfter: string };
  bands: AcrBand[];
  levels: Record<StaffGroup, AcrLevel[]>;
  questions: AcrQuestion[];
  cycles: AcrCycle[];
  years: Array<{ id: string; code: string; status: string }>;
  roles: Array<{ code: string; name: string }>;
  designations: string[];
  staff: Array<{ id: string; name: string; code: string }>;
}

export const KIND_LABEL: Record<LevelKind, string> = {
  acr_hod: 'The employee’s ACR HOD',
  approver_l1: 'The employee’s L1 approver',
  approver_l2: 'The employee’s L2 approver',
  approver_l3: 'The employee’s L3 approver',
  role: 'Anyone with a role',
  designation: 'Anyone with a designation',
  employee: 'A named person',
};
export const GROUP_LABEL: Record<StaffGroup | 'both', string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  both: 'Both',
};

/** One ACR on the board (people/acr/board, mine, to-assess, employee/:id). */
export interface AcrRow {
  id: string;
  cycleId: string;
  cycle: string;
  employee: {
    id: string;
    name: string;
    code: string;
    department: string | null;
    designation: string | null;
  };
  staffGroup: StaffGroup;
  status: 'self' | 'review' | 'disclosed' | 'represented' | 'closed';
  level: { seq: number; label: string | null; waitingOn: string[] } | null;
  selfPct: number | null;
  scorePct: number | null;
  grade: string | null;
  adverse: boolean;
  objectBy: string | null;
  updatedAt: string;
}
export const ACR_STATUS: Record<AcrRow['status'], string> = {
  self: 'Self-appraisal',
  review: 'With the levels',
  disclosed: 'Shown to the employee',
  represented: 'Objection waiting',
  closed: 'Final',
};
