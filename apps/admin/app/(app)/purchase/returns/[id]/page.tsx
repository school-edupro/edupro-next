import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import type { ReturnDetail } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOURCE = {
  issue: 'Against the issue',
  rejected: 'Rejected at inspection',
  stock: 'From stock (defective)',
} as const;

/** One return note (docs/design/84, part 8): to the vendor or into the store, with its PDF. */
export default async function ReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const r = await apiFetch<ReturnDetail>(`/purchase/returns/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const vendor = r.kind === 'to_vendor';
  const total = r.lineItems.reduce((a, l) => a + l.value, 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Returns', href: '/purchase/returns' },
          { label: r.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · ${vendor ? 'Return to the vendor' : 'Return into the store'}`}
        title={r.number}
        description={`${r.store} · ${when(r.returnedOn)}${r.by ? ` · ${r.by}` : ''}`}
        actions={
          <FileLinks
            href={`/api/purchase/stock-doc/returns/${r.id}`}
            label={`${r.number} as a PDF`}
          />
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="rt-facts">
        <h2 id="rt-facts" className="ep-card__title">
          {vendor ? `To ${r.vendor ?? 'the vendor'}` : `From ${r.department ?? 'the department'}`}
        </h2>
        <p style={{ marginTop: 0 }}>
          {vendor ? (
            <>
              Against <a href={`/purchase/orders/${r.orderId ?? ''}`}>{r.order}</a>
              {r.dispatch ? ` · sent with ${r.dispatch}` : ''}
            </>
          ) : (
            <>
              Against <a href={`/purchase/issues/${r.issueId ?? ''}`}>{r.issue}</a>
            </>
          )}
        </p>
        {r.note ? <p>{r.note}</p> : null}
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rt-facts">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Quantity
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Value
                </th>
                <th scope="col">{vendor ? 'Replacement' : 'Condition'}</th>
              </tr>
            </thead>
            <tbody>
              {r.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.item}
                    <span className="ep-mr-col__desc">
                      {[SOURCE[l.source], l.receipt, l.batch ? `Batch ${l.batch}` : null, l.reason]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.qty.toLocaleString('en-IN')} {l.unit}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(l.value)}</td>
                  <td>
                    {vendor ? (
                      <Badge tone={l.replacement ? 'warning' : 'neutral'}>
                        {l.replacement ? 'Wanted' : 'Not wanted'}
                      </Badge>
                    ) : (
                      <Badge tone={l.condition === 'unused' ? 'success' : 'danger'}>
                        {l.condition === 'unused' ? 'Unused: in stock' : 'Damaged'}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} style={{ textAlign: 'right' }}>
                  Value
                </th>
                <td style={{ textAlign: 'right' }}>{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
