import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, RECEIPT_KIND, RECEIPT_STATUS, type ReceiptRow } from '@/lib/purchase';

const TABS = [
  ['waiting', 'Waiting for me'],
  ['inspecting', 'Waiting for inspection'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
] as const;
type Tab = (typeof TABS)[number][0];
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/**
 * Goods receipts and completion certificates (docs/design/84, part 7): what came against POs, waiting
 * for the department's (or the committee's) inspection, accepted into the store or rejected.
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const receives = [
    'purchase.store.operate',
    'purchase.store.manage',
    'purchase.order.manage',
  ].some((p) => me.permissions.includes(p));
  const tab: Tab = TABS.some(([k]) => k === sp.tab)
    ? (sp.tab as Tab)
    : receives
      ? 'inspecting'
      : 'waiting';
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page) });
  if (tab === 'waiting') qs.set('mine', '1');
  if (['inspecting', 'accepted', 'rejected'].includes(tab)) qs.set('status', tab);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const data = await apiFetch<{ rows: ReceiptRow[]; total: number; waitingForMe: number }>(
    `/purchase/receipts?${qs.toString()}`,
  );
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q: sp.q, ...p })) if (v) u.set(k, v);
    return `/purchase/receipts?${u.toString()}`;
  };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Goods receipts' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Goods receipts"
        description="What came against purchase orders and the services' completion certificates. The keeper records what came; the department inspects and accepts it (the purchase committee above its limit); only what is accepted enters the store, and what was bought for an indent goes straight to that department."
        actions={
          receives ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/to-receive">
              Receive against a PO
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav
        aria-label="Receipts to show"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {TABS.filter(([k]) => receives || k === 'waiting' || k === 'all').map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={link({ tab: k, page: undefined })}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
              {k === 'waiting' ? ` (${String(data.waitingForMe)})` : ''}
            </a>
          ))}
        </div>
      </nav>
      <form method="get" action="/purchase/receipts" className="ep-grid__toolbar">
        <input type="hidden" name="tab" value={tab} />
        <label className="ep-field" htmlFor="gr-q">
          <span className="ep-field__label">Search</span>
          <input
            id="gr-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Receipt, PO, vendor, challan or invoice"
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Goods receipts">
        <table className="ep-table">
          <caption className="ep-sr-only">Goods receipts</caption>
          <thead>
            <tr>
              <th scope="col">Receipt</th>
              <th scope="col">Order and vendor</th>
              <th scope="col">Department and store</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Accepted value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/receipts/${x.id}`}>{x.number}</a>
                    <span className="ep-mr-col__desc">
                      {RECEIPT_KIND[x.kind]} · {when(x.receivedOn)}
                      {x.createdBy ? ` · by ${x.createdBy}` : ''}
                    </span>
                  </td>
                  <td>
                    {x.order}
                    <span className="ep-mr-col__desc">{x.vendor}</span>
                  </td>
                  <td>
                    {x.department ?? '—'}
                    {x.store ? <span className="ep-mr-col__desc">{x.store}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {x.status === 'accepted' ? inr(x.acceptedValue) : '—'}
                  </td>
                  <td>
                    <Badge tone={RECEIPT_STATUS[x.status].tone}>
                      {RECEIPT_STATUS[x.status].label}
                    </Badge>
                    {x.status === 'inspecting' && x.waitingWith ? (
                      <span className="ep-mr-col__desc">With {x.waitingWith}</span>
                    ) : null}
                    {x.status === 'inspecting' ? (
                      <span className="ep-mr-col__desc">
                        Deemed accepted on {when(x.deemedOn)}
                        {x.overdue ? ' (passed)' : ''}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {tab === 'waiting'
                    ? 'Nothing is waiting for your inspection.'
                    : 'No receipts here.'}
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
