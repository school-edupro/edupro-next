/** Board results (docs/design/88): what the screens show of an upload, a candidate and a layout. */

export type BoardTab = 'upload' | 'results' | 'analysis' | 'reports' | 'teachers' | 'setup';

export interface BoardImport {
  id: string;
  kind: 'sheet' | 'gazette';
  board: string;
  classLabel: 'X' | 'XII';
  examYear: number | null;
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  replacedAt: string | null;
  layoutHow: 'fingerprint' | 'tried' | 'claude' | null;
  figures: Partial<GazetteFigures>;
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  unmatchedRows: number;
  report: BoardProblem[];
  createdAt: string;
  committedAt: string | null;
}

export interface BoardProblem {
  line?: number;
  row?: number;
  roll?: string;
  field?: string;
  column?: string;
  message: string;
  level?: 'error' | 'warning';
}

export interface GazetteFigures {
  candidates: number;
  appeared: number;
  results: Record<string, number>;
  subjects: Array<{
    code: string;
    candidates: number;
    absent: number;
    highest: number | null;
    average: number | null;
  }>;
  matched: { roll: number; name: number; none: number };
  problems: { errors: number; warnings: number; candidatesWithErrors: number };
  layout: {
    model: string;
    notes: string;
    masked: number;
    usage: { inputTokens: number; outputTokens: number };
  } | null;
}

export interface GazetteCandidate {
  line: number;
  roll: string;
  flag: string;
  sex: string;
  name: string;
  subjects: Array<{
    slot: number;
    code: string;
    marks: number | null;
    absent: boolean;
    grade: string;
  }>;
  internalGrades: string[];
  result: string;
  compartment: string[];
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  match: 'roll' | 'name' | 'none';
}

export interface BoardLayout {
  key: string;
  name: string;
  classLabel: 'X' | 'XII';
  source: 'built-in' | 'claude' | 'edited';
  model: string | null;
  notes: string | null;
  active: boolean;
  learnedFrom: { importId: string; fileName: string | null } | null;
  createdAt: string | null;
}

export interface BoardImportDetail extends BoardImport {
  saved: BoardSaved | null;
  subjectNames: Record<string, string>;
  academicYear: string | null;
  by: string | null;
  layout: BoardLayout | null;
  replacedBy: string | null;
  replaces: { id: string; fileName: string | null; committedAt: string } | null;
  candidates: GazetteCandidate[];
}

export interface BoardYear {
  id: string;
  name: string;
  examYear: number;
  current: boolean;
}

/** What each result word CBSE prints means. */
export const RESULT_WORDS: Record<string, string> = {
  PASS: 'Passed',
  COMP: 'Compartment',
  FAIL: 'Failed',
  ER: 'Essential repeat',
  ABST: 'Absent',
  RW: 'Result withheld',
  RL: 'Result later',
  UFM: 'Unfair means case',
  XXXX: 'Not declared',
};

/** How an upload's layout was found. */
export const LAYOUT_HOW: Record<NonNullable<BoardImport['layoutHow']>, string> = {
  fingerprint: 'Recognised by its column headings',
  tried: 'Read with a known layout',
  claude: 'New layout: learned by the AI from masked lines',
};

export const statusOf = (i: Pick<BoardImport, 'status' | 'replacedAt'>) =>
  i.replacedAt
    ? ({ tone: 'neutral', key: 'replaced', word: 'Replaced' } as const)
    : i.status === 'committed'
      ? ({ tone: 'success', key: 'saved', word: 'Saved' } as const)
      : i.status === 'failed'
        ? ({ tone: 'danger', key: 'failed', word: 'Did not pass its checks' } as const)
        : ({ tone: 'info', key: 'waiting', word: 'Waiting to be saved' } as const);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 17 Nov 2026, 10:42 am (IST) */
export function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  const h = d.getUTCHours();
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]!} ${String(d.getUTCFullYear())}, ${String(h % 12 || 12)}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// ---- phase B --------------------------------------------------------------------------------------------------------

