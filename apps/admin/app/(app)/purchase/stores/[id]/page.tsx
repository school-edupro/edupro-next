import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { OpeningStock } from '@/components/purchase/OpeningStock';
import { ApiError, apiFetch } from '@/lib/api';
import { inr, type StoreDetail, type StoreFormLists } from '@/lib/purchase';
import { saveStoreLevels } from '@/lib/purchase-actions';

const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '—');
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * One store (docs/design/84, part 6): its details and keepers, its stock (quantity, reserved, free,
 * average rate, value, the reorder level and whether below it, the earliest expiry), the reorder
 * levels, and the opening stock.
 */
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const s = await apiFetch<StoreDetail>(`/purchase/stores/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const lists =
    s.can.manage || s.can.operate ? await apiFetch<StoreFormLists>('/purchase/store-form') : null;
  const inStock = s.stock.filter((x) => x.qty > 0 || x.reserved > 0);
  const total = s.stock.reduce((a, x) => a + x.value, 0);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/stock-file?storeId=${s.id}&format=${format}`;
  const levelled = new Set(s.stock.map((x) => x.itemId));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Stores', href: '/purchase/stores' }, { label: s.name }]} />
      <PageHeader
        kicker={`Purchase · ${s.kind === 'main' ? 'Main store' : 'Sub-store'}`}
        title={s.name}
        description={[s.code, s.department, s.location].filter(Boolean).join(' · ')}
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
            {s.can.manage ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/stores/${s.id}/edit`}
              >
                Change
              </a>
            ) : null}
          </>
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="st-facts">
        <h2 id="st-facts" className="ep-card__title">
          The store{' '}
          <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
            {s.status === 'active' ? 'Active' : 'Inactive'}
          </Badge>
        </h2>
        <dl className="ep-facts">
          <div>
            <dt>Keepers</dt>
            <dd>
              {s.keepers.length
                ? s.keepers.map((k) => `${k.name} (${k.code})`).join(', ')
                : 'Nobody yet: give the store a keeper'}
            </dd>
          </div>
          <div>
            <dt>Stock value</dt>
            <dd>
              <strong>{inr(total)}</strong> · {inStock.length} items
              {s.belowReorder ? ` · ${String(s.belowReorder)} below their reorder level` : ''}
            </dd>
          </div>
          {s.kind === 'sub' ? (
            <div>
              <dt>Under</dt>
              <dd>{s.parent}</dd>
            </div>
          ) : null}
          <div>
            <dt>Physical count</dt>
            <dd>
              <Badge tone={s.countedThisYear ? 'success' : 'warning'}>
                {s.countedThisYear ? 'Counted this year' : 'Not counted this year'}
              </Badge>{' '}
              {s.counts.length ? (
                <>
                  Last:{' '}
                  <a
                    href={`/purchase/counts/${s.counts[0]!.id}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {s.counts[0]!.number}
                  </a>{' '}
                  ({s.counts[0]!.countedOn})
                </>
              ) : (
                <a href="/purchase/counts" style={{ textDecoration: 'underline' }}>
                  Start a count
                </a>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="ep-card" aria-labelledby="st-stock">
        <h2 id="st-stock" className="ep-card__title">
          Stock
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-stock">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Item</th>
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
              {inStock.length ? (
                inStock.map((x) => (
                  <tr key={x.itemId}>
                    <td>
                      <a href={`/purchase/stock/${x.itemId}?storeId=${s.id}`}>{x.name}</a>
                      <span className="ep-mr-col__desc">
                        {x.code} · {x.category}
                      </span>
                    </td>
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
                  <td colSpan={7}>No stock yet: post the opening stock below, or receive goods.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {s.can.manage && lists ? (
        <section className="ep-card" aria-labelledby="st-levels">
          <h2 id="st-levels" className="ep-card__title">
            Reorder levels
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            When the free stock (in stock less reserved) falls to the reorder level, the item is
            listed for reordering; the reorder quantity is what to buy, the maximum what the store
            should hold. Leave a row empty to remove its levels.
          </p>
          <form action={saveStoreLevels}>
            <input type="hidden" name="id" value={s.id} />
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-levels">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Reorder level</th>
                    <th scope="col">Reorder quantity</th>
                    <th scope="col">Maximum</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stock.map((x) => (
                    <tr key={x.itemId}>
                      <td>
                        <input type="hidden" name="itemId" value={x.itemId} />
                        {x.name} <span className="ep-mr-col__desc">in {x.unit}</span>
                      </td>
                      <td>
                        <input
                          name={`level_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Reorder level of ${x.name}`}
                          defaultValue={x.reorderLevel ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`qty_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Reorder quantity of ${x.name}`}
                          defaultValue={x.reorderQty ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`max_${x.itemId}`}
                          className="ep-input"
                          inputMode="decimal"
                          aria-label={`Maximum of ${x.name}`}
                          defaultValue={x.maxQty ?? ''}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <select
                        name="newItemId"
                        className="ep-select"
                        aria-label="Another item"
                        defaultValue=""
                      >
                        <option value="">Another item…</option>
                        {lists.items
                          .filter((i) => !levelled.has(i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.code}, {i.unit})
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <input
                        name="level_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Reorder level of the other item"
                      />
                    </td>
                    <td>
                      <input
                        name="qty_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Reorder quantity of the other item"
                      />
                    </td>
                    <td>
                      <input
                        name="max_new"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label="Maximum of the other item"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Save the reorder levels
              </button>
            </p>
          </form>
        </section>
      ) : null}

      {s.can.operate && lists ? (
        <section className="ep-card" aria-labelledby="st-open">
          <h2 id="st-open" className="ep-card__title">
            Opening stock
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            What the store holds on the day it starts in EduPro, once per item: quantity in the
            store unit and what one cost. Stock found different later is corrected by a physical
            count.
          </p>
          <OpeningStock storeId={s.id} items={lists.items} />
        </section>
      ) : null}
    </>
  );
}
