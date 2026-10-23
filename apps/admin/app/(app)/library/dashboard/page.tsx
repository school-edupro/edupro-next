import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import {
  BarChart,
  DonutChart,
  LineChart,
  ProgressRows,
  type ChartTone,
} from '@/components/charts/Charts';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { Icon } from '@/components/nav-icons';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { rupees } from '@/lib/library-desk';
import type { LibraryDashboard } from '@/lib/library-overview';

type Lib = LibraryDashboard['matrix']['libraries'][number];
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const STATUS: Record<string, [string, ChartTone]> = {
  available: ['On the shelf', 'success'],
  issued: ['On loan', 'navy'],
  damaged: ['Damaged', 'warning'],
  lost: ['Lost', 'danger'],
  withdrawn: ['Withdrawn', 'muted'],
  sold: ['Sold', 'cyan'],
};

/**
 * Library dashboard, built like the fee dashboard: a tab per library, the figures, the "total books in
 * school" table (each library and the total, every number opening its list), then the charts two by two
 * (status, material type, this session against the last, borrowing by class, subjects), what is overdue,
 * the most read and the busiest readers.
 */
export default async function LibraryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ library?: string }>;
}) {
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.view')) notFound();
  const sp = await searchParams;
  const d = await apiFetch<LibraryDashboard>(
    `/library/dashboard${sp.library ? `?libraryId=${encodeURIComponent(sp.library)}` : ''}`,
  );
  const f = d.figures;
  const libs = d.matrix.libraries;
  const chosen = libs.find((l) => l.id === d.libraryId) ?? null;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const total = libs.reduce<Omit<Lib, 'id' | 'name' | 'titles'>>(
    (a, l) => ({
      copies: a.copies + l.copies,
      available: a.available + l.available,
      onLoan: a.onLoan + l.onLoan,
      overdue: a.overdue + l.overdue,
      lost: a.lost + l.lost,
      damaged: a.damaged + l.damaged,
      withdrawn: a.withdrawn + l.withdrawn,
      reservedReady: a.reservedReady + l.reservedReady,
      value: a.value + l.value,
    }),
    {
      copies: 0,
      available: 0,
      onLoan: 0,
      overdue: 0,
      lost: 0,
      damaged: 0,
      withdrawn: 0,
      reservedReady: 0,
      value: 0,
    },
  );
  const copiesHref = (status: string, l?: { name: string }) =>
    `/library?${new URLSearchParams({ view: 'copies', status, ...(l ? { library: l.name } : {}) }).toString()}`;
  const loansHref = (what: string, l?: { id: string }) =>
    `/library/history?${new URLSearchParams({ what, from: '', to: '', ...(l ? { libraryId: l.id } : {}) }).toString()}`;
  // the table's rows: label, value of a library / the total, where a number opens
  const ROWS: Array<{
    label: string;
    of: (l: Lib) => number;
    all: number;
    href?: (l?: Lib) => string;
    money?: boolean;
  }> = [
    { label: 'Titles', of: (l) => l.titles, all: d.matrix.titles, href: () => '/library' },
    {
      label: 'Copies',
      of: (l) => l.copies,
      all: total.copies,
      href: (l) => copiesHref('in_stock', l),
    },
    {
      label: 'On the shelf',
      of: (l) => l.available,
      all: total.available,
      href: (l) => copiesHref('available', l),
    },
    { label: 'On loan', of: (l) => l.onLoan, all: total.onLoan, href: (l) => loansHref('out', l) },
    {
      label: 'Overdue',
      of: (l) => l.overdue,
      all: total.overdue,
      href: (l) => loansHref('overdue', l),
    },
    {
      label: 'Kept for a reservation',
      of: (l) => l.reservedReady,
      all: total.reservedReady,
      href: () => '/library/reservations',
    },
    {
      label: 'Damaged',
      of: (l) => l.damaged,
      all: total.damaged,
      href: (l) => copiesHref('damaged', l),
    },
    { label: 'Lost', of: (l) => l.lost, all: total.lost, href: (l) => copiesHref('lost', l) },
    {
      label: 'Withdrawn or sold',
      of: (l) => l.withdrawn,
      all: total.withdrawn,
      href: (l) => copiesHref('withdrawn', l),
    },
    { label: 'Value of the books (₹)', of: (l) => l.value, all: total.value, money: true },
  ];
  const cell = (n: number, money: boolean | undefined, href?: string) => {
    const text = money ? rupees(n) : n.toLocaleString('en-IN');
    return href && n > 0 && !money ? (
      <a className="ep-cdash__num" href={href}>
        {text}
      </a>
    ) : (
      text
    );
  };
  const stockTotal = d.byStatus.reduce((n, x) => n + x.copies, 0);
  const sessionIssues = d.year.reduce((n, x) => n + x.thisYear, 0);
  const sessionLast = d.year.reduce((n, x) => n + x.lastYear, 0);

  return (
    <div className="ep-dash-compact">
      <PageHeader
        kicker="Library"
        title="Library dashboard"
        description={`${chosen ? chosen.name : 'All libraries'}, as of ${dmy(today)}. Live from the books register and the loans.`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/library/history"
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="chart" size={16} /> Circulation history
          </a>
        }
      />
      <LibraryScopeNote />
      {libs.length > 1 ? (
        <nav className="ep-tabs-links" aria-label="Library" style={{ marginBottom: 'var(--sp-4)' }}>
          <a href="/library/dashboard" aria-current={!chosen ? 'page' : undefined}>
            All libraries
          </a>
          {libs.map((l) => (
            <a
              key={l.id}
              href={`/library/dashboard?library=${l.id}`}
              aria-current={chosen?.id === l.id ? 'page' : undefined}
            >
              {l.name}
            </a>
          ))}
        </nav>
      ) : null}

      <h2 className="ep-sr-only">Books and loans</h2>
      <div className="ep-dash-kpis">
        <KpiTile
          label="Books (copies)"
          value={f.copies.toLocaleString('en-IN')}
          hint={`${f.titles} titles`}
        />
        <KpiTile
          label="On the shelf"
          value={f.available.toLocaleString('en-IN')}
          hint={`${pct(f.available, f.copies)}% of the books`}
        />
        <KpiTile
          label="On loan"
          value={f.onLoan.toLocaleString('en-IN')}
          hint={`${f.dueSoon} due in 3 days`}
        />
        <KpiTile
          label="Overdue"
          value={f.overdue.toLocaleString('en-IN')}
          delta={{
            text: f.onLoan ? `${pct(f.overdue, f.onLoan)}% of loans` : 'none on loan',
            tone:
              f.overdue === 0 ? 'success' : pct(f.overdue, f.onLoan) > 30 ? 'danger' : 'warning',
          }}
        />
        <KpiTile
          label="Issued today"
          value={String(f.issuedToday)}
          hint={`${f.returnedToday} returned today`}
        />
        <KpiTile label="Late fines unpaid" value={rupees(f.finesUnpaid)} hint="sent to fees" />
      </div>

      <Card title="Total books in school" style={{ marginBottom: 'var(--sp-4)' }}>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Total books in school"
        >
          <table className="ep-table ep-table--dense ep-ldash__matrix">
            <caption className="ep-sr-only">Books in each library and in the school</caption>
            <thead>
              <tr>
                <th scope="col">Library</th>
                <th scope="col" className="ep-num">
                  Total
                </th>
                {libs.map((l) => (
                  <th key={l.id} scope="col" className="ep-num">
                    <a
                      href={`/library/dashboard?library=${l.id}`}
                      style={{ textDecoration: 'underline' }}
                    >
                      {l.name}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="ep-num">
                    <strong>{cell(r.all, r.money, r.href?.())}</strong>
                  </td>
                  {libs.map((l) => (
                    <td key={l.id} className="ep-num">
                      {cell(r.of(l), r.money, r.href?.(l))}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Reservations waiting</th>
                <td className="ep-num">
                  <strong>{cell(d.matrix.reservedWaiting, false, '/library/reservations')}</strong>
                </td>
                {libs.map((l) => (
                  <td key={l.id} className="ep-num ep-field__help">
                    —
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
          Click a number to open the list behind it. Copies, titles and value leave out books
          withdrawn or sold.
        </p>
      </Card>

      <div className="ep-chart__grid2">
        <Card title="Books by status">
          {stockTotal ? (
            <DonutChart
              title="Copies by status"
              centre={stockTotal.toLocaleString('en-IN')}
              caption="copies"
              parts={d.byStatus.map((x) => ({
                label: STATUS[x.status]?.[0] ?? x.status,
                tone: STATUS[x.status]?.[1] ?? 'muted',
                value: x.copies,
              }))}
            />
          ) : (
            <p className="ep-field__help">No books yet.</p>
          )}
        </Card>
        <Card title="Books by material type">
          {d.byMaterial.length ? (
            <BarChart
              title="Copies and copies on loan by material type"
              series={[
                { label: 'Copies', tone: 'navy' },
                { label: 'On loan', tone: 'cyan' },
              ]}
              data={d.byMaterial.map((x) => ({ label: x.name, values: [x.copies, x.onLoan] }))}
            />
          ) : (
            <p className="ep-field__help">No books yet.</p>
          )}
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Books issued: this session against the last">
          <LineChart
            title="Books issued per month this session and in the same month last session"
            labels={d.year.map((x) => monthLabel(x.month))}
            series={[
              {
                label: 'This session',
                tone: 'navy',
                values: d.year.map((x) => (x.soFar ? x.thisYear : null)),
              },
              { label: 'Last session', tone: 'muted', values: d.year.map((x) => x.lastYear) },
            ]}
          />
          <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
            {sessionIssues} issued this session · {sessionLast} last session
          </p>
        </Card>
        <Card title="Pupils who borrowed this session, by class">
          {d.byClass.length ? (
            <ProgressRows
              label="Share of the pupils of each class who borrowed a book this session"
              rows={d.byClass.map((x) => {
                const r = pct(x.borrowed, x.pupils);
                return {
                  name: x.name,
                  value: x.borrowed,
                  of: x.pupils,
                  text: `${String(x.borrowed)} of ${String(x.pupils)} · ${String(r)}%`,
                  tone: r >= 60 ? 'success' : r >= 25 ? 'warning' : 'danger',
                };
              })}
            />
          ) : (
            <p className="ep-field__help">No pupils on roll.</p>
          )}
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Books by subject">
          {d.bySubject.length ? (
            <BarChart
              title="Copies and copies on loan by subject"
              series={[
                { label: 'Copies', tone: 'navy' },
                { label: 'On loan', tone: 'cyan' },
              ]}
              data={d.bySubject.map((x) => ({ label: x.name, values: [x.copies, x.onLoan] }))}
            />
          ) : (
            <p className="ep-field__help">No subjects set on the books yet.</p>
          )}
        </Card>
        <Card title="Today and periodicals">
          <dl className="ep-hd__facts">
            <div>
              <dt>Issued / returned today</dt>
              <dd>
                {f.issuedToday} / {f.returnedToday}
              </dd>
            </div>
            <div>
              <dt>Due back in the next 3 days</dt>
              <dd>{f.dueSoon}</dd>
            </div>
            <div>
              <dt>Books added this month</dt>
              <dd>{f.addedThisMonth}</dd>
            </div>
            <div>
              <dt>Periodicals due today / late / missing</dt>
              <dd>
                <a className="ep-cdash__num" href="/library/periodicals">
                  {f.periodicalsDueToday} / {f.periodicalsLate} / {f.periodicalsMissing}
                </a>{' '}
                <span className="ep-field__help">· {f.subscriptions} subscriptions</span>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title={`Overdue (${String(f.overdue)})`} style={{ marginBottom: 'var(--sp-4)' }}>
        {d.overdue.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Overdue books">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Overdue books, the longest first</caption>
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">With</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="ep-num">
                    Days late
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.overdue.map((o) => (
                  <tr key={o.copyId}>
                    <td>
                      <a href={`/library/check/${o.copyId}`}>{o.title}</a>
                      <div className="ep-field__help">{o.accessionNo}</div>
                    </td>
                    <td>
                      <a href={`/library/history/${o.kind}/${o.borrowerId}`}>{o.name}</a>
                      <div className="ep-field__help">
                        {[o.ref, o.place].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{dmy(o.dueOn)}</td>
                    <td className="ep-num">{o.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing overdue.
          </p>
        )}
        {f.overdue > d.overdue.length ? (
          <p style={{ margin: 'var(--sp-2) 0 0' }}>
            <a href={loansHref('overdue', chosen ?? undefined)}>All overdue books →</a>
          </p>
        ) : null}
      </Card>

      <div className="ep-chart__grid2">
        <Card title="Most read (6 months)">
          {d.popular.length ? (
            <ol className="ep-cdash__list">
              {d.popular.map((p) => (
                <li key={p.id}>
                  <a href={`/library/books/${p.id}`}>{p.title}</a>{' '}
                  <span className="ep-field__help">
                    · {p.author ?? ''} · {p.loans} loan{p.loans === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ep-field__help">No loans in the last six months.</p>
          )}
        </Card>
        <Card title="Busiest readers (6 months)">
          {d.readers.length ? (
            <ol className="ep-cdash__list">
              {d.readers.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <a href={`/library/history/${r.kind}/${r.id}`}>{r.name}</a>{' '}
                  <span className="ep-field__help">
                    · {[r.ref, r.place].filter(Boolean).join(' · ')} · {r.loans} book
                    {r.loans === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ep-field__help">No loans in the last six months.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
