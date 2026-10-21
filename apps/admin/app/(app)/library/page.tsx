import { Badge, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { isbnText, type BookRow, type BookSetup } from '@/lib/library-books';

const STATUSES = [
  ['', 'Any'],
  ['available', 'On the shelf'],
  ['issued', 'Issued'],
  ['damaged', 'Damaged'],
  ['lost', 'Lost'],
  ['withdrawn', 'Withdrawn'],
] as const;

/**
 * The book master (docs/design/36-library.md, part 2): every title with its copies on the shelf and
 * out, searched by title, author, accession number, barcode, ISBN or call number, and filtered by
 * library, material, subject and copy status. A title opens its page (copies, loans, history).
 */
export default async function LibraryBooksPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    library?: string;
    material?: string;
    subject?: string;
    status?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const id = (x?: string) => (x && /^\d{1,18}$/.test(x) ? x : '');
  const status = STATUSES.some(([k]) => k === sp.status) ? (sp.status ?? '') : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page), size: '25' });
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  if (id(sp.library)) qs.set('libraryId', id(sp.library));
  if (id(sp.material)) qs.set('materialTypeId', id(sp.material));
  if (id(sp.subject)) qs.set('subjectId', id(sp.subject));
  if (status) qs.set('status', status);
  const [t, setup, list] = await Promise.all([
    getTranslations('pages.library'),
    apiFetch<BookSetup>('/library/books/setup'),
    apiFetch<{
      data: BookRow[];
      page: { number: number; size: number; total: number };
      can: { manage: boolean };
    }>(`/library/books?${qs.toString()}`),
  ]);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const link = (n: number) => {
    const p = new URLSearchParams();
    const keep = {
      q: sp.q,
      library: sp.library,
      material: sp.material,
      subject: sp.subject,
      status,
    };
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    p.set('page', String(n));
    return `?${p.toString()}`;
  };
  const filtered = Boolean(sp.q || status || sp.library || sp.material || sp.subject);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {list.can.manage ? (
              <a className="ep-btn ep-btn--primary" href="/library/books/new">
                + Add a book
              </a>
            ) : null}
            <a className="ep-btn ep-btn--ghost" href="/masters/library">
              Library setup
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="lb-q" style={{ margin: 0 }}>
          <span className="ep-field__label">Find</span>
          <input
            id="lb-q"
            name="q"
            type="search"
            className="ep-input"
            maxLength={80}
            defaultValue={sp.q ?? ''}
            placeholder="Title, author, accession no., barcode, ISBN"
          />
        </label>
        <label className="ep-field" htmlFor="lb-library" style={{ margin: 0 }}>
          <span className="ep-field__label">Library</span>
          <select
            id="lb-library"
            name="library"
            className="ep-select"
            defaultValue={id(sp.library)}
          >
            <option value="">All</option>
            {setup.libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="lb-material" style={{ margin: 0 }}>
          <span className="ep-field__label">Material</span>
          <select
            id="lb-material"
            name="material"
            className="ep-select"
            defaultValue={id(sp.material)}
          >
            <option value="">All</option>
            {setup.materialTypes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="lb-subject" style={{ margin: 0 }}>
          <span className="ep-field__label">Subject</span>
          <select
            id="lb-subject"
            name="subject"
            className="ep-select"
            defaultValue={id(sp.subject)}
          >
            <option value="">All</option>
            {setup.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="lb-status" style={{ margin: 0 }}>
          <span className="ep-field__label">A copy that is</span>
          <select id="lb-status" name="status" className="ep-select" defaultValue={status}>
            {STATUSES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      <DataTable<BookRow>
        caption={`Books · ${String(list.page.total)}`}
        density="dense"
        emptyTitle={filtered ? 'No book matches' : 'No book yet'}
        emptyHint={
          list.can.manage && !filtered ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/library/books/new">
              + Add a book
            </a>
          ) : undefined
        }
        columns={[
          {
            key: 'title',
            header: 'Title',
            render: (b) => (
              <>
                <a href={`/library/books/${b.id}`}>
                  <strong>{b.title}</strong>
                </a>
                {b.subtitle ? <div className="ep-field__help">{b.subtitle}</div> : null}
                <div className="ep-field__help">{b.author ?? '—'}</div>
              </>
            ),
          },
          {
            key: 'kind',
            header: 'Material · subject',
            render: (b) => [b.material, b.subject].filter(Boolean).join(' · ') || '—',
          },
          {
            key: 'pub',
            header: 'Publisher · year',
            render: (b) => [b.publisher, b.year].filter(Boolean).join(' · ') || '—',
          },
          {
            key: 'ids',
            header: 'Call no. · ISBN',
            render: (b) => [b.callNo, isbnText(b.isbn)].filter(Boolean).join(' · ') || '—',
          },
          { key: 'copies', header: 'Copies', numeric: true, render: (b) => b.copies },
          {
            key: 'shelf',
            header: 'On the shelf',
            numeric: true,
            render: (b) => <Badge tone={b.available ? 'success' : 'neutral'}>{b.available}</Badge>,
          },
          { key: 'out', header: 'Issued', numeric: true, render: (b) => b.issued },
        ]}
        rows={list.data}
        rowKey={(b) => b.id}
      />
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="ep-hero__actions"
          style={{ marginTop: 'var(--sp-3)', alignItems: 'center' }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page - 1)}>
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages} · {list.page.total} books
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page + 1)}>
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
