import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { StoreForm } from '@/components/purchase/StoreForm';
import { apiFetch, getMe } from '@/lib/api';
import type { StoreFormLists } from '@/lib/purchase';

/** Add a sub-store under the main store (docs/design/84, part 6). */
export default async function NewStorePage() {
  const me = await getMe();
  if (!me.permissions.includes('purchase.store.manage')) notFound();
  const lists = await apiFetch<StoreFormLists>('/purchase/store-form');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Stores', href: '/purchase/stores' }, { label: 'Add a sub-store' }]}
      />
      <PageHeader
        kicker="Purchase · Stores"
        title="Add a sub-store"
        description="A store a department keeps (a lab, the sports room): it sits under the main store and gets its stock by transfer or receipts."
      />
      <StoreForm store={null} lists={lists} />
    </>
  );
}
