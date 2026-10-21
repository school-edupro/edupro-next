import { PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { LibraryRegister } from '@/components/library/LibraryRegister';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  DEFAULT_VIEW,
  PREF,
  sanitizeRegisterView,
  type RegisterFields,
  type RegisterLevel,
  type RegisterResult,
  type RegisterView,
} from '@/lib/library-register';

/**
 * The book master (docs/design/36-library.md): the titles, or the copies (the accession register), as
 * the Employees list: quick and more filters on any field, the columns each user keeps (saved for them),
 * the counts, sortable headers, pages, and the view as Excel or PDF; Customise export for the fields
 * picked and the school's layouts.
 */
export default async function LibraryBooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const level: RegisterLevel = sp.view === 'copies' ? 'copies' : 'titles';
  const other: RegisterLevel = level === 'copies' ? 'titles' : 'copies';
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  const [t, fields, saved] = await Promise.all([
    getTranslations('pages.library'),
    apiFetch<RegisterFields>(`/library/register/${level}/fields`),
    // the view this user saved for this list; other users keep their own
    apiFetch<{ value: unknown }>(`/me/preferences/${PREF[level]}`).catch(() => ({ value: null })),
  ]);
  let view: RegisterView = sanitizeRegisterView(
    level,
    saved.value,
    new Set(fields.fields.map((f) => f.key)),
  );
  const load = (v: RegisterView) =>
    apiFetch<RegisterResult>(`/library/register/${level}`, {
      method: 'POST',
      body: JSON.stringify({ ...v, search: v.search || undefined, page: 1 }),
    });
  // a saved view the list can no longer run (a field's values changed) opens as the default
  const initial = await load(view).catch(async () => {
    view = DEFAULT_VIEW[level];
    return load(view);
  });
  const otherTotal = await apiFetch<RegisterResult>(`/library/register/${other}`, {
    method: 'POST',
    body: JSON.stringify({ size: 25, page: 1 }),
  })
    .then((r) => r.stats.total ?? 0)
    .catch(() => null);
  const titles = level === 'titles' ? (initial.stats.total ?? 0) : otherTotal;
  const copies = level === 'copies' ? (initial.stats.total ?? 0) : otherTotal;
  const manage = can('library.catalogue.manage');
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {manage ? (
              <a className="ep-btn ep-btn--primary" href="/library/books/new">
                + Add a book
              </a>
            ) : null}
            {manage ? (
              <a className="ep-btn ep-btn--ghost" href="/library/import">
                Import
              </a>
            ) : null}
            {manage ? (
              <a className="ep-btn ep-btn--ghost" href="/library/labels">
                Labels
              </a>
            ) : null}
            <a className="ep-btn ep-btn--ghost" href="/masters/library">
              Library setup
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <nav
        className="ep-tabs"
        aria-label="Titles or copies"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          <a
            className="ep-tabs__tab"
            href="/library"
            aria-current={level === 'titles' ? 'page' : undefined}
          >
            Titles{' '}
            {titles !== null ? <span className="ep-badge ep-badge--neutral">{titles}</span> : null}
          </a>
          <a
            className="ep-tabs__tab"
            href="/library?view=copies"
            aria-current={level === 'copies' ? 'page' : undefined}
          >
            Copies (accession register){' '}
            {copies !== null ? <span className="ep-badge ep-badge--neutral">{copies}</span> : null}
          </a>
        </div>
      </nav>
      <LibraryRegister
        key={level}
        level={level}
        fields={fields}
        initial={initial}
        initialView={view}
        can={{
          manage,
          circulate: can('library.loan.circulate'),
        }}
      />
    </>
  );
}
