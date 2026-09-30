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
