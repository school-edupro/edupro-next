import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { AssetImport } from '@/components/purchase/AssetImport';

/** Existing assets from the old register into the asset register (docs/design/84, part 9). */
export default function AssetImportPage() {
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Assets', href: '/purchase/assets' },
          { label: 'Import from Excel' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Assets"
        title="Import from Excel"
        description="Assets you already have, from the old register, into the asset register. The format has drop-downs for the item, store or department, custodian, condition and vendor from your set-up; one row per asset, or one row with a Quantity for many alike (each gets a new tag and QR label). Every row is checked first; then the good ones are saved. The store's stock is not changed."
      />
      <AssetImport />
    </>
  );
}
