import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { ReorderList } from '@/components/purchase/ReorderList';
import { apiFetch } from '@/lib/api';
import type { ReorderRow } from '@/lib/purchase';

/**
 * Reorder (docs/design/84, part 9): per store the items whose free stock and what is on order are at
 * or below the reorder level; a draft indent for the store's department in one go.
 */
export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await apiFetch<{ rows: ReorderRow[] }>('/purchase/reorder');
  const stores = new Map<string, { id: string; name: string; mine: boolean; rows: ReorderRow[] }>();
  for (const r of data.rows) {
    const s = stores.get(r.storeId) ?? { id: r.storeId, name: r.store, mine: r.mine, rows: [] };
    s.rows.push(r);
    stores.set(r.storeId, s);
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Reorder' }]} />
      <PageHeader
        kicker="Purchase"
        title="Reorder"
        description="Items whose free stock (in hand less reserved) plus what is on order is at or below the store’s reorder level. The quantity offered is the reorder quantity, or up to the maximum. Set the levels on each store’s page."
      />
      <Notice params={sp} />
      {stores.size ? (
        [...stores.values()].map((s) => (
          <section key={s.id} className="ep-card" aria-labelledby={`ro-h-${s.id}`}>
            <h2 id={`ro-h-${s.id}`} className="ep-card__title">
              {s.name}
            </h2>
            <ReorderList store={s} rows={s.rows} />
          </section>
        ))
      ) : (
        <p className="ep-field__help">Nothing is at or below its reorder level.</p>
      )}
    </>
  );
}
