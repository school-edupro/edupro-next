import { Badge } from '@edupro/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMISSION_COOKIE, admissionFetch, dmy } from '@/lib/admission';
import { QUERY_STATUS, type QueryOptions, type QueryRow } from '@/lib/admission-queries';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';
import { askSchool } from '../actions';

/**
 * My queries (docs/design/43, part 4): "Ask the school" about one of the family's registrations, and
 * its questions with how each stands; a new answer is marked until the family opens it.
 */
export default async function AdmissionQueriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ error?: string; reg?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const [list, opts] = await Promise.all([
    admissionFetch<{ unread: number; data: QueryRow[] }>('/me/queries').catch(() => null),
    admissionFetch<QueryOptions>('/me/queries/options').catch(() => null),
  ]);
  if (!list || !opts) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('My queries')}</h1>
      </div>

      <section className="ep-card ep-adm-ask" id="ask" aria-labelledby="ask-h">
        <h2 id="ask-h" className="fp-section-title">
          {w('Ask the school')}
        </h2>
        {opts.registrations.length === 0 ? (
          <p className="ep-field__help">
            {w('Start a registration first; then ask about it here.')}{' '}
            <a href={`${base}/apply`}>{w('Apply for a class')}</a>
          </p>
        ) : (
          <form action={askSchool} className="ep-adm-ask__form">
            <input type="hidden" name="school" value={school} />
            {sp.error ? (
              <div className="ep-alert ep-alert--danger" role="alert">
                {sp.error}
              </div>
            ) : null}
            <label className="ep-field">
              <span className="ep-field__label">{w('About')} *</span>
              <select
                className="ep-select"
                name="applicationId"
                required
                defaultValue={
                  opts.registrations.some((r) => r.id === sp.reg)
                    ? sp.reg
                    : opts.registrations.length === 1
                      ? opts.registrations[0]!.id
                      : ''
                }
              >
                <option value="" disabled>
                  {w('Select one')}
                </option>
                {opts.registrations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {[r.candidate || w('New form'), r.className, r.number]
                      .filter(Boolean)
                      .join(' · ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{w('Question about')} *</span>
              <select className="ep-select" name="categoryCode" required defaultValue="">
                <option value="" disabled>
                  {w('Select one')}
                </option>
                {opts.heads.map((h) => (
                  <option key={h.code} value={h.code}>
                    {w(h.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">{w('Subject')} *</span>
              <input className="ep-input" name="subject" required minLength={3} maxLength={150} />
            </label>
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">{w('Your question')} *</span>
              <textarea
                className="ep-input"
                name="body"
                rows={4}
                required
                minLength={5}
                maxLength={4000}
              />
            </label>
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">
                {w('A file, if it helps (PDF or photo, up to 5MB)')}
              </span>
              <input
                className="ep-input"
                type="file"
                name="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
            </label>
            <p className="ep-field__help ep-adm-ask__wide">
              {w('The admission office answers here and by email, usually within a working day.')}
            </p>
            <div className="ep-form-actions ep-adm-ask__wide">
              <button className="ep-btn ep-btn--primary" type="submit">
                {w('Send the question')}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="ep-card" aria-labelledby="mine-h">
        <h2 id="mine-h" className="fp-section-title">
          {w('Your questions')}
        </h2>
        {list.data.length === 0 ? (
          <p className="ep-field__help">{w('No question yet.')}</p>
        ) : (
          <ul className="fp-list">
            {list.data.map((q) => {
              const st = QUERY_STATUS[q.status];
              return (
                <li key={q.id} className="ep-adm-pay__row">
                  <span>
                    <a href={`${base}/queries/${q.id}`}>
                      <strong>{q.subject}</strong>
                    </a>
                    <span className="fp-list__meta">
                      {' '}
                      · {q.number} · {w(q.head)} ·{' '}
                      {[q.registration.candidate, q.registration.className]
                        .filter(Boolean)
                        .join(', ')}{' '}
                      · {dmy(q.openedAt)}
                    </span>
                  </span>
                  {q.unread ? <Badge tone="info">{w('New answer')}</Badge> : null}
                  <Badge tone={st.tone}>{w(st.label)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
