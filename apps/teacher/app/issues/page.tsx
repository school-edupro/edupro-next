import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { reportIssue } from './actions';

interface Issue {
  id: string;
  number: string;
  title: string;
  module: string;
  severity: string;
  status: string;
  dueAt: string;
  resolution: string | null;
  workaround: string | null;
  createdAt: string;
}

/** Sprint 22: report an issue during hypercare and follow the ones you raised. */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let issues: Issue[] = [];
  try {
    issues = (await bff.api.fetch<{ data: Issue[] }>('/ops/hypercare/issues/mine?size=50')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Report an issue')}
        description={t(
          lang,
          'Something broken, slow or wrong: the support desk sees it at once with a due time by severity.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Thank you. The issue is logged and the desk will respond.')}
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
      <Card title={t(lang, 'New issue')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form action={reportIssue} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <InputField
            id="title"
            name="title"
            label={t(lang, 'What happened?')}
            required
            minLength={3}
            maxLength={200}
          />
          <InputField
            id="detail"
            name="detail"
            label={t(lang, 'Details (screen, pupil, time)')}
            maxLength={5000}
          />
          <SelectField
            id="module"
            name="module"
            label={t(lang, 'Where')}
            options={['attendance', 'academics', 'exams', 'engagement', 'apps', 'other'].map(
              (m) => ({ value: m, label: t(lang, m) }),
            )}
          />
          <SelectField
            id="severity"
            name="severity"
            label={t(lang, 'How urgent?')}
            defaultValue="s3"
            options={[
              { value: 's1', label: t(lang, 'S1: the school cannot work') },
              { value: 's2', label: t(lang, 'S2: a task is blocked') },
              { value: 's3', label: t(lang, 'S3: a workaround exists') },
              { value: 's4', label: t(lang, 'S4: cosmetic or a suggestion') },
            ]}
          />
          <div>
            <Button type="submit">{t(lang, 'Send')}</Button>
          </div>
        </form>
      </Card>
      <Card title={t(lang, 'Your issues')}>
        {issues.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No issues reported yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {issues.map((i) => (
              <li
                key={i.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {i.number} · {i.title}
                  </strong>
                  <Badge
                    tone={
                      i.status === 'closed' || i.status === 'verified'
                        ? 'success'
                        : i.status === 'open'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {i.status}
                  </Badge>
                </div>
                <div className="ep-kicker">
                  {i.module} · {i.severity.toUpperCase()} · {t(lang, 'Due')}{' '}
                  {i.dueAt.slice(0, 16).replace('T', ' ')}
                </div>
                {i.workaround ? (
                  <div className="ep-kicker">
                    {t(lang, 'Workaround')}: {i.workaround}
                  </div>
                ) : null}
                {i.resolution ? (
                  <div className="ep-kicker">
                    {t(lang, 'Resolution')}: {i.resolution}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
