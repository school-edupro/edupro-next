import { Badge, Button, Card, PageHeader } from '@edupro/ui';
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

/** S10: the family's queries, complaints and leave requests, plus quick feedback. */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let queries: Query[];
  let viewer: Viewer;
  try {
    [queries, viewer] = await Promise.all([
      bff.api.fetch<{ data: Query[] }>('/engagement/mine/queries?size=50').then((r) => r.data),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
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
        description={`${queries.filter((q) => q.status !== 'closed').length} ${t(lang, 'open')} · ${queries.length} ${t(lang, 'in all')}`}
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
      {queries.length === 0 ? (
        <Card>
          {t(
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
                {q.rating ? <Badge tone="info">{'★'.repeat(q.rating)}</Badge> : null}
              </span>
            </div>
          </Card>
        </a>
      ))}
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
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">{t(lang, 'Rating')}</legend>
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <input type="radio" name="rating" value={n} defaultChecked={n === 5} /> {n}
                </label>
              ))}
            </div>
          </fieldset>
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
