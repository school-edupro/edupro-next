'use client';
import { FieldPicker } from '@/components/FieldPicker';
import { deleteBookLayout, loadBookExportSetup, saveBookLayout } from '@/lib/library-books-actions';

/**
 * The book list's Excel export with the fields picked (docs/design/36-library.md, part 3): one row per
 * copy (the accession register) or per title, as the list is filtered and sorted.
 */
export function BookExportPicker({
  filters,
  titles,
  copies,
}: {
  filters: Record<string, string>;
  titles: number;
  copies: number;
}) {
  return (
    <FieldPicker
      noun="Books"
      filters={filters}
      count={copies}
      countByLevel={{ copy: copies, title: titles }}
      action="/api/library-export"
      load={loadBookExportSetup}
      save={saveBookLayout}
      remove={deleteBookLayout}
      example="For example: Shelf list, Stock register"
    />
  );
}
