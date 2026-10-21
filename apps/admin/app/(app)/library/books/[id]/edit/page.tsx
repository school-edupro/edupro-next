import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BookForm } from '@/components/library/BookForm';
import { ApiError, apiFetch } from '@/lib/api';
import type { BookSetup, BookView } from '@/lib/library-books';

/** A title changed (docs/design/36-library.md, part 2): every copy shows the change. */
export default async function EditBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const [setup, book] = await Promise.all([
    apiFetch<BookSetup>('/library/books/setup'),
    apiFetch<BookView>(`/library/books/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  if (!book.can.manage) notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: book.title, href: `/library/books/${book.id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        kicker="Library"
        title={`Edit ${book.title}`}
        description="Every copy of the title shows the change. A copy’s own details are edited on the book’s page."
      />
      <BookForm setup={setup} initial={book} mode="edit" />
    </>
  );
}
