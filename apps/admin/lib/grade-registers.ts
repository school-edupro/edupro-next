import type { GradeRegisterDef, GradeTree, Sheet } from '@edupro/ui';
import type { RegisterRights } from './mark-schemes';

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
