'use client';
import { FieldPicker } from '@/components/FieldPicker';
import { deleteBookLayout, loadBookExportSetup, saveBookLayout } from '@/lib/library-books-actions';
import type { RegisterView } from '@/lib/library-register';

/**
 * The book list's Excel export with the fields picked (docs/design/36-library.md, part 3): one row per
 * copy (the accession register) or per title. At the level of the list on screen it takes that list's
 * filters, search and status; at the other level, every book.
 */
export function BookExportPicker({
  level,
  view,
}: {
  level: 'copy' | 'title';
  view: Pick<RegisterView, 'status' | 'search' | 'filters'>;
}) {
  return (
    <FieldPicker
      noun="Books"
      filters={{
        view: JSON.stringify({
          status: view.status,
          search: view.search ?? '',
          filters: view.filters,
        }),
        viewLevel: level,
      }}
      startLevel={level}
      action="/api/library-export"
      load={loadBookExportSetup}
      save={saveBookLayout}
      remove={deleteBookLayout}
      example="For example: Shelf list, Stock register"
    />
  );
}
