import { Badge, Breadcrumbs, DataTable, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { IMPORT_STATUS, type ImportListRow } from '@/lib/library-books';
import { uploadBooks } from '@/lib/library-books-actions';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Books from Excel (docs/design/36-library.md, part 4): upload an .xlsx or .csv in our template or the
 * legacy library's layout; it is checked first, nothing saved; the uploads so far.
 */
export default async function LibraryImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.manage')) notFound();
  const list = await apiFetch<{ data: ImportListRow[] }>('/library/imports');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Import books' }]} />
      <PageHeader
        kicker="Library"
        title="Import books"
        description="Bring books in from Excel: one row per copy. The file is checked first and nothing is saved until you import it."
      />
      <Notice params={sp} />
      <div className="ep-grid-2">
        <section className="ep-card ep-acr-card" aria-labelledby="im-up-h">
          <h2 id="im-up-h" className="ep-card__title">
            Upload a file
          </h2>
          <form action={uploadBooks} className="ep-book__upload">
            <label className="ep-field" htmlFor="im-file" style={{ margin: 0 }}>
              <span className="ep-field__label">File (.xlsx or .csv, up to 15 MB)</span>
              <input
                id="im-file"
                name="file"
                type="file"
                className="ep-input"
                required
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              />
            </label>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                Check the file
              </button>
            </div>
          </form>
        </section>
        <section className="ep-card ep-acr-card" aria-labelledby="im-how-h">
          <h2 id="im-how-h" className="ep-card__title">
            What the file holds
          </h2>
          <ul className="ep-book__how">
            <li>
              Our layout: <a href="/api/library-import/template">download the template</a> (with
              drop-downs and how to fill it).
            </li>
            <li>
              The legacy library’s book file (BookCode, BookName, Author …) as it is: its columns
              are read by their names.
            </li>
            <li>
              One row per copy. Rows with the same ISBN, or the same title, first author, edition
              and volume, become one title with its copies.
            </li>
            <li>
              An accession number already in the library updates that copy: only the cells filled in
              change.
            </li>
            <li>
              New authors, publishers, subjects, languages, vendors, shelves and racks are added to
              Library setup. Libraries and material types must be there already.
            </li>
          </ul>
        </section>
      </div>
      <h2 className="ep-card__title" style={{ marginTop: 'var(--sp-5)' }}>
        Uploads
      </h2>
      <DataTable<ImportListRow>
        caption="Uploads"
        density="dense"
        emptyTitle="No upload yet"
        columns={[
          {
            key: 'file',
            header: 'File',
            render: (x) => (
              <>
                <a href={`/library/import/${x.id}`}>
                  <strong>{x.fileName}</strong>
                </a>
                <div className="ep-field__help">
                  {x.layout === 'legacy' ? 'Legacy layout' : 'Our layout'} · {when(x.createdAt)}
                  {x.by ? ` · ${x.by}` : ''}
                </div>
              </>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (x) => (
              <Badge
                tone={
                  x.status === 'done' ? 'success' : x.status === 'discarded' ? 'neutral' : 'info'
                }
              >
                {IMPORT_STATUS[x.status] ?? x.status}
              </Badge>
            ),
          },
          { key: 'rows', header: 'Rows', numeric: true, render: (x) => x.total },
          {
            key: 'titles',
            header: 'New titles',
            numeric: true,
            render: (x) => x.summary.newTitles,
          },
          {
            key: 'copies',
            header: 'New copies',
            numeric: true,
            render: (x) => x.summary.newCopies,
          },
          { key: 'updates', header: 'Updates', numeric: true, render: (x) => x.summary.updates },
          {
            key: 'errors',
            header: 'Refused',
            numeric: true,
            render: (x) => x.summary.errors + (x.summary.failed ?? 0),
          },
        ]}
        rows={list.data}
        rowKey={(x) => x.id}
      />
    </>
  );
}
