import type { ChartTone } from '@/components/charts/Charts';
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
/** A class's analysis rules (docs/design/88): the best five built from parts, the marks, the grade scale. */
export type BestInclude = 'language' | 'english' | 'none';
export type BestRest = 'best' | 'printed';
export type BestOptional = 'replace' | 'never' | 'failed';
export type OptionalKind = 'language' | 'main' | 'skill' | 'additional';
export const BEST_INCLUDE: BestInclude[] = ['language', 'english', 'none'];
export const BEST_REST: BestRest[] = ['best', 'printed'];
export const BEST_OPTIONAL: BestOptional[] = ['replace', 'never', 'failed'];
export const OPTIONAL_KINDS: OptionalKind[] = ['language', 'main', 'skill', 'additional'];
/** the most grades a scale may have (the form shows this many rows) */
export const MAX_GRADES = 12;
export interface BestFiveSpec {
  include: BestInclude;
  rest: BestRest;
  optional: BestOptional;
  optionalKinds: OptionalKind[];
}
export interface GradeBand {
  grade: string;
  from: number;
  to: number;
}
export interface BoardRules {
  bestFive: BestFiveSpec;
  distinction: number;
  passMarks: number;
  grades: 'marks' | 'printed';
  scale: GradeBand[];
}

type Words = (key: string, values?: Record<string, string>) => string;
/** The best five in words, as the API's notes say it: "English and the best four other subjects; …". */
export function bestFiveWords(spec: BestFiveSpec, b: Words): string {
  const five = spec.include === 'none';
  const rest = b(`bfw_${spec.rest}_${five ? '5' : '4'}`);
  const head = five ? rest : b(`bfw_head_${spec.include}`, { rest });
  const kinds = spec.optionalKinds.map((k) => b(`bfk_${k}`));
  if (!kinds.length || spec.optional === 'replace') return head;
  const list =
    kinds.length === 1
      ? kinds[0]!
      : `${kinds.slice(0, -1).join(', ')} ${b('bfw_and')} ${kinds[kinds.length - 1]!}`;
  return b(`bfw_${spec.optional}`, { head, kinds: list });
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

// ---- the Reports tab: Teacher wise result analysis ----

export interface BoardTeacherAnalysis {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  gender: 'all' | 'M' | 'F';
  code: string | null;
  teacher: string | null;
  subjects: Array<{ code: string; name: string }>;
  /** a staff id, "n:<name>" for a name typed on the Teachers tab, or "none" */
  teachers: Array<{ key: string; name: string }>;
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
    /** A1 … E1 */
    grades: string[];
    /** each grade's chart tone (the class's scale: passing green … amber, failing red) */
    tones: ChartTone[];
    gradeSpread: Array<{
      code: string;
      name: string;
      appeared: number;
      counts: number[];
      pct: number[];
    }>;
    marks: Array<{ code: string; name: string; values: number[] }>;
    /** every subject (or the one chosen): its grades a year, as shares of those who appeared */
    subjectYears: Array<{
      code: string;
      name: string;
      series: Array<{ label: string; appeared: number; counts: number[]; pct: number[] }>;
    }>;
  } | null;
}

// ---- the Reports tab: Topper Report ----

export interface BoardTopperRow {
  rank: number;
  classRank: number | null;
  roll: string;
  name: string | null;
  sex: string | null;
  section: string | null;
  marks: number;
  max: number;
  pct: number;
  grade: string | null;
}

export interface BoardTopperList {
  kind: 'top' | 'low' | 'pct';
  ranks: number | null;
  rows: BoardTopperRow[];
}

export interface BoardToppersBlock {
  code: string | null;
  name: string;
  appeared: number;
  max: number;
  lists: BoardTopperList[];
}

export interface BoardToppers {
  classLabel: 'X' | 'XII';
  examYear: number | null;
  years: number[];
  compare: number;
  method: 'best5' | 'first5' | 'all';
  rule: string;
  gender: 'all' | 'M' | 'F';
  section: string | null;
  sections: string[];
  show: 'overall' | 'subjects' | 'both';
  codes: string[];
  top: number;
  low: number;
  pctOp: 'gte' | 'lte' | null;
  pct: number | null;
  subjects: Array<{ code: string; name: string }>;
  report: {
    overall: BoardToppersBlock | null;
    subjects: BoardToppersBlock[];
    years: Array<{
      examYear: number;
      label: string;
      appeared: number;
      highest: number | null;
      atFirst: number;
      cutoff: number | null;
      inTop: number;
      pct95: number;
      pct90: number;
    }>;
  } | null;
}
