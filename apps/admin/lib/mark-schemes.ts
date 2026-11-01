import type { RegisterDef, RegStudentResult, Sheet } from '@edupro/ui';

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
      parts: Array<{ name: string; code: string | null; max: number }>;
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
  blocks: Array<{ title: string; sheet: Sheet }>;
  rows: Array<Omit<RegStudentResult, 'subjects'> & { subjects: unknown[] }>;
  notes: string[];
  counts: Record<string, number>;
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
