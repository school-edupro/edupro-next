import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';
import { cancelBookReservation, reserveBook } from './actions';

interface Book {
  id: string;
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
}
interface Reservation {
  id: string;
  status: string;
  placedOn: string;
  readyUntil: string | null;
  endReason: string | null;
  endedOn: string | null;
  titleId: string;
  title: string;
  author: string | null;
  accessionNo: string | null;
  library: string | null;
  place: number | null;
}
interface Borrower {
  borrower: { id: string; name: string; ref: string; place: string | null };
  now: Book[];
  history: Book[];
  reservations: Reservation[];
  dues: { atCounter: number; atLibrary: number };
}
interface Title {
  titleId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  subject: string | null;
  material: string | null;
  copies: number;
  onShelf: number;
  libraries: string | null;
  nextBack: string | null;
  queue: number;
  reference: boolean;
  canReserve: boolean;
}
interface Catalogue {
  rows: Title[];
  total: number;
  page: number;
  pages: number;
}
interface Digital {
  id: string;
  title: string;
  author: string | null;
  url: string | null;
  category: string | null;
  description: string | null;
}
type View = 'books' | 'history' | 'find';

const day = (lang: Lang, d: string | null) =>
  d
    ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
        lang === 'hi' ? 'hi-IN' : 'en-IN',
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        },
      )
    : '—';
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * My library in the staff app (docs/design/36-library.md, "Library round 3", part 4): the books I hold
 * (due, late, the fine to today), what I read before, my reservations (place in line, a book kept for
 * me until a day) and what is due; the catalogue with each book on the shelf or out (never who has it),
 * and a book reserved when every copy is out.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const view: View = sp.view === 'history' || sp.view === 'find' ? sp.view : 'books';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Math.min(500, Number(sp.page) || 1));
  const header = (
    <PageHeader
      kicker={t(lang, 'Library')}
      title={t(lang, 'Library books')}
      description={t(
        lang,
        'Books you hold, when they are due, books read before, and reservations. Find a book and see if it is on the shelf.',
      )}
      actions={
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
          {t(lang, 'Home')}
        </a>
      }
    />
  );
  const unlinked = (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 760, margin: '0 auto' }}>
      {header}
      <Card>
        {t(lang, 'Your sign-in is not linked to a staff record. Please contact the school office.')}
      </Card>
    </main>
  );
  let mine: Borrower;
  let catalogue: Catalogue | null = null;
  let digital: Digital[] = [];
  try {
    // the staff member: the one borrower of the summary
    const me = await bff.api
      .fetch<{ people: Array<{ kind: string; id: string }> }>('/library/portal/summary')
      .then((r) => r.people.find((p) => p.kind === 'employee'));
    if (!me) return unlinked;
    [mine, catalogue, digital] = await Promise.all([
      bff.api.fetch<Borrower>(`/library/portal/borrowers/employee/${me.id}`),
      view === 'find'
        ? bff.api.fetch<Catalogue>(
            `/library/portal/catalogue?${new URLSearchParams({ q, page: String(page) }).toString()}`,
          )
        : Promise.resolve(null),
      view === 'books'
        ? bff.api
            .fetch<{ data: Digital[] }>('/library/mine/digital')
            .then((r) => r.data)
            .catch(() => [])
        : Promise.resolve([]),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404))
      return unlinked;
    throw error;
  }
  const here = (x: Record<string, string>) => {
    const s = new URLSearchParams(x).toString();
    return `/library${s ? `?${s}` : ''}`;
  };
  const back =
    view === 'find'
      ? here({ view, ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) })
      : view === 'history'
        ? here({ view })
        : '/library';
  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'books' ? '/library' : here({ view: v })}
      aria-current={view === v ? 'page' : undefined}
    >
      {t(lang, label)}
    </a>
  );
  const open = mine.reservations.filter((r) => r.status === 'waiting' || r.status === 'ready');
  const reservedIds = new Set(open.map((r) => r.titleId));
  const holdingIds = new Set(mine.now.map((b) => b.titleId));
  const backField = <input type="hidden" name="back" value={back} />;

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 760, margin: '0 auto' }}>
      {header}
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Library')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {tab('books', 'Books now')}
        {tab('history', 'Read before')}
        {tab('find', 'Find a book')}
      </nav>
      {sp.done ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.done === 'reserved'
            ? t(lang, 'Reserved. When a copy comes back it is kept for you; you will see it here.')
            : t(lang, 'The reservation is cancelled.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || t(lang, 'That did not go through. Please try again.')}
        </div>
      ) : null}

      {view === 'books' ? (
        <>
          {open.some((r) => r.status === 'ready') ? (
            <div
              className="ep-alert ep-alert--warning"
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              <strong>{t(lang, 'Ready to collect')}:</strong>{' '}
              {open
                .filter((r) => r.status === 'ready')
                .map(
                  (r) =>
                    `${r.title}${r.library ? ` (${r.library})` : ''}, ${t(lang, 'kept until')} ${day(lang, r.readyUntil)}`,
                )
                .join('; ')}
            </div>
          ) : null}
          <Card title={t(lang, 'Books with me')} style={{ marginBottom: 'var(--sp-3)' }}>
            {mine.now.length === 0 ? (
              <p className="ep-field__help">{t(lang, 'No books on loan.')}</p>
            ) : (
              <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Book')}</th>
                    <th scope="col">{t(lang, 'Due on')}</th>
                    <th scope="col">{t(lang, 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.now.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.title}
                        <div className="ep-kicker">
                          {[b.author, b.accessionNo, b.library].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>{day(lang, b.dueOn)}</td>
                      <td>
                        {b.daysLate > 0 ? (
                          <Badge tone="danger">
                            {t(lang, 'Overdue')} · {b.daysLate} {t(lang, 'days')}
                          </Badge>
                        ) : (
                          <Badge tone="success">{t(lang, 'On loan')}</Badge>
                        )}
                        {b.fine > 0 ? (
                          <div className="ep-kicker">
                            {t(lang, 'Fine so far')} {rupees(b.fine)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mine.dues.atCounter > 0 || mine.dues.atLibrary > 0 ? (
              <p className="ep-field__help" style={{ marginBottom: 0 }}>
                {mine.dues.atCounter > 0
                  ? `${t(lang, 'Library fines and charges due at the fees counter')}: ${rupees(mine.dues.atCounter)}. `
                  : ''}
                {mine.dues.atLibrary > 0
                  ? `${t(lang, 'Older fines kept at the library')}: ${rupees(mine.dues.atLibrary)}.`
                  : ''}
              </p>
            ) : null}
          </Card>
          <Card title={t(lang, 'Reservations')} style={{ marginBottom: 'var(--sp-3)' }}>
            {mine.reservations.length === 0 ? (
              <p className="ep-field__help">
                {t(lang, 'None. When every copy of a book is out, reserve it under Find a book.')}
              </p>
            ) : (
              <ul className="fp-books">
                {mine.reservations.map((r) => (
                  <li key={r.id}>
                    <span className="fp-books__what">
                      <strong>{r.title}</strong>
                      {r.author ? <span className="fp-books__note">{r.author}</span> : null}
                    </span>
                    <span className="fp-books__state">
                      {r.status === 'ready' ? (
                        <Badge tone="warning">
                          {t(lang, 'Ready to collect')}
                          {r.library ? ` · ${r.library}` : ''} · {t(lang, 'until')}{' '}
                          {day(lang, r.readyUntil)}
                        </Badge>
                      ) : r.status === 'waiting' ? (
                        <Badge tone="info">
                          {t(lang, 'Waiting')} · {t(lang, 'No.')} {r.place ?? '–'}{' '}
                          {t(lang, 'in line')}
                        </Badge>
                      ) : (
                        <Badge tone={r.status === 'collected' ? 'success' : 'neutral'}>
                          {t(
                            lang,
                            r.status === 'collected'
                              ? 'Collected'
                              : r.status === 'lapsed'
                                ? 'Not collected in time'
                                : 'Cancelled',
                          )}{' '}
                          {day(lang, r.endedOn)}
                        </Badge>
                      )}
                      {r.status === 'cancelled' && r.endReason ? ` ${r.endReason}` : ''}
                    </span>
                    {r.status === 'waiting' || r.status === 'ready' ? (
                      <form action={cancelBookReservation} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={r.id} />
                        {backField}
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          {t(lang, 'Cancel')}
                          <span className="ep-sr-only"> {r.title}</span>
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {digital.length ? (
            <Card title={t(lang, 'Digital library')} style={{ marginBottom: 'var(--sp-3)' }}>
              <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
                {digital.map((d) => (
                  <li key={d.id}>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {d.title}
                      </a>
                    ) : (
                      d.title
                    )}
                    {d.author ? ` · ${d.author}` : ''}
                    {d.category ? <span className="ep-kicker"> · {d.category}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      {view === 'history' ? (
        <Card title={t(lang, 'Books read before')} style={{ marginBottom: 'var(--sp-3)' }}>
          {mine.history.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No books returned yet.')}</p>
          ) : (
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th scope="col">{t(lang, 'Book')}</th>
                  <th scope="col">{t(lang, 'Taken on')}</th>
                  <th scope="col">{t(lang, 'Returned')}</th>
                </tr>
              </thead>
              <tbody>
                {mine.history.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.title}
                      <div className="ep-kicker">
                        {[b.author, b.accessionNo].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{day(lang, b.issuedOn)}</td>
                    <td>
                      {day(lang, b.returnedOn)}
                      {b.daysLate > 0 ? (
                        <div className="ep-kicker">
                          {b.daysLate} {t(lang, 'days late')}
                          {b.fine > 0 ? ` · ${t(lang, 'Fine')} ${rupees(b.fine)}` : ''}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {view === 'find' && catalogue ? (
        <Card title={t(lang, 'Find a book')} style={{ marginBottom: 'var(--sp-3)' }}>
          <form method="get" role="search" className="fp-search">
            <input type="hidden" name="view" value="find" />
            <label className="ep-field" htmlFor="lib-q">
              <span className="ep-field__label">{t(lang, 'Title, author, subject or ISBN')}</span>
              <input id="lib-q" name="q" className="ep-input" defaultValue={q} />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              {t(lang, 'Search')}
            </button>
          </form>
          {catalogue.rows.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No book found.')}</p>
          ) : (
            <ul className="fp-books">
              {catalogue.rows.map((b) => (
                <li key={b.titleId}>
                  <span className="fp-books__what">
                    <strong>{b.title}</strong>
                    <span className="fp-books__note">
                      {[b.author, b.subject, b.publisher, b.year ? String(b.year) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="fp-books__state">
                    {b.onShelf > 0 ? (
                      <Badge tone="success">
                        {t(lang, 'On the shelf')}
                        {b.libraries ? ` · ${b.libraries}` : ''}
                      </Badge>
                    ) : b.reference ? (
                      <Badge tone="neutral">{t(lang, 'Read in the library only')}</Badge>
                    ) : (
                      <Badge tone="warning">
                        {t(lang, 'All copies out')}
                        {b.nextBack ? ` · ${t(lang, 'due back')} ${day(lang, b.nextBack)}` : ''}
                      </Badge>
                    )}
                    {b.queue > 0 ? ` ${b.queue} ${t(lang, 'waiting')}` : ''}
                  </span>
                  {holdingIds.has(b.titleId) ? (
                    <span className="fp-books__state">{t(lang, 'With you')}</span>
                  ) : reservedIds.has(b.titleId) ? (
                    <span className="fp-books__state">{t(lang, 'Reserved')}</span>
                  ) : b.canReserve ? (
                    <form action={reserveBook} style={{ display: 'inline' }}>
                      <input type="hidden" name="borrowerId" value={mine.borrower.id} />
                      <input type="hidden" name="titleId" value={b.titleId} />
                      {backField}
                      <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                        {t(lang, 'Reserve')}
                        <span className="ep-sr-only"> {b.title}</span>
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {catalogue.pages > 1 ? (
            <nav
              aria-label={t(lang, 'Pages')}
              className="ep-tabs-links"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              {catalogue.page > 1 ? (
                <a
                  href={here({
                    view: 'find',
                    ...(q ? { q } : {}),
                    page: String(catalogue.page - 1),
                  })}
                >
                  {t(lang, 'Previous')}
                </a>
              ) : null}
              <span>
                {catalogue.page} / {catalogue.pages}
              </span>
              {catalogue.page < catalogue.pages ? (
                <a
                  href={here({
                    view: 'find',
                    ...(q ? { q } : {}),
                    page: String(catalogue.page + 1),
                  })}
                >
                  {t(lang, 'Next')}
                </a>
              ) : null}
            </nav>
          ) : null}
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {t(
              lang,
              'A book can be reserved when every copy is out. The next copy back is kept for you for a few days; collect it at the library.',
            )}
          </p>
        </Card>
      ) : null}
    </main>
  );
}
