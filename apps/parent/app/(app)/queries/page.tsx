import {
  Badge,
  Button,
  Card,
  InputField,
  PageHeader,
  SelectField,
  StarInput,
  Stars,
} from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { giveFeedback } from './actions';

interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  subject: string;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  decision: string | null;
  rating: number | null;
  openedAt: string;
}
interface Viewer {
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
}
const TONE: Record<Query['status'], 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};
const LABEL: Record<Query['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
const KIND: Record<Query['kind'], string> = {
  query: 'Query',
  complaint: 'Complaint',
  leave: 'Leave request',
};

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
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const filters = Object.fromEntries(
    Object.entries({
      status: STATUSES.includes(sp.status ?? '') ? sp.status : undefined,
      kind: KINDS.includes(sp.kind ?? '') ? sp.kind : undefined,
      studentId: /^\d{1,18}$/.test(sp.student ?? '') ? sp.student : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const filtered = Object.keys(filters).length > 0;
  const page = Math.max(1, Number(sp.page) || 1);
  const api = new URLSearchParams({
    ...filters,
    order: 'latest',
    size: String(PAGE_SIZE),
    page: String(page),
  });
  /** A link to another page that keeps the filters. */
  const href = (n: number) => {
    const u = new URLSearchParams({
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.studentId ? { student: filters.studentId } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      page: String(n),
    });
    return `/queries?${u.toString()}`;
  };
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
          {viewer.students.length > 1 ? (
            <SelectField
              id="f-student"
              name="student"
              label={t(lang, 'Child')}
              defaultValue={filters.studentId ?? ''}
              options={[
                { value: '', label: t(lang, 'All') },
                ...viewer.students.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          ) : null}
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
      {queries.map((q) => (
        <a key={q.id} href={`/queries/${q.id}`} style={{ textDecoration: 'none' }}>
          <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    color: 'var(--text-heading)',
                  }}
                >
                  {q.subject}
                </div>
                <div className="ep-kicker">
                  {q.number} · {t(lang, KIND[q.kind])} · {q.categoryName} · {q.studentName} ·{' '}
                  {new Date(q.openedAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <Badge tone={TONE[q.status]}>{t(lang, LABEL[q.status])}</Badge>
                {q.decision ? (
                  <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>
                    {t(lang, q.decision)}
                  </Badge>
                ) : null}
                {q.rating ? <Stars value={q.rating} /> : null}
              </span>
            </div>
          </Card>
        </a>
      ))}
      {total > PAGE_SIZE ? (
        <nav
          aria-label={t(lang, 'Pages')}
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href(page - 1)}>
              ← {t(lang, 'Previous')}
            </a>
          ) : null}
          <span className="ep-field__help">
            {t(lang, 'Page')} {page} / {Math.ceil(total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < total ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href(page + 1)}>
              {t(lang, 'Next')} →
            </a>
          ) : null}
        </nav>
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