export interface BoardSaved {
  roll: number;
  name: number;
  picked: number;
  none: number;
  notOurs: number;
  fromRecord: number;
  fromSheet: number;
}

export interface BoardReview {
  classLabel: 'X' | 'XII';
  examYear: number;
  candidates: Array<{
    id: string;
    roll: string;
    name: string | null;
    sex: string | null;
    match: 'roll' | 'name' | 'picked' | 'none' | 'not_ours';
    student: { id: string; name: string; admissionNo: string | null } | null;
    suggested: string[];
  }>;
  students: Array<{ id: string; name: string; admissionNo: string; section: string; sex: string }>;
}

export type BoardSubjectKind = 'language' | 'main' | 'skill' | 'additional' | 'internal';
export interface BoardSubjectRow {
  id: string;
  code: string;
  name: string | null;
  kind: BoardSubjectKind;
  subject: { id: string; name: string } | null;
  candidates: number;
}

export interface BoardTeachers {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  rows: Array<{
    section: string | null;
    code: string;
    name: string | null;
    candidates: number;
    teachers: Array<{ name: string | null; candidates: number }>;
    overrides: Array<{ id: string; name: string; employeeId: string | null; rolls: string[] }>;
  }>;
  options: Array<{ id: string; name: string; code: string }>;
}

export const MATCH_WORD: Record<BoardReview['candidates'][number]['match'], string> = {
  roll: 'By board roll no',
  name: 'By name',
  picked: 'Picked',
  none: 'Not found',
  not_ours: 'Not our student',
};

// ---- phase C: the annexures (docs/design/88) ----

export type AnCell = string | number | null;
export interface AnColumn {
  key: string;
  label: string;
  group?: string;
  num?: boolean;
  width?: number;
}
export interface AnTable {
  key: string;
  title: string;
  columns: AnColumn[];
  rows: Array<Record<string, AnCell>>;
  strong?: number[];
  blocks?: boolean;
  note?: string;
}
export interface Annexure {
  no: number;
  title: string;
  tables: AnTable[];
}
export type BestFiveRule = 'language-plus-four' | 'english-plus-four' | 'any-five';
export interface BoardRules {
  bestFive: BestFiveRule;
  distinction: number;
  passMarks: number;
  grades: 'marks' | 'printed';
}
export interface BoardAnalysisView {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  sections: string[];
  section: string | null;
  rules: BoardRules;
  rulesDefault: boolean;
  file: { id: string; fileName: string | null; savedAt: string | null } | null;
  analysis: {
    classLabel: 'X' | 'XII';
    examYear: number;
    headline: {
      registered: number;
      appeared: number;
      absent: number;
      failures: number;
      compartments: number;
      passed: number;
      passPct: number | null;
      aggregate: number | null;
      n90: number;
      n75: number;
      pct90: number | null;
      pct75: number | null;
    };
    annexures: Annexure[];
  } | null;
}
export const BEST_FIVE: BestFiveRule[] = ['language-plus-four', 'english-plus-four', 'any-five'];
/** The year as the school writes it: 2026 → "2025-26". */
export const yearLabel = (y: number) => `${String(y - 1)}-${String(y).slice(2)}`;

// ---- phase D: a student's board results, the exam page's figures ----

export interface BoardStudentResult {
  studentId: string;
  classLabel: 'X' | 'XII';
  examYear: number;
  roll: string;
  result: string | null;
  compartment: Array<{ code: string; name: string }>;
  subjects: Array<{
    code: string;
    name: string;
    kind: string | null;
    marks: number | null;
    grade: string | null;
    inBestFive: boolean;
  }>;
  bestFive: { total: number; percent: number } | null;
  rule: string;
}
export interface BoardSummary {
  classes: Array<{
    classLabel: 'X' | 'XII';
    examYear: number;
    appeared: number;
    passPct: number | null;
    aggregate: number | null;
    pct90: number | null;
    pi: number | null;
  }>;
}

