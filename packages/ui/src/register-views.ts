/**
 * The registers as the API gives them (docs/design/68, 69): mark registers, grade registers, the Remark, Attendance
 * and Height & Weight registers — shared by the admin app and the staff website (docs/design/97).
 */
import type { RegisterDef, RegStudentResult, Sheet } from './mark-register';

/** Mark registers as the API gives them (docs/design/68; the schemes of docs/design/65 part 3). */
export interface RegisterRights {
  manage: boolean;
  run: boolean;
  edit: boolean;
  delete: boolean;
  assign: boolean;
}
export interface MarkScheme {
  id: string;
  chainId: string;
  name: string;
  purpose: 'result' | 'register';
  termCode: string | null;
  classIds: string[];
  classes: Array<{ id: string; code: string; name: string }>;
  def: RegisterDef;
  exams: Array<{ key: string; examId: string; code: string | null; name: string | null }>;
  preset: string | null;
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previousId: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  computedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  results: number;
  problems: string[];
  rights: RegisterRights;
}
/** a row of the registers list */
export type RegisterRow = Omit<MarkScheme, 'def'> & {
  subjects: number;
  layout: RegisterDef['layout'];
  type: RegisterDef['type'];
  /** a draft being made from a locked version: that version's number */
  inUse: number | null;
  sameName: boolean;
  assignees: Array<{ name: string; rights: string }>;
};
export interface SchemePreset {
  code: string;
  name: string;
  description: string;
  examKeys: Array<{ key: string; label: string }>;
  columns: string[];
}
/** what the builder reads for its classes */
export interface BuilderData {
  exams: Array<{ id: string; code: string; name: string }>;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    classes: string[];
    papers: Array<{
      examId: string;
      classCode: string;
      max: number;
      weightage: number | null;
      /** subjectId: the part's sub-subject (Geography in Social Science), docs/design/72 */
      parts: Array<{ name: string; code: string | null; subjectId?: string | null; max: number }>;
    }>;
  }>;
  slots: Array<{ name: string; members: string[] }>;
  codes: RegisterDef['codes'][string];
  scales: Array<{ id: string; code: string; name: string }>;
  grades: RegisterDef['grades'];
}
export interface RunResponse {
  scheme: {
    id: string;
    name: string;
    purpose: 'result' | 'register';
    termCode: string | null;
    status: MarkScheme['status'];
    version: number;
    layout: RegisterDef['layout'];
    type: RegisterDef['type'];
  };
  places: Array<{ value: string; label: string; classId: string }>;
  exams: string[];
  exam: string | null;
  examName: string | null;
  subjects: Array<{ key: string; title: string }>;
  /** register, or one of the reports (docs/design/68, phase 2) */
  report: string;
  reports: Array<{ kind: string; label: string; merit: boolean }>;
  sheet: Sheet | null;
  /** a report's tables */
  blocks: Array<{ title: string; sheet: Sheet; band?: boolean }>;
  rows: Array<Omit<RegStudentResult, 'subjects'> & { subjects: unknown[] }>;
  notes: string[];
  counts: Record<string, number>;
  /** the attendance report's dates (docs/design/79) */
  range?: { from: string; to: string } | null;
}
export const SCHEME_STATUS: Record<
  MarkScheme['status'],
  { label: string; tone: 'neutral' | 'success' | 'warning' }
> = {
  draft: { label: 'Draft', tone: 'warning' },
  locked: { label: 'Locked', tone: 'success' },
  superseded: { label: 'Replaced', tone: 'neutral' },
};
export const COLUMN_KIND: Record<
  RegisterDef['subjects'][number]['columns'][number]['kind'],
  string
> = {
  raw: 'EXAM',
  part: 'SUB-PART',
  avg: 'AVERAGE',
  conv: 'CONVERSION',
  attendance: 'ATTENDANCE',
};

import type { GradeRegisterDef, GradeTree } from './grade-register';

/** Grade registers as the API gives them (docs/design/69). */
export interface GradeRegister {
  id: string;
  chainId: string;
  name: string;
  classIds: string[];
  classes: Array<{ id: string; code: string; name: string }>;
  def: GradeRegisterDef;
  exams: Array<{ examId: string; label: string; code: string | null; name: string | null }>;
  /** all: every indicator of the register; mapping: a teacher sees only the areas given to them */
  accessType: 'all' | 'mapping';
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previousId: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  problems: string[];
  rights: RegisterRights;
}
/** a row of the grade registers list */
export type GradeRegisterRow = Omit<GradeRegister, 'def'> & {
  assessments: string[];
  /** a draft being made from a locked version: that version's number */
  inUse: number | null;
  sameName: boolean;
  assignees: Array<{ name: string; rights: string }>;
};
/** what the builder reads */
export interface GradeBuilderData {
  classes: Array<{ id: string; code: string; name: string; noGrades: boolean }>;
  exams: Array<{ id: string; code: string; name: string; classes: string[] }>;
  tree: GradeTree | null;
  /** the levels of the sets the classes use (a starting grade scale) */
  levels: string[];
}
/** GET /exams/grade-registers/:id/run (docs/design/69, part 3) */
export interface GradeRunResponse {
  register: {
    id: string;
    name: string;
    version: number;
    status: GradeRegister['status'];
    accessType: GradeRegister['accessType'];
  };
  places: Array<{ value: string; label: string }>;
  place: string | null;
  layout: 'class' | 'student';
  report: 'sheet' | 'summary' | 'analysis' | 'analysis-all';
  exams: Array<{ examId: string; label: string; name: string }>;
  /** the filter's choices (the section's areas and items, as per mapping) */
  areas: Array<{ key: string; name: string }>;
  items: Array<{ key: string; name: string; area: string }>;
  chosen: { areas: string[] | null; items: string[] | null };
  sheets: Sheet[];
  notes: string[];
  /** as per mapping, for this person */
  mapped: boolean;
}

/** GET /exams/registers/:type (docs/design/69): the Remark, Attendance or Height & Weight register. */
export interface StudentRegisterResponse {
  type: 'remark' | 'attendance' | 'health';
  title: string;
  /** every section of the school (a manager), else the sections the person teaches */
  all: boolean;
  classes: Array<{ id: string; code: string; name: string }>;
  classId: string | null;
  sections: Array<{ id: string; code: string }>;
  section: string | null;
  exams: Array<{ id: string; code: string; name: string }>;
  picked: string[];
  cutoff: number;
  bmi: boolean;
  places: Array<{ id: string; place: string; sheets: Sheet[]; notes: string[] }>;
}
