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
  /** 0196: shown at the top of the level's step on the sheet; empty = the plain default */
  instructions?: string;
}
export interface AcrQuestion {
  id: string;
  formId: string | null;
  sectionId: string | null;
  part: 'self' | 'rate';
  staffGroup: StaffGroup | 'both';
  section: string;
  text: string;
  kind: 'scale' | 'text' | 'yesno' | 'file';
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
  /** 0192: a self-appraisal form for these employee types only (ids and names from Staff setup) */
  employeeTypeIds: string[];
  employeeTypes: string[];
  /** active employees this self form serves now; null for a level's questionnaire */
  appliesTo: number | null;
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
export interface AcrRemarkLine {
  id: string;
  grade: string;
  text: string;
  sortOrder: number;
  active: boolean;
}
export interface AcrSetup {
  settings: {
    scaleLabels: string[];
    representationDays: number;
    staffLateAfter: string;
    guidelines: string;
  };
  bands: AcrBand[];
  levels: Record<StaffGroup, AcrLevel[]>;
  questions: AcrQuestion[];
  forms: AcrForm[];
  employeeTypes: Array<{ id: string; name: string; staffGroup: string }>;
  /** Principal's remarks (0195): standard lines per grade */
  remarkLines: AcrRemarkLine[];
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
    /** the employee type on the record (Staff setup) */
    type: string | null;
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
  /** the self-appraisal form this ACR is on (0192) */
  form: string | null;
  /** every level with its people and where it stands: on the board only (ACR managers) */
  levels?: AcrRowLevel[];
}
export interface AcrRowLevel {
  seq: number;
  label: string;
  status: 'waiting' | 'pending' | 'done' | 'skipped';
  people: string[];
  filledAt: string | null;
  grade: string | null;
  skippedNote: string | null;
}
export const LEVEL_WORD: Record<AcrRowLevel['status'], string> = {
  waiting: 'not yet',
  pending: 'with them now',
  done: 'filled',
  skipped: 'skipped',
};
export const LEVEL_TONE: Record<AcrRowLevel['status'], string> = {
  waiting: 'neutral',
  pending: 'info',
  done: 'success',
  skipped: 'warning',
};
/** The export watcher's words while the workers make an ACR PDF. */
export const ACR_PDF_LABELS = {
  queued: 'ACR PDF requested',
  ready: 'ACR PDF',
  pending: 'Preparing the PDF… open it to print, or download it',
  failed: 'The PDF could not be made',
  stuck:
    'Still waiting after a minute: the workers service prepares files; check that it is running',
};
/** The board's filters, shared with the Excel export: status, staff, level now, department, type, search. */
export function filterAcrRows(
  rows: AcrRow[],
  f: { status?: string; group?: string; level?: string; dept?: string; type?: string; q?: string },
): AcrRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.status || r.status === f.status) &&
      (!f.group || r.staffGroup === f.group) &&
      (!f.level || r.level?.label === f.level) &&
      (!f.dept || (r.employee.department ?? '') === f.dept) &&
      (!f.type || (r.employee.type ?? '') === f.type) &&
      (!q ||
        `${r.employee.name} ${r.employee.code} ${r.employee.department ?? ''} ${r.employee.designation ?? ''} ${(r.levels ?? []).flatMap((l) => l.people).join(' ')}`
          .toLowerCase()
          .includes(q)),
  );
}
export const ACR_PAGE_SIZES = [25, 50, 100] as const;
export const ACR_STATUS: Record<AcrRow['status'], string> = {
  self: 'Self-appraisal',
  review: 'With the levels',
  disclosed: 'Shown to the employee',
  represented: 'Objection waiting',
  closed: 'Final',
};
