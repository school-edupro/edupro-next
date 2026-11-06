import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { EMERGENCY_STATUS, inr, ORDER_STATUS, type OrderRow } from '@/lib/purchase';

const TABS = [
  ['all', 'All'],
  ['waiting', 'Waiting for me'],
  ['drafts', 'Drafts'],
  ['to-send', 'Approved: to send'],
  ['emergency', 'Emergency'],
] as const;
type Tab = (typeof TABS)[number][0];
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso));

/**
 * Purchase Orders (docs/design/83, part 4): drafted from approved requisitions, approved on the
 * department's PO levels, sent to the vendor; the emergency purchases recorded for ratification.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('purchase.order.manage');
  const emergencyRight = me.permissions.includes('purchase.emergency.record');
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : manage ? 'all' : 'waiting';
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page), size: '50' });
  if (tab === 'waiting') qs.set('view', 'waiting');
  if (tab === 'drafts') qs.set('status', 'draft');
  if (tab === 'to-send') qs.set('status', 'approved');
  if (tab === 'emergency') qs.set('emergency', '1');
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const data = await apiFetch<{
    data: OrderRow[];
    total: number;
    waitingForMe: number;
    drafts: number;
    toSend: number;
    toOrder: number;
  }>(`/purchase/orders?${qs.toString()}`);
  const count: Partial<Record<Tab, number>> = {
    waiting: data.waitingForMe,
    drafts: data.drafts,
    'to-send': data.toSend,
  };
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q: sp.q, ...p })) if (v) u.set(k, v);
    return `/purchase/orders?${u.toString()}`;
  };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Purchase Orders' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Purchase Orders"
        description="Approving a requisition drafts one PO per chosen vendor. Check the draft — rates, discount, freight, delivery, payment term — send it for approval, then e-mail it to the vendor."
        actions={
          manage || emergencyRight ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {manage ? (
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href="/purchase/to-order"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  To order ({data.toOrder})
                </a>
              ) : null}
              {emergencyRight ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href="/purchase/emergency"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Record an emergency purchase
                </a>
              ) : null}
            </div>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav aria-label="Orders to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {TABS.filter(
            ([k]) => manage || k === 'waiting' || (k === 'emergency' && emergencyRight),
          ).map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={link({ tab: k, page: undefined })}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
              {count[k] !== undefined ? ` (${String(count[k])})` : ''}
            </a>
          ))}
        </div>
      </nav>
      <form method="get" action="/purchase/orders" className="ep-grid__toolbar">
        <input type="hidden" name="tab" value={tab} />
        <label className="ep-field" htmlFor="po-q">
          <span className="ep-field__label">Search</span>
          <input
            id="po-q"
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
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Purchase Orders">
        <table className="ep-table">
          <caption className="ep-sr-only">Purchase Orders</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Vendor</th>
              <th scope="col">Department</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Total
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/orders/${x.id}`}>{x.label}</a>
                    {x.emergency ? (
                      <>
                        {' '}
                        <Badge tone="danger">Emergency</Badge>
                      </>
                    ) : null}
                    <span className="ep-mr-col__desc">
                      {when(x.poDate)}
                      {x.requisition ? ` · from ${x.requisition}` : ''}
                    </span>
                  </td>
                  <td>
                    {x.vendor}
                    {x.msmeWarning ? (
                      <span className="ep-mr-col__desc">MSME: over 45 days</span>
                    ) : null}
                  </td>
                  <td>{x.department ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.total)}</td>
                  <td>
                    <Badge tone={ORDER_STATUS[x.status].tone}>
                      {x.emergency
                        ? (EMERGENCY_STATUS[x.status] ?? ORDER_STATUS[x.status].label)
                        : ORDER_STATUS[x.status].label}
                    </Badge>
                    {x.status === 'submitted' && x.waitingWith ? (
                      <span className="ep-mr-col__desc">With {x.waitingWith}</span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {tab === 'waiting' ? 'Nothing is waiting for your approval.' : 'No orders here.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > 50 ? (
        <p className="ep-field__help">
          Page {page} of {Math.ceil(data.total / 50)} ·{' '}
          {page > 1 ? <a href={link({ page: String(page - 1) })}>Previous</a> : null}{' '}
          {page * 50 < data.total ? <a href={link({ page: String(page + 1) })}>Next</a> : null}
        </p>
      ) : null}
    </>
  );
}
