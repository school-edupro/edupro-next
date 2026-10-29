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
  /** the merit list, or a Written test / Interview stage's result (docs/design/62) */
  view: { id: string; name: string; kind: string };
  views: Array<{ id: string; name: string; kind: string }>;
  max: number | null;
  /** a column per level of the class's process (docs/design/50) */
  levels: string[];
  /** the marks: a column per subject or parameter, each stage's total; one for a stage without a paper (docs/design/61) */
  marks: Array<{
    stage: string;
    label: string;
    max: number | null;
    kind: 'part' | 'total' | 'stage';
  }>;
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
    /** the marks in the order of `marks` (AB: absent) */
    cells: Array<number | 'AB' | null>;
    merit: number | null;
    /** the merit (merit list) or the stage's total (a stage's view) */
    total: number | null;
    /** a stage's view: the total as % of its maximum */
    percent: number | null;
    confirmed: boolean;
    check: boolean;
    rank: number | null;
    /** each level's decision and remark, in the order of `levels` */
    remarks: Array<string | null>;
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
  /** {CLASS} in a series for every class: `next` is one class's sample (docs/design/63) */
  perClass: boolean;
}
export interface NumberSeriesSetup {
  series: NumberSeries[];
  cycles: Array<{
    id: string;
    name: string;
    defaultRegistration: string;
    /** the academic year, for {SESSION} (2027-28) */
    session: string;
    registrations: number;
    classes: Array<{ id: string; name: string; code: string }>;
  }>;
}

/** The placeholders a prefix may hold (docs/design/63), with what each gives. */
export const PREFIX_PLACEHOLDERS: Array<[string, string]> = [
  ['{SESSION}', 'the session, e.g. 2027-28'],
  ['{YYYY}', 'its first year, e.g. 2027'],
  ['{YY}', 'e.g. 27'],
  ['{CLASS}', "the class's code, e.g. I, VI, NUR"],
];
/** The prefix with its placeholders filled, as the API fills them. */
export const fillPrefix = (prefix: string, session: string, classCode: string | null) => {
  const s = session.replace(/^Session\s+/i, '').replace(/\s+/g, '');
  const yyyy = s.match(/\d{4}/)?.[0] ?? '';
  return prefix
    .replaceAll('{SESSION}', s)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yyyy.slice(2))
    .replaceAll('{CLASS}', (classCode ?? '').replace(/\s+/g, ''));
};
/** Test a series: the series a registration would take and its number, or the default. */
export interface NumberSeriesTestResult {
  series: { id: string; name: string } | null;
  number: string | null;
  usual: string | null;
}
/** Renumbering registrations already made: old → new, applied or a preview. */
export interface NumberSeriesRenumberResult {
  applied: boolean;
  rows: Array<{ id: string; candidate: string | null; from: string; to: string }>;
  skipped: number;
  series: NumberSeries[];
}

/** A series' number as it will be given ("DP1" + 1, 4 digits → DP10001). */
export const seriesText = (prefix: string, n: number, digits: number) =>
  `${prefix}${String(Math.max(0, Math.trunc(n || 0))).padStart(digits, '0')}`;

/** The score report's sessions and classes with their registrations (docs/design/61). */
export interface ScoreReportOptions {
  cycles: Array<{
    id: string;
    name: string;
    registrations: number;
    classes: Array<{ id: string; name: string; registrations: number }>;
  }>;
}
