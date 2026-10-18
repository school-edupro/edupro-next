import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { raise } from '../helpdesk-actions';

/** Raise a staff query (salary, HR, IT…) or a ticket to the ERP provider, with attachments. */
export default async function RaisePage({
  searchParams,
}: {
  searchParams: Promise<{ desk?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const desk = sp.desk === 'provider' ? 'provider' : 'staff';
  let heads: Array<{ code: string; name: string }>;
  try {
    heads = (
      await bff.api.fetch<{ data: Array<{ code: string; name: string }> }>(
        `/helpdesk/heads/${desk}`,
      )
    ).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Queries and helpdesk')}
        title={
          desk === 'provider'
            ? t(lang, 'Ticket to the ERP provider')
            : t(lang, 'Raise a staff query')
        }
        description={
          desk === 'provider'
            ? t(lang, 'Something not working in EduPro? The provider replies here.')
            : t(lang, 'It goes to the person who handles this type of query.')
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/queries?tab=mine">
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
        <form action={raise} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <input type="hidden" name="desk" value={desk} />
          <label className="ep-field" htmlFor="categoryCode">
            <span className="ep-field__label">{t(lang, 'Query type')}</span>
            <select
              id="categoryCode"
              className="ep-select"
              name="categoryCode"
              required
              defaultValue=""
            >
              <option value="">{t(lang, 'Choose…')}</option>
              {heads.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {desk === 'provider' ? (
            <label className="ep-field" htmlFor="priority">
              <span className="ep-field__label">{t(lang, 'How urgent')}</span>
              <select id="priority" className="ep-select" name="priority" defaultValue="normal">
                <option value="urgent">{t(lang, 'Urgent: work has stopped')}</option>
                <option value="high">{t(lang, 'High')}</option>
                <option value="normal">{t(lang, 'Normal')}</option>
                <option value="low">{t(lang, 'Low')}</option>
              </select>
            </label>
          ) : null}
          <label className="ep-field" htmlFor="subject">
            <span className="ep-field__label">{t(lang, 'Subject')}</span>
            <input
              id="subject"
              className="ep-input"
              name="subject"
              required
              minLength={3}
              maxLength={200}
            />
          </label>
          <label className="ep-field" htmlFor="body">
            <span className="ep-field__label">{t(lang, 'Details')}</span>
            <textarea
              id="body"
              className="ep-input"
              name="body"
              rows={5}
              required
              minLength={3}
              maxLength={5000}
            />
          </label>
          <label className="ep-field" htmlFor="files">
            <span className="ep-field__label">{t(lang, 'Attachments (optional)')}</span>
            <input
              id="files"
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
            <Button type="submit">{t(lang, 'Send')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
