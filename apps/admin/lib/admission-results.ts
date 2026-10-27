/** Test and interview results by part (docs/design/57, part 2). */
import type { Paper } from './admission-papers';

export type ResultState = 'waiting' | 'held' | 'selected' | 'rejected' | 'sent_back' | 'other';
export const STATE_WORDS: Record<ResultState, string> = {
  waiting: 'Waiting',
  held: 'Held',
  selected: 'Selected',
  rejected: 'Not selected',
  sent_back: 'Sent back',
  other: 'Past this stage',
};
export interface ResultRow {
  id: string;
  number: string | null;
  candidate: string | null;
  category: string | null;
  rollNo: number | null;
  slotId: string | null;
  slot: string | null;
  state: ResultState;
  level: string | null;
  marks: Record<string, number | null>;
  absent: boolean;
  total: number | null;
  maxTotal: number | null;
  percent: number | null;
  below: boolean;
  remark: string | null;
  decision: { decision: string; by: string | null; at: string } | null;
  marked: boolean;
}
export interface ResultsView {
  place: {
    cycle: string;
    className: string;
    stage: string;
    kind: 'test' | 'interview';
    paper: Paper | null;
  };
  slots: Array<{ id: string; label: string }>;
  /** the marks shown to families from a date and time (docs/design/57, part 4) */
  release: ResultsRelease | null;
  counts: { all: number; waiting: number; marked: number; below: number };
  rows: ResultRow[];
}
export interface ResultsRelease {
  at: string;
  passed: boolean;
  by: string | null;
  toldAt: string | null;
  toldCount: number | null;
}
export interface ResultsOptions {
  cycles: Array<{
    id: string;
    name: string;
    status: string;
    classes: Array<{ id: string; name: string }>;
  }>;
  stages: Array<{ id: string; name: string; kind: string }>;
}
export interface ResultsSheetResult {
  place: string;
  applied: boolean;
  ok: number;
  done: number;
  skipped: number;
  errors: number;
  notFound: string[];
  rows: Array<{
    row: number;
    number: string;
    candidate: string | null;
    total: number | null;
    decision: string | null;
    status: 'ok' | 'skipped' | 'error' | 'done';
    reason: string | null;
  }>;
}
export const BANDS = [
  '0-10',
  '11-20',
  '21-30',
  '31-40',
  '41-50',
  '51-60',
  '61-70',
  '71-80',
  '81-90',
  '91-100',
];
