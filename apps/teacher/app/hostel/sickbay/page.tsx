import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { currentLang, t } from '@/lib/i18n';
import { saveSickbay } from '../actions';

/** A boarder in the sick bay: the note goes into the pupil's clinic record. */
export default async function SickbayPage({
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
        kicker={t(lang, 'Sick bay')}
        title={sp.name ?? t(lang, 'Boarder')}
        description={t(
          lang,
          'The note is saved as a clinic visit of the pupil; the family is told by the clinic’s rule.',
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
        <form action={saveSickbay} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <input type="hidden" name="studentId" value={sp.studentId} />
          <input type="hidden" name="name" value={sp.name ?? ''} />
          <label className="ep-field" htmlFor="sb-c">
            <span className="ep-field__label">{t(lang, 'Complaint')} *</span>
            <input
              id="sb-c"
              name="complaint"
              className="ep-input"
              required
              minLength={2}
              maxLength={300}
            />
          </label>
          <label className="ep-field" htmlFor="sb-t">
            <span className="ep-field__label">{t(lang, 'Temperature (°C)')}</span>
            <input
              id="sb-t"
              name="temperatureC"
              type="number"
              step="0.1"
              min={30}
              max={45}
              className="ep-input"
            />
          </label>
          <label className="ep-field" htmlFor="sb-tr">
            <span className="ep-field__label">{t(lang, 'Treatment given')}</span>
            <input id="sb-tr" name="treatment" className="ep-input" maxLength={500} />
          </label>
          <label className="ep-field" htmlFor="sb-o">
            <span className="ep-field__label">{t(lang, 'Outcome')}</span>
            <select id="sb-o" name="outcome" className="ep-select" defaultValue="rest">
              <option value="rest">{t(lang, 'Resting in the sick bay')}</option>
              <option value="back_to_class">{t(lang, 'Back to class')}</option>
              <option value="sent_home">{t(lang, 'Sent home')}</option>
              <option value="referred">{t(lang, 'Referred to a doctor or hospital')}</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="sb-r">
            <span className="ep-field__label">{t(lang, 'Referred to')}</span>
            <input id="sb-r" name="referredTo" className="ep-input" maxLength={160} />
          </label>
          <label className="ep-field" htmlFor="sb-rm">
            <span className="ep-field__label">{t(lang, 'Note')}</span>
            <input id="sb-rm" name="remark" className="ep-input" maxLength={300} />
          </label>
          <div>
            <Button type="submit">{t(lang, 'Save')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
