import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/RegisterTools';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { apiFetch, getMe } from '@/lib/api';
import { dmy, type BookSetup } from '@/lib/library-books';

type View = 'circulation' | 'student' | 'employee';
type What = 'all' | 'issued' | 'returned' | 'renewed' | 'out' | 'overdue';
type Event = {
  day: string;
  what: string;
  loanId: string;
  borrowerKind: string;
  borrowerId: string;
  borrower: string;
  ref: string;
  place: string | null;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string | null;
  library: string | null;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewed: number;
  daysLate: number;
  fine: number;
  fromDue: string | null;
  toDue: string | null;
  by: string | null;
};
type Circulation = {
  rows: Event[];
  total: number;
  page: number;
  pages: number;
  counts: Record<'issued' | 'returned' | 'renewed' | 'out' | 'overdue', number>;
};
type Borrower = {
  kind: string;
  id: string;
  name: string;
  ref: string;
  place: string | null;
  rollNo: number | null;
  borrowed: number;
  returned: number;
  holding: number;
  overdue: number;
  late: number;
  fines: number;
  ever: number;
  lastIssued: string | null;
};
type Borrowers = {
  rows: Borrower[];
  total: number;
  page: number;
  pages: number;
  totals: { borrowed: number; returned: number; holding: number; overdue: number; fines: number };
};
type Sections = {
  classes: Array<{ id: string; name: string; sections: Array<{ id: string; name: string }> }>;
};

