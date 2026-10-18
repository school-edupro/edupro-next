import type { ReactNode } from 'react';
import type { BuilderField, FilterOp, ReportSpec } from './report-builder';

/**
 * The shared people list (students, employees): the view a user keeps, a page of rows, the fields, and
 * what each list sets for itself (statuses, quick filters, counts, the name cell, the row menu).
 */
export interface PeopleListView<S extends string = string> {
  columns: Array<{ key: string; label?: string | null }>;
  filters: Array<{ key: string; op: FilterOp; values?: string[] }>;
  sort: Array<{ key: string; dir: 'asc' | 'desc' }>;
  search?: string;
  status: S;
  size: number;
}
export type PeopleListQuery<V extends PeopleListView> = V & { page: number };
export interface PeopleListResult<St = Record<string, number>> {
  columns: Array<{ key: string; header: string; type: string }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  page: number;
  pages: number;
  stats: St;
  /** a search was typed: every status was looked in */
  searchedAll?: boolean;
}
export interface PeopleListFields {
  sections: Array<{ id: string; title: string }>;
  fields: BuilderField[];
  sectionClass?: Record<string, string>;
}
export type PeopleRow = Record<string, string | number | null>;

export interface PeopleListConfig<V extends PeopleListView, R extends PeopleListResult<unknown>> {
  /** "student" / "students" / "Student" (the name column) */
  noun: { one: string; many: string; heading: string };
  defaultView: V;
  quickFilters: string[];
  /** Narrows one quick filter's options by the others chosen (the students' sections by class). */
  quickOptions?: (
    key: string,
    options: string[],
    chosen: Record<string, string[]>,
    fields: PeopleListFields,
  ) => string[];
  statuses: Array<{ value: V['status']; label: string }>;
  /** The status the list opens on and "Clear" goes back to. */
  defaultStatus: V['status'];
  searchLabel: string;
  /** Said when a search looked in every status. */
  searchedAllNote: string;
  columnSearchPlaceholder: string;
  /** The default name and description of "Save as report". */
  report: { name: string; description: string };
  /** The view as a report definition (the same rules the export uses). */
  viewToSpec: (v: V) => ReportSpec;
  /** The counts line: label and number. */
  counts: (r: R) => Array<[string, number]>;
  rowHref: (id: string) => string;
  /** The lines under the name in the first column. */
  identity: (row: PeopleRow) => ReactNode;
  statusCell: (row: PeopleRow) => ReactNode;
  /** The row's Actions menu items (<li>…</li>). */
  menu: (id: string, row: PeopleRow, can: Record<string, boolean>) => ReactNode;
  /** Buttons after Export / Save as report / Report builder. */
  tools: (can: Record<string, boolean>) => ReactNode;
  /** Once on the first render (e.g. dropping an old browser copy of the view). */
  onMount?: () => void;
}
