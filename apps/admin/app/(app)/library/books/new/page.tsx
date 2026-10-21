import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BookForm } from '@/components/library/BookForm';
import { ApiError, apiFetch } from '@/lib/api';
import type { BookSetup, BookView } from '@/lib/library-books';

/** A new book (docs/design/36-library.md, part 2); `?from=` starts it from another title (clone). */
export default async function NewBookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const sp = await searchParams;
  const from = sp.from && /^\d{1,18}$/.test(sp.from) ? sp.from : '';
  const [setup, source] = await Promise.all([
    apiFetch<BookSetup>('/library/books/setup'),
    from
      ? apiFetch<BookView>(`/library/books/${from}`).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        })
      : null,
  ]);
  if (!setup.can.manage) notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Books', href: '/library' },
          { label: source ? `Clone of ${source.title}` : 'Add a book' },
        ]}
      />
      <PageHeader
        kicker="Library"
        title={source ? 'Add a book from another' : 'Add a book'}
        description={
          source
            ? `Starts from “${source.title}”: change what differs (edition, volume, ISBN) and add its copies.`
            : 'The title once, with its authors and publication; then its copies, each with its accession number.'
        }
      />
      <BookForm setup={setup} initial={source ?? undefined} mode={source ? 'clone' : 'new'} />
    </>
  );
}
