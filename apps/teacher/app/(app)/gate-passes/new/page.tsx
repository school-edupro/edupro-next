import { Button, Card, PageHeader } from '@edupro/ui';
import { currentLang, t } from '@/lib/i18n';
import { applyGatePass } from '../actions';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** My own gate pass (0069): RGP (I come back today) or NRGP (I do not), with what I carry out. */
export default async function NewGatePassPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Gate passes')}
        title={t(lang, 'Apply for a gate pass')}
        description={t(
          lang,
          'RGP: you go out on work and come back today. NRGP: you do not come back today.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/gate-passes">
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
        <form action={applyGatePass} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="tg-cat">
            <span className="ep-field__label">{t(lang, 'Type of pass')} *</span>
            <select id="tg-cat" name="category" className="ep-select" defaultValue="rgp">
              <option value="rgp">{t(lang, 'RGP · I come back today')}</option>
              <option value="nrgp">{t(lang, 'NRGP · I do not come back today')}</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="tg-date">
            <span className="ep-field__label">{t(lang, 'Date')} *</span>
            <input
              id="tg-date"
              name="onDate"
              type="date"
              className="ep-input"
              required
              min={today()}
              defaultValue={today()}
            />
          </label>
          <label className="ep-field" htmlFor="tg-out">
            <span className="ep-field__label">{t(lang, 'Going out at')} *</span>
            <input id="tg-out" name="atTime" type="time" className="ep-input" required />
          </label>
          <label className="ep-field" htmlFor="tg-back">
            <span className="ep-field__label">{t(lang, 'Back by (for RGP)')}</span>
            <input id="tg-back" name="returnTime" type="time" className="ep-input" />
          </label>
          <label className="ep-field" htmlFor="tg-reason">
            <span className="ep-field__label">{t(lang, 'Purpose')} *</span>
            <input
              id="tg-reason"
              name="reason"
              className="ep-input"
              required
              minLength={3}
              maxLength={300}
            />
          </label>
          <label className="ep-field" htmlFor="tg-dest">
            <span className="ep-field__label">{t(lang, 'Going to (optional)')}</span>
            <input id="tg-dest" name="destination" className="ep-input" maxLength={160} />
          </label>
          <fieldset className="ep-slots">
            <legend className="ep-field__label">
              {t(lang, 'Equipment or material taken out (leave blank if none)')}
            </legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                style={{
                  display: 'grid',
                  gap: 'var(--sp-2)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))',
                  alignItems: 'end',
                  marginBottom: 'var(--sp-2)',
                }}
              >
                <label className="ep-field" htmlFor={`ti-${String(n)}`}>
                  <span className="ep-field__label">
                    {t(lang, 'Item')} {n}
                  </span>
                  <input
                    id={`ti-${String(n)}`}
                    name={`item${String(n)}`}
                    className="ep-input"
                    maxLength={120}
                  />
                </label>
                <label className="ep-field" htmlFor={`tq-${String(n)}`}>
                  <span className="ep-field__label">{t(lang, 'Quantity')}</span>
                  <input
                    id={`tq-${String(n)}`}
                    name={`qty${String(n)}`}
                    type="number"
                    className="ep-input"
                    min={1}
                    max={9999}
                    defaultValue={1}
                  />
                </label>
                <label className="ep-field" htmlFor={`ts-${String(n)}`}>
                  <span className="ep-field__label">{t(lang, 'Serial / asset no.')}</span>
                  <input
                    id={`ts-${String(n)}`}
                    name={`serial${String(n)}`}
                    className="ep-input"
                    maxLength={60}
                  />
                </label>
                <label className="ep-check" htmlFor={`tb-${String(n)}`}>
                  <input
                    id={`tb-${String(n)}`}
                    name={`back${String(n)}`}
                    type="checkbox"
                    defaultChecked
                  />{' '}
                  {t(lang, 'To be brought back')}
                </label>
              </div>
            ))}
          </fieldset>
          <div>
            <Button type="submit">{t(lang, 'Send for approval')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
