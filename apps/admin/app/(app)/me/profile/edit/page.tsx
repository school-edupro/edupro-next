import { Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { editable, shown, type MyProfile } from '@/lib/my-profile';
import { sendMyChanges } from '@/lib/my-profile-actions';

/**
 * Update one section of my profile (admin app twin of the staff app page): each field says whether it is
 * saved at once or goes for approval; the documents the school asks for are attached here; a field
 * already waiting cannot be changed again.
 */
export default async function EditMyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('pages.me_profile');
  const p = await apiFetch<MyProfile>('/me/employee-profile').catch(() => null);
  const s = p?.sections.find((x) => x.id === sp.section);
  if (!p || !s || !p.canEdit) notFound();
  const fields = s.fields.filter(editable);
  if (!fields.length) notFound();
  const proofs = [
    ...new Map(fields.filter((f) => f.proof).map((f) => [f.proof!.typeId, f.proof!])).values(),
  ];
  const dateValue = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';

  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/me/profile' },
          { label: t('title'), href: '/me/profile' },
          { label: s.title },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={s.title}
        description="Change what is wrong or out of date. Some changes need the school’s approval."
        actions={
          <a className="ep-btn ep-btn--ghost" href="/me/profile">
            Back
          </a>
        }
      />
      <Notice params={sp} />
      <form action={sendMyChanges} className="ep-card ep-acr-card">
        <input type="hidden" name="section" value={s.id} />
        {fields.map((f) => {
          const id = `f-${f.key}`;
          const waiting = f.pending !== undefined;
          const was =
            f.type === 'date' ? dateValue(f.value) : f.value === null ? '' : String(f.value);
          return (
            <div key={f.key} className="ep-field">
              <label className="ep-field__label" htmlFor={id}>
                {f.label}{' '}
                <span className="ep-field__help">
                  (
                  {waiting
                    ? `waiting for approval: ${shown(f.pending ?? null)}`
                    : f.level === 'edit_direct'
                      ? 'saved at once'
                      : 'needs approval'}
                  {f.proof ? ` · attach ${f.proof.name}` : ''})
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
            <legend className="ep-field__label">Documents for the changes</legend>
            {proofs.map((pr) => (
              <label key={pr.typeId} className="ep-field" htmlFor={`proof-${pr.typeId}`}>
                <span className="ep-field__help">
                  {pr.name} (PDF or photo, up to 5 MB; needed only when you change its field)
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
          <span className="ep-field__label">Why (optional)</span>
          <input id="reason" name="reason" className="ep-input" maxLength={500} />
        </label>
        <Button type="submit">Send</Button>
      </form>
    </>
  );
}
