import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type ToOrderGroup } from '@/lib/purchase';
import { draftOrder } from '@/lib/purchase-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/**
 * To order (docs/design/83, part 4): the lines of approved requisitions not yet on a purchase order —
 * those left after the drafts made on approval, a cancelled or rejected PO's, and a requisition the
 * system approved under the limit (no vendor yet). Tick the lines, pick the vendor, draft the PO.
 */
export default async function ToOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.order.manage')) notFound();
  const data = await apiFetch<{
    data: ToOrderGroup[];
    vendors: Array<{ id: string; code: string; name: string }>;
  }>('/purchase/to-order');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase Orders', href: '/purchase/orders' }, { label: 'To order' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="To order"
        description="Lines of approved requisitions not yet on a purchase order. Approving a requisition drafts its POs by itself; what is left waits here."
      />
      <Notice params={sp} />
      {data.data.length ? (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {data.data.map((g, gi) => {
            const n = String(gi);
            return (
              <section
                key={`${g.requisitionId}-${g.vendorId ?? 'none'}`}
                className="ep-card"
                aria-labelledby={`to-${n}`}
              >
                <h2 id={`to-${n}`} className="ep-card__title">
                  <a href={`/purchase/requisitions/${g.requisitionId}`}>{g.number}</a>
                  {g.department ? ` · ${g.department}` : ''}
                  {g.vendor ? ` · ${g.vendor}` : ' · no vendor chosen'}
                </h2>
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  {g.autoRule ? 'Approved by the system under a bypass rule. ' : ''}
                  {g.requiredBy ? `Needed by ${when(g.requiredBy)}.` : ''}
                  {g.vendor && !g.vendorActive
                    ? ' The vendor chosen is no longer active: pick another.'
                    : ''}
                </p>
                <form action={draftOrder}>
                  <input type="hidden" name="requisitionId" value={g.requisitionId} />
                  <ul className="ep-purch-checks">
                    {g.lines.map((l) => (
                      <li key={l.id}>
                        <label className="ep-check" htmlFor={`to-${n}-${l.id}`}>
                          <input
                            id={`to-${n}-${l.id}`}
                            className="ep-check__input"
                            type="checkbox"
                            name="lineId"
                            value={l.id}
                            defaultChecked
                          />
                          <span className="ep-check__box" />
                          {l.seq}. {l.item} × {l.quantity} {l.uom} at {inr(l.rate)}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
                    <label className="ep-field" htmlFor={`to-${n}-v`}>
                      <span className="ep-field__label">Vendor</span>
                      <select
                        id={`to-${n}-v`}
                        name="vendorId"
                        className="ep-select"
                        required
                        defaultValue={g.vendorActive && g.vendorId ? g.vendorId : ''}
                      >
                        <option value="">Pick the vendor</option>
                        {data.vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({v.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                      Draft the PO
                    </button>
                  </div>
                </form>
              </section>
            );
          })}
        </div>
      ) : (
        <p>Nothing waits to be ordered.</p>
      )}
    </>
  );
}
