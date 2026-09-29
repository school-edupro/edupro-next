import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Plan {
  id: string;
  section: string;
  subject: string;
  weekStart: string;
  title: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'returned';
  decisionNote: string | null;
}
const LABEL: Record<Plan['status'], string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned for changes',
};
const TONE: Record<Plan['status'], 'neutral' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  returned: 'danger',
};

/** S11: the teacher's weekly lesson plans and their approval state. */
export default async function LessonPlansPage() {
  const lang = await currentLang();
  let plans: Plan[];
  try {
    plans = await bff.api
      .fetch<{ data: Plan[] }>('/academics/lesson-plans/mine')
      .then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Lesson plans')} />
          <Card>
            {t(lang, 'Lesson plans are written by teaching staff with an employee record.')}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Lesson plans')}
        title={t(lang, 'My weekly plans')}
        description={t(
          lang,
          'Plans go to the coordinator, the vice principal and the principal for approval.',
        )}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/lesson-plans/new">
              {t(lang, 'New plan')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      {plans.length === 0 ? <Card>{t(lang, 'No plans yet. Start with next week.')}</Card> : null}
      {plans.map((p) => (
        <a key={p.id} href={`/lesson-plans/${p.id}`} style={{ textDecoration: 'none' }}>
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
                  {p.title}
                </div>
                <div className="ep-kicker">
                  {t(lang, 'Week of')} {p.weekStart} · {p.section} · {p.subject}
                  {p.decisionNote ? ` · ${p.decisionNote}` : ''}
                </div>
              </div>
              <Badge tone={TONE[p.status]}>{t(lang, LABEL[p.status])}</Badge>
            </div>
          </Card>
        </a>
      ))}
    </main>
  );
}
