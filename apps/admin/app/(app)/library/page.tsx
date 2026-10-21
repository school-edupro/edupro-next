import { Badge, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { BookExportPicker } from '@/components/library/BookExportPicker';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import {
  COPY_STATUS,
  COPY_TONE,
  dmy,
  isbnText,
  type BookRow,
  type BookSetup,
  type RegisterRow,
} from '@/lib/library-books';

const STATUSES = [
  ['', 'Any'],
  ['available', 'On the shelf'],
  ['issued', 'Issued'],
  ['damaged', 'Damaged'],
  ['lost', 'Lost'],
  ['withdrawn', 'Withdrawn'],
] as const;
const SORTS = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['accession', 'Accession no.'],
  ['callNo', 'Call number'],
  ['year', 'Year'],
  ['publisher', 'Publisher'],
  ['price', 'Price'],
  ['accessioned', 'Date of accession'],
  ['status', 'Status'],
  ['library', 'Library'],
] as const;
const SIZES = [25, 50, 100] as const;
const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The filters the page passes on, with what each must look like (anything else is dropped). */
const FILTERS = {
  q: /^.{1,80}$/,
  libraryId: ID,
  materialTypeId: ID,
  subjectId: ID,
  languageId: ID,
  classId: ID,
  shelfId: ID,
  rack: /^.{1,20}$/,
  author: /^.{1,80}$/,
  publisher: /^.{1,80}$/,
  status: /^(available|issued|lost|damaged|withdrawn)$/,
  acquisition: /^(Purchase|Donation)$/,
  vendorId: ID,
  accessionFrom: /^[A-Za-z0-9/ -]{1,30}$/,
  accessionTo: /^[A-Za-z0-9/ -]{1,30}$/,
  accessionedFrom: DAY,
  accessionedTo: DAY,
  yearFrom: /^\d{4}$/,
  yearTo: /^\d{4}$/,
  stock: /^(never|checked)$/,
  checkedSince: DAY,
  sort: /^(title|author|accession|callNo|year|publisher|price|accessioned|status|library)$/,
  dir: /^(asc|desc)$/,
} as const;
type FilterKey = keyof typeof FILTERS;
/** The filters kept under "More filters" (it opens when one of them is set). */
const MORE: FilterKey[] = [
  'author',
  'publisher',
  'languageId',
  'classId',
  'shelfId',
  'rack',
  'acquisition',
  'vendorId',
  'accessionFrom',
  'accessionTo',
  'accessionedFrom',
  'accessionedTo',
  'yearFrom',
  'yearTo',
  'stock',
  'checkedSince',
];

/**
 * The book master (docs/design/36-library.md, parts 2 and 3): the titles, or the copies (the accession
 * register), searched and filtered by the title's links and the copies' place, source, status, dates
 * and stock check, sorted; Excel of every field, or of the fields picked (per copy or per title).
 */
