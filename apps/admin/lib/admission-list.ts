import type { BuilderField, FilterOp } from './report-builder';

/** The admissions list shapes (API admissions/registrations/grid; docs/design/39, part 7). */
export type AdmissionListStatus = 'in_progress' | 'unfinished' | 'admitted' | 'closed' | 'all';

export interface AdmissionListView {
  columns: Array<{ key: string; label?: string | null }>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  search?: string;
  status: AdmissionListStatus;
  size: number;
}
export interface AdmissionListQuery extends AdmissionListView {
  page: number;
}
export interface AdmissionListResult {
  columns: Array<{ key: string; header: string; type: string }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  page: number;
  pages: number;
  stats: {
    total: number;
    in_progress: number;
    unfinished: number;
    admitted: number;
    closed: number;
  };
  searchedAll?: boolean;
}
export interface AdmissionListFields {
  sections: Array<{ id: string; title: string }>;
  fields: BuilderField[];
}

export const DEFAULT_ADMISSION_VIEW: AdmissionListView = {
  columns: [
    { key: 'class_sought' },
    { key: 'session' },
    { key: 'category' },
    { key: 'stage' },
    { key: 'mobile' },
    { key: 'registered_on' },
    { key: 'admission_no' },
  ],
  filters: [],
  sort: [],
  search: '',
  status: 'in_progress',
  size: 50,
};

export const ADMISSION_QUICK_FILTERS: string[] = [
  'session',
  'class_sought',
  'status',
  'stage',
  'category',
  'entered_at',
];

const STATUSES = new Set(['in_progress', 'unfinished', 'admitted', 'closed', 'all']);

/** A saved view checked against today's fields (unknown keys and unfinished filters dropped). */
export function sanitizeAdmissionView(raw: unknown, known: ReadonlySet<string>): AdmissionListView {
  if (!raw || typeof raw !== 'object') return DEFAULT_ADMISSION_VIEW;
  const v = raw as Partial<AdmissionListView>;
  const filters = (Array.isArray(v.filters) ? v.filters : []).filter((f) => {
    if (!f || !known.has(f.key)) return false;
    const n = (f.values ?? []).filter((x) => String(x).trim() !== '').length;
    if (f.op === 'empty' || f.op === 'not_empty') return true;
    return f.op === 'between' ? n >= 2 : n >= 1;
  });
  return {
    columns: (Array.isArray(v.columns) ? v.columns : DEFAULT_ADMISSION_VIEW.columns).filter(
      (c) => c && known.has(c.key),
    ),
    filters,
    sort: (Array.isArray(v.sort) ? v.sort : []).filter((s) => s && known.has(s.key)),
    search: typeof v.search === 'string' ? v.search : '',
    status: STATUSES.has(String(v.status)) ? (v.status as AdmissionListStatus) : 'in_progress',
    size: [25, 50, 100, 200].includes(Number(v.size)) ? Number(v.size) : 50,
  };
}
