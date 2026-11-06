import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type Store, type StockRow } from '@/lib/purchase';

const ID = /^\d{1,18}$/;
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '—');
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Stock in hand (docs/design/84, part 6): every store's items with quantity, reserved, free, average
 * rate and value; filter by store, category, a search, or only those below their reorder level; as
 * Excel or PDF.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.store.view')) notFound();
  const f: Record<string, string> = {};
  if (sp.storeId && ID.test(sp.storeId)) f.storeId = sp.storeId;
  if (sp.categoryId && ID.test(sp.categoryId)) f.categoryId = sp.categoryId;
  if (sp.q) f.q = sp.q.slice(0, 80);
  if (sp.below === '1') f.below = '1';
  const [data, stores] = await Promise.all([
    apiFetch<{
      data: StockRow[];
      total: number;
      value: number;
      below: number;
      categories: Array<{ id: string; name: string }>;
    }>(`/purchase/stock?${new URLSearchParams(f).toString()}`),
    apiFetch<{ data: Store[] }>('/purchase/stores'),
  ]);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/stock-file?${new URLSearchParams({ ...f, format }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Stores', href: '/purchase/stores' }, { label: 'Stock in hand' }]}
      />
      <PageHeader
        kicker="Purchase · Stores"
        title="Stock in hand"
        description="What each store holds now, at the weighted-average rate. Reserved stock is held for approved requisitions."
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
      <form method="get" action="/purchase/stock" className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="sk-s">
          <span className="ep-field__label">Store</span>
          <select id="sk-s" name="storeId" className="ep-select" defaultValue={f.storeId ?? ''}>
            <option value="">All stores</option>
            {stores.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="sk-c">
          <span className="ep-field__label">Category</span>
          <select
            id="sk-c"
            name="categoryId"
            className="ep-select"
            defaultValue={f.categoryId ?? ''}
          >
            <option value="">All</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="sk-q">
          <span className="ep-field__label">Search</span>
          <input
            id="sk-q"
            name="q"
            className="ep-input"
            defaultValue={f.q ?? ''}
            placeholder="Item code or name"
          />
        </label>
        <label className="ep-check" htmlFor="sk-b">
          <input
            id="sk-b"
            name="below"
            value="1"
            type="checkbox"
            className="ep-check__input"
            defaultChecked={f.below === '1'}
          />
          <span className="ep-check__box" />
          Below the reorder level only
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <p className="ep-field__help">
        {data.total} {data.total === 1 ? 'line' : 'lines'} · value{' '}
        <strong>{inr(data.value)}</strong>
        {data.below ? ` · ${String(data.below)} below the reorder level` : ''}
        {data.total > data.data.length ? ' · the first 1,000 shown; Excel has them all' : ''}
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Stock in hand">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Stock in hand</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Store</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                In stock
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Reserved
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Average rate
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Reorder</th>
              <th scope="col">Earliest expiry</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((x) => (
                <tr key={`${x.storeId}-${x.itemId}`}>
                  <td>
                    <a href={`/purchase/stock/${x.itemId}?storeId=${x.storeId}`}>{x.name}</a>
                    <span className="ep-mr-col__desc">
                      {x.code} · {x.category}
                    </span>
                  </td>
                  <td>{x.store}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {qty(x.qty)} {x.unit}
                  </td>
                  <td style={{ textAlign: 'right' }}>{x.reserved ? qty(x.reserved) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.avgRate)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                  <td>
                    {x.reorderLevel ? `at ${qty(x.reorderLevel)}` : '—'}
                    {x.below ? (
                      <>
                        {' '}
                        <Badge tone="warning">Below</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>{dmy(x.earliestExpiry)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No stock for these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
