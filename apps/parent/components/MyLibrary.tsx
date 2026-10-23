/**
 * My library (library round 4, part 3) — the same file in the parent portal and the staff app: the
 * borrower's figures (held now, overdue, read this session, fines) with six months of borrowing and the
 * subjects read most, and the history with filters (issued between dates, a status, a search), pages and
 * Excel / PDF of the rows as filtered.
 */
import { Card } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';

export interface LibraryStats {
  sessionFrom: string;
  holding: number;
  overdue: number;
  readSession: number;
  readMonth: number;
  readEver: number;
  lateSession: number;
  onTimeSession: number;
  avgDays: number;
  finesSession: number;
  finesPaid: number;
  finesWaived: number;
  months: Array<{ month: string; issued: number }>;
  subjects: Array<{ subject: string; loans: number }>;
}
export interface HistoryRow {
  id: string;
  accessionNo: string;
  title: string;
  author: string | null;
  library: string | null;
  subject: string | null;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewed: number;
  daysLate: number;
  daysKept: number;
  fine: number;
  waived: number;
  fineStatus: 'paid' | 'waived' | 'due' | null;
}
export interface LibraryHistory {
  stats: LibraryStats;
  rows: HistoryRow[];
  total: number;
  page: number;
  pages: number;
}
export type HistoryFilters = { from: string; to: string; status: string; q: string };

const STATUSES: Array<[string, string]> = [
  ['all', 'All books'],
  ['out', 'Not returned yet'],
  ['returned', 'Returned'],
  ['late', 'Late'],
  ['renewed', 'Renewed'],
  ['fined', 'With a fine'],
];
const FINE: Record<string, string> = { paid: 'Paid', waived: 'Waived', due: 'Due' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters from the query string, checked. */
export function historyFilters(sp: Record<string, string | undefined>): HistoryFilters {
  return {
    from: DAY.test(sp.from ?? '') ? sp.from! : '',
    to: DAY.test(sp.to ?? '') ? sp.to! : '',
    status: STATUSES.some(([v]) => v === sp.status) ? sp.status! : 'all',
    q: (sp.q ?? '').trim().slice(0, 80),
  };
}

/** The API query for the filters (and a page). */
export function historyQuery(f: HistoryFilters, page = 1): string {
  const q = new URLSearchParams({ status: f.status, page: String(page) });
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.q) q.set('q', f.q);
  return q.toString();
}

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
const monthLabel = (lang: Lang, m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'short',
    timeZone: 'UTC',
  });

/** The figures and the small borrowing chart. */
export function MyLibraryFigures({
  lang,
  stats,
  historyHref,
}: {
  lang: Lang;
  stats: LibraryStats;
  historyHref: string;
}) {
  const finesDue = Math.max(0, stats.finesSession - stats.finesPaid - stats.finesWaived);
  const max = Math.max(1, ...stats.months.map((m) => m.issued));
  const tile = (label: string, value: string, sub: string, href?: string) => (
    <div className="fp-glance" key={label}>
      <div className="fp-glance__body">
        <span className="fp-glance__label">{t(lang, label)}</span>
        {href ? (
          <a className="fp-glance__value fp-libvalue" href={href}>
            {value}
          </a>
        ) : (
          <span className="fp-glance__value">{value}</span>
        )}
        <span className="fp-glance__note">{sub}</span>
      </div>
    </div>
  );
  return (
    <>
      <div className="fp-glances fp-glances--4" style={{ marginBottom: 'var(--sp-3)' }}>
        {tile(
          'With me now',
          String(stats.holding),
          stats.overdue
            ? `${String(stats.overdue)} ${t(lang, 'overdue')}`
            : t(lang, 'none overdue'),
        )}
        {tile(
          'Read this session',
          String(stats.readSession),
          `${String(stats.readMonth)} ${t(lang, 'this month')}`,
          historyHref,
        )}
        {tile(
          'Returned on time',
          `${String(stats.onTimeSession)}/${String(stats.onTimeSession + stats.lateSession)}`,
          stats.avgDays
            ? `${t(lang, 'kept')} ${String(stats.avgDays)} ${t(lang, 'days on average')}`
            : t(lang, 'this session'),
        )}
        {tile(
          'Late fines',
          rupees(stats.finesSession),
          finesDue ? `${rupees(finesDue)} ${t(lang, 'due')}` : t(lang, 'nothing due'),
        )}
      </div>
      <Card
        title={t(lang, 'Books borrowed, last six months')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div
          className="fp-libbars"
          role="img"
          aria-label={stats.months
            .map((m) => `${monthLabel(lang, m.month)} ${String(m.issued)}`)
            .join(', ')}
        >
          {stats.months.map((m) => (
            <div key={m.month} className="fp-libbars__col">
              <span className="fp-libbars__n">{m.issued}</span>
              <span
                className="fp-libbars__bar"
                style={{ height: `${String(Math.max(3, (100 * m.issued) / max))}%` }}
              />
              <span className="fp-libbars__m">{monthLabel(lang, m.month)}</span>
            </div>
          ))}
        </div>
        {stats.subjects.length ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            {t(lang, 'Read most')}:{' '}
            {stats.subjects.map((s) => `${s.subject} (${String(s.loans)})`).join(', ')}
          </p>
        ) : null}
      </Card>
    </>
  );
}

