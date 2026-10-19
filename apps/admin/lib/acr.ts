/** Employee ACR (docs/design/32-employee-acr.md): shapes from people/acr. */
export type StaffGroup = 'teaching' | 'non_teaching';
export type LevelKind =
  | 'acr_hod'
  | 'acr_reviewer'
  | 'approver_l1'
  | 'approver_l2'
  | 'approver_l3'
  | 'role'
  | 'designation'
  | 'employee';

export interface AcrLevel {
  seq?: number;
  label: string;
  kind: LevelKind;
  roleCode: string | null;
  designation: string | null;
  employeeId: string | null;
  employeeName?: string | null;
  action: 'rate' | 'review';
  /** 0191: the questionnaire this level answers (none: the grade and remarks only) */
  formId?: string | null;
  formName?: string | null;
}
export interface AcrQuestion {
  id: string;
  formId: string | null;
  sectionId: string | null;
  part: 'self' | 'rate';
  staffGroup: StaffGroup | 'both';
  section: string;
  text: string;
  kind: 'scale' | 'text' | 'yesno';
  weight: number;
  required: boolean;
  sortOrder: number;
  active: boolean;
}
/** 0191: a form (a self-appraisal of a staff category, or a level's questionnaire) with its sections. */
export interface AcrSection {
  id: string;
  title: string;
  help: string | null;
  weight: number;
  sortOrder: number;
  questions: AcrQuestion[];
}
export interface AcrForm {
  id: string;
  name: string;
  part: 'self' | 'level';
  staffGroup: StaffGroup | 'both';
  description: string | null;
  active: boolean;
  sortOrder: number;
  sections: AcrSection[];
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
  forms: AcrForm[];
  cycles: AcrCycle[];
  years: Array<{ id: string; code: string; status: string }>;
  roles: Array<{ code: string; name: string }>;
  designations: string[];
  staff: Array<{ id: string; name: string; code: string }>;
}

export const KIND_LABEL: Record<LevelKind, string> = {
  acr_hod: 'The employee’s ACR HOD',
  acr_reviewer: 'The employee’s ACR reviewer (a designation when nobody is set)',
  approver_l1: 'The employee’s L1 approver',
  approver_l2: 'The employee’s L2 approver',
  approver_l3: 'The employee’s L3 approver',
  role: 'Anyone with a role',
  designation: 'Anyone with a designation',
  employee: 'A named person',
};
/** Who assesses each employee (people/acr/setup/assessors, 0189; the whole chain per group, 0190). */
export interface AcrAssessorLevel {
  seq: number;
  label: string;
  kind: string;
  /** the record field this level reads, when it is employee-wise */
  field: string | null;
  /** the reviewer level's designation used when nobody is set on the record */
  fallback: string | null;
  /** who fills it when it is not employee-wise */
  fixed: string | null;
}
export interface AcrAssessorRow {
  id: string;
  code: string;
  name: string;
  department: string | null;
  designation: string | null;
  staffGroup: StaffGroup;
  assessors: Record<string, { id: string; name: string; code: string } | null>;
  missing: boolean;
}
export interface AcrAssessors {
  levels: Record<StaffGroup, AcrAssessorLevel[]>;
  maxSeq: number;
  /** the record fields in use: the CSV's columns */
  fields: Array<{ key: string; label: string }>;
  rows: AcrAssessorRow[];
  total: number;
  missing: number;
  departments: string[];
}
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
