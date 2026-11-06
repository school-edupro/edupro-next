import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { VendorImport } from '@/components/purchase/VendorImport';
import { apiFetch, getMe } from '@/lib/api';
import { VENDOR_KIND, VENDOR_STATUS, type Vendor, type VendorStatus } from '@/lib/purchase';

/**
 * The school's vendors (docs/design/83, part 1): one common master. A new vendor waits for a second
 * person's approval before a PR or PO can use it; blacklisted ones are never offered.
 */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const canManage = me.permissions.includes('purchase.master.manage');
  const status = (Object.keys(VENDOR_STATUS) as VendorStatus[]).includes(sp.status as VendorStatus)
    ? (sp.status as VendorStatus)
    : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page), size: '50' });
  if (status) qs.set('status', status);
  if (sp.q) qs.set('q', sp.q);
  const data = await apiFetch<{
    data: Vendor[];
    total: number;
    counts: Partial<Record<VendorStatus, number>>;
  }>(`/purchase/vendors?${qs.toString()}`);
  const all = Object.values(data.counts).reduce((a, n) => a + (n ?? 0), 0);
  const link = (s?: VendorStatus) =>
    `/purchase/vendors?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(sp.q ? { q: sp.q } : {}) }).toString()}`;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Vendors' }]} />
      <PageHeader
        kicker="Purchase"
        title="Vendors"
        description="The school’s common vendor master. A vendor you add, and a later change of its bank account, GSTIN or PAN, waits for a second person’s approval."
        actions={
          canManage ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/vendors/new">
              Add vendor
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav
        aria-label="Vendors by status"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          <a className="ep-tabs__tab" href={link()} aria-current={!status ? 'page' : undefined}>
            All ({all})
          </a>
          {(Object.keys(VENDOR_STATUS) as VendorStatus[]).map((s) => (
            <a
              key={s}
              className="ep-tabs__tab"
              href={link(s)}
              aria-current={status === s ? 'page' : undefined}
            >
              {VENDOR_STATUS[s].label} ({data.counts[s] ?? 0})
            </a>
          ))}
        </div>
      </nav>
      <form method="get" action="/purchase/vendors" className="ep-grid__toolbar">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <label className="ep-field" htmlFor="v-q">
          <span className="ep-field__label">Search</span>
          <input
            id="v-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Code, name, GSTIN, PAN or city"
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Search
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Vendors">
        <table className="ep-table">
          <caption className="ep-sr-only">Vendors</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Vendor</th>
              <th scope="col">GSTIN / PAN</th>
              <th scope="col">State</th>
              <th scope="col">MSME</th>
              <th scope="col">Payment term</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((v) => (
                <tr key={v.id}>
                  <td>
                    <a href={`/purchase/vendors/${v.id}`}>{v.code}</a>
                  </td>
                  <td>
                    <strong>{v.legalName}</strong>
                    <span className="ep-mr-col__desc">
                      {VENDOR_KIND[v.kind]}
                      {v.city ? ` · ${v.city}` : ''}
                    </span>
                  </td>
                  <td>{v.gstin ?? (v.pan ? `PAN ${v.pan}` : 'Not registered')}</td>
                  <td>{v.state ?? '—'}</td>
                  <td>{v.msmeType ? v.msmeType[0]!.toUpperCase() + v.msmeType.slice(1) : '—'}</td>
                  <td>{v.paymentTerm ?? '—'}</td>
                  <td>
                    <Badge tone={VENDOR_STATUS[v.status].tone}>
                      {VENDOR_STATUS[v.status].label}
                    </Badge>
                    {v.pendingChangeId ? (
                      <span className="ep-mr-col__desc">A change waits for approval</span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>
                  No vendors{status ? ` ${VENDOR_STATUS[status].label.toLowerCase()}` : ''}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > 50 ? (
        <p className="ep-field__help">
          Page {page} of {Math.ceil(data.total / 50)} ·{' '}
          {page > 1 ? <a href={`${link(status)}&page=${String(page - 1)}`}>Previous</a> : null}{' '}
          {page * 50 < data.total ? (
            <a href={`${link(status)}&page=${String(page + 1)}`}>Next</a>
          ) : null}
        </p>
      ) : null}
      <p className="ep-field__help">
        The list as Excel or PDF:{' '}
        <a href="/masters/purchase?tab=purchase_vendors">Purchase set-up → Vendors</a>.
      </p>
      {canManage ? <VendorImport /> : null}
    </>
  );
}
