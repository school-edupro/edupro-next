import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { LabelsForm } from '@/components/library/LabelsForm';
import { apiFetch, getMe } from '@/lib/api';
import type { BookView, LabelSetup } from '@/lib/library-books';

/**
 * Barcode and spine labels (docs/design/36-library.md, part 5). Opened from a title (`?title=`), from
 * new copies (`?list=`), or for a range (`?from=&to=`).
 */
export default async function LibraryLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; list?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.manage')) notFound();
  const titleId = sp.title && /^\d{1,18}$/.test(sp.title) ? sp.title : '';
  const acc = (s?: string) => (s && /^[A-Za-z0-9/ ,-]{1,3000}$/.test(s) ? s : '');
  const [setup, book] = await Promise.all([
    apiFetch<LabelSetup>('/library/labels/setup'),
    titleId ? apiFetch<BookView>(`/library/books/${titleId}`).catch(() => null) : null,
  ]);
  const source = book ? 'title' : acc(sp.list) ? 'list' : 'range';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Labels' }]} />
      <PageHeader
        kicker="Library"
        title="Barcode and spine labels"
        description="The barcode is the accession number, as the issue desk reads it. Count the labels, then open the PDF and print it at actual size."
      />
      <LabelsForm
        setup={setup}
        initial={{
          source,
          ...(book ? { titleId: book.id, title: book.title } : {}),
          ...(acc(sp.list) ? { list: acc(sp.list).replace(/,/g, '\n') } : {}),
          ...(acc(sp.from) ? { from: acc(sp.from) } : {}),
          ...(acc(sp.to) ? { to: acc(sp.to) } : {}),
        }}
      />
    </>
  );
}
