import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FilesNav } from '@/components/FilesNav';
import { bff } from '@/lib/bff';
import type { FileNote } from '@/lib/file-movement';
import { currentLang, t } from '@/lib/i18n';
import { FileFeed, type FileWords } from './FileFeed';

/** The first page: the latest 10 files of the box; the rest load as the person scrolls. */
const PAGE = 10;

const BOXES: Array<[string, string]> = [
  ['inbox', 'To approve'],
  ['mine', 'My files'],
  ['acted', 'Decided by me'],
  ['all', 'All'],
];
const STATUSES: Array<[string, string]> = [
  ['pending', 'In approval'],
  ['returned', 'Sent back'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
];

/**
 * File movement on the staff website, as the admin's /workflow/files: the files waiting for me, the ones I raised,
 * the ones I decided, and all I may see; the filters; the list as Excel or PDF.
 */
export default async function StaffFilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const box = BOXES.some(([b]) => b === sp.box) ? sp.box! : 'inbox';
  const filters: Record<string, string> = { box };
  if (STATUSES.some(([s]) => s === sp.status)) filters.status = sp.status!;
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) filters[k] = sp[k]!;
  if (sp.q?.trim()) filters.q = sp.q.trim().slice(0, 80);
  const qs = new URLSearchParams(filters).toString();
  let list: {
    data: FileNote[];
    inbox: number;
    returned: number;
    seesAll: boolean;
    page: { total: number } | null;
  };
  try {
    list = await bff.api.fetch(`/file-movement?${qs}&page=1&size=${String(PAGE)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }
  const words: FileWords = {
    region: t(lang, 'Files'),
    caption: t(lang, 'Files for approval'),
    head: [
      t(lang, 'S.no'),
      t(lang, 'File no.'),
      t(lang, 'Subject'),
      t(lang, 'Raised by'),
      t(lang, 'Raised on'),
      t(lang, 'Levels'),
      t(lang, 'With'),
      t(lang, 'Status'),
    ],
    round: t(lang, 'Round'),
    status: Object.fromEntries(STATUSES.map(([, label]) => [label, t(lang, label)])),
  };
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '72rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker={t(lang, 'Approvals')}
        title={t(lang, 'File movement')}
        description={t(
          lang,
          'Files raised for approval move through the approvers their creator chose, level by level. An approved file can be downloaded as a PDF note sheet.',
        )}
        actions={
          <>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/files/new">
              + {t(lang, 'Add new approval')}
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/file-movement/export?${qs}&format=xlsx`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/file-movement/export?${qs}&format=pdf`}
            >
              PDF
            </a>
          </>
        }
      />
      <FilesNav current="/files" ok={sp.ok} lang={lang} />
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Lists')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {BOXES.map(([value, label]) => (
          <a
            key={value}
            href={`/files?box=${value}`}
            aria-current={box === value ? 'page' : undefined}
          >
            {t(lang, label)}
            {value === 'inbox' ? ` · ${String(list.inbox)}` : ''}
            {value === 'mine' && list.returned
              ? ` · ${String(list.returned)} ${t(lang, 'sent back')}`
              : ''}
            {value === 'all' && !list.seesAll ? ` ${t(lang, 'mine')}` : ''}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="box" value={box} />
          <SelectField
            id="fm-status"
            name="status"
            label={t(lang, 'Status')}
            defaultValue={filters.status ?? ''}
            options={[
              { value: '', label: t(lang, 'Any status') },
              ...STATUSES.map(([value, label]) => ({ value, label: t(lang, label) })),
            ]}
          />
          <InputField
            id="fm-from"
            name="from"
            type="date"
            label={t(lang, 'Raised from')}
            defaultValue={filters.from ?? ''}
          />
          <InputField
            id="fm-to"
            name="to"
            type="date"
            label={t(lang, 'Raised to')}
            defaultValue={filters.to ?? ''}
          />
          <InputField
            id="fm-q"
            name="q"
            type="search"
            label={t(lang, 'Subject, file no. or raised by')}
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">{t(lang, 'Show')}</Button>
          {Object.keys(filters).length > 1 ? (
            <a className="ep-btn ep-btn--secondary" href={`/files?box=${box}`}>
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {box === 'inbox'
              ? t(lang, 'No file waits for your approval.')
              : t(lang, 'Nothing here.')}
          </p>
        ) : (
          <FileFeed
            key={qs}
            first={list.data}
            more={PAGE < (list.page?.total ?? 0)}
            filters={filters}
            words={words}
            foot={foot}
          />
        )}
      </Card>
    </main>
  );
}
