import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { RequisitionForm } from '@/components/purchase/RequisitionForm';
import { apiFetch, getMe } from '@/lib/api';
import type { RequisitionFormLists } from '@/lib/purchase';

/** A direct requisition: the purchase office's own need, without an indent (docs/design/83, part 3). */
export default async function NewRequisitionPage() {
  const me = await getMe();
  // a direct requisition is the purchase office's own right (docs/design/83)
  if (!me.permissions.includes('purchase.requisition.direct')) notFound();
  const lists = await apiFetch<RequisitionFormLists>('/purchase/requisition-form');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Requisitions', href: '/purchase/requisitions' },
          { label: 'Direct requisition' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Requisition"
        title="Direct requisition"
        description="For a need that did not come through an indent. The department’s requisition levels approve it; source it on the next page."
      />
      <RequisitionForm pr={null} lists={lists} />
    </>
  );
}
