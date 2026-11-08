import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type ReportFilters, type ReturnList } from '@/lib/purchase';

const TABS = [
  ['all', 'All'],
  ['to_vendor', 'To vendors'],
  ['to_store', 'Into the store'],
] as const;
type Tab = (typeof TABS)[number][0];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/**
 * Returns (docs/design/84, part 8; "As built — issues and returns rebuilt", 8 Nov 2026): goods sent back
 * to vendors (rejected at inspection or found defective in stock) and goods a department brought back
 * to the store. Figures, then filters (period — this month unless chosen —, store, department, item,
 * search), each return with its reason and slip. New return starts one from a PO or an issue; Report
 * opens the return register with the same filters.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const keeper = ['purchase.store.operate', 'purchase.store.manage'].some((p) =>
    me.permissions.includes(p),
  );
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const from = sp.from === undefined ? `${today().slice(0, 8)}01` : sp.from;
  const f = {
    from: DAY.test(from) ? from : '',
    to: sp.to && DAY.test(sp.to) ? sp.to : '',
    storeId: sp.storeId && ID.test(sp.storeId) ? sp.storeId : '',
    departmentId: sp.departmentId && ID.test(sp.departmentId) ? sp.departmentId : '',
    itemId: sp.itemId && ID.test(sp.itemId) ? sp.itemId : '',
    q: (sp.q ?? '').trim().slice(0, 80),
  };
  const qs = new URLSearchParams({ page: String(page) });
  if (tab !== 'all') qs.set('kind', tab);
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  const [data, lists] = await Promise.all([
    apiFetch<ReturnList>(`/purchase/returns?${qs.toString()}`),
    apiFetch<ReportFilters>('/purchase/report-filters'),
  ]);
  /** this page with the same filters (an emptied From stays empty: no limit) */
  const link = (p: Record<string, string>) => {
    const u = new URLSearchParams({ tab });
    for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
    if (!f.from) u.set('from', '');
    for (const [k, v] of Object.entries(p)) u.set(k, v);
    return `/purchase/returns?${u.toString()}`;
  };
  const report = `/purchase/reports?${new URLSearchParams(
    Object.entries({
      report: 'return_register',
      from: f.from,
      to: f.to,
      storeId: f.storeId,
      departmentId: f.departmentId,
      itemId: f.itemId,
      status: tab === 'all' ? '' : tab,
    }).filter(([, v]) => v),
  ).toString()}`;
  const filtered = Boolean(
    sp.from !== undefined || f.to || f.storeId || f.departmentId || f.itemId || f.q,
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Returns' }]} />
      <PageHeader
        kicker="Purchase"
        title="Returns"
        description="Goods sent back to vendors — rejected at inspection, or found defective in stock — and goods a department brought back to the store."
        actions={
          <>
            {keeper ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/returns/new">
                New return
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={report}>
              Report
            </a>
          </>
        }
      />
      <Notice params={sp} />
      <nav aria-label="Returns to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {TABS.map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={link({ tab: k, page: '1' })}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
            </a>
          ))}
        </div>
      </nav>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Returns" value={String(data.figures.returns)} hint="in these filters" />
        <KpiTile label="Value returned" value={inr(data.figures.value)} />
        <KpiTile label="To vendors" value={inr(data.figures.toVendors)} />
        <KpiTile label="Into the store" value={inr(data.figures.intoStore)} />
      </div>
      <form method="get" action="/purchase/returns" className="ep-grid__toolbar">
        <input type="hidden" name="tab" value={tab} />
        <label className="ep-field" htmlFor="rt-from">
          <span className="ep-field__label">From</span>
          <input id="rt-from" name="from" type="date" className="ep-input" defaultValue={f.from} />
        </label>
        <label className="ep-field" htmlFor="rt-to">
          <span className="ep-field__label">To</span>
          <input id="rt-to" name="to" type="date" className="ep-input" defaultValue={f.to} />
        </label>
        <label className="ep-field" htmlFor="rt-store">
          <span className="ep-field__label">Store</span>
          <select id="rt-store" name="storeId" className="ep-select" defaultValue={f.storeId}>
            <option value="">All</option>
            {lists.stores.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="rt-dept">
          <span className="ep-field__label">Department</span>
          <select
            id="rt-dept"
            name="departmentId"
            className="ep-select"
            defaultValue={f.departmentId}
          >
            <option value="">All</option>
            {lists.departments.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="rt-item">
          <span className="ep-field__label">Item</span>
          <select id="rt-item" name="itemId" className="ep-select" defaultValue={f.itemId}>
            <option value="">All</option>
            {lists.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="rt-q">
          <span className="ep-field__label">Search</span>
          <input
            id="rt-q"
            name="q"
            className="ep-input"
            defaultValue={f.q}
            placeholder="Return, PO, issue, vendor or department"
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
        {filtered ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/purchase/returns?tab=${tab}`}>
            Clear
          </a>
        ) : null}
      </form>
      {sp.from === undefined ? (
        <p className="ep-field__help">This month’s returns; change From for earlier ones.</p>
      ) : null}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Returns">
        <table className="ep-table">
          <caption className="ep-sr-only">Returns</caption>
          <thead>
            <tr>
              <th scope="col">Return</th>
              <th scope="col">Against</th>
              <th scope="col">Store</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Items
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Reason</th>
              <th scope="col">Slip</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/returns/${x.id}`}>{x.number}</a>{' '}
                    <Badge tone={x.kind === 'to_vendor' ? 'warning' : 'info'}>
                      {x.kind === 'to_vendor' ? 'To the vendor' : 'Into the store'}
                    </Badge>
                    <span className="ep-mr-col__desc">
                      {when(x.returnedOn)}
                      {x.by ? ` · ${x.by}` : ''}
                    </span>
                  </td>
                  <td>
                    {x.doc && x.docId ? (
                      <a
                        href={
                          x.kind === 'to_vendor'
                            ? `/purchase/orders/${x.docId}`
                            : `/purchase/issues/${x.docId}`
                        }
                      >
                        {x.doc}
                      </a>
                    ) : (
                      (x.doc ?? '—')
                    )}
                    <span className="ep-mr-col__desc">{x.vendor ?? x.department ?? ''}</span>
                  </td>
                  <td>{x.store}</td>
                  <td style={{ textAlign: 'right' }}>{x.lines}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                  <td>{x.reason ?? '—'}</td>
                  <td>
                    <FileLinks
                      href={`/api/purchase/stock-doc/returns/${x.id}`}
                      label={`${x.number} slip as a PDF`}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No returns match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > 50 ? (
        <p className="ep-field__help">
          {data.total} returns · page {page} of {Math.ceil(data.total / 50)} ·{' '}
          {page > 1 ? <a href={link({ page: String(page - 1) })}>Previous</a> : null}{' '}
          {page * 50 < data.total ? <a href={link({ page: String(page + 1) })}>Next</a> : null}
        </p>
      ) : null}
      <p className="ep-field__help">
        A return to a vendor starts from its purchase order or goods receipt; goods a department
        brings back are taken on its issue. New return finds either.
      </p>
    </>
  );
}