const VIEWS: Array<[View, string]> = [
  ['circulation', 'Circulation'],
  ['student', 'Pupils'],
  ['employee', 'Staff'],
];
const WHATS: Array<[What, string]> = [
  ['all', 'Every issue, return and renewal'],
  ['issued', 'Issued'],
  ['returned', 'Returned'],
  ['renewed', 'Renewed'],
  ['out', 'Out now'],
  ['overdue', 'Overdue now'],
];
const WHAT_TONE: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'danger'> = {
  issued: 'info',
  returned: 'success',
  renewed: 'neutral',
  out: 'warning',
  overdue: 'danger',
};
const SHOWS: Array<[string, string]> = [
  ['active', 'Borrowed or returned between the days, or holding now'],
  ['holding', 'Holding books now'],
  ['overdue', 'With books overdue now'],
  ['all', 'Everyone who ever borrowed'],
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Circulation history (docs/design/36-library.md, "Library reports", part 2): the issues, returns and
 * renewals between two days and the books out or overdue now; pupils and staff by what they borrowed,
 * returned and hold, each opening their own history; every list as Excel or PDF.
 */
export default async function LibraryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : 'circulation';
  // the days: this month until a day is chosen (both left empty: every day)
  const chosen = 'from' in sp || 'to' in sp;
  const from = chosen ? (DAY.test(sp.from ?? '') ? sp.from! : '') : `${today().slice(0, 8)}01`;
  const to = chosen ? (DAY.test(sp.to ?? '') ? sp.to! : '') : today();
  const where = /^[cs]:\d{1,18}$/.test(sp.where ?? '') ? sp.where! : '';
  const search = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const qs = (x: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries(x).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''),
    ).toString();
  // the page's own links keep empty days once chosen ("every day"); the API is never sent an empty value
  const link = (x: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries(x).filter(
        (e): e is [string, string] =>
          e[1] !== undefined && (e[1] !== '' || (chosen && (e[0] === 'from' || e[0] === 'to'))),
      ),
    ).toString();
  // the filters as the page has them (empty days kept so "every day" stays chosen)
  const days = { from, to };
  const classFilter = {
    classId: where.startsWith('c:') ? where.slice(2) : undefined,
    sectionId: where.startsWith('s:') ? where.slice(2) : undefined,
  };
  const sections = await apiFetch<Sections>('/library/desk/sections').catch(
    () => ({ classes: [] }) as Sections,
  );
  const classOptions = [
    { value: '', label: 'Every class' },
    ...sections.classes.flatMap((k) => [
      { value: `c:${k.id}`, label: `${k.name} (all sections)` },
      ...k.sections.map((s) => ({ value: `s:${s.id}`, label: `${k.name}-${s.name}` })),
    ]),
  ];
  const tabs = (
    <nav className="ep-tabs" aria-label="History of" style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="ep-tabs__list">
        {VIEWS.map(([v, label]) => (
          <a
            key={v}
            className="ep-tabs__tab"
            href={`/library/history?${link({ view: v, ...(chosen ? days : {}) })}`}
            aria-current={view === v ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
  const dayFields = (help?: string) => (
    <>
      <InputField
        id="lh-from"
        name="from"
        type="date"
        label="From"
        defaultValue={from}
        help={help}
      />
      <InputField id="lh-to" name="to" type="date" label="To" defaultValue={to} max={today()} />
    </>
  );
  const fileLinks = (href: (f: 'xlsx' | 'pdf') => string) => (
    <>
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/circulation">
        Circulation desk
      </a>
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href('xlsx')}>
        Excel
      </a>
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href('pdf')}>
        PDF
      </a>
    </>
  );
  // a borrower's own page: every loan, or the days chosen here
  const historyHref = (kind: string, id: string) => {
    const q = link(chosen ? days : {});
    return `/library/history/${kind}/${id}${q ? `?${q}` : ''}`;
  };

  if (view === 'circulation') {
    const what: What = WHATS.some(([v]) => v === sp.what) ? (sp.what as What) : 'all';
    const now = what === 'out' || what === 'overdue';
    const borrower = sp.borrower === 'student' || sp.borrower === 'employee' ? sp.borrower : '';
    const [setup] = await Promise.all([
      apiFetch<BookSetup>('/library/books/setup').catch(() => null),
    ]);
    const libraries = setup?.libraries ?? [];
    const libraryId = ID.test(sp.libraryId ?? '') ? sp.libraryId! : '';
    const filters = {
      ...days,
      borrower,
      ...classFilter,
      libraryId,
      q: search,
    };
    const keep = { view, what, ...days, borrower, where, libraryId, q: search };
    const data = await apiFetch<Circulation>(
      `/library/history/circulation?${qs({ ...filters, what, page: String(page), size: '50' })}`,
    );
    const tile = (w: What, label: string, n: number, sub: string) => (
      <a
        key={w}
        href={`/library/history?${link({ ...keep, what: w })}#list`}
        className="ep-tile-link"
        aria-current={what === w ? 'true' : undefined}
        aria-label={`${label}: ${String(n)}. Show the list`}
      >
        <Card title={label}>
          <div className="ep-cdash__big">{n}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {sub}
          </p>
        </Card>
      </a>
    );
    const span = from || to ? `${from ? dmy(from) : '…'} to ${to ? dmy(to) : '…'}` : 'every day';
    return (
      <>
        <Breadcrumbs
          items={[{ label: 'Library', href: '/library' }, { label: 'Circulation history' }]}
        />
        <PageHeader
          kicker="Library"
          title="Circulation history"
          description="Every book issued, returned and renewed between two days, and the books out or overdue now."
          actions={fileLinks(
            (format) =>
              `/api/library-report?${qs({ report: 'circulation', what, ...filters, format })}`,
          )}
        />
        {tabs}
        <LibraryScopeNote />
        <LibraryScopeNote />
        <div className="ep-dash-kpis ep-dash-kpis--4">
          {tile('issued', 'Issued', data.counts.issued, span)}
          {tile('returned', 'Returned', data.counts.returned, span)}
          {tile('renewed', 'Renewed', data.counts.renewed, span)}
          {tile(
            'out',
            'Out now',
            data.counts.out,
            `${String(data.counts.overdue)} overdue · any day`,
          )}
        </div>
        <div className="ep-filter-band">
          <form method="get" action="/library/history" className="ep-dlog__filters">
            <input type="hidden" name="view" value="circulation" />
            <SelectField
              id="lh-what"
              name="what"
              label="Show"
              defaultValue={what}
              options={WHATS.map(([value, label]) => ({ value, label }))}
            />
            {dayFields(now ? 'Out now and overdue now are not by day' : undefined)}
            <SelectField
              id="lh-borrower"
              name="borrower"
              label="Borrowers"
              defaultValue={borrower}
              options={[
                { value: '', label: 'Pupils and staff' },
                { value: 'student', label: 'Pupils' },
                { value: 'employee', label: 'Staff' },
              ]}
            />
            <SelectField
              id="lh-where"
              name="where"
              label="Class or section"
              defaultValue={where}
              options={classOptions}
            />
            {libraries.length > 1 ? (
              <SelectField
                id="lh-library"
                name="libraryId"
                label="Library"
                defaultValue={libraryId}
                options={[
                  { value: '', label: 'Every library' },
                  ...libraries.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            ) : null}
            <div className="ep-dlog__search">
              <InputField
                id="lh-q"
                name="q"
                type="search"
                label="Search"
                placeholder="Book, book no., author, borrower or admission / employee no."
                maxLength={80}
                defaultValue={search}
              />
            </div>
            <Button type="submit">Show</Button>
            <a className="ep-btn ep-btn--secondary" href="/library/history">
              Reset
            </a>
          </form>
        </div>
        <section className="ep-card" id="list" aria-labelledby="lh-list-h">
          <h2 id="lh-list-h" className="ep-card__title">
            {WHATS.find(([v]) => v === what)![1]} · {data.total}
          </h2>
          {data.rows.length === 0 ? (
            <p className="ep-field__help">Nothing here for these filters.</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Circulation (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">{now ? 'Issued on' : 'Day'}</th>
                    {what === 'all' ? <th scope="col">What</th> : null}
                    <th scope="col">Book</th>
                    <th scope="col">Borrower</th>
                    <th scope="col">Issued · due</th>
                    <th scope="col">Returned</th>
                    <th scope="col" className="is-numeric">
                      Days late
                    </th>
                    <th scope="col" className="is-numeric">
                      Fine
                    </th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((x, i) => (
                    <tr key={`${x.what}-${x.loanId}-${String(i)}`}>
                      <td>{dmy(x.day)}</td>
                      {what === 'all' ? (
                        <td>
                          <Badge tone={WHAT_TONE[x.what] ?? 'neutral'}>
                            {x.what[0]!.toUpperCase() + x.what.slice(1)}
                          </Badge>
                        </td>
                      ) : null}
                      <td>
                        <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                        <div className="ep-field__help">
                          {x.accessionNo}
                          {x.author ? ` · ${x.author}` : ''}
                          {libraries.length > 1 && x.library ? ` · ${x.library}` : ''}
                        </div>
                      </td>
                      <td>
                        <a href={historyHref(x.borrowerKind, x.borrowerId)}>{x.borrower}</a>
                        <div className="ep-field__help">
                          {x.borrowerKind === 'student' ? 'Pupil' : 'Staff'} · {x.ref}
                          {x.place ? ` · ${x.place}` : ''}
                        </div>
                      </td>
                      <td>
                        {dmy(x.issuedOn)}
                        <div className="ep-field__help">
                          {x.what === 'renewed' && x.toDue
                            ? `due ${x.fromDue ? `${dmy(x.fromDue)} → ` : ''}${dmy(x.toDue)}`
                            : `due ${dmy(x.dueOn)}`}
                          {x.renewed ? ` · renewed ${String(x.renewed)}×` : ''}
                        </div>
                      </td>
                      <td>{x.returnedOn ? dmy(x.returnedOn) : '—'}</td>
                      <td className="is-numeric">{x.daysLate || '—'}</td>
                      <td className="is-numeric">{x.fine ? rupees(x.fine) : '—'}</td>
                      <td>{x.by ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            page={data.page}
            pages={data.pages}
            hrefFor={(n) => `/library/history?${link({ ...keep, page: String(n) })}#list`}
          />
        </section>
      </>
    );
  }

  // ---- pupils or staff ---------------------------------------------------------------------------
  const pupils = view === 'student';
  const show = SHOWS.some(([v]) => v === sp.show) ? sp.show! : 'active';
  const sort = ['name', 'holding', 'borrowed'].includes(sp.sort ?? '') ? sp.sort! : 'name';
  const filters = {
    kind: view,
    ...days,
    show,
    ...(pupils ? classFilter : {}),
    q: search,
    sort,
  };
  const keep = { view, ...days, show, where: pupils ? where : '', q: search, sort };
  const data = await apiFetch<Borrowers>(
    `/library/history/borrowers?${qs({ ...filters, page: String(page), size: '50' })}`,
  );
  const span = from || to ? `${from ? dmy(from) : '…'} to ${to ? dmy(to) : '…'}` : 'every day';
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Library', href: '/library' }, { label: 'Circulation history' }]}
      />
      <PageHeader
        kicker="Library"
        title="Circulation history"
        description={
          pupils
            ? 'Each pupil with the books borrowed and returned between two days and held now; open a pupil for every book.'
            : 'Each staff member with the books borrowed and returned between two days and held now; open one for every book.'
        }
        actions={fileLinks(
          (format) => `/api/library-report?${qs({ report: 'borrowers', ...filters, format })}`,
        )}
      />
      {tabs}
      <LibraryScopeNote />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        {(
          [
            ['Borrowed', String(data.totals.borrowed), span],
            ['Returned', String(data.totals.returned), span],
            ['Holding now', String(data.totals.holding), 'books out'],
            ['Overdue now', String(data.totals.overdue), 'books past their due date'],
          ] as Array<[string, string, string]>
        ).map(([label, value, sub]) => (
          <Card key={label} title={label}>
            <div className="ep-cdash__big">{value}</div>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {sub} · {data.total} {pupils ? 'pupils' : 'staff'}
            </p>
          </Card>
        ))}
      </div>
      <div className="ep-filter-band">
        <form method="get" action="/library/history" className="ep-dlog__filters">
          <input type="hidden" name="view" value={view} />
          {dayFields()}
          <SelectField
            id="lh-show"
            name="show"
            label={pupils ? 'Pupils' : 'Staff'}
            defaultValue={show}
            options={SHOWS.map(([value, label]) => ({ value, label }))}
          />
          {pupils ? (
            <SelectField
              id="lh-where"
              name="where"
              label="Class or section"
              defaultValue={where}
              options={classOptions}
            />
          ) : null}
          <div className="ep-dlog__search">
            <InputField
              id="lh-q"
              name="q"
              type="search"
              label="Search"
              placeholder={pupils ? 'Name or admission no.' : 'Name or employee code'}
              maxLength={80}
              defaultValue={search}
            />
          </div>
          <SelectField
            id="lh-sort"
            name="sort"
            label="Order"
            defaultValue={sort}
            options={[
              { value: 'name', label: pupils ? 'Class, roll no.' : 'Name' },
              { value: 'holding', label: 'Most books held' },
              { value: 'borrowed', label: 'Most borrowed' },
            ]}
          />
          <Button type="submit">Show</Button>
          <a className="ep-btn ep-btn--secondary" href={`/library/history?view=${view}`}>
            Reset
          </a>
        </form>
      </div>
      <section className="ep-card" id="list" aria-labelledby="lh-list-h">
        <h2 id="lh-list-h" className="ep-card__title">
          {pupils ? 'Pupils' : 'Staff'} · {data.total}
        </h2>
        {data.rows.length === 0 ? (
          <p className="ep-field__help">Nobody here for these filters.</p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${pupils ? 'Pupils' : 'Staff'} and their books (scrolls sideways)`}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">{pupils ? 'Pupil' : 'Staff member'}</th>
                  <th scope="col">{pupils ? 'Class · roll no.' : 'Designation'}</th>
                  <th scope="col" className="is-numeric">
                    Borrowed
                  </th>
                  <th scope="col" className="is-numeric">
                    Returned
                  </th>
                  <th scope="col" className="is-numeric">
                    Returned late
                  </th>
                  <th scope="col" className="is-numeric">
                    Holding now
                  </th>
                  <th scope="col" className="is-numeric">
                    Overdue now
                  </th>
                  <th scope="col" className="is-numeric">
                    Late fines
                  </th>
                  <th scope="col">Last issued</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <a href={historyHref(x.kind, x.id)}>{x.name}</a>
                      <div className="ep-field__help">{x.ref}</div>
                    </td>
                    <td>
                      {x.place ?? '—'}
                      {x.rollNo !== null ? ` · ${String(x.rollNo)}` : ''}
                    </td>
                    <td className="is-numeric">{x.borrowed}</td>
                    <td className="is-numeric">{x.returned}</td>
                    <td className="is-numeric">{x.late || '—'}</td>
                    <td className="is-numeric">{x.holding ? <strong>{x.holding}</strong> : '—'}</td>
                    <td className="is-numeric">
                      {x.overdue ? <Badge tone="danger">{x.overdue}</Badge> : '—'}
                    </td>
                    <td className="is-numeric">{x.fines ? rupees(x.fines) : '—'}</td>
                    <td>{dmy(x.lastIssued) || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Total · {data.total}
                  </th>
                  <td className="is-numeric">
                    <strong>{data.totals.borrowed}</strong>
                  </td>
                  <td className="is-numeric">
                    <strong>{data.totals.returned}</strong>
                  </td>
                  <td />
                  <td className="is-numeric">
                    <strong>{data.totals.holding}</strong>
                  </td>
                  <td className="is-numeric">
                    <strong>{data.totals.overdue}</strong>
                  </td>
                  <td className="is-numeric">
                    <strong>{rupees(data.totals.fines)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager
          page={data.page}
          pages={data.pages}
          hrefFor={(n) => `/library/history?${link({ ...keep, page: String(n) })}#list`}
        />
      </section>
    </>
  );
}
