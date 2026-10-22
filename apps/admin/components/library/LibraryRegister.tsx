'use client';
import { PeopleList } from '../people/PeopleList';
import { BookExportPicker } from './BookExportPicker';
import type { PeopleListConfig } from '@/lib/people-list';
import type { ReportSpec } from '@/lib/report-builder';
import { COPY_STATUS, COPY_TONE, type CopyStatus } from '@/lib/library-books';
import {
  DEFAULT_VIEW,
  QUICK,
  type RegisterFields,
  type RegisterLevel,
  type RegisterResult,
  type RegisterView,
} from '@/lib/library-register';
import { registerDownload, registerLoad, registerSaveView } from '@/lib/library-register-actions';

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
/** The shared list wants a report definition for its filter count; the library lists are not reports. */
const spec = (v: RegisterView): ReportSpec => ({
  columns: [],
  filters: v.filters,
  sort: v.sort,
  options: { paper: 'A4', orientation: 'auto' },
});
const FILTERS_HELP =
  'Add conditions on any field of the book, its publication, the copy, how it came or its loan. They work together with the quick filters above the list; all must match. A condition without a value is ignored.';

const COPIES: PeopleListConfig<RegisterView, RegisterResult> = {
  noun: { one: 'copy', many: 'copies', heading: 'Accession no.' },
  primary: { key: 'accession_no', avatar: false },
  defaultView: DEFAULT_VIEW.copies,
  quickFilters: QUICK.copies,
  statuses: [
    { value: 'all', label: 'Every copy' },
    { value: 'in_stock', label: 'In stock (not lost, withdrawn or sold)' },
    { value: 'available', label: 'On the shelf' },
    { value: 'issued', label: 'Issued' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'lost', label: 'Lost' },
    { value: 'withdrawn', label: 'Withdrawn' },
    { value: 'sold', label: 'Sold' },
    { value: 'stock_verified', label: 'Stock check: verified' },
    { value: 'stock_pending', label: 'Stock check: pending' },
    { value: 'stock_missing', label: 'Stock check: missing' },
  ],
  defaultStatus: 'all',
  searchLabel: 'Title, author, accession no., barcode, ISBN',
  searchedAllNote: '',
  columnSearchPlaceholder: 'Search: shelf, vendor, due on…',
  filtersHelp: FILTERS_HELP,
  newFilterKey: 'library',
  report: { name: 'Accession register', description: 'The library’s copies' },
  viewToSpec: spec,
  counts: ({ stats: s }) => [
    ['Total', s.total ?? 0],
    ['On the shelf', s.available ?? 0],
    ['Issued', s.issued ?? 0],
    ['Overdue', s.overdue ?? 0],
    ['Damaged', s.damaged ?? 0],
    ['Lost', s.lost ?? 0],
    ['Withdrawn', s.withdrawn ?? 0],
  ],
  rowHref: (id, r) => `/library/books/${text(r.__title_id)}#copy-${id}`,
  identity: (r) => (
    <span className="ep-sl__sub">
      {text(r.title)}
      {r.authors ? ` · ${text(r.authors)}` : ''}
    </span>
  ),
  statusCell: (r) => {
    const st = text(r.__status) as CopyStatus;
    return (
      <span className={`ep-badge ep-badge--${COPY_TONE[st] ?? 'neutral'}`}>
        {COPY_STATUS[st] ?? text(r.copy_status)}
      </span>
    );
  },
  menu: (id, r, can) => (
    <>
      <li>
        <a href={`/library/books/${text(r.__title_id)}#copy-${id}`}>Open the book</a>
      </li>
      {can.manage ? (
        <li>
          <a href={`/library/labels?source=list&list=${encodeURIComponent(text(r.accession_no))}`}>
            Print its labels
          </a>
        </li>
      ) : null}
      {can.manage ? (
        <li>
          <a href={`/library/accession?from=${encodeURIComponent(text(r.accession_no))}`}>
            Correct the accession no.
          </a>
        </li>
      ) : null}
      {can.circulate ? (
        <li>
          <a href="/library/circulation">Circulation desk</a>
        </li>
      ) : null}
    </>
  ),
  tools: (_can, v) => <BookExportPicker level="copy" view={v} />,
};

const TITLES: PeopleListConfig<RegisterView, RegisterResult> = {
  noun: { one: 'title', many: 'titles', heading: 'Title' },
  primary: { key: 'title', avatar: false },
  defaultView: DEFAULT_VIEW.titles,
  quickFilters: QUICK.titles,
  statuses: [
    { value: 'all', label: 'Every title' },
    { value: 'available', label: 'A copy on the shelf' },
    { value: 'out', label: 'Every copy out' },
    { value: 'none', label: 'No copies' },
  ],
  defaultStatus: 'all',
  searchLabel: 'Title, author, accession no., barcode, ISBN',
  searchedAllNote: '',
  columnSearchPlaceholder: 'Search: publisher, ISBN, copies…',
  filtersHelp: FILTERS_HELP,
  newFilterKey: 'material',
  statusHeader: 'On the shelf',
  report: { name: 'Library titles', description: 'The library’s titles' },
  viewToSpec: spec,
  counts: ({ stats: s }) => [
    ['Titles', s.total ?? 0],
    ['A copy on the shelf', s.available ?? 0],
    ['Every copy out', s.out ?? 0],
    ['No copies', s.none ?? 0],
  ],
  rowHref: (id) => `/library/books/${id}`,
  identity: (r) => (
    <span className="ep-sl__sub">
      {[r.authors, r.catalogue_code, r.material].filter(Boolean).map(text).join(' · ')}
    </span>
  ),
  statusCell: (r) => {
    const copies = Number(r.copies ?? 0);
    const on = Number(r.on_shelf ?? 0);
    if (!copies) return <span className="ep-badge ep-badge--neutral">No copies</span>;
    return (
      <span className={`ep-badge ep-badge--${on ? 'success' : 'warning'}`}>
        {on} of {copies}
      </span>
    );
  },
  menu: (id, _r, can) => (
    <>
      <li>
        <a href={`/library/books/${id}`}>Open</a>
      </li>
      {can.manage ? (
        <li>
          <a href={`/library/books/${id}/edit`}>Edit the book</a>
        </li>
      ) : null}
      {can.manage ? (
        <li>
          <a href={`/library/books/${id}#bk-copies-h`}>Add copies</a>
        </li>
      ) : null}
      {can.manage ? (
        <li>
          <a href={`/library/books/new?from=${id}`}>Add a book like this</a>
        </li>
      ) : null}
    </>
  ),
  tools: (_can, v) => <BookExportPicker level="title" view={v} />,
};

/**
 * The Books page's list (docs/design/36-library.md): the copies or the titles on the shared list the
 * Employees and Students pages use: quick and more filters on any field, the columns each user keeps,
 * the counts, sortable headers, pages, and the view as Excel or PDF.
 */
export function LibraryRegister({
  level,
  fields,
  initial,
  initialView,
  can,
}: {
  level: RegisterLevel;
  fields: RegisterFields;
  initial: RegisterResult;
  initialView: RegisterView;
  can: Record<string, boolean>;
}) {
  return (
    <PeopleList
      config={level === 'copies' ? COPIES : TITLES}
      fields={fields}
      initial={initial}
      initialView={initialView}
      can={{ ...can, builder: false }}
      actions={{
        load: (q) => registerLoad(level, q),
        saveView: (v) => registerSaveView(level, v),
        download: (q) => registerDownload(level, q),
      }}
    />
  );
}
