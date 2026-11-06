import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { RECEIPT_STATUS_OF_ORDER, type ToReceiveRow } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/**
 * To receive (docs/design/84, part 7): approved and sent POs with something still to come, the
 * earliest delivery date first and the late ones marked; receive goods or record the work done. The
 * PO's maker does not receive it.
 */
export default async function ToReceivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q ? `?q=${encodeURIComponent(sp.q.slice(0, 80))}` : '';
  const data = await apiFetch<{ rows: ToReceiveRow[] }>(`/purchase/to-receive${q}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Goods receipts', href: '/purchase/receipts' },
          { label: 'To receive' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="To receive"
        description="Orders the vendors still owe something on. When it comes, record what came (or, for a service, the work done); the department then inspects it."
      />
      <Notice params={sp} />
      <form method="get" action="/purchase/to-receive" className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="tr-q">
          <span className="ep-field__label">Search</span>
          <input
            id="tr-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="PO number or vendor"
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Orders to receive">
        <table className="ep-table">
          <caption className="ep-sr-only">Orders to receive</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Vendor</th>
              <th scope="col">Department</th>
              <th scope="col">Deliver by</th>
              <th scope="col">Lines to come</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/orders/${x.id}`}>{x.label}</a>
                    <span className="ep-mr-col__desc">
                      {when(x.poDate)} · {RECEIPT_STATUS_OF_ORDER[x.receiptStatus]}
                    </span>
                  </td>
                  <td>{x.vendor}</td>
                  <td>{x.department ?? '—'}</td>
                  <td>
                    {x.deliveryDate ? when(x.deliveryDate) : '—'}
                    {x.late ? (
                      <>
                        {' '}
                        <Badge tone="danger">Late</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {x.openLines} of {x.lines}
                  </td>
                  <td>
                    {x.madeByMe ? (
                      <span className="ep-mr-col__desc">
                        You made this PO: someone else receives it
                      </span>
                    ) : (
                      <span
                        style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                      >
                        {x.goods ? (
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/purchase/receipts/new?order=${x.id}`}
                            aria-label={`Receive goods against ${x.label}`}
                          >
                            Receive goods
                          </a>
                        ) : null}
                        {x.services ? (
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/purchase/receipts/new?order=${x.id}&kind=service`}
                            aria-label={`Record the work done against ${x.label}`}
                          >
                            Work done
                          </a>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>Nothing is waiting to come.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
