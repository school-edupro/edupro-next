/** Board results (docs/design/88): what the screens show of an upload, a candidate and a layout. */

export type BoardTab = 'upload' | 'results' | 'analysis' | 'setup';

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
