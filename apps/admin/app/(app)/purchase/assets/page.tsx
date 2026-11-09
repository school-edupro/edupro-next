import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { ASSET_STATUS, inr, type AssetLists, type AssetRow } from '@/lib/purchase';

const ID = /^\d{1,18}$/;
const FILTERS = ['itemId', 'categoryId', 'departmentId', 'storeId', 'custodianId'] as const;

interface AssetPage {
  rows: AssetRow[];
  total: number;
  cost: number;
  bookValue: number;
  page: number;
  size: number;
  figures: { depreciation: number; underRepair: number; lost: number; ending: number };
}

/**
 * The asset register (docs/design/84, part 9; "As built — the asset master and the import format",
 * 9 Nov 2026): figures over what the filters find, the filters (status, item, category, department,
 * store, custodian, search, warranty or insurance ending), the asset master as Excel (every field, totals
 * by category) or PDF, the register a page at a time (25, 50 or 100), QR labels for the ticked ones;
 * import from Excel; the yearly depreciation.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('purchase.asset.manage');
  const size = pageSizeOf(sp.size);
  // the filters, kept on every link (pages, files)
  const keep = new URLSearchParams();
  keep.set('status', sp.status && /^[a-z_]{2,20}$/.test(sp.status) ? sp.status : 'held');
  for (const k of FILTERS) if (sp[k] && ID.test(sp[k]!)) keep.set(k, sp[k]!);
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  if (sp.expiring === '1') keep.set('expiring', '1');
  const qs = new URLSearchParams(keep);
  if (qs.get('status') === 'all') qs.delete('status');
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  qs.set('size', size);
  let data: AssetPage;
  let lists: AssetLists;
  try {
    [data, lists] = await Promise.all([
      apiFetch<AssetPage>(`/purchase/assets?${qs.toString()}`),
      apiFetch<AssetLists>('/purchase/asset-lists'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const link = (page: number) => {
    const p = new URLSearchParams(keep);
    p.set('size', size);
    if (page > 1) p.set('page', String(page));
    return `/purchase/assets?${p.toString()}`;
  };
  const file = (format: 'xlsx' | 'pdf') => {
    const p = new URLSearchParams(keep);
    p.set('format', format);
    return `/api/purchase/assets-file?${p.toString()}`;
  };
  const filtered = FILTERS.some((k) => keep.has(k)) || keep.has('q') || keep.has('expiring');
  const sel = (
    name: (typeof FILTERS)[number],
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
  const f = data.figures;
  const status = keep.get('status')!;
  const statusWords =
    status === 'held'
      ? 'on the books'
      : status === 'all'
        ? 'all, with those gone'
        : (ASSET_STATUS[status]?.label.toLowerCase() ?? status);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Assets' }]} />
      <PageHeader
        kicker="Purchase"
        title="Assets"
        description="Every unit of an asset item, tagged when it is accepted on a goods receipt, posted as opening stock or imported from the old register: where it is, who keeps it, what it cost and its book value. Download the asset master as Excel or PDF with the filters you set."
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
      <div className="ep-dash-kpis">
        <KpiTile
          label="Assets"
          value={data.total.toLocaleString('en-IN')}
          hint={filtered ? 'in these filters' : statusWords}
        />
        <KpiTile label="Cost" value={inr(data.cost)} />
        <KpiTile label="Book value" value={inr(data.bookValue)} />
        <KpiTile label="Depreciation so far" value={inr(f.depreciation)} />
        <KpiTile
          label="Under repair or lost"
          value={String(f.underRepair + f.lost)}
          hint={`${String(f.underRepair)} under repair · ${String(f.lost)} lost`}
        />
        <KpiTile
          label="Warranty or insurance ending"
          value={String(f.ending)}
          hint={
            f.ending && sp.expiring !== '1' ? (
              <a href={`${link(1)}&expiring=1`}>in 60 days: show them</a>
            ) : (
              'in 60 days'
            )
          }
        />
      </div>
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
            defaultValue={keep.get('status')!}
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
        {sel(
          'itemId',
          'Item',
          lists.items.map((x) => ({ id: x.id, name: `${x.name} (${x.code})` })),
          'All items',
        )}
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
            placeholder="Tag, serial, item, place, custodian"
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
        <PerPage id="as-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
        {filtered || keep.get('status') !== 'held' ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/purchase/assets">
            Clear
          </a>
        ) : null}
        <span className="ep-grid__spacer" />
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={file('xlsx')}
          title="The asset master as filtered, every page: every field, and totals by category"
        >
          Excel
        </a>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={file('pdf')}
          title="The asset register as filtered, every page, on the letterhead"
        >
          PDF
        </a>
      </form>
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
                  <td colSpan={5}>
                    {data.total && data.page > 1 ? (
                      <>
                        No assets on this page.{' '}
                        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={link(1)}>
                          First page
                        </a>
                      </>
                    ) : (
                      'No assets here.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={data.page}
          size={data.size}
          total={data.total}
          href={link}
          noun={data.total === 1 ? 'asset' : 'assets'}
        />
        {data.rows.length ? (
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Print QR labels for the ticked ones
          </button>
        ) : null}
      </form>
    </>
  );
}