// ---- phase E: earlier years' figures typed in ----

export interface BoardYearSubject {
  code: string;
  appeared: number;
  highest?: number | null;
  aGrades?: number | null;
  compartments?: number | null;
  failures?: number | null;
  distinctions?: number | null;
  average?: number | null;
  pi?: number | null;
}
export interface BoardYearFigures {
  classLabel: 'X' | 'XII';
  subjects: Array<{ code: string; name: string; kind: string }>;
  rows: Array<{
    id: string;
    examYear: number;
    registered: number | null;
    appeared: number;
    passed: number | null;
    compartments: number | null;
    failures: number | null;
    n90: number | null;
    n75: number | null;
    aggregate: number | null;
    pi: number | null;
    subjects: BoardYearSubject[];
    note: string | null;
    updatedAt: string;
    fileSaved: boolean;
  }>;
}
/** The order of a subject line's figures when typed or pasted (after the code). */
export const YEAR_SUBJECT_FIELDS = [
  'appeared',
  'highest',
  'aGrades',
  'compartments',
  'failures',
  'distinctions',
  'average',
  'pi',
] as const;

// ---- the Results tab: candidate-wise marks ----

export interface BoardMarks {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  sections: string[];
  results: Array<{ word: string; n: number }>;
  method: 'best5' | 'first5' | 'all';
  rule: string;
  total: number;
  page: number;
  size: number;
  maxSubjects: number;
  rows: Array<{
    sr: number;
    roll: string;
    name: string | null;
    sex: string | null;
    section: string | null;
    studentId: string | null;
    admissionNo: string | null;
    result: string | null;
    compartment: Array<{ code: string; name: string }>;
    subjects: Array<{
      code: string;
      name: string;
      short: string;
      marks: number | null;
      grade: string | null;
      counted: boolean;
    }>;
    max: number | null;
    total: number | null;
    percent: number | null;
    rank: number | null;
  }>;
}

// ---- the Reports tab: Range Wise Subject Summary ----

export interface BoardRange {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  compare: number;
  gender: 'all' | 'M' | 'F';
  code: string | null;
  subjects: Array<{ code: string; name: string }>;
  grades: 'marks' | 'printed';
  summary: {
    years: number[];
    blocks: Array<{
      code: string;
      name: string;
      rows: Array<{
        key: string;
        label: string;
        values: Record<string, { count: number | null; pct: number | null }>;
      }>;
    }>;
  } | null;
}

// ---- the Reports tab: Range Wise Summary (the class's result) ----

export interface BoardOverall {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  compare: number;
  gender: 'all' | 'M' | 'F';
  method: 'best5' | 'first5' | 'all';
  rule: string;
  summary: NonNullable<BoardRange['summary']> | null;
}

// ---- the Reports tab: Subject Summary ----

export interface BoardSubjectPerf {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  gender: 'all' | 'M' | 'F';
  code: string | null;
  subjects: Array<{ code: string; name: string }>;
  table: AnTable | null;
}

// ---- the Reports tab: Result Analysis ----

export interface BoardResultAnalysis {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  compare: number;
  gender: 'all' | 'M' | 'F' | 'both';
  code: string | null;
  result: string | null;
  results: Array<{ word: string; n: number }>;
  grades: 'marks' | 'printed';
  subjects: Array<{ code: string; name: string }>;
  table: AnTable | null;
  charts: {
    passTrend: { labels: string[]; series: Array<{ label: string; values: Array<number | null> }> };
    gradeSpread: Array<{ code: string; name: string; values: number[] }>;
    marks: Array<{ code: string; name: string; values: number[] }>;
    subjectYears: {
      code: string;
      name: string;
      labels: string[];
      series: Array<{ label: string; values: number[] }>;
    } | null;
  } | null;
}
