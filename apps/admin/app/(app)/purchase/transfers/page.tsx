import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, TRANSFER_STATUS, type TransferRow } from '@/lib/purchase';

const TABS = [
  ['mine', 'To receive'],
  ['in_transit', 'In transit'],
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

/** Transfers between stores (docs/design/84, part 8): in transit until the receiving keeper receives them. */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const keeper = ['purchase.store.operate', 'purchase.store.manage'].some((p) =>
    me.permissions.includes(p),
  );
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : keeper ? 'mine' : 'all';
  const qs = new URLSearchParams({ page: String(Math.max(1, Number(sp.page) || 1)) });
  if (tab === 'mine') qs.set('mine', '1');
  if (tab === 'in_transit') qs.set('status', 'in_transit');
  const data = await apiFetch<{ rows: TransferRow[] }>(`/purchase/transfers?${qs.toString()}`);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Transfers' }]} />
      <PageHeader
        kicker="Purchase"
        title="Transfers"
        description="Stock sent from one store to another. It leaves the sending store at once and stays in transit until the receiving keeper receives it."
        actions={
          keeper ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/transfers/new">
              Send to another store
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav
        aria-label="Transfers to show"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {TABS.filter(([k]) => keeper || k !== 'mine').map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/purchase/transfers?tab=${k}`}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
            </a>
          ))}
        </div>
      </nav>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Transfers">
        <table className="ep-table">
          <caption className="ep-sr-only">Transfers</caption>
          <thead>
            <tr>
              <th scope="col">Transfer</th>
              <th scope="col">From → to</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/transfers/${x.id}`}>{x.number}</a>
                    <span className="ep-mr-col__desc">
                      {when(x.sentOn)}
                      {x.sentBy ? ` · ${x.sentBy}` : ''}
                    </span>
                  </td>
                  <td>
                    {x.fromStore} → {x.toStore}
                    <span className="ep-mr-col__desc">
                      {x.lines} line{x.lines === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                  <td>
                    <Badge tone={TRANSFER_STATUS[x.status].tone}>
                      {TRANSFER_STATUS[x.status].label}
                    </Badge>
                    {x.receivedOn ? (
                      <span className="ep-mr-col__desc">received {when(x.receivedOn)}</span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>
                  {tab === 'mine' ? 'Nothing is in transit to your stores.' : 'No transfers here.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
