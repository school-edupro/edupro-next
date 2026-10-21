import type {
  PeopleListFields,
  PeopleListQuery,
  PeopleListResult,
  PeopleListView,
} from './people-list';

/**
 * The Books page's two lists as the Employees list (docs/design/36-library.md): the copies (the accession
 * register) and the titles, each with the columns, filters and sort a user keeps.
 */
export type CopyListStatus =
  | 'all'
  | 'in_stock'
  | 'available'
  | 'issued'
  | 'overdue'
  | 'damaged'
  | 'lost'
  | 'withdrawn'
  | 'sold';
export type TitleListStatus = 'all' | 'available' | 'out' | 'none';
export type CopiesView = PeopleListView<CopyListStatus>;
export type TitlesView = PeopleListView<TitleListStatus>;
export type RegisterLevel = 'copies' | 'titles';
export type RegisterView = CopiesView | TitlesView;
export type RegisterQuery = PeopleListQuery<RegisterView>;
export type RegisterResult = PeopleListResult<Record<string, number>>;
export type RegisterFields = PeopleListFields;

export const DEFAULT_COPIES_VIEW: CopiesView = {
  columns: [
    { key: 'material' },
    { key: 'library' },
    { key: 'shelf' },
    { key: 'accessioned_on' },
    { key: 'copy_price' },
    { key: 'issued_to' },
    { key: 'due_on' },
  ],
  filters: [],
  sort: [{ key: 'accession_no', dir: 'asc' }],
  search: '',
  status: 'all',
  size: 50,
};
export const DEFAULT_TITLES_VIEW: TitlesView = {
  columns: [
    { key: 'material' },
    { key: 'subject' },
    { key: 'publisher' },
    { key: 'year' },
    { key: 'copies' },
    { key: 'issued' },
  ],
  filters: [],
  sort: [{ key: 'title', dir: 'asc' }],
  search: '',
  status: 'all',
  size: 50,
};
export const DEFAULT_VIEW: Record<RegisterLevel, RegisterView> = {
  copies: DEFAULT_COPIES_VIEW,
  titles: DEFAULT_TITLES_VIEW,
};
export const QUICK: Record<RegisterLevel, string[]> = {
  copies: ['library', 'material', 'subject'],
  titles: ['material', 'subject', 'language'],
};
export const STATUSES: Record<RegisterLevel, string[]> = {
  copies: [
    'all',
    'in_stock',
    'available',
    'issued',
    'overdue',
    'damaged',
    'lost',
    'withdrawn',
    'sold',
  ],
  titles: ['all', 'available', 'out', 'none'],
};
/** The preference each list is kept under, for the signed-in user of this school. */
export const PREF: Record<RegisterLevel, string> = {
  copies: 'library.copies.list',
  titles: 'library.titles.list',
};

/** A saved view made safe: fields this list knows, filters that can run; it opens on its default status. */
export function sanitizeRegisterView(
  level: RegisterLevel,
  raw: unknown,
  known: ReadonlySet<string>,
): RegisterView {
  const d = DEFAULT_VIEW[level];
  if (!raw || typeof raw !== 'object') return d;
  const v = raw as Partial<RegisterView>;
  const filters = (Array.isArray(v.filters) ? v.filters : []).filter((f) => {
    if (!f || !known.has(f.key)) return false;
    const n = (f.values ?? []).filter((x) => String(x).trim() !== '').length;
    if (f.op === 'empty' || f.op === 'not_empty') return true;
    return f.op === 'between' ? n >= 2 : n >= 1;
  });
  return {
    columns: (Array.isArray(v.columns) ? v.columns : d.columns)
      .filter((c) => c && known.has(c.key))
      .slice(0, 60),
    filters: filters.slice(0, 30),
    sort: (Array.isArray(v.sort) ? v.sort : d.sort)
      .filter((x) => x && known.has(x.key))
      .slice(0, 3),
    search: '',
    status: STATUSES[level].includes(String(v.status))
      ? (v.status as RegisterView['status'])
      : d.status,
    size: [25, 50, 100, 200].includes(Number(v.size)) ? Number(v.size) : d.size,
  } as RegisterView;
}
