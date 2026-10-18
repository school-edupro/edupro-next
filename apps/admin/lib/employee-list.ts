import type { BuilderField, FilterOp } from './report-builder';

/** Employee list shapes (API people/staff/grid; docs/design/30-employee-master.md, part 2). */

export type EmployeeListStatus = 'active' | 'inactive' | 'all';

export interface EmployeeListView {
  columns: Array<{ key: string; label?: string | null }>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  search?: string;
  status: EmployeeListStatus;
  size: number;
}

export interface EmployeeListQuery extends EmployeeListView {
  page: number;
}

export interface EmployeeListResult {
  columns: Array<{ key: string; header: string; type: string }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  page: number;
  pages: number;
  stats: {
    total: number;
    active: number;
    inactive: number;
    teaching: number;
    nonTeaching: number;
    noLogin: number;
    incomplete: number;
  };
  searchedAll?: boolean;
}

export interface EmployeeListFields {
  sections: Array<{ id: string; title: string }>;
  fields: BuilderField[];
}

export const DEFAULT_EMPLOYEE_VIEW: EmployeeListView = {
  columns: [
    { key: 'staff_type' },
    { key: 'department' },
    { key: 'designation' },
    { key: 'mobile' },
    { key: 'email' },
    { key: 'joined_on' },
    { key: 'has_login' },
    { key: 'profile_completeness' },
  ],
  filters: [],
  sort: [],
  search: '',
  status: 'active',
  size: 50,
};

/** Quick filters above the table; everything else goes through "More filters". */
export const EMPLOYEE_QUICK_FILTERS: string[] = [
  'staff_group',
  'staff_type',
  'department',
  'designation',
  'gender',
  'has_login',
];

/** A saved view checked against today's fields (unknown keys and unfinished filters dropped). */
export function sanitizeEmployeeView(raw: unknown, known: ReadonlySet<string>): EmployeeListView {
  if (!raw || typeof raw !== 'object') return DEFAULT_EMPLOYEE_VIEW;
  const v = raw as Partial<EmployeeListView>;
  const filters = (Array.isArray(v.filters) ? v.filters : []).filter((f) => {
    if (!f || !known.has(f.key)) return false;
    const n = (f.values ?? []).filter((x) => String(x).trim() !== '').length;
    if (f.op === 'empty' || f.op === 'not_empty') return true;
    return f.op === 'between' ? n >= 2 : n >= 1;
  });
  return {
    columns: (Array.isArray(v.columns) ? v.columns : DEFAULT_EMPLOYEE_VIEW.columns)
      .filter((c) => c && known.has(c.key))
      .slice(0, 60),
    filters: filters.slice(0, 30),
    sort: (Array.isArray(v.sort) ? v.sort : []).filter((x) => x && known.has(x.key)).slice(0, 3),
    // the list always opens on active employees with an empty search, whatever was saved
    search: '',
    status: 'active',
    size: [25, 50, 100, 200].includes(Number(v.size)) ? Number(v.size) : 50,
  };
}
