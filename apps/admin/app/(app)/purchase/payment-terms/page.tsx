import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PaymentTerms } from '@/components/purchase/PaymentTerms';
import { apiFetch, getMe } from '@/lib/api';
import type { PaymentTerm } from '@/lib/purchase';

/** Payment terms in instalments (docs/design/83, part 1). */
export default async function PaymentTermsPage() {
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const terms = await apiFetch<{ data: PaymentTerm[] }>('/purchase/payment-terms').then(
    (r) => r.data,
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Payment terms' }]} />
      <PageHeader
        kicker="Purchase"
        title="Payment terms"
        description="How a vendor is paid: one or more instalments, each due in advance, after delivery or after the invoice. A vendor has its own term (else the default); the PO copies it and prints it."
      />
      <PaymentTerms terms={terms} canManage={me.permissions.includes('purchase.master.manage')} />
    </>
  );
}
