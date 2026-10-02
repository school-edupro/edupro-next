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
  columns: Array<{
    key: string;
    label?: string | null;
    width?: number | null;
    /** Detailed layout: fields with the same number stack in one column. */
    group?: number | null;
    highlight?: boolean;
    /** Excluded from the screen and the exports. */
    hidden?: boolean;
  }>;
  layout?: 'table' | 'detailed';
  groupLabels?: Record<string, string>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  options: {
    paper: 'A4' | 'A3';
    orientation: 'auto' | 'portrait' | 'landscape';
    academicYearId?: string | null;
    includeInactive?: boolean;
    search?: string | null;
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
  columns: Array<{ key: string; header: string; type: string; width: number; highlight?: boolean }>;
  layout?: 'table' | 'detailed';
  groups?: Array<{ label: string | null; keys: string[] }>;
  excluded?: string[];
  highlighted?: string[];
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

/** The office-register template: class, student, father, mother, address and contacts as stacks. */
export const DETAILED_TEMPLATE: ReportSpec['columns'] = (
  [
    ['class_section', 1],
    ['full_name', 2],
    ['admission_no', 2],
    ['dob', 2],
    ['admitted_on', 2],
    ['gender', 2],
    ['category', 2],
    ['aadhaar_no', 2],
    ['father_name', 3],
    ['father_education', 3],
    ['father_designation', 3],
    ['father_organisation', 3],
    ['father_office_address_line_1', 3],
    ['father_mobile', 3],
    ['father_aadhaar_no', 3],
    ['mother_name', 4],
    ['mother_education', 4],
    ['mother_designation', 4],
    ['mother_organisation', 4],
    ['mother_office_address_line_1', 4],
    ['mother_mobile', 4],
    ['mother_aadhaar_no', 4],
    ['residential_address_line_1', 5],
    ['sms_mobile', 5],
    ['alternate_mobile', 5],
    ['primary_email', 5],
  ] as const
).map(([key, group]) => ({ key, group }));

/**
 * Columns a PDF page must hold, counted as the server does: excluded fields do not count, and in the
 * detailed layout fields with the same stack number share one column (plus the Sr# column).
 */
export function pdfColumnCount(spec: ReportSpec): number {
  const shown = spec.columns.filter((c) => !c.hidden);
  if (spec.layout !== 'detailed') return shown.length;
  const stacks = new Set(shown.map((c) => (c.group ? `g${String(c.group)}` : `k:${c.key}`)));
  return stacks.size + 1;
}
