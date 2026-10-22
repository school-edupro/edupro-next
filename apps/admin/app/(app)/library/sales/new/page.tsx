import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SaleDesk } from '@/components/library/SaleDesk';
import { getMe } from '@/lib/api';

/** The sale desk (docs/design/36-library.md, "Library reports", part 4): one buyer, the books, the payment. */
export default async function NewSalePage() {
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify')) notFound();
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Book sales', href: '/library/sales' },
          { label: 'Sell books' },
        ]}
      />
      <PageHeader
        kicker="Library"
        title="Sell books"
        description="Pick the buyer, scan the books with the price of each, and sell them together."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/sales/upload">
            Upload sales instead
          </a>
        }
      />
      <SaleDesk today={today} />
    </>
  );
}
