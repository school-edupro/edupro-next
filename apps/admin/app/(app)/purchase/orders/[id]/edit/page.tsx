import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { OrderForm } from '@/components/purchase/OrderForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { OrderDetail } from '@/lib/purchase';

/** Change a draft Purchase Order, or one sent back (docs/design/83, part 4). */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.order.manage')) notFound();
  const po = await apiFetch<OrderDetail>(`/purchase/orders/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  if (!po.can.edit) notFound();
  // the HSN / SAC master, offered as a line's code is typed (an item without one shows empty)
  const hsn = await apiFetch<{
    data: Array<{
      code: string;
      description: string | null;
      gst_rate: string;
      exempt: string | boolean;
      reverse_charge: string | boolean;
      status: string;
    }>;
  }>('/masters/purchase_hsn/rows?size=500')
    .then((r) =>
      r.data
        .filter((h) => h.status === 'active')
        .map((h) => ({
          code: h.code,
          description: h.description ?? '',
          gstRate: Number(h.gst_rate),
          exempt: String(h.exempt) === 'true',
          reverseCharge: String(h.reverse_charge) === 'true',
        })),
    )
    .catch(() => []);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Orders', href: '/purchase/orders' },
          { label: po.label, href: `/purchase/orders/${po.id}` },
          { label: 'Change' },
        ]}
      />
      <PageHeader
        kicker={`Purchase · Order · ${po.vendor}`}
        title={`Change ${po.label}`}
        description={
          po.decisionNote && po.status === 'sent_back'
            ? `Sent back: ${po.decisionNote}`
            : 'The vendor stays; to order from another vendor, cancel this draft and draft a new PO on To order.'
        }
      />
      <OrderForm po={po} hsn={hsn} />
    </>
  );
}
