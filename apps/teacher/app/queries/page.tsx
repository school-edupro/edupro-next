import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  section: string | null;
  raisedBy: string | null;
  subject: string;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  openedAt: string;
}
const LABEL: Record<Query['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
const TONE: Record<Query['status'], 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};

/** S10: queries from the families of the teacher's sections. */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let queries: Query[];
  try {
    queries = await bff.api
      .fetch<{ data: Query[] }>(
        `/engagement/queries?size=100${sp.status ? `&status=${sp.status}` : ''}`,
      )
      .then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Queries')} />
          <Card>{t(lang, 'You have no sections assigned, so no family queries reach you.')}</Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Queries')}
        title={t(lang, 'Family queries')}
        description={`${queries.filter((q) => q.status === 'open' || q.status === 'in_progress').length} ${t(lang, 'waiting for a reply')}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            {(['', 'open', 'answered', 'closed'] as const).map((s) => (
              <a
                key={s}
                className={`ep-btn ep-btn--sm ${(sp.status ?? '') === s ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
                href={s ? `/queries?status=${s}` : '/queries'}
              >
                {s ? t(lang, LABEL[s]) : t(lang, 'All')}
              </a>
            ))}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      {queries.length === 0 ? <Card>{t(lang, 'No queries.')}</Card> : null}
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
                  {q.number} · {t(lang, q.kind)} · {q.categoryName} · {q.studentName}
                  {q.section ? ` (${q.section})` : ''} · {q.raisedBy ?? ''} ·{' '}
                  {new Date(q.openedAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <Badge tone={TONE[q.status]}>{t(lang, LABEL[q.status])}</Badge>
            </div>
          </Card>
        </a>
      ))}
    </main>
  );
}
