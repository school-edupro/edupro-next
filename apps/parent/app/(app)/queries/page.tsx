import { Button, Card, InputField, PageHeader, SelectField, StarInput } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { MoreFeed } from '@/components/MoreFeed';
import { queriesPage } from '@/lib/feed-actions';
import { giveFeedback } from './actions';
import { LABEL, KIND, QueryItems, type Query } from './QueryItems';

interface Viewer {
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
}
const PAGE_SIZE = 10;
const STATUSES = ['active', 'open', 'in_progress', 'answered', 'closed'];
const KINDS = ['query', 'complaint', 'leave'];

/**
 * S10: the family's queries, complaints and leave requests, latest first, with filters (status, type,
 * child, search) and pages, plus quick feedback.
 */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    kind?: string;
    student?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  // the child comes from the switch under the title, the same on every page
  const kid = await chosenChild(sp.student);
  const filters = Object.fromEntries(
    Object.entries({
      status: STATUSES.includes(sp.status ?? '') ? sp.status : undefined,
      kind: KINDS.includes(sp.kind ?? '') ? sp.kind : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const filtered = Object.keys(filters).length > 0;
  // the filters and the child, as the next pages ask for them too
  const query: Record<string, string> = { ...filters, ...(kid ? { studentId: kid.id } : {}) };
  const api = new URLSearchParams({
    ...query,
    order: 'latest',
    size: String(PAGE_SIZE),
    page: '1',
  });
  let queries: Query[];
  let total: number;
  let viewer: Viewer;
  try {
    const [list, v] = await Promise.all([
      bff.api.fetch<{ data: Query[]; page: { total: number } }>(
        `/engagement/mine/queries?${api.toString()}`,
      ),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
    queries = list.data;
    total = list.page.total;
    viewer = v;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Queries')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Queries')}
        title={t(lang, 'Queries, complaints and leave')}
        description={`${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/queries/new">
              {t(lang, 'New request')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      <ChildSwitch lang={lang} back="/queries" current={kid?.id} />
      {sp.ok === 'feedback' ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Thank you for your feedback.')}
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
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
        >
          <SelectField
            id="f-status"
            name="status"
            label={t(lang, 'Status')}
            defaultValue={filters.status ?? ''}
            options={[
              { value: '', label: t(lang, 'All') },
              { value: 'active', label: t(lang, 'Not closed') },
              ...(['open', 'in_progress', 'answered', 'closed'] as const).map((v) => ({
                value: v,
                label: t(lang, LABEL[v]),
              })),
            ]}
          />
          <SelectField
            id="f-kind"
            name="kind"
            label={t(lang, 'Type')}
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: t(lang, 'All') },
              ...(['query', 'complaint', 'leave'] as const).map((v) => ({
                value: v,
                label: t(lang, KIND[v]),
              })),
            ]}
          />
          <InputField
            id="f-q"
            name="q"
            type="search"
            label={t(lang, 'Number or subject')}
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit" variant="secondary">
            {t(lang, 'Show')}
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/queries">
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      </Card>
      {queries.length === 0 ? (
        <Card>
          {filtered
            ? t(lang, 'Nothing matches these filters.')
            : t(
                lang,
                'No queries yet. Use New request to ask the school something, report a problem or apply for leave.',
              )}
        </Card>
      ) : null}
      {queries.length ? (
        <MoreFeed
          key={JSON.stringify(query)}
          first={<QueryItems items={queries} lang={lang} />}
          more={PAGE_SIZE < total}
          load={queriesPage.bind(null, query)}
          labels={{
            more: t(lang, 'Show more'),
            loading: t(lang, 'Loading…'),
            failed: t(lang, 'Could not load more.'),
            end: t(lang, 'That is everything.'),
          }}
        />
      ) : null}
      <Card title={t(lang, 'Quick feedback')} style={{ marginTop: 'var(--sp-4)' }}>
        <form action={giveFeedback} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <input type="hidden" name="studentId" value={viewer.students[0]?.id ?? ''} />
          <label className="ep-field">
            <span className="ep-field__label">{t(lang, 'Area')}</span>
            <select className="ep-input" name="category" defaultValue="teaching">
              {[
                ['teaching', t(lang, 'Teaching')],
                ['transport', t(lang, 'Transport')],
                ['fees', t(lang, 'Fees')],
                ['facilities', t(lang, 'Facilities')],
                ['communication', t(lang, 'Communication')],
                ['app', t(lang, 'Parent app')],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <StarInput
            id="fb-rating"
            name="rating"
            label={t(lang, 'Rating')}
            starLabel={(n) => `${String(n)} / 5`}
          />
          <label className="ep-field">
            <span className="ep-field__label">{t(lang, 'Comment (optional)')}</span>
            <input className="ep-input" name="comment" maxLength={1000} />
          </label>
          <div>
            <Button type="submit" variant="secondary">
              {t(lang, 'Send feedback')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
