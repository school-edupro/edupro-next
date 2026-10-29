/** Mark schemes as the API gives them (docs/design/65, part 3). */
export type Rounding = 'none' | 'two' | 'whole' | 'half_kept' | 'up';
export interface SchemeColumn {
  key: string;
  label: string;
  kind: 'raw' | 'average' | 'sum' | 'convert' | 'attendance';
  exam?: string;
  part?: string;
  wholeIfNoParts?: boolean;
  of?: string[];
  best?: number;
  scale?: number | 'rest';
  round?: Rounding;
  hidden?: boolean;
  total?: boolean;
  target?: number;
  passGroup?: 'theory' | 'practical';
}
export interface SchemeDef {
  exams: Array<{ key: string; examId: string }>;
  columns: SchemeColumn[];
  codes?: Record<string, string>;
  attendance?: Array<{ minPct: number; marks: number }>;
  result: {
    passPct: number;
    partsEach?: boolean;
    compartmentUpTo: number;
    divisions?: Array<{ name: string; minPct: number }>;
    rankBy: 'total' | 'pct';
    countAdditional?: boolean;
    totalRound?: Rounding;
  };
  gradeScaleId?: string | null;
}
export interface MarkScheme {
  id: string;
  name: string;
  purpose: 'result' | 'register';
  termCode: string | null;
  classIds: string[];
  classes: Array<{ id: string; code: string; name: string }>;
  def: SchemeDef;
  exams: Array<{ key: string; examId: string; code: string | null; name: string | null }>;
  preset: string | null;
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previousId: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  computedAt: string | null;
  results: number;
  problems: string[];
}
export interface SchemePreset {
  code: string;
  name: string;
  description: string;
  examKeys: Array<{ key: string; label: string }>;
  columns: string[];
}
export const SCHEME_STATUS: Record<
  MarkScheme['status'],
  { label: string; tone: 'neutral' | 'success' | 'warning' }
> = {
  draft: { label: 'Draft', tone: 'warning' },
  locked: { label: 'Locked', tone: 'success' },
  superseded: { label: 'Replaced', tone: 'neutral' },
};
export const ROUNDING: Record<Rounding, string> = {
  two: '2 decimals',
  whole: 'Whole, half up',
  half_kept: 'Whole, .5 kept',
  up: 'Round up',
  none: 'As worked out',
};
export const KINDS: Record<SchemeColumn['kind'], string> = {
  raw: "An exam's marks",
  average: 'Average (or best N)',
  sum: 'Sum',
  convert: 'Convert to a maximum',
  attendance: 'Attendance slabs',
};
