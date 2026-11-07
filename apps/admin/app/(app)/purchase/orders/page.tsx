import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import {
  ExportButtons,
  ListFilterFields,
  readListFilters,
} from '@/components/purchase/ListFilters';
import { apiFetch, getMe } from '@/lib/api';
import {
  EMERGENCY_STATUS,
  inr,
  ORDER_STATUS,
  RECEIPT_STATUS_OF_ORDER,
  type OrderRow,
} from '@/lib/purchase';

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
  // status (on All), department, dates, the indent it came from, the vendor (docs/design/83)
  const status =
    tab === 'all' && sp.status && sp.status in ORDER_STATUS
      ? (sp.status as keyof typeof ORDER_STATUS)
      : undefined;
  if (status) qs.set('status', status);
  const f = readListFilters(sp, true);
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  const [data, choices] = await Promise.all([
    apiFetch<{
      data: OrderRow[];
      total: number;
      waitingForMe: number;
      drafts: number;
      toSend: number;
      toOrder: number;
    }>(`/purchase/orders?${qs.toString()}`),
    apiFetch<{
      departments: Array<{ id: string; name: string }>;
      vendors: Array<{ id: string; code: string; name: string }>;
    }>('/purchase/list-filters'),
  ]);
  // the file follows the tab and the filters
  const fileParams: Record<string, string | undefined> = {
    view: tab === 'waiting' ? 'waiting' : undefined,
    status: tab === 'drafts' ? 'draft' : tab === 'to-send' ? 'approved' : status,
    emergency: tab === 'emergency' ? '1' : undefined,
    q: sp.q?.slice(0, 80),
    ...f,
  };
  const count: Partial<Record<Tab, number>> = {
    waiting: data.waitingForMe,
    drafts: data.drafts,
    'to-send': data.toSend,
  };
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, status, q: sp.q, ...f, ...p })) if (v) u.set(k, v);
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
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <ExportButtons doc="orders" params={fileParams} />
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
        {tab === 'all' ? (
          <label className="ep-field" htmlFor="po-status">
            <span className="ep-field__label">Status</span>
            <select id="po-status" name="status" className="ep-select" defaultValue={status ?? ''}>
              <option value="">Any</option>
              {(Object.keys(ORDER_STATUS) as Array<keyof typeof ORDER_STATUS>).map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS[s].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ListFilterFields
          prefix="po"
          values={f}
          departments={choices.departments}
          vendors={choices.vendors}
          withIndent
        />
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
                    {['approved', 'sent'].includes(x.status) && x.receiptStatus !== 'none' ? (
                      <span className="ep-mr-col__desc">
                        {RECEIPT_STATUS_OF_ORDER[x.receiptStatus]}
                      </span>
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
