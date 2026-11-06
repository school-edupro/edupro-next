import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { StoreForm } from '@/components/purchase/StoreForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { StoreDetail, StoreFormLists } from '@/lib/purchase';

/** Change a store's details and keepers (docs/design/84, part 6). */
export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.store.manage')) notFound();
  const [store, lists] = await Promise.all([
    apiFetch<StoreDetail>(`/purchase/stores/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    apiFetch<StoreFormLists>('/purchase/store-form'),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Stores', href: '/purchase/stores' },
          { label: store.name, href: `/purchase/stores/${store.id}` },
          { label: 'Change' },
        ]}
      />
      <PageHeader kicker="Purchase · Stores" title={`Change ${store.name}`} />
      <StoreForm store={store} lists={lists} />
    </>
  );
}
