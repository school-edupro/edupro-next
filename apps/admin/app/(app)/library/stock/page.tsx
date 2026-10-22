import { Badge, Breadcrumbs, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { apiFetch, getMe } from '@/lib/api';
import { dmy, type BookSetup } from '@/lib/library-books';
import type { StockCycle } from '@/lib/library-stock';
import { createStockCycle } from '@/lib/library-stock-actions';

const STATUS_TONE = { open: 'warning', closed: 'success', cancelled: 'neutral' } as const;
const STATUS_WORD = { open: 'Open', closed: 'Closed', cancelled: 'Cancelled' } as const;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Stock verification (docs/design/36-library.md, "Library reports", part 3): the cycles, open first, each
 * with how far it has come; a new cycle over the libraries, shelves and material types ticked. A cycle's
 * own page verifies its copies (scan, a file, by hand) and lists them.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify')) notFound();
  const [cycles, setup] = await Promise.all([
    apiFetch<{ data: StockCycle[] }>('/library/stock/cycles').then((x) => x.data),
    apiFetch<BookSetup>('/library/books/setup').catch(() => null),
  ]);
  const open = cycles.filter((x) => x.status === 'open');
  const making = sp.new === '1' || cycles.length === 0;
  const libraries = setup?.libraries ?? [];
  const shelves = setup?.shelves ?? [];
  const types = setup?.materialTypes ?? [];
  const tick = (name: string, id: string, label: string) => (
    <label key={id} className="ep-check" htmlFor={`sc-${name}-${id}`}>
      <input id={`sc-${name}-${id}`} type="checkbox" name={name} value={id} /> {label}
    </label>
  );

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Library', href: '/library' }, { label: 'Stock verification' }]}
      />
      <PageHeader
        kicker="Library"
        title="Stock verification"
        description="Check the books on the shelves in cycles: choose the libraries, shelves or material types, scan the books or upload a file of book numbers, then close the cycle to list what is missing."
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/api/library-report?report=stock-template"
            >
              Upload layout
            </a>
            {making ? null : (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/library/stock?new=1#new">
                + Start a cycle
              </a>
            )}
          </>
        }
      />
      <Notice params={sp} />
      <LibraryScopeNote />

      {making ? (
        <section
          className="ep-card"
          id="new"
          aria-labelledby="sc-new-h"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="sc-new-h" className="ep-card__title">
            Start a cycle
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The cycle lists the copies on the shelves, damaged or on loan in what you tick; tick
            nothing in a group for all of it. A copy can be in one open cycle at a time.
          </p>
          <form action={createStockCycle}>
            <div className="ep-dlog__filters">
              <div className="ep-dlog__search">
                <InputField
                  id="sc-name"
                  name="name"
                  label="Name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={`Stock check ${dmy(today())}`}
                />
              </div>
              <div className="ep-dlog__search">
                <InputField id="sc-note" name="note" label="Note" maxLength={300} />
              </div>
            </div>
            <div className="ep-stock-scope">
              <fieldset className="ep-stock-scope__group">
                <legend>Libraries</legend>
                {libraries.map((l) => tick('libraryIds', l.id, l.name))}
              </fieldset>
              <fieldset className="ep-stock-scope__group">
                <legend>Shelves</legend>
                {shelves.length ? (
                  <div className="ep-stock-scope__list">
                    {libraries.map((l) => {
                      const mine = shelves.filter((s) => s.libraryId === l.id);
                      return mine.length ? (
                        <div key={l.id}>
                          {libraries.length > 1 ? (
                            <p className="ep-stock-scope__sub">{l.name}</p>
                          ) : null}
                          {mine.map((s) =>
                            tick('shelfIds', s.id, `${s.code}${s.name ? ` · ${s.name}` : ''}`),
                          )}
                        </div>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <p className="ep-field__help">
                    No shelves are set up yet (
                    <a href="/masters/library?tab=library_shelves">Library setup</a>).
                  </p>
                )}
              </fieldset>
              <fieldset className="ep-stock-scope__group">
                <legend>Material types</legend>
                {types.map((m) => tick('materialTypeIds', m.id, m.name))}
              </fieldset>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <Button type="submit">Start the cycle</Button>
              {cycles.length ? (
                <a className="ep-btn ep-btn--secondary" href="/library/stock">
                  Cancel
                </a>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {open.length ? (
        <div className="ep-stock-open">
          {open.map((k) => (
            <a
              key={k.id}
              href={`/library/stock/${k.id}`}
              className="ep-tile-link"
              aria-label={`${k.name}: ${String(k.done)}% done. Open the cycle`}
            >
              <Card title={k.name}>
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  {k.scope.words} · since {dmy(k.startedOn)}
                </p>
                <div className="ep-stock-bar" aria-hidden="true">
                  <span style={{ width: `${String(Math.min(100, k.done))}%` }} />
                </div>
                <p style={{ margin: 'var(--sp-2) 0 0' }}>
                  <strong>{k.done}%</strong> · {k.counts.verified} verified · {k.counts.pending}{' '}
                  pending · {k.counts.onLoan} on loan · {k.counts.total} copies
                </p>
              </Card>
            </a>
          ))}
        </div>
      ) : null}

      <section className="ep-card" aria-labelledby="sc-list-h">
        <h2 id="sc-list-h" className="ep-card__title">
          Cycles · {cycles.length}
        </h2>
        {cycles.length === 0 ? (
          <p className="ep-field__help">No stock cycle yet.</p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Stock cycles (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Cycle</th>
                  <th scope="col">Started</th>
                  <th scope="col">State</th>
                  <th scope="col" className="is-numeric">
                    Copies
                  </th>
                  <th scope="col" className="is-numeric">
                    Verified
                  </th>
                  <th scope="col" className="is-numeric">
                    Pending
                  </th>
                  <th scope="col" className="is-numeric">
                    On loan
                  </th>
                  <th scope="col" className="is-numeric">
                    Missing
                  </th>
                  <th scope="col" className="is-numeric">
                    Done
                  </th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <a href={`/library/stock/${k.id}`}>{k.name}</a>
                      <div className="ep-field__help">{k.scope.words}</div>
                    </td>
                    <td>
                      {dmy(k.startedOn)}
                      {k.startedBy ? <div className="ep-field__help">by {k.startedBy}</div> : null}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[k.status]}>{STATUS_WORD[k.status]}</Badge>
                      {k.finishedOn ? (
                        <div className="ep-field__help">{dmy(k.finishedOn)}</div>
                      ) : null}
                    </td>
                    <td className="is-numeric">{k.counts.total}</td>
                    <td className="is-numeric">{k.counts.verified}</td>
                    <td className="is-numeric">{k.counts.pending || '—'}</td>
                    <td className="is-numeric">{k.counts.onLoan || '—'}</td>
                    <td className="is-numeric">
                      {k.counts.missing ? <Badge tone="danger">{k.counts.missing}</Badge> : '—'}
                    </td>
                    <td className="is-numeric">{k.done}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
