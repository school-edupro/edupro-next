import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { ImportRunner } from '@/components/library/ImportRunner';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { IMPORT_KIND, IMPORT_STATUS, type ImportView } from '@/lib/library-books';
import { discardImport } from '@/lib/library-books-actions';

const KINDS = [
  ['', 'All'],
  ['new_title', 'New titles'],
  ['new_copy', 'New copies'],
  ['update', 'Updates'],
  ['unchanged', 'No change'],
  ['error', 'Refused'],
  ['warnings', 'With warnings'],
  ['failed', 'Failed'],
] as const;
const TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  new_title: 'success',
  new_copy: 'success',
  update: 'info',
  unchanged: 'neutral',
  error: 'danger',
};

/**
 * A checked upload (docs/design/36-library.md, part 4): what it holds and what each row will do, the
 * names it adds to Library setup; import it batch by batch, or discard it; the rows not imported as a
 * file to correct.
 */
export default async function LibraryImportViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    kind?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const kind = KINDS.some(([k]) => k === sp.kind) ? (sp.kind ?? '') : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const v = await apiFetch<ImportView>(
    `/library/imports/${id}?page=${String(page)}${kind ? `&kind=${kind}` : ''}`,
  ).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const s = v.summary;
  const todo = s.newCopies + s.updates;
  const open = v.status === 'checked' || v.status === 'importing';
  const pages = Math.max(1, Math.ceil(v.page.total / v.page.size));
  const link = (k: string, p = 1) =>
    `/library/import/${id}?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const WORDS: Record<string, [string, string]> = {
    authors: ['author', 'authors'],
    publishers: ['publisher', 'publishers'],
    subjects: ['subject', 'subjects'],
    languages: ['language', 'languages'],
    vendors: ['vendor', 'vendors'],
    shelves: ['shelf', 'shelves'],
  };
  const masters = Object.entries(s.masters)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${String(n)} ${(WORDS[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Import books', href: '/library/import' },
          { label: v.fileName },
        ]}
      />
      <PageHeader
        kicker="Import books"
        title={v.fileName}
        description={`${v.layout === 'legacy' ? 'The legacy library’s layout' : 'Our layout'} · ${String(v.total)} rows · ${IMPORT_STATUS[v.status] ?? v.status}`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {(
          [
            ['New titles', s.newTitles],
            ['New copies', s.newCopies],
            ['Updates', s.updates],
            ['No change', s.unchanged],
            ['Refused', s.errors],
            ['With warnings', s.warnings],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="ep-card ep-card--elevated ep-staff-kpi">
            <span className="ep-kpi__value">{n}</span>
            <span className="ep-kpi__label">{label}</span>
          </div>
        ))}
      </div>

      <section
        className="ep-card ep-acr-card"
        aria-labelledby="im-act-h"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <h2 id="im-act-h" className="ep-card__title">
          {v.status === 'done' ? 'Imported' : v.status === 'discarded' ? 'Discarded' : 'Import'}
        </h2>
        {masters.length && open ? (
          <p style={{ marginTop: 0 }}>Adds to Library setup: {masters.join(', ')}.</p>
        ) : null}
        {v.ignoredColumns.length ? (
          <p className="ep-field__help">Columns not read: {v.ignoredColumns.join(', ')}.</p>
        ) : null}
        {open ? (
          <div className="ep-hero__actions" style={{ alignItems: 'flex-end' }}>
            <ImportRunner id={v.id} todo={todo} started={v.progress.done + v.progress.failed} />
            {v.status === 'checked' ? (
              <ConfirmAction
                action={discardImport}
                fields={{ id: v.id }}
                label="Discard"
                variant="ghost"
                title="Discard this upload?"
                confirmLabel="Discard"
              >
                Nothing in it is imported. Upload the file again to import it later.
              </ConfirmAction>
            ) : null}
          </div>
        ) : null}
        {v.status === 'done' ? (
          <>
            <p style={{ marginTop: 0 }}>
              {s.done ?? 0} rows imported{s.failed ? `, ${String(s.failed)} not imported` : ''}.{' '}
              <a href="/library">Open the books</a>.
            </p>
            {s.series?.length ? (
              <p className="ep-field__help">
                The accession numbers continue at {s.series.map((x) => x.next).join(', ')}.
              </p>
            ) : null}
          </>
        ) : null}
        {s.errors || v.progress.failed ? (
          <p style={{ marginBottom: 0 }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/api/library-import/${v.id}/problems`}
            >
              Download the rows not imported
            </a>
          </p>
        ) : null}
      </section>

      <nav
        className="ep-tabs"
        aria-label="Rows by what they do"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {KINDS.map(([k, label]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={link(k)}
              aria-current={kind === k ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Rows of the file (scrolls sideways)"
      >
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Rows of {v.fileName}</caption>
          <thead>
            <tr>
              <th scope="col" className="is-numeric">
                Row
              </th>
              <th scope="col">Accession no.</th>
              <th scope="col">Title</th>
              <th scope="col">Does</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.line}>
                <td className="is-numeric">{r.line}</td>
                <td>{r.accessionNo ?? '—'}</td>
                <td>
                  {r.title ?? '—'}
                  {r.library ? <div className="ep-field__help">{r.library}</div> : null}
                </td>
                <td>
                  <Badge tone={r.state === 'failed' ? 'danger' : (TONE[r.kind] ?? 'neutral')}>
                    {r.state === 'failed' ? 'Failed' : (IMPORT_KIND[r.kind] ?? r.kind)}
                  </Badge>
                  {r.state === 'done' ? <div className="ep-field__help">Imported</div> : null}
                </td>
                <td>
                  {r.errors.length ? (
                    <div className="ep-book__err">{r.errors.join('; ')}</div>
                  ) : null}
                  {r.result ? <div className="ep-book__err">{r.result}</div> : null}
                  {r.changes.length ? <div>Changes: {r.changes.join(', ')}</div> : null}
                  {r.warnings.length ? (
                    <div className="ep-field__help">{r.warnings.join('; ')}</div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!v.rows.length ? (
              <tr>
                <td colSpan={5} className="ep-field__help">
                  No row here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="ep-hero__actions"
          style={{ marginTop: 'var(--sp-3)', alignItems: 'center' }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(kind, page - 1)}>
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(kind, page + 1)}>
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