export default async function LibraryBooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'copies' ? 'copies' : 'titles';
  const f: Partial<Record<FilterKey, string>> = {};
  for (const [k, re] of Object.entries(FILTERS) as Array<[FilterKey, RegExp]>) {
    const v = (sp[k] ?? '').trim();
    if (v && re.test(v)) f[k] = v;
  }
  const size = (SIZES as readonly number[]).includes(Number(sp.size)) ? Number(sp.size) : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const filterQs = new URLSearchParams(f as Record<string, string>);
  const listQs = new URLSearchParams(filterQs);
  listQs.set('page', String(page));
  listQs.set('size', String(size));
  const countQs = new URLSearchParams(filterQs);
  countQs.set('size', '1');
  type Paged<T> = {
    data: T[];
    page: { number: number; size: number; total: number };
    can: { manage: boolean };
  };
  const [t, setup, list, other] = await Promise.all([
    getTranslations('pages.library'),
    apiFetch<BookSetup>('/library/books/setup'),
    view === 'copies'
      ? apiFetch<Paged<RegisterRow>>(`/library/books/copies?${listQs.toString()}`)
      : apiFetch<Paged<BookRow>>(`/library/books?${listQs.toString()}`),
    // the other view's count, for the tabs and the export
    view === 'copies'
      ? apiFetch<Paged<BookRow>>(`/library/books?${countQs.toString()}`)
      : apiFetch<Paged<RegisterRow>>(`/library/books/copies?${countQs.toString()}`),
  ]);
  const titles = view === 'titles' ? list.page.total : other.page.total;
  const copies = view === 'copies' ? list.page.total : other.page.total;
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(filterQs);
    if (view === 'copies') p.set('view', 'copies');
    if (size !== 25) p.set('size', String(size));
    for (const [k, v] of Object.entries(over))
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, v);
    const s = p.toString();
    return `/library${s ? `?${s}` : ''}`;
  };
  const filtered = Object.keys(f).some((k) => k !== 'sort' && k !== 'dir');
  const moreOpen = MORE.some((k) => f[k]);
  const shelvesOf = f.libraryId
    ? setup.shelves.filter((s) => s.libraryId === f.libraryId)
    : setup.shelves;
  const exportQs = new URLSearchParams(filterQs);
  exportQs.set('level', view === 'copies' ? 'copy' : 'title');
  const select = (
    name: FilterKey,
    label: string,
    options: Array<{ value: string; label: string }>,
    any = 'All',
  ) => (
    <label className="ep-field" htmlFor={`lb-${name}`} style={{ margin: 0 }}>
      <span className="ep-field__label">{label}</span>
      <select id={`lb-${name}`} name={name} className="ep-select" defaultValue={f[name] ?? ''}>
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const input = (name: FilterKey, label: string, more: Record<string, string | number> = {}) => (
    <label className="ep-field" htmlFor={`lb-${name}`} style={{ margin: 0 }}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`lb-${name}`}
        name={name}
        className="ep-input"
        defaultValue={f[name] ?? ''}
        {...more}
      />
    </label>
  );
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {list.can.manage ? (
              <a className="ep-btn ep-btn--primary" href="/library/books/new">
                + Add a book
              </a>
            ) : null}
            <a
              className="ep-btn ep-btn--secondary"
              href={`/api/library-export?${exportQs.toString()}`}
              title="Every field, one row per copy (the register) or per title, as filtered and sorted"
            >
              Export to Excel
            </a>
            <BookExportPicker
              filters={Object.fromEntries(filterQs)}
              titles={titles}
              copies={copies}
            />
            {list.can.manage ? (
              <a className="ep-btn ep-btn--ghost" href="/library/import">
                Import
              </a>
            ) : null}
            {list.can.manage ? (
              <a className="ep-btn ep-btn--ghost" href="/library/labels">
                Labels
              </a>
            ) : null}
            <a className="ep-btn ep-btn--ghost" href="/masters/library">
              Library setup
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Books or copies" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          <a
            className="ep-tabs__tab"
            href={href({ view: undefined, page: undefined })}
            aria-current={view === 'titles' ? 'page' : undefined}
          >
            Titles <span className="ep-badge ep-badge--neutral">{titles}</span>
          </a>
          <a
            className="ep-tabs__tab"
            href={href({ view: 'copies', page: undefined })}
            aria-current={view === 'copies' ? 'page' : undefined}
          >
            Copies (accession register) <span className="ep-badge ep-badge--neutral">{copies}</span>
          </a>
        </div>
      </nav>
      <form
        method="get"
        className="ep-card"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        {view === 'copies' ? <input type="hidden" name="view" value="copies" /> : null}
        <div className="ep-acr-filter">
          <label className="ep-field" htmlFor="lb-q" style={{ margin: 0 }}>
            <span className="ep-field__label">Find</span>
            <input
              id="lb-q"
              name="q"
              type="search"
              className="ep-input"
              maxLength={80}
              defaultValue={f.q ?? ''}
              placeholder="Title, author, accession no., barcode, ISBN"
            />
          </label>
          {select(
            'libraryId',
            'Library',
            setup.libraries.map((l) => ({ value: l.id, label: l.name })),
          )}
          {select(
            'materialTypeId',
            'Material',
            setup.materialTypes.map((m) => ({ value: m.id, label: m.name })),
          )}
          {select(
            'subjectId',
            'Subject',
            setup.subjects.map((s) => ({ value: s.id, label: s.name })),
          )}
          {select(
            'status',
            'A copy that is',
            STATUSES.slice(1).map(([value, label]) => ({ value, label })),
            'Any',
          )}
        </div>
        <details className="ep-book__more" open={moreOpen}>
          <summary>More filters</summary>
          <div className="ep-acr-filter">
            {input('author', 'Author', { maxLength: 80, placeholder: 'Name or part of it' })}
            {input('publisher', 'Publisher', { maxLength: 80 })}
            {select(
              'languageId',
              'Language',
              setup.languages.map((l) => ({ value: l.id, label: l.name })),
            )}
            {select(
              'classId',
              'For class',
              setup.classes.map((c) => ({ value: c.id, label: c.name })),
            )}
            {select(
              'shelfId',
              'Shelf',
              shelvesOf.map((s) => ({
                value: s.id,
                label: `${s.code}${s.name ? ` · ${s.name}` : ''}`,
              })),
            )}
            {input('rack', 'Rack', { maxLength: 20 })}
            {select('acquisition', 'Purchase or donation', [
              { value: 'Purchase', label: 'Purchase' },
              { value: 'Donation', label: 'Donation' },
            ])}
            {select(
              'vendorId',
              'Vendor',
              setup.vendors.map((v) => ({ value: v.id, label: v.name })),
            )}
            {input('accessionFrom', 'Accession no. from', { maxLength: 30, placeholder: 'B00001' })}
            {input('accessionTo', 'Accession no. to', { maxLength: 30, placeholder: 'B00500' })}
            {input('accessionedFrom', 'Accessioned from', { type: 'date' })}
            {input('accessionedTo', 'Accessioned to', { type: 'date' })}
            {input('yearFrom', 'Year from', { type: 'number', min: 1500, max: 2100 })}
            {input('yearTo', 'Year to', { type: 'number', min: 1500, max: 2100 })}
            {select(
              'stock',
              'Stock check',
              [
                { value: 'never', label: 'Never checked' },
                { value: 'checked', label: 'Checked' },
              ],
              'Any',
            )}
            {input('checkedSince', 'Checked since', { type: 'date' })}
          </div>
        </details>
        <div className="ep-acr-filter" style={{ marginTop: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="lb-sort" style={{ margin: 0 }}>
            <span className="ep-field__label">Sort by</span>
            <select
              id="lb-sort"
              name="sort"
              className="ep-select"
              defaultValue={f.sort ?? (view === 'copies' ? 'accession' : 'title')}
            >
              {SORTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="lb-dir" style={{ margin: 0 }}>
            <span className="ep-field__label">Order</span>
            <select id="lb-dir" name="dir" className="ep-select" defaultValue={f.dir ?? 'asc'}>
              <option value="asc">A to Z, low to high, old to new</option>
              <option value="desc">Z to A, high to low, new to old</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="lb-size" style={{ margin: 0 }}>
            <span className="ep-field__label">Per page</span>
            <select id="lb-size" name="size" className="ep-select" defaultValue={String(size)}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'end' }}>
            <button type="submit" className="ep-btn ep-btn--primary">
              Show
            </button>
            {filtered ? (
              <a
                className="ep-btn ep-btn--ghost"
                href={view === 'copies' ? '/library?view=copies' : '/library'}
              >
                Clear
              </a>
            ) : null}
          </span>
        </div>
      </form>

      {view === 'titles' ? (
        <DataTable<BookRow>
          caption={`Titles · ${String(list.page.total)}`}
          density="dense"
          emptyTitle={filtered ? 'No book matches' : 'No book yet'}
          emptyHint={
            list.can.manage && !filtered ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/books/new">
                + Add a book
              </a>
            ) : undefined
          }
          columns={[
            {
              key: 'title',
              header: 'Title',
              render: (b) => (
                <>
                  <a href={`/library/books/${b.id}`}>
                    <strong>{b.title}</strong>
                  </a>
                  {b.subtitle ? <div className="ep-field__help">{b.subtitle}</div> : null}
                  <div className="ep-field__help">{b.author ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'kind',
              header: 'Material · subject',
              render: (b) => [b.material, b.subject].filter(Boolean).join(' · ') || '—',
            },
            {
              key: 'pub',
              header: 'Publisher · year',
              render: (b) => [b.publisher, b.year].filter(Boolean).join(' · ') || '—',
            },
            {
              key: 'ids',
              header: 'Call no. · ISBN',
              render: (b) => [b.callNo, isbnText(b.isbn)].filter(Boolean).join(' · ') || '—',
            },
            { key: 'copies', header: 'Copies', numeric: true, render: (b) => b.copies },
            {
              key: 'shelf',
              header: 'On the shelf',
              numeric: true,
              render: (b) => (
                <Badge tone={b.available ? 'success' : 'neutral'}>{b.available}</Badge>
              ),
            },
            { key: 'out', header: 'Issued', numeric: true, render: (b) => b.issued },
          ]}
          rows={list.data as BookRow[]}
          rowKey={(b) => b.id}
        />
      ) : (
        <DataTable<RegisterRow>
          caption={`Copies · ${String(list.page.total)}`}
          density="dense"
          emptyTitle={filtered ? 'No copy matches' : 'No copy yet'}
          columns={[
            {
              key: 'acc',
              header: 'Accession no.',
              render: (c) => (
                <>
                  <strong>{c.accessionNo}</strong>
                  <div className="ep-field__help">{dmy(c.accessionedOn)}</div>
                </>
              ),
            },
            {
              key: 'title',
              header: 'Title',
              render: (c) => (
                <>
                  <a href={`/library/books/${c.titleId}`}>{c.title}</a>
                  <div className="ep-field__help">{c.author ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'where',
              header: 'Where',
              render: (c) => (
                <>
                  {c.library}
                  <div className="ep-field__help">
                    {c.shelf ? `Shelf ${c.shelf}${c.rack ? ` · rack ${c.rack}` : ''}` : '—'}
                  </div>
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <>
                  <Badge tone={COPY_TONE[c.status]}>{COPY_STATUS[c.status]}</Badge>
                  {c.borrower ? (
                    <div className="ep-field__help">
                      {c.borrower} · due {dmy(c.dueOn)}
                    </div>
                  ) : null}
                </>
              ),
            },
            { key: 'how', header: 'How it came', render: (c) => c.acquisition ?? '—' },
            {
              key: 'checked',
              header: 'Stock check',
              render: (c) => (c.lastVerifiedOn ? dmy(c.lastVerifiedOn) : 'Never'),
            },
            {
              key: 'price',
              header: 'Price',
              numeric: true,
              render: (c) => (c.price ? `₹${c.price}` : '—'),
            },
          ]}
          rows={list.data as RegisterRow[]}
          rowKey={(c) => c.id}
        />
      )}
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="ep-hero__actions"
          style={{ marginTop: 'var(--sp-3)', alignItems: 'center' }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href({ page: String(page - 1) })}>
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages} · {list.page.total} {view === 'copies' ? 'copies' : 'titles'}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href({ page: String(page + 1) })}>
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
