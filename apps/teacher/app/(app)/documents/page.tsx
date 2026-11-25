import {
  Button,
  Card,
  ClassSectionPicker,
  PageHeader,
  RichEditor,
  type ClassSectionOption,
} from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { postDocument, removeDocument } from '../daily-work/actions';
import { DocumentFeed, type ClassDoc } from './DocumentFeed';

/** The first page: the latest 10; the rest load as the teacher scrolls. */
const PAGE = 10;

type Doc = ClassDoc;
const KINDS: Array<[string, string]> = [
  ['session_plan', 'Session plan'],
  ['curriculum', 'Curriculum / syllabus'],
  ['date_sheet', 'Date sheet'],
  ['other', 'Other'],
];
const nowLocal = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
/**
 * Class documents: the teacher uploads a session plan, the curriculum or a date sheet (with a remark and
 * attachments) for the classes and subjects they hold. Parents and students see each from its publish
 * time; where asked, they acknowledge it and the teacher sees who has.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    kind?: string;
    classSectionId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  if (/^[a-z_]{3,20}$/.test(sp.kind ?? '')) query.set('kind', sp.kind!);
  if (/^\d{1,18}$/.test(sp.classSectionId ?? '')) query.set('classSectionId', sp.classSectionId!);
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) query.set(k, sp[k]!);
  const filters = query.toString();
  let docs: Doc[] = [];
  let total = 0;
  let sections: ClassSectionOption[] = [];
  try {
    [[docs, total], sections] = await Promise.all([
      bff.api
        .fetch<{ data: Doc[]; page: { total: number } }>(
          `/academics/documents?${filters}${filters ? '&' : ''}page=1&size=${String(PAGE)}`,
        )
        .then((r) => [r.data, r.page.total] as const),
      bff.api
        .fetch<{ data: ClassSectionOption[] }>('/academics/daily-work/sheet/options')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const lang = await currentLang();
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="Academics"
        title="Session plan, curriculum, date sheet"
        description="Upload for your classes; parents and students see it in their portal from the publish time."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'removed' ? 'Removed.' : 'Uploaded.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {sections.length ? (
        <Card title="Upload" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={postDocument} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <label className="ep-field">
                <span className="ep-field__label">What *</span>
                <select name="kind" className="ep-select" required>
                  {KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ClassSectionPicker name="classSectionIds" options={sections} />
            <label className="ep-field">
              <span className="ep-field__label">Title *</span>
              <input name="title" className="ep-input" required minLength={2} maxLength={200} />
            </label>
            <RichEditor name="remark" label="Remark" />
            <label className="ep-field">
              <span className="ep-field__label">Attachments * (PDF or image, up to 5 files)</span>
              <input
                name="files"
                type="file"
                className="ep-input"
                multiple
                required
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
            </label>
            <div
              style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end' }}
            >
              <label className="ep-field">
                <span className="ep-field__label">Publish on (date and time)</span>
                <input
                  name="publishAt"
                  type="datetime-local"
                  className="ep-input"
                  defaultValue={nowLocal()}
                />
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="ackRequired" value="1" />
                Ask the parent / student to acknowledge
              </label>
            </div>
            <div>
              <Button type="submit">Upload</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          You have no class assigned in this session yet.
        </Card>
      )}
      <Card title="Uploaded">
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <label className="ep-field">
            <span className="ep-field__label">What</span>
            <select className="ep-select" name="kind" defaultValue={sp.kind ?? ''}>
              <option value="">All kinds</option>
              {[...KINDS, ['magazine', 'School magazine'], ['almanac', 'School almanac']].map(
                ([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class</span>
            <select
              className="ep-select"
              name="classSectionId"
              defaultValue={sp.classSectionId ?? ''}
            >
              <option value="">All my classes</option>
              {sections.map((o) => (
                <option key={o.classSectionId} value={o.classSectionId}>
                  {o.section}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Published from</span>
            <input className="ep-input" type="date" name="from" defaultValue={sp.from ?? ''} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">To</span>
            <input className="ep-input" type="date" name="to" defaultValue={sp.to ?? ''} />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Show
          </button>
          <a
            className="ep-btn ep-btn--secondary"
            href={`/api/documents-report?format=xlsx&${filters}`}
          >
            Excel
          </a>
          <a
            className="ep-btn ep-btn--secondary"
            href={`/api/documents-report?format=pdf&${filters}`}
          >
            PDF
          </a>
        </form>
        {docs.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing uploaded yet.
          </p>
        ) : (
          <DocumentFeed
            key={filters}
            first={docs}
            more={PAGE < total}
            filters={Object.fromEntries(query.entries())}
            remove={removeDocument}
            foot={foot}
          />
        )}
      </Card>
    </main>
  );
}
