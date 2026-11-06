import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { inr, type ReturnRow } from '@/lib/purchase';

const TABS = [
  ['all', 'All'],
  ['to_vendor', 'To vendors'],
  ['to_store', 'Into the store'],
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
 * Returns (docs/design/84, part 8): goods sent back to vendors (rejected at inspection or found
 * defective in stock) and goods brought back to the store against issues.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'all';
  const qs = new URLSearchParams({ page: String(Math.max(1, Number(sp.page) || 1)) });
  if (tab !== 'all') qs.set('kind', tab);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const data = await apiFetch<{ rows: ReturnRow[] }>(`/purchase/returns?${qs.toString()}`);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Returns' }]} />
      <PageHeader
        kicker="Purchase"
        title="Returns"
        description="To return goods to a vendor, open the purchase order (or the goods receipt) and press Return to the vendor. Goods brought back by a department are recorded on its issue."
      />
      <Notice params={sp} />
      <nav aria-label="Returns to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {TABS.map(([k, l]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/purchase/returns?tab=${k}`}
              aria-current={tab === k ? 'page' : undefined}
            >
              {l}
            </a>
          ))}
        </div>
      </nav>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Returns">
        <table className="ep-table">
          <caption className="ep-sr-only">Returns</caption>
          <thead>
            <tr>
              <th scope="col">Return</th>
              <th scope="col">Against</th>
              <th scope="col">Store</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/returns/${x.id}`}>{x.number}</a>{' '}
                    <Badge tone={x.kind === 'to_vendor' ? 'warning' : 'info'}>
                      {x.kind === 'to_vendor' ? 'To the vendor' : 'Into the store'}
                    </Badge>
                    <span className="ep-mr-col__desc">
                      {when(x.returnedOn)}
                      {x.by ? ` · ${x.by}` : ''}
                    </span>
                  </td>
                  <td>
                    {x.doc ?? '—'}
                    <span className="ep-mr-col__desc">{x.vendor ?? x.department ?? ''}</span>
                  </td>
                  <td>{x.store}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No returns here.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
