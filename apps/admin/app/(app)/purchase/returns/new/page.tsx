import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { VendorReturnForm } from '@/components/purchase/VendorReturnForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { Returnable } from '@/lib/purchase';

/** Return goods of a PO to its vendor (?order=). */
export default async function NewVendorReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  if (!sp.order || !/^\d{1,18}$/.test(sp.order)) notFound();
  let data: Returnable;
  try {
    data = await apiFetch<Returnable>(`/purchase/returnable/${sp.order}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Returns', href: '/purchase/returns' },
          { label: 'Return to the vendor' },
        ]}
      />
      <PageHeader
        kicker={`${data.order.label} · ${data.order.vendor}`}
        title="Return to the vendor"
        description="Goods rejected at inspection never entered the stock; defective goods found later come out of it at the average cost. With a replacement wanted the order waits for it (and opens again if it had closed); without, close the order short."
      />
      <VendorReturnForm data={data} />
    </>
  );
}
