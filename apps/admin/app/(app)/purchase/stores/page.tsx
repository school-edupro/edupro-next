import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type Store } from '@/lib/purchase';

/**
 * Stores (docs/design/84, part 6): the main store, which receives, and the sub-stores under it (labs,
 * the sports room, the library…), each with its keepers, its stock value and how many items are below
 * their reorder level.
 */
export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.store.view')) notFound();
  const data = await apiFetch<{ data: Store[]; canManage: boolean }>('/purchase/stores');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Stores' }]} />
      <PageHeader
        kicker="Purchase · Stores"
        title="Stores"
        description="The main store receives what the school buys; sub-stores keep what labs, the sports room or the library hold. Each has its keepers."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/purchase/stock">
              Stock in hand
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/purchase/counts"
              style={{ whiteSpace: 'nowrap' }}
            >
              Physical counts
            </a>
            {data.canManage ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href="/purchase/stores/new"
                style={{ whiteSpace: 'nowrap' }}
              >
                Add a sub-store
              </a>
            ) : null}
          </>
        }
      />
      <Notice params={sp} />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Stores">
        <table className="ep-table">
          <caption className="ep-sr-only">Stores</caption>
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col">Department · where</th>
              <th scope="col">Keepers</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Items
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`/purchase/stores/${s.id}`}>{s.name}</a>
                  <span className="ep-mr-col__desc">
                    {s.code} ·{' '}
                    {s.kind === 'main' ? 'Main store' : `under ${s.parent ?? 'the main store'}`}
                    {s.mine ? ' · you keep it' : ''}
                  </span>
                </td>
                <td>
                  {s.department ?? '—'}
                  {s.location ? <span className="ep-mr-col__desc">{s.location}</span> : null}
                </td>
                <td>{s.keepers.length ? s.keepers.map((k) => k.name).join(', ') : 'Nobody yet'}</td>
                <td style={{ textAlign: 'right' }}>{s.items}</td>
                <td style={{ textAlign: 'right' }}>{inr(s.value)}</td>
                <td>
                  <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
                    {s.status === 'active' ? 'Active' : 'Inactive'}
                  </Badge>
                  {s.belowReorder ? (
                    <span className="ep-mr-col__desc">{s.belowReorder} below reorder level</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
