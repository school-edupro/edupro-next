import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { VendorForm } from '@/components/purchase/VendorForm';
import { getMe } from '@/lib/api';
import { vendorFormLists } from '@/lib/purchase-load';

/** Add a vendor (docs/design/83, part 1): it waits for a second person's approval. */
export default async function NewVendorPage() {
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.manage')) notFound();
  const lists = await vendorFormLists();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Vendors', href: '/purchase/vendors' },
          { label: 'Add vendor' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Vendors"
        title="Add vendor"
        description="The vendor waits for a second person’s approval before a PR or PO can use it."
      />
      <VendorForm vendor={null} lists={lists} />
    </>
  );
}
