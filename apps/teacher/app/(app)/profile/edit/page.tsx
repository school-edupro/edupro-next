import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { editable, shown, type MyProfile } from '@/lib/my-profile';
import { sendChanges } from '../actions';

/**
 * Update one section of my profile: each field says whether it is saved at once or goes for approval; the
 * documents the school asks for are attached here; a field already waiting cannot be changed again.
 */
export default async function EditMyProfile({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const p = await bff.api.fetch<MyProfile>('/me/employee-profile');
  const s = p.sections.find((x) => x.id === sp.section);
  if (!s || !p.canEdit) notFound();
  const fields = s.fields.filter(editable);
  if (!fields.length) notFound();
  const proofs = [
    ...new Map(fields.filter((f) => f.proof).map((f) => [f.proof!.typeId, f.proof!])).values(),
  ];
  const dateValue = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';

  return (
    <main>
      <PageHeader
        kicker={t(lang, 'My profile')}
        title={t(lang, s.title)}
        description={t(
          lang,
          'Change what is wrong or out of date. Some changes need the school’s approval.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost" href="/profile">
            {t(lang, 'Back')}
          </a>
        }
      />
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not go through.')}
        </div>
      ) : null}
      <form action={sendChanges} className="ep-card ep-acr-card">
        <input type="hidden" name="section" value={s.id} />
        {fields.map((f) => {
          const id = `f-${f.key}`;
          const waiting = f.pending !== undefined;
          const was =
            f.type === 'date' ? dateValue(f.value) : f.value === null ? '' : String(f.value);
          return (
            <div key={f.key} className="ep-field">
              <label className="ep-field__label" htmlFor={id}>
                {t(lang, f.label)}{' '}
                <span className="ep-field__help">
                  (
                  {waiting
                    ? `${t(lang, 'waiting for approval')}: ${shown(f.pending ?? null)}`
                    : f.level === 'edit_direct'
                      ? t(lang, 'saved at once')
                      : t(lang, 'needs approval')}
                  {f.proof ? ` · ${t(lang, 'attach')} ${f.proof.name}` : ''})
                </span>
              </label>
              <input type="hidden" name={`o.${f.key}`} value={was} />
              {f.options ? (
                <select
                  id={id}
                  name={`v.${f.key}`}
                  className="ep-select"
                  defaultValue={was}
                  disabled={waiting}
                >
                  <option value="">—</option>
                  {was && !f.options.includes(was) ? <option value={was}>{was}</option> : null}
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  name={`v.${f.key}`}
                  className="ep-input"
                  type={
                    f.type === 'date'
                      ? 'date'
                      : f.type === 'email'
                        ? 'email'
                        : f.type === 'mobile'
                          ? 'tel'
                          : 'text'
                  }
                  defaultValue={was}
                  maxLength={300}
                  disabled={waiting}
                  style={f.upper ? { textTransform: 'uppercase' } : undefined}
                />
              )}
              {f.help ? <span className="ep-field__help">{f.help}</span> : null}
            </div>
          );
        })}
        {proofs.length ? (
          <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
            <legend className="ep-field__label">{t(lang, 'Documents for the changes')}</legend>
            {proofs.map((pr) => (
              <label key={pr.typeId} className="ep-field" htmlFor={`proof-${pr.typeId}`}>
                <span className="ep-field__help">
                  {pr.name} (
                  {t(lang, 'PDF or photo, up to 5 MB; needed only when you change its field')})
                </span>
                <input
                  id={`proof-${pr.typeId}`}
                  name={`proof.${pr.typeId}`}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="ep-field" htmlFor="reason">
          <span className="ep-field__label">{t(lang, 'Why (optional)')}</span>
          <input id="reason" name="reason" className="ep-input" maxLength={500} />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary">
          {t(lang, 'Send')}
        </button>
      </form>
    </main>
  );
}
