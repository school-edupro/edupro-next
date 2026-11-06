import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { TransferForm } from '@/components/purchase/TransferForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { IssueFormLists, Store } from '@/lib/purchase';

/** Send stock to another store (docs/design/84, part 8). */
export default async function NewTransferPage() {
  let lists: IssueFormLists;
  try {
    lists = await apiFetch<IssueFormLists>('/purchase/issue-form');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const stores = await apiFetch<{ data: Store[] }>('/purchase/stores');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Transfers', href: '/purchase/transfers' },
          { label: 'Send to another store' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Transfers"
        title="Send to another store"
        description="The items leave your store now at its average cost; the receiving keeper receives them into theirs. Stock reserved for requisitions stays."
      />
      <TransferForm
        lists={lists}
        allStores={stores.data
          .filter((s) => s.status === 'active')
          .map((s) => ({ id: s.id, code: s.code, name: s.name }))}
      />
    </>
  );
}