/** The history: filters, the table, pages and the downloads. */
export function MyLibraryHistory({
  lang,
  data,
  filters,
  path,
  extra,
  download,
}: {
  lang: Lang;
  data: LibraryHistory;
  filters: HistoryFilters;
  /** this page's path */
  path: string;
  /** query values the page keeps (e.g. view=history) */
  extra: Record<string, string>;
  /** the download route, e.g. /api/library-history?kind=student&id=1 */
  download: string;
}) {
  const keep = (x: Record<string, string>) => {
    const q = new URLSearchParams({ ...extra });
    for (const [k, v] of Object.entries({ ...filters, ...x }))
      if (v && !(k === 'status' && v === 'all')) q.set(k, v);
    return `${path}?${q.toString()}`;
  };
  const dl = (format: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    q.set('format', format);
    return `${download}&${q.toString()}`;
  };
  return (
    <Card title={t(lang, 'Library history')} style={{ marginBottom: 'var(--sp-3)' }}>
      <form method="get" action={path} className="fp-libfilters" role="search">
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="ep-field" htmlFor="lh-from">
          <span className="ep-field__label">{t(lang, 'Taken from')}</span>
          <input
            id="lh-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={filters.from}
          />
        </label>
        <label className="ep-field" htmlFor="lh-to">
          <span className="ep-field__label">{t(lang, 'To')}</span>
          <input id="lh-to" name="to" type="date" className="ep-input" defaultValue={filters.to} />
        </label>
        <label className="ep-field" htmlFor="lh-status">
          <span className="ep-field__label">{t(lang, 'Show')}</span>
          <select id="lh-status" name="status" className="ep-select" defaultValue={filters.status}>
            {STATUSES.map(([v, label]) => (
              <option key={v} value={v}>
                {t(lang, label)}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="lh-q">
          <span className="ep-field__label">{t(lang, 'Book or author')}</span>
          <input
            id="lh-q"
            name="q"
            type="search"
            className="ep-input"
            defaultValue={filters.q}
            maxLength={80}
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          {t(lang, 'Show')}
        </button>
      </form>
      <div className="fp-libbar">
        <span className="ep-field__help" aria-live="polite">
          {data.total
            ? `${String(data.total)} ${t(lang, data.total === 1 ? 'book' : 'books')}`
            : t(lang, 'No books for these filters.')}
        </span>
        {data.total ? (
          <span className="fp-libbar__dl">
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={dl('xlsx')}>
              {t(lang, 'Excel')}
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={dl('pdf')}>
              PDF
            </a>
          </span>
        ) : null}
      </div>
      {data.rows.length ? (
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t(lang, 'Library history')}
        >
          <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
            <caption className="ep-sr-only">{t(lang, 'Library history')}</caption>
            <thead>
              <tr>
                <th scope="col">{t(lang, 'Book')}</th>
                <th scope="col">{t(lang, 'Taken on')}</th>
                <th scope="col">{t(lang, 'Returned')}</th>
                <th scope="col">{t(lang, 'Fine')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.title}
                    <div className="ep-field__help">
                      {[b.author, b.subject, b.accessionNo].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    {day(lang, b.issuedOn)}
                    <div className="ep-field__help">
                      {t(lang, 'due')} {day(lang, b.dueOn)}
                      {b.renewed ? ` · ${t(lang, 'renewed')} ${String(b.renewed)}` : ''}
                    </div>
                  </td>
                  <td>
                    {b.returnedOn ? day(lang, b.returnedOn) : <strong>{t(lang, 'Not yet')}</strong>}
                    <div className="ep-field__help">
                      {b.daysLate > 0
                        ? `${String(b.daysLate)} ${t(lang, 'days late')}`
                        : t(lang, 'on time')}
                      {` · ${String(b.daysKept)} ${t(lang, 'days')}`}
                    </div>
                  </td>
                  <td>
                    {b.fine > 0 ? rupees(b.fine) : '—'}
                    {b.fineStatus ? (
                      <div className="ep-field__help">{t(lang, FINE[b.fineStatus]!)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data.pages > 1 ? (
        <nav className="fp-libpager" aria-label={t(lang, 'Pages')}>
          {data.page > 1 ? (
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={keep({ page: String(data.page - 1) })}
            >
              ← {t(lang, 'Previous')}
            </a>
          ) : null}
          <span className="ep-field__help">
            {t(lang, 'Page')} {data.page} / {data.pages}
          </span>
          {data.page < data.pages ? (
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={keep({ page: String(data.page + 1) })}
            >
              {t(lang, 'Next')} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </Card>
  );
}
