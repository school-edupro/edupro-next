import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { currentLang, t } from '@/lib/i18n';
import { saveIncident } from '../actions';

const CATEGORIES = [
  ['discipline', 'Discipline'],
  ['health', 'Health'],
  ['safety', 'Safety'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const;

/** Record an incident of a boarder; tick to tell the parent; a serious one goes to the principal. */
export default async function IncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; name?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  if (!/^\d{1,18}$/.test(sp.studentId ?? '')) redirect('/hostel');
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Incident')}
        title={sp.name ?? t(lang, 'Boarder')}
        description={t(
          lang,
          'What happened and what was done. Tick to tell the parent; a serious one also goes to the principal.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/hostel">
            {t(lang, 'Hostel desk')}
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
        <form action={saveIncident} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <input type="hidden" name="studentId" value={sp.studentId} />
          <input type="hidden" name="name" value={sp.name ?? ''} />
          <label className="ep-field" htmlFor="in-c">
            <span className="ep-field__label">{t(lang, 'Kind')}</span>
            <select id="in-c" name="category" className="ep-select" defaultValue="discipline">
              {CATEGORIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(lang, label)}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="in-s">
            <span className="ep-field__label">{t(lang, 'How serious')}</span>
            <select id="in-s" name="severity" className="ep-select" defaultValue="minor">
              <option value="minor">{t(lang, 'Minor')}</option>
              <option value="serious">{t(lang, 'Serious')}</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="in-w">
            <span className="ep-field__label">{t(lang, 'What happened')} *</span>
            <textarea
              id="in-w"
              name="what"
              className="ep-input"
              rows={3}
              required
              minLength={5}
              maxLength={1000}
            />
          </label>
          <label className="ep-field" htmlFor="in-a">
            <span className="ep-field__label">{t(lang, 'Action taken')}</span>
            <textarea id="in-a" name="action" className="ep-input" rows={2} maxLength={1000} />
          </label>
          <label className="ep-field" htmlFor="in-t">
            <span>
              <input id="in-t" name="tellParent" type="checkbox" /> {t(lang, 'Tell the parent')}
            </span>
          </label>
          <div>
            <Button type="submit">{t(lang, 'Record')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
