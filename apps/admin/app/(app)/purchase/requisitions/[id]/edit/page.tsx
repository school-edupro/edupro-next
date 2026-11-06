import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { RequisitionForm } from '@/components/purchase/RequisitionForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { RequisitionDetail, RequisitionFormLists } from '@/lib/purchase';

/** Change a requisition's header and lines before it goes for approval (docs/design/83, part 3). */
export default async function EditRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.requisition.manage')) notFound();
  const pr = await apiFetch<RequisitionDetail>(`/purchase/requisitions/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    },
  );
  if (!pr.can.edit) notFound();
  const lists = await apiFetch<RequisitionFormLists>('/purchase/requisition-form');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Requisitions', href: '/purchase/requisitions' },
          { label: pr.number, href: `/purchase/requisitions/${pr.id}` },
          { label: 'Change the lines' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Requisition"
        title={`Change ${pr.number}`}
        description="Changing the lines clears the committee’s signatures on the comparative statement."
      />
      <RequisitionForm pr={pr} lists={lists} />
    </>
  );
}
