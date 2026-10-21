'use client';
import { FieldPicker } from '@/components/FieldPicker';
import { deleteExportLayout, loadExportSetup, saveExportLayout } from '@/lib/recruitment-actions';

/**
 * The candidates' Excel export with the fields the office picks (docs/design/34-recruitment.md, part
 * 10): the shared field picker, with the lists that come as sheets of their own and the ticked
 * candidates.
 */
export function ExportPicker({
  filters,
  count,
}: {
  /** the list's filters, as the download sends them */
  filters: Record<string, string>;
  /** how many candidates the list shows */
  count: number;
}) {
  return (
    <FieldPicker
      noun="Candidates"
      filters={filters}
      count={count}
      action="/api/recruitment-export"
      load={loadExportSetup}
      save={saveExportLayout}
      remove={deleteExportLayout}
      ticked
      example="For example: Interview panel sheet"
      sheetsHelp="One row per entry, with the application number. For a list in one cell, tick it under “Lists in one cell”."
    />
  );
}
