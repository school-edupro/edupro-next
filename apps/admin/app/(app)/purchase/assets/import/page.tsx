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
        description="One row per unit: the item (an item of type asset), the tag already on it (or empty for a new one), make, model, serial, what it cost, when bought and put to use, the store or the department with the room and who keeps it, condition, warranty, and where it came from. Every row is checked first; then the good ones are saved. The store's stock is not changed."
      />
      <AssetImport />
    </>
  );
}
