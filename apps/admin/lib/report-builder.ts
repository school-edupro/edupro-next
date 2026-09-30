/** Report builder shapes (API reports/builder). */

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'starts'
  | 'empty'
  | 'not_empty'
  | 'between'
  | 'gte'
  | 'lte';

export interface BuilderField {
  key: string;
  label: string;
  section: string;
  type: 'text' | 'number' | 'date';
  list?: string | null;
  sensitive?: boolean;
  masked: boolean;
  options: string[] | null;
}

export interface BuilderFields {
  sections: Array<{ id: string; title: string }>;
  fields: BuilderField[];
  ops: FilterOp[];
  pdfColumnLimit: { A4: number; A3: number };
  years: Array<{ id: string; code: string; status: string }>;
  canManage: boolean;
}

export interface ReportSpec {
  columns: Array<{ key: string; label?: string | null; width?: number | null }>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  options: {
    paper: 'A4' | 'A3';
    orientation: 'auto' | 'portrait' | 'landscape';
    academicYearId?: string | null;
    includeInactive?: boolean;
  };
}

export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  spec: ReportSpec;
  ownerId: string;
  ownerName: string | null;
  isOwner: boolean;
  canEdit: boolean;
  canShare: boolean;
  sharedWithMe: boolean;
  shares: Array<{ userId: string | null; roleId: string | null; name: string; canEdit: boolean }>;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface PreviewResult {
  columns: Array<{ key: string; header: string; type: string; width: number }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  filtersText: string[];
  academicYear: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; errors?: string[] };

export const OP_LABELS: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  contains: 'contains',
  starts: 'starts with',
  empty: 'is empty',
  not_empty: 'is filled in',
  between: 'is between',
  gte: 'at least / on or after',
  lte: 'at most / on or before',
};

/** Operators that make sense for a field type. */
export function opsFor(type: BuilderField['type']): FilterOp[] {
  if (type === 'text')
    return ['eq', 'neq', 'in', 'not_in', 'contains', 'starts', 'empty', 'not_empty'];
  return ['eq', 'neq', 'between', 'gte', 'lte', 'empty', 'not_empty'];
}

export const EMPTY_SPEC: ReportSpec = {
  columns: [
    { key: 'admission_no' },
    { key: 'full_name' },
    { key: 'class_section' },
    { key: 'roll_no' },
  ],
  filters: [],
  sort: [
    { key: 'class_section', dir: 'asc' },
    { key: 'roll_no', dir: 'asc' },
  ],
  options: { paper: 'A4', orientation: 'auto', includeInactive: false },
};
