import { Card, PageHeader, SelectField, Button } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { rupees } from '@/lib/library-desk';
import type { LibraryDashboard } from '@/lib/library-overview';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/**
 * Library dashboard: today's figures in rows of four (books, loans, reservations and fines, today,
 * periodicals), then the six months as a table and small bars, what is overdue, each library, the most
 * read and the busiest readers. Library staff tied to libraries see theirs only.
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
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const max = Math.max(1, ...d.months.map((m) => Math.max(m.issued, m.returned)));
  const row = (items: Array<[string, string, string, string?]>) => (
    <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginTop: 'var(--sp-3)' }}>
      {items.map(([label, value, sub, href]) => (
        <Card key={label} title={label}>
          <div className="ep-cdash__big">
            {href ? (
              <a className="ep-cdash__num" href={href}>
                {value}
              </a>
            ) : (
              value
            )}
          </div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {sub}
          </p>
        </Card>
      ))}
    </div>
  );
  return (
    <>
      <PageHeader
        kicker="Library"
        title="Library dashboard"
        description="Books, loans, reservations, fines and periodicals today, and the last six months."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/check">
            Check a book
          </a>
        }
      />
      <LibraryScopeNote />
      {d.libraries.length > 1 ? (
        <div className="ep-filter-band">
          <form method="get" action="/library/dashboard" className="ep-dlog__filters">
            <SelectField
              id="ld-lib"
              name="library"
              label="Library"
              defaultValue={d.libraryId ?? ''}
              options={[
                { value: '', label: 'All libraries' },
                ...d.libraries.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
        </div>
      ) : null}
      {row([
        ['Titles', String(f.titles), 'in use'],
        [
          'Copies',
          String(f.copies),
          `${String(f.addedThisMonth)} added this month`,
          '/library?view=copies',
        ],
        [
          'On the shelf',
          String(f.available),
          'ready to issue',
          '/library?view=copies&status=available',
        ],
        [
          'On loan',
          String(f.onLoan),
          `${String(f.dueSoon)} due in 3 days`,
          '/library/history?what=out&from=&to=',
        ],
      ])}
      {row([
        [
          'Overdue',
          String(f.overdue),
          'books past their due date',
          '/library/history?what=overdue&from=&to=',
        ],
        [
          'Reservations',
          String(f.reservedWaiting),
          `waiting · ${String(f.reservedReady)} kept for collection`,
          '/library/reservations',
        ],
        [
          'Late fines unpaid',
          rupees(f.finesUnpaid),
          'sent to fees, not paid yet',
          '/library/fines',
        ],
        [
          'Lost or damaged',
          String(f.lost + f.damaged),
          `${String(f.lost)} lost · ${String(f.damaged)} damaged`,
          '/library/charges',
        ],
      ])}
      {row([
        [
          'Issued today',
          String(f.issuedToday),
          'books',
          `/library/history?what=issued&from=${today}&to=${today}`,
        ],
        [
          'Returned today',
          String(f.returnedToday),
          'books',
          `/library/history?what=returned&from=${today}&to=${today}`,
        ],
        [
          'Periodicals due today',
          String(f.periodicalsDueToday),
          `${String(f.subscriptions)} current subscriptions`,
          '/library/periodicals',
        ],
        [
          'Periodicals late',
          String(f.periodicalsLate),
          `${String(f.periodicalsMissing)} marked missing`,
          '/library/periodicals',
        ],
      ])}
      <div className="ep-cdash__two">
        <Card title="Last six months">
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Last six months">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">
                Issues, returns, late returns and books added per month
              </caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="ep-num">
                    Issued
                  </th>
                  <th scope="col" className="ep-num">
                    Returned
                  </th>
                  <th scope="col" className="ep-num">
                    Returned late
                  </th>
                  <th scope="col" className="ep-num">
                    Books added
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...d.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{monthLabel(m.month)}</th>
                    <td className="ep-num">{m.issued}</td>
                    <td className="ep-num">{m.returned}</td>
                    <td className="ep-num">{m.late}</td>
                    <td className="ep-num">{m.added}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Issued and returned">
          <div
            className="ep-ldash__bars"
            role="img"
            aria-label={`Issued and returned per month: ${d.months.map((m) => `${monthLabel(m.month)} ${String(m.issued)} issued, ${String(m.returned)} returned`).join('; ')}`}
          >
            {d.months.map((m) => (
              <div key={m.month} className="ep-ldash__month">
                <div className="ep-ldash__pair">
                  <span
                    data-series="issued"
                    style={{ height: `${String((100 * m.issued) / max)}%` }}
                  />
                  <span
                    data-series="returned"
                    style={{ height: `${String((100 * m.returned) / max)}%` }}
                  />
                </div>
                <span className="ep-cdash__dlabel">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
          <div className="ep-cdash__legend">
            <span>
              <i data-series="issued" aria-hidden="true" /> Issued
            </span>
            <span>
              <i data-series="returned" aria-hidden="true" /> Returned
            </span>
          </div>
        </Card>
      </div>
      <Card title={`Overdue (${String(f.overdue)})`} style={{ marginTop: 'var(--sp-4)' }}>
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
          <p className="ep-field__help">Nothing overdue.</p>
        )}
        {f.overdue > d.overdue.length ? (
          <p>
            <a href="/library/history?what=overdue&from=&to=">All overdue books →</a>
          </p>
        ) : null}
      </Card>
      <div className="ep-cdash__two">
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
      {d.byLibrary.length > 1 ? (
        <Card title="Each library" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Each library">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">
                Copies, on the shelf, on loan and overdue per library
              </caption>
              <thead>
                <tr>
                  <th scope="col">Library</th>
                  <th scope="col" className="ep-num">
                    Copies
                  </th>
                  <th scope="col" className="ep-num">
                    On the shelf
                  </th>
                  <th scope="col" className="ep-num">
                    On loan
                  </th>
                  <th scope="col" className="ep-num">
                    Overdue
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.byLibrary.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      <a href={`/library/dashboard?library=${l.id}`}>{l.name}</a>
                    </th>
                    <td className="ep-num">{l.copies}</td>
                    <td className="ep-num">{l.available}</td>
                    <td className="ep-num">{l.onLoan}</td>
                    <td className="ep-num">{l.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
