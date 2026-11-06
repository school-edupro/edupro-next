import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { ASSET_STATUS, inr, type AssetLists, type AssetRow } from '@/lib/purchase';

const ID = /^\d{1,18}$/;

/**
 * The asset register (docs/design/84, part 9): every tagged unit, filtered by status, item, category,
 * department, store, custodian or a search, warranty or insurance ending soon; its cost and book value;
 * QR labels for the ticked ones; import from Excel; the yearly depreciation.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('purchase.asset.manage');
  const qs = new URLSearchParams({ page: String(Math.max(1, Number(sp.page) || 1)) });
  qs.set('status', sp.status ?? 'held');
  if (sp.status === 'all') qs.delete('status');
  for (const k of ['itemId', 'categoryId', 'departmentId', 'storeId', 'custodianId'])
    if (sp[k] && ID.test(sp[k]!)) qs.set(k, sp[k]!);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  if (sp.expiring === '1') qs.set('expiring', '1');
  let data: { rows: AssetRow[]; total: number; cost: number; bookValue: number };
  let lists: AssetLists;
  try {
    [data, lists] = await Promise.all([
      apiFetch<{ rows: AssetRow[]; total: number; cost: number; bookValue: number }>(
        `/purchase/assets?${qs.toString()}`,
      ),
      apiFetch<AssetLists>('/purchase/asset-lists'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const sel = (
    name: string,
    label: string,
    opts: Array<{ id: string; name: string }>,
    all: string,
  ) => (
    <label className="ep-field" htmlFor={`as-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select id={`as-${name}`} name={name} className="ep-select" defaultValue={sp[name] ?? ''}>
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Assets' }]} />
      <PageHeader
        kicker="Purchase"
        title="Assets"
        description="Every unit of an asset item, tagged when it is accepted on a goods receipt (or imported from the old register): where it is, who keeps it, what it cost and its book value."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/purchase/assets/depreciation">
              Depreciation
            </a>
            {manage ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/purchase/assets/import">
                Import from Excel
              </a>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />
      <form
        method="get"
        action="/purchase/assets"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <label className="ep-field" htmlFor="as-status">
          <span className="ep-field__label">Status</span>
          <select
            id="as-status"
            name="status"
            className="ep-select"
            defaultValue={sp.status ?? 'held'}
          >
            <option value="held">On the books</option>
            <option value="all">All</option>
            {Object.entries(ASSET_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {sel('categoryId', 'Category', lists.categories, 'All categories')}
        {sel('departmentId', 'Department', lists.departments, 'All departments')}
        {sel('storeId', 'Store', lists.stores, 'All stores')}
        {sel(
          'custodianId',
          'Custodian',
          lists.staff.map((x) => ({ id: x.id, name: `${x.name} (${x.code})` })),
          'Anyone',
        )}
        <label className="ep-field" htmlFor="as-q">
          <span className="ep-field__label">Search</span>
          <input
            id="as-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Tag, serial, item, place"
          />
        </label>
        <label className="ep-check" htmlFor="as-exp">
          <input
            id="as-exp"
            name="expiring"
            value="1"
            className="ep-check__input"
            type="checkbox"
            defaultChecked={sp.expiring === '1'}
          />
          <span className="ep-check__box" />
          Warranty or insurance ending in 60 days
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <p className="ep-field__help">
        {data.total.toLocaleString('en-IN')} assets · cost {inr(data.cost)} · book value{' '}
        {inr(data.bookValue)}
      </p>
      <form method="get" action="/api/purchase/asset-labels" target="_blank">
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Assets">
          <table className="ep-table">
            <caption className="ep-sr-only">Assets</caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Asset</th>
                <th scope="col">Where</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Book value
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length ? (
                data.rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <input
                        type="checkbox"
                        name="ids"
                        value={a.id}
                        aria-label={`Label for ${a.tag}`}
                      />
                    </td>
                    <td>
                      <a href={`/purchase/assets/${a.id}`}>{a.tag}</a>
                      <span className="ep-mr-col__desc">
                        {a.item}
                        {a.serialNo ? ` · S/N ${a.serialNo}` : ''}
                      </span>
                    </td>
                    <td>
                      {a.store ?? a.department ?? '—'}
                      <span className="ep-mr-col__desc">
                        {[a.location, a.custodian].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {inr(a.bookValue)}
                      <span className="ep-mr-col__desc">cost {inr(a.cost)}</span>
                    </td>
                    <td>
                      <Badge tone={ASSET_STATUS[a.status]?.tone ?? 'neutral'}>
                        {a.statusLabel}
                      </Badge>
                      {a.pending ? (
                        <span className="ep-mr-col__desc">custody change waiting</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>No assets here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.rows.length ? (
          <button
            type="submit"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            Print QR labels for the ticked ones
          </button>
        ) : null}
      </form>
    </>
  );
}
