import type { BuilderField, FilterOp } from './report-builder';

/** Students list shapes (API people/students/grid). */

export type ListStatus = 'active' | 'inactive' | 'withdrawn' | 'all';

export interface StudentListView {
  columns: Array<{ key: string; label?: string | null }>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  search?: string;
  status: ListStatus;
  size: number;
}

export interface StudentListQuery extends StudentListView {
  page: number;
}

export interface StudentListResult {
  columns: Array<{ key: string; header: string; type: string }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  page: number;
  pages: number;
  stats: { total: number; active: number; inactive: number; withdrawn: number };
}

export interface StudentListFields {
  sections: Array<{ id: string; title: string }>;
  fields: BuilderField[];
}

export const DEFAULT_VIEW: StudentListView = {
  columns: [
    { key: 'class_section' },
    { key: 'roll_no' },
    { key: 'father_name' },
    { key: 'father_mobile' },
    { key: 'mother_name' },
    { key: 'mother_mobile' },
    { key: 'category' },
    { key: 'fee_discount' },
    { key: 'transport_route' },
  ],
  filters: [],
  sort: [],
  search: '',
  status: 'active',
  size: 50,
};

/** Quick filters above the table; everything else goes through "More filters". */
export const QUICK_FILTERS: string[] = [
  'class_section',
  'category',
  'gender',
  'fee_discount',
  'transport_route',
  'sibling_in_school',
  'boarding',
];

/** A saved view as stored for the user, checked against today's fields (unknown keys and unfinished filters dropped). */
export function sanitizeView(raw: unknown, known: ReadonlySet<string>): StudentListView {
  if (!raw || typeof raw !== 'object') return DEFAULT_VIEW;
  const v = raw as Partial<StudentListView>;
  const statuses: ListStatus[] = ['active', 'inactive', 'withdrawn', 'all'];
  const filters = (Array.isArray(v.filters) ? v.filters : []).filter((f) => {
    if (!f || !known.has(f.key)) return false;
    const n = (f.values ?? []).filter((x) => String(x).trim() !== '').length;
    if (f.op === 'empty' || f.op === 'not_empty') return true;
    return f.op === 'between' ? n >= 2 : n >= 1;
  });
  return {
    columns: (Array.isArray(v.columns) ? v.columns : DEFAULT_VIEW.columns)
      .filter((c) => c && known.has(c.key))
      .slice(0, 60),
    filters: filters.slice(0, 30),
    sort: (Array.isArray(v.sort) ? v.sort : []).filter((x) => x && known.has(x.key)).slice(0, 3),
    search: typeof v.search === 'string' ? v.search.slice(0, 80) : '',
    status: statuses.includes(v.status as ListStatus) ? (v.status as ListStatus) : 'active',
    size: [25, 50, 100, 200].includes(Number(v.size)) ? Number(v.size) : 50,
  };
}
