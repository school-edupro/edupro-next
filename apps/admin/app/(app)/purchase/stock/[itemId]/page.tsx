import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { inr, type StockLedger, type Store } from '@/lib/purchase';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '—');
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * An item's stock register (docs/design/84, part 6): every move in and out of a store (or all
 * stores), with the store's balance and value after it, the batches in hand, and the balance in each
 * store; as Excel or PDF.
 */
export default async function StockRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { itemId } = await params;
  const sp = await searchParams;
  if (!ID.test(itemId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.store.view')) notFound();
  const f: Record<string, string> = {};
  if (sp.storeId && ID.test(sp.storeId)) f.storeId = sp.storeId;
  if (sp.from && DAY.test(sp.from)) f.from = sp.from;
  if (sp.to && DAY.test(sp.to)) f.to = sp.to;
  const [d, stores] = await Promise.all([
    apiFetch<StockLedger>(
      `/purchase/stock/items/${itemId}?${new URLSearchParams(f).toString()}`,
    ).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<{ data: Store[] }>('/purchase/stores'),
  ]);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/stock-file?${new URLSearchParams({ item: itemId, ...f, format }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Stock in hand', href: '/purchase/stock' },
          { label: `${d.item.name} (${d.item.code})` },
        ]}
      />
      <PageHeader
        kicker="Purchase · Stock register"
        title={`${d.item.name} (${d.item.code})`}
        description={`Kept in ${d.item.unit}${d.item.perUnit !== 1 ? ` · ${qty(d.item.perUnit)} ${d.item.unit} make one ${d.item.purchaseUnit}` : ''}${d.item.tracksBatch ? ' · by batch and expiry' : ''}.`}
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </>
        }
      />
      <form method="get" action={`/purchase/stock/${itemId}`} className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="sr-s">
          <span className="ep-field__label">Store</span>
          <select id="sr-s" name="storeId" className="ep-select" defaultValue={f.storeId ?? ''}>
            <option value="">All stores</option>
            {stores.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="sr-f">
          <span className="ep-field__label">From</span>
          <input
            id="sr-f"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={f.from ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor="sr-t">
          <span className="ep-field__label">To</span>
          <input id="sr-t" name="to" type="date" className="ep-input" defaultValue={f.to ?? ''} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      {d.balances.length ? (
        <section className="ep-card" aria-labelledby="sr-bal">
          <h2 id="sr-bal" className="ep-card__title">
            In each store
          </h2>
          <ul className="ep-purch-checks">
            {d.balances.map((b) => (
              <li key={b.storeId}>
                <strong>{b.store}</strong>: {qty(b.qty)} {b.unit}
                {b.reserved ? ` (${qty(b.reserved)} reserved)` : ''} · {inr(b.value)} at{' '}
                {inr(b.avgRate)}
              </li>
            ))}
            {d.batches.map((b) => (
              <li key={`${b.store}-${b.batch}-${b.expiry ?? ''}`}>
                Batch {b.batch} in {b.store}: {qty(b.qty)} · expires {dmy(b.expiry)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Stock register">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Stock register</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Store</th>
              <th scope="col">What</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                In
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Out
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Rate
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance value
              </th>
            </tr>
          </thead>
          <tbody>
            {d.moves.length ? (
              d.moves.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dmy(m.day)}</td>
                  <td>{m.store}</td>
                  <td>
                    {m.what}
                    {m.batch ? (
                      <span className="ep-mr-col__desc">
                        Batch {m.batch}
                        {m.expiry ? `, expires ${dmy(m.expiry)}` : ''}
                      </span>
                    ) : null}
                    {m.note && m.note !== 'Opening stock' ? (
                      <span className="ep-mr-col__desc">{m.note}</span>
                    ) : null}
                    {m.by ? <span className="ep-mr-col__desc">{m.by}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{m.qty > 0 ? qty(m.qty) : ''}</td>
                  <td style={{ textAlign: 'right' }}>{m.qty < 0 ? qty(-m.qty) : ''}</td>
                  <td style={{ textAlign: 'right' }}>{inr(m.rate)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(m.balanceQty)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(m.balanceValue)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No moves for these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
