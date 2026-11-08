import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { OrderFormLists } from '@/lib/purchase';
import { EmergencyForm } from '@/components/purchase/EmergencyForm';

/**
 * Record an emergency purchase (docs/design/83, part 4): made before any indent or requisition (a pipe
 * burst, a broken generator); the vendor, what was bought, the vendor's bill and why it could not
 * wait. It goes for ratification; it is marked Emergency everywhere.
 */
export default async function EmergencyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.emergency.record')) notFound();
  const lists = await apiFetch<OrderFormLists>('/purchase/order-form');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Orders', href: '/purchase/orders' },
          { label: 'Emergency purchase' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="Record an emergency purchase"
        description={`For a purchase that could not wait for an indent and a requisition. Attach the vendor's bill and say why; everyone with the designation ${lists.emergencyRatifier} ratifies it.`}
      />
      <Notice params={sp} />
      {!lists.emergencyEnabled ? (
        <p className="ep-alert ep-alert--warning" role="status">
          Emergency purchase is switched off on{' '}
          <a style={{ textDecoration: 'underline' }} href="/purchase/settings">
            Purchase settings
          </a>
          .
        </p>
      ) : (
        <EmergencyForm lists={lists} today={today} />
      )}
    </>
  );
}
