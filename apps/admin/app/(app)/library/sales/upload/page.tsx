import { Badge, Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { BUYER_KIND, rupees, type SalesUpload } from '@/lib/library-sales';
import { decideSalesUpload, uploadSalesFile } from '@/lib/library-sales-actions';

/**
 * Sales from a file (docs/design/36-library.md, "Library reports", part 4): the file is checked row by
 * row (the book can be sold, the buyer is found or named, the price and mode read); the good rows are
 * sold together, one sale a buyer, the rest listed with what is wrong.
 */
export default async function SalesUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify')) notFound();
  const u = /^\d{1,18}$/.test(sp.id ?? '')
    ? await apiFetch<SalesUpload>(`/library/sales/uploads/${sp.id!}`).catch(() => null)
    : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Book sales', href: '/library/sales' },
          { label: 'Upload sales' },
        ]}
      />
      <PageHeader
        kicker="Library"
        title="Upload sales"
        description="An Excel or CSV file of books sold: one book a row with the buyer and the price. It is checked first; nothing is sold until you apply it."
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/api/library-report?report=sales-template"
          >
            The layout
          </a>
        }
      />
      <Notice params={sp} />
      {!u || u.status !== 'checked' ? (
        <section className="ep-card" aria-labelledby="su-h" style={{ marginBottom: 'var(--sp-4)' }}>
          <h2 id="su-h" className="ep-card__title">
            Check a file
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Columns: Accession no., Buyer (Pupil, Staff or Outside), Admission or employee no.,
            Buyer name and Mobile (someone outside), Price, Pay mode (Cash, UPI, Card or Bank;
            blank: Cash), Reference, Remarks.
          </p>
          <form action={uploadSalesFile} className="ep-dlog__filters">
            <label className="ep-field ep-dlog__search" htmlFor="su-file" style={{ margin: 0 }}>
              <span className="ep-field__label">File *</span>
              <input
                id="su-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv"
                className="ep-input"
              />
            </label>
            <Button type="submit">Check the file</Button>
          </form>
        </section>
      ) : null}
      {u ? (
        <section className="ep-card" aria-labelledby="su-pre-h">
          <h2 id="su-pre-h" className="ep-card__title">
            {u.fileName}{' '}
            <Badge
              tone={
                u.status === 'checked' ? 'warning' : u.status === 'applied' ? 'success' : 'neutral'
              }
            >
              {u.status === 'checked'
                ? 'Checked'
                : u.status === 'applied'
                  ? 'Applied'
                  : 'Discarded'}
            </Badge>
          </h2>
          {u.counts ? (
            <dl className="ep-sheet__grid">
              {(
                [
                  ['Rows', String(u.counts.rows)],
                  ['Ready to sell', String(u.counts.ok)],
                  ['With a problem', String(u.counts.errors)],
                  ['Sales (one a buyer)', String(u.counts.sales)],
                  ['Amount', rupees(u.counts.amount)],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {u.status === 'applied' && u.sales?.length ? (
            <ul>
              {u.sales.map((x) => (
                <li key={x.id}>
                  <a href={`/library/sales/${x.id}`}>{x.saleNo}</a> · {x.buyer} · {x.books} book
                  {x.books === 1 ? '' : 's'} · {rupees(x.total)}
                </li>
              ))}
            </ul>
          ) : null}
          {u.status === 'checked' ? (
            <>
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="The rows of the file (scrolls sideways)"
              >
                <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-3)' }}>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Book</th>
                      <th scope="col">Buyer</th>
                      <th scope="col" className="is-numeric">
                        Price
                      </th>
                      <th scope="col">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.lines.map((l) => (
                      <tr key={l.row}>
                        <td>{l.row}</td>
                        <td>
                          {l.accessionNo || '—'}
                          {l.title ? <div className="ep-field__help">{l.title}</div> : null}
                        </td>
                        <td>
                          {l.buyer ?? '—'}
                          {l.buyerKind ? (
                            <div className="ep-field__help">
                              {BUYER_KIND[l.buyerKind]}
                              {l.mode ? ` · ${l.mode.toUpperCase()}` : ''}
                            </div>
                          ) : null}
                        </td>
                        <td className="is-numeric">{l.price !== null ? rupees(l.price) : '—'}</td>
                        <td>
                          {l.ok ? (
                            <Badge tone="success">Ready</Badge>
                          ) : (
                            <Badge tone="danger">{l.error ?? 'Problem'}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ep-desk__actions">
                {(['apply', 'discard'] as const).map((d) => (
                  <form key={d} action={decideSalesUpload}>
                    <input type="hidden" name="uploadId" value={u.id} />
                    <input type="hidden" name="decision" value={d} />
                    <Button
                      type="submit"
                      variant={d === 'apply' ? 'primary' : 'secondary'}
                      disabled={d === 'apply' && !u.counts?.ok}
                    >
                      {d === 'apply'
                        ? `Sell ${String(u.counts?.ok ?? 0)} books in ${String(u.counts?.sales ?? 0)} sales`
                        : 'Discard the file'}
                    </Button>
                  </form>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
