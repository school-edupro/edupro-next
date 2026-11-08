import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { VendorReturnForm } from '@/components/purchase/VendorReturnForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { Returnable, ReturnSources } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00+05:30`));

/**
 * A new return. With ?order=: goods of that PO back to its vendor. Without: the picker ("As built —
 * issues and returns rebuilt", 8 Nov 2026) — to a vendor (the POs with rejected goods not yet sent
 * back, or accepted stock goods) or from a department (the issues with goods not yet back), searched,
 * the newest first; each opens its form (the PO's here, the issue's Goods brought back).
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  if (!sp.order) return <ReturnPicker sp={sp} />;
  if (!/^\d{1,18}$/.test(sp.order)) notFound();
  let data: Returnable;
  try {
    data = await apiFetch<Returnable>(`/purchase/returnable/${sp.order}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Returns', href: '/purchase/returns' },
          { label: 'Return to the vendor' },
        ]}
      />
      <PageHeader
        kicker={`${data.order.label} · ${data.order.vendor}`}
        title="Return to the vendor"
        description="Goods rejected at inspection never entered the stock; defective goods found later come out of it at the average cost. With a replacement wanted the order waits for it (and opens again if it had closed); without, close the order short."
      />
      <VendorReturnForm data={data} />
    </>
  );
}

async function ReturnPicker({ sp }: { sp: Record<string, string | undefined> }) {
  const kind = sp.kind === 'to_store' ? 'to_store' : 'to_vendor';
  const q = (sp.q ?? '').trim().slice(0, 80);
  let data: ReturnSources;
  try {
    data = await apiFetch<ReturnSources>(
      `/purchase/return-sources?${new URLSearchParams({ kind, ...(q && { q }) }).toString()}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const vendor = kind === 'to_vendor';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Returns', href: '/purchase/returns' },
          { label: 'New return' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Returns"
        title="New return"
        description="Pick what goes back: goods to a vendor against its purchase order, or goods a department brings back against its issue."
      />
      <nav
        aria-label="What is returned"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {(
            [
              ['to_vendor', 'To a vendor'],
              ['to_store', 'From a department'],
            ] as const
          ).map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/purchase/returns/new?kind=${k}`}
              aria-current={kind === k ? 'page' : undefined}
            >
              {l}
            </a>
          ))}
        </div>
      </nav>
      <form method="get" action="/purchase/returns/new" className="ep-grid__toolbar">
        <input type="hidden" name="kind" value={kind} />
        <label className="ep-field" htmlFor="nr-q">
          <span className="ep-field__label">Search</span>
          <input
            id="nr-q"
            name="q"
            className="ep-input"
            defaultValue={q}
            placeholder={
              vendor ? 'PO, goods receipt or vendor' : 'Issue, department, indent or requisition'
            }
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="nr-cap">
        <table className="ep-table">
          <caption id="nr-cap" className="ep-sr-only">
            {vendor
              ? 'Purchase orders with goods that can go back to the vendor'
              : 'Issues with goods that can come back to the store'}
          </caption>
          <thead>
            <tr>
              <th scope="col">{vendor ? 'Purchase order' : 'Issue'}</th>
              <th scope="col">{vendor ? 'Vendor' : 'Department'}</th>
              <th scope="col">{vendor ? 'Last received' : 'Issued on'}</th>
              <th scope="col">{vendor ? 'What can go back' : 'Lines not yet back'}</th>
              <th scope="col">
                <span className="ep-sr-only">Return</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.number}
                    <span className="ep-mr-col__desc">{x.detail}</span>
                  </td>
                  <td>{x.party}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(x.on)}</td>
                  <td>
                    {vendor
                      ? [
                          x.rejectedLines
                            ? `${String(x.rejectedLines)} rejected line${x.rejectedLines === 1 ? '' : 's'}`
                            : null,
                          x.stockLines
                            ? `${String(x.stockLines)} line${x.stockLines === 1 ? '' : 's'} in stock`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : String(x.openLines ?? 0)}
                  </td>
                  <td>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={x.href}
                      aria-label={`Return against ${x.number}`}
                    >
                      Return
                    </a>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {vendor
                    ? 'No purchase order of your stores has goods that can go back to its vendor.'
                    : 'No issue of your stores has goods that can come back.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="ep-field__help">
        {vendor
          ? 'Rejected goods go back as they never entered the stock; accepted goods found defective come out of the stock at the average cost.'
          : 'Unused goods go back into the stock at the rate they went out at; damaged ones are recorded for condemnation.'}{' '}
        The newest first, at most 50: search for older ones.
      </p>
    </>
  );
}
