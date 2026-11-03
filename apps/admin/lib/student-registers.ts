import type { Sheet } from '@edupro/ui';

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
