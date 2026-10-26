import type { AdmissionCondition } from '@edupro/ui';

/** Merit score tables, the score report and number series (docs/design/48). */
export type ScoreTableName = 'qualification' | 'locality' | 'alumni_school';

export interface ScoreRow {
  id: string;
  name: string;
  fatherScore?: number;
  motherScore?: number;
  fatherWeight?: number;
  motherWeight?: number;
  classId?: string | null;
  className?: string | null;
  band?: string | null;
  area?: string | null;
  passoutClass?: string;
  score?: number;
}
export interface ScoreTables {
  qualification: ScoreRow[];
  locality: ScoreRow[];
  alumni_school: ScoreRow[];
  classes: Array<{ id: string; name: string }>;
  /** the school's lists the tables pick from (Education, Locality, AlumniClass) and the schools named */
  options: ScoreOptions;
}
export interface ScoreOptions {
  qualification: string[];
  locality: string[];
  passout: string[];
  schools: string[];
}
export const TABLE_TITLE: Record<ScoreTableName, string> = {
  qualification: 'Qualifications',
  locality: 'Localities (distance)',
  alumni_school: 'Alumni schools',
};

export interface ScoreReport {
  session: string;
  className: string;
  max: number | null;
  criteria: Array<{
    name: string;
    kind: 'fixed' | 'table' | 'sibling';
    cap: number | null;
    points: number;
  }>;
  rows: Array<{
    id: string;
    number: string | null;
    candidate: string | null;
    category: string | null;
    status: string;
    lines: Array<{ points: number; max: number; check: string | null } | null>;
    points: number | null;
    marks: number | null;
    merit: number | null;
    confirmed: boolean;
    check: boolean;
    rank: number | null;
  }>;
}

export interface NumberSeries {
  id: string;
  kind: 'registration' | 'admission';
  cycleId: string;
  cycleName: string;
  classId: string | null;
  className: string | null;
  conditions: AdmissionCondition[];
  name: string;
  prefix: string;
  nextNo: number;
  digits: number;
  next: string;
  lastGiven: string | null;
  given: number;
}
export interface NumberSeriesSetup {
  series: NumberSeries[];
  cycles: Array<{
    id: string;
    name: string;
    defaultRegistration: string;
    classes: Array<{ id: string; name: string }>;
  }>;
}

/** A series' number as it will be given ("DP1" + 1, 4 digits → DP10001). */
export const seriesText = (prefix: string, n: number, digits: number) =>
  `${prefix}${String(Math.max(0, Math.trunc(n || 0))).padStart(digits, '0')}`;
