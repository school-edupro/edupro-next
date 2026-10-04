import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { raiseQuery } from '../actions';

interface Viewer {
  students: Array<{ id: string; name: string; section: string | null }>;
}

export default async function NewQueryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let viewer: Viewer;
  let categories: Array<{ code: string; name: string }>;
  try {
    [viewer, categories] = await Promise.all([
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
      bff.api
        .fetch<{ data: Array<{ code: string; name: string }> }>('/engagement/mine/categories')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const kind = sp.kind === 'leave' || sp.kind === 'complaint' ? sp.kind : 'query';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Queries')}
        title={t(lang, 'New request')}
        description={t(lang, 'A query, a complaint or a leave application for your child.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/queries">
            {t(lang, 'Back')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          {(['query', 'complaint', 'leave'] as const).map((k) => (
            <a
              key={k}
              className={`ep-btn ep-btn--sm ${kind === k ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
              href={`/queries/new?kind=${k}`}
            >
              {k === 'query'
                ? t(lang, 'Query')
                : k === 'complaint'
                  ? t(lang, 'Complaint')
                  : t(lang, 'Leave request')}
            </a>
          ))}
        </div>
        <form action={raiseQuery} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <input type="hidden" name="kind" value={kind} />
          <label className="ep-field">
            <span className="ep-field__label">{t(lang, 'Child')}</span>
            <select
              className="ep-input"
              name="studentId"
              required
              defaultValue={(await chosenChild())?.id}
            >
              {viewer.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.section ? ` · ${s.section}` : ''}
                </option>
              ))}
            </select>
          </label>
          {kind !== 'leave' ? (
            <label className="ep-field">
              <span className="ep-field__label">{t(lang, 'About')}</span>
              <select className="ep-input" name="categoryCode" defaultValue="other">
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="categoryCode" value="attendance" />
          )}
          <label className="ep-field">
            <span className="ep-field__label">{t(lang, 'Subject')}</span>
            <input className="ep-input" name="subject" required minLength={3} maxLength={160} />
          </label>
          {kind === 'leave' ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: '1fr 1fr' }}>
              <label className="ep-field">
                <span className="ep-field__label">{t(lang, 'From')}</span>
                <input className="ep-input" type="date" name="leaveFrom" required />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{t(lang, 'To')}</span>
                <input className="ep-input" type="date" name="leaveTo" required />
              </label>
            </div>
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">
              {kind === 'leave' ? t(lang, 'Reason') : t(lang, 'Details')}
            </span>
            <textarea className="ep-input" name="body" rows={5} required maxLength={4000} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">{t(lang, 'Attachments (optional)')}</span>
            <input
              className="ep-input"
              type="file"
              name="files"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
            />
            <span className="ep-field__help">
              {t(lang, 'PDF or photos, up to 5 files of 5 MB each.')}
            </span>
          </label>
          <div>
            <Button type="submit">
              {kind === 'leave' ? t(lang, 'Apply for leave') : t(lang, 'Send')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
