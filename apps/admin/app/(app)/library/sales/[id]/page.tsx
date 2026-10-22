import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { BUYER_KIND, FROM_STATUS, rupees, SALE_STATE, type SaleOrder } from '@/lib/library-sales';

/** One sale: the buyer, the books and their prices, how it is paid; its receipt when someone outside paid. */
export default async function SalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sold?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify') || !/^\d{1,18}$/.test(id)) notFound();
  let o: SaleOrder;
  try {
    o = await apiFetch<SaleOrder>(`/library/sales/orders/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [stateWord, tone] = SALE_STATE[o.state];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Book sales', href: '/library/sales' },
          { label: o.saleNo },
        ]}
      />
      <PageHeader
        kicker="Book sale"
        title={`${o.saleNo} · ${o.buyer.name}`}
        description={`${BUYER_KIND[o.buyer.kind]}${o.buyer.ref ? ` ${o.buyer.ref}` : ''} · sold on ${dmy(o.soldOn)}${o.soldBy ? ` by ${o.soldBy}` : ''}`}
        actions={
          <>
            {o.receipt ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/library/sales/${o.id}/receipt`}
              >
                Print the receipt
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/sales/new">
              Sell more books
            </a>
          </>
        }
      />
      {sp.sold ? (
        <p className="ep-alert ep-alert--success" role="status">
          {o.books.length} book{o.books.length === 1 ? '' : 's'} sold for {rupees(o.total)}.{' '}
          {o.buyer.kind === 'other'
            ? o.receipt
              ? `Receipt ${o.receipt.receiptNo ?? ''} is made: print it for the buyer.`
              : 'No price: no receipt.'
            : o.total
              ? `It is announced to ${o.buyer.name} as a misc fee, paid at the fees counter.`
              : 'No price: nothing to pay.'}
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="so-h">
        <h2 id="so-h" className="ep-card__title">
          {rupees(o.total)} <Badge tone={tone}>{stateWord}</Badge>
        </h2>
        <dl className="ep-sheet__grid">
          {(
            [
              ['Buyer', `${o.buyer.name}${o.buyer.ref ? ` (${o.buyer.ref})` : ''}`],
              ['Mobile', o.buyer.mobile ?? '—'],
              [
                'Paid',
                o.state === 'due'
                  ? `${rupees(o.paid)} · ${rupees(o.due)} due at the fees counter`
                  : rupees(o.paid),
              ],
              ...(o.receipt
                ? ([
                    [
                      'Receipt',
                      `${o.receipt.receiptNo ?? ''}${o.mode ? ` · ${o.mode.toUpperCase()}` : ''}${o.reference ? ` · ${o.reference}` : ''}`,
                    ],
                  ] as Array<[string, string]>)
                : []),
              ...(o.note ? ([['Note', o.note]] as Array<[string, string]>) : []),
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Books sold">
          <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-3)' }}>
            <thead>
              <tr>
                <th scope="col">Book no.</th>
                <th scope="col">Book</th>
                <th scope="col">Was</th>
                <th scope="col" className="is-numeric">
                  Bought for
                </th>
                <th scope="col" className="is-numeric">
                  Sold for
                </th>
              </tr>
            </thead>
            <tbody>
              {o.books.map((b) => (
                <tr key={b.accessionNo}>
                  <td>{b.accessionNo}</td>
                  <td>
                    <a href={`/library/books/${b.titleId}`}>{b.title}</a>
                  </td>
                  <td>{b.fromStatus ? (FROM_STATUS[b.fromStatus] ?? b.fromStatus) : '—'}</td>
                  <td className="is-numeric">{b.copyPrice !== null ? rupees(b.copyPrice) : '—'}</td>
                  <td className="is-numeric">{rupees(b.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
