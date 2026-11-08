import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  REPORTS,
  type PurchaseReport,
  type ReportColumn,
  type ReportFilters,
  type ReportResult,
} from '@/lib/purchase';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const show = (c: ReportColumn, v: string | number | null) =>
  v === null || v === ''
    ? ''
    : c.type === 'money'
      ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : c.type === 'number'
        ? Number(v).toLocaleString('en-IN')
        : c.type === 'date' && DAY.test(String(v).slice(0, 10))
          ? dmy(String(v))
          : String(v);

/**
 * Purchase reports (docs/design/83, part 5): pick a report, filter it (the period, a store, a
 * department, a vendor, an item, a status), read it here (the first 500 rows) and save it as Excel or
 * PDF (all rows, with the filters in words). Those who see the stores without the purchase reports get
 * the store registers (issues, returns, receipts, stock).
 */
export default async function PurchaseReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const all = me.permissions.includes('purchase.report.view');
  if (!all && !me.permissions.includes('purchase.store.view')) notFound();
  const lists = await apiFetch<ReportFilters>('/purchase/report-filters');
  const mine = (Object.keys(REPORTS) as PurchaseReport[]).filter((r) => r in lists.reports);
  const report: PurchaseReport =
    sp.report && mine.includes(sp.report as PurchaseReport)
      ? (sp.report as PurchaseReport)
      : all
        ? 'po_register'
        : 'issue_register';
  const def = REPORTS[report];
  const f: Record<string, string> = {};
  if (def.filters.includes('period')) {
    if (sp.from && DAY.test(sp.from)) f.from = sp.from;
    if (sp.to && DAY.test(sp.to)) f.to = sp.to;
  }
  if (def.filters.includes('store') && sp.storeId && ID.test(sp.storeId)) f.storeId = sp.storeId;
  if (def.filters.includes('department') && sp.departmentId && ID.test(sp.departmentId))
    f.departmentId = sp.departmentId;
  if (def.filters.includes('vendor') && sp.vendorId && ID.test(sp.vendorId))
    f.vendorId = sp.vendorId;
  if (def.filters.includes('item') && sp.itemId && ID.test(sp.itemId)) f.itemId = sp.itemId;
  if (def.filters.includes('status') && sp.status && def.status && sp.status in def.status)
    f.status = sp.status;
  const data = await apiFetch<ReportResult>(
    `/purchase/reports/${report}?${new URLSearchParams(f).toString()}`,
  ).catch((e: unknown) => {
    if (e instanceof ApiError) return null;
    throw e;
  });
  /** the column that opens the row's document: its number (the registers open with the date) */
  const linkCol = ['overrides', 'issue_register', 'return_register'].includes(report) ? 1 : 0;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/purchase/report?${new URLSearchParams({ report, ...f, format }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[
          all
            ? { label: 'Purchase dashboard', href: '/purchase/dashboard' }
            : { label: 'Stores', href: '/purchase/stores' },
          { label: 'Purchase reports' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="Purchase reports"
        description={
          all
            ? 'Registers, the tracker from indent to order, pending approvals, overrides, spend, GST and MSME vendors, and the store registers. Each as Excel or PDF.'
            : 'The store registers: issues, returns, goods receipts, transfers, counts and stock. Each as Excel or PDF.'
        }
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
      <form method="get" action="/purchase/reports" className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="rp-r">
          <span className="ep-field__label">Report</span>
          <select id="rp-r" name="report" className="ep-select" defaultValue={report}>
            {mine.map((r) => (
              <option key={r} value={r}>
                {lists.reports[r]}
              </option>
            ))}
          </select>
        </label>
        {def.filters.includes('period') ? (
          <>
            <label className="ep-field" htmlFor="rp-from">
              <span className="ep-field__label">From</span>
              <input
                id="rp-from"
                name="from"
                type="date"
                className="ep-input"
                defaultValue={f.from ?? data?.from ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="rp-to">
              <span className="ep-field__label">To</span>
              <input
                id="rp-to"
                name="to"
                type="date"
                className="ep-input"
                defaultValue={f.to ?? data?.to ?? ''}
              />
            </label>
          </>
        ) : null}
        {def.filters.includes('store') ? (
          <label className="ep-field" htmlFor="rp-st">
            <span className="ep-field__label">Store</span>
            <select id="rp-st" name="storeId" className="ep-select" defaultValue={f.storeId ?? ''}>
              <option value="">All</option>
              {lists.stores.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {def.filters.includes('department') ? (
          <label className="ep-field" htmlFor="rp-d">
            <span className="ep-field__label">Department</span>
            <select
              id="rp-d"
              name="departmentId"
              className="ep-select"
              defaultValue={f.departmentId ?? ''}
            >
              <option value="">All</option>
              {lists.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {def.filters.includes('vendor') ? (
          <label className="ep-field" htmlFor="rp-v">
            <span className="ep-field__label">Vendor</span>
            <select id="rp-v" name="vendorId" className="ep-select" defaultValue={f.vendorId ?? ''}>
              <option value="">All</option>
              {lists.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {def.filters.includes('item') ? (
          <label className="ep-field" htmlFor="rp-i">
            <span className="ep-field__label">Item</span>
            <select id="rp-i" name="itemId" className="ep-select" defaultValue={f.itemId ?? ''}>
              <option value="">All</option>
              {lists.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {def.filters.includes('status') && def.status ? (
          <label className="ep-field" htmlFor="rp-s">
            <span className="ep-field__label">{report === 'overrides' ? 'Kind' : 'Status'}</span>
            <select id="rp-s" name="status" className="ep-select" defaultValue={f.status ?? ''}>
              <option value="">All</option>
              {Object.entries(def.status).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Show
        </button>
      </form>

      <section className="ep-card" aria-labelledby="rp-title">
        <h2 id="rp-title" className="ep-card__title">
          {lists.reports[report] ?? report}
        </h2>
        <p style={{ marginTop: 0 }}>{def.help}</p>
        {data ? (
          <>
            <p className="ep-field__help">
              {data.rows.length} {data.rows.length === 1 ? 'row' : 'rows'} · {data.words}
              {data.more ? ' · the first 500 shown; Excel and PDF have them all' : ''}
            </p>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rp-title">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th
                        key={c.label}
                        scope="col"
                        style={
                          c.type === 'money' || c.type === 'number'
                            ? { textAlign: 'right' }
                            : undefined
                        }
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length ? (
                    data.rows.map((r, i) => (
                      <tr key={i}>
                        {data.columns.map((c, j) => {
                          const v = show(c, r[j] ?? null);
                          const linkHere = j === linkCol;
                          const href = linkHere ? data.links?.[i] : null;
                          return (
                            <td
                              key={j}
                              style={
                                c.type === 'money' || c.type === 'number'
                                  ? { textAlign: 'right', whiteSpace: 'nowrap' }
                                  : c.type === 'date'
                                    ? { whiteSpace: 'nowrap' }
                                    : undefined
                              }
                            >
                              {href && linkHere && v ? <a href={href}>{v}</a> : v}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={data.columns.length}>
                        Nothing in this report for these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.totals && data.rows.length ? (
                  <tfoot>
                    <tr>
                      {data.columns.map((c, j) => (
                        <td
                          key={j}
                          style={
                            c.type === 'money' || c.type === 'number'
                              ? { textAlign: 'right', fontWeight: 600 }
                              : { fontWeight: 600 }
                          }
                        >
                          {show(c, data.totals![j] ?? null)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </>
        ) : (
          <p className="ep-field__error" role="alert">
            The report could not be made with these filters.
          </p>
        )}
      </section>
    </>
  );
}
