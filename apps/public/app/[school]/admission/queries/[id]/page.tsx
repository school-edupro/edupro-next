import { Badge } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ViewDownload } from '@/components/ViewDownload';
import { ADMISSION_COOKIE, admissionFetch, dmy } from '@/lib/admission';
import { QUERY_STATUS, type QueryDetail } from '@/lib/admission-queries';
import { PublicApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';
import { queryAction } from '../../actions';

/**
 * One question to the school (docs/design/43, part 4): what the family asked, the conversation, and
 * what it may do now — write back, reopen within the days the school allows, rate the answer.
 */
export default async function AdmissionQueryPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; id: string }>;
  searchParams: Promise<{ error?: string; done?: string; sent?: string }>;
}) {
  const { school, id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const q = await admissionFetch<QueryDetail>(`/me/queries/${id}`).catch((e: unknown) => {
    if (e instanceof PublicApiError && e.status === 404) notFound();
    redirect(`/${school}/admission#sign-in`);
  });
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const st = QUERY_STATUS[q.status];
  const regId = q.registration.id ?? '';
  const files = (ids: string[], whose: string) =>
    ids.length ? (
      <span className="fp-msg__files">
        {ids.map((f, i) => (
          <span key={f} className="ep-adm-home__pdf">
            <span className="ep-kicker">
              {w('File')} {i + 1}
            </span>
            <ViewDownload
              href={`/api/admission/query-file/${q.id}/${f}`}
              what={`${w('file')} ${String(i + 1)}: ${whose}`}
            />
          </span>
        ))}
      </span>
    ) : null;
  const done: Record<string, string> = {
    reply: w('Sent to the school.'),
    reopen: w('Reopened: the school will look at it again.'),
    rate: w('Thank you for rating the answer.'),
  };
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{q.subject}</h1>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/admission/queries`}>
          {w('My queries')}
        </a>
      </div>
      {sp.error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {sp.error}
        </div>
      ) : sp.sent || (sp.done && done[sp.done]) ? (
        <div className="ep-alert ep-alert--success" role="status">
          {sp.sent ? `${w('Your question is with the school')}: ${q.number}.` : done[sp.done!]}
        </div>
      ) : null}

      <section className="ep-card" aria-labelledby="q-h">
        <h2 id="q-h" className="fp-section-title">
          {q.number} <Badge tone={st.tone}>{w(st.label)}</Badge>
        </h2>
        <p className="fp-list__meta" style={{ marginTop: 0 }}>
          {w(q.head)} ·{' '}
          {[q.registration.candidate, q.registration.className, q.registration.number]
            .filter(Boolean)
            .join(' · ')}{' '}
          · {dmy(q.openedAt)}
        </p>
        <ol className="ep-adm-thread">
          <li className="ep-adm-thread__msg" data-from="family">
            <p className="ep-kicker">
              {w('You')} · {dmy(q.openedAt)}
            </p>
            <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{q.body}</p>
            {files(q.fileIds, w('your question'))}
          </li>
          {q.replies.map((r) => (
            <li
              key={r.id}
              className="ep-adm-thread__msg"
              data-from={r.fromFamily ? 'family' : 'school'}
            >
              <p className="ep-kicker">
                {r.fromFamily ? w('You') : (r.author ?? w('The school'))} · {dmy(r.at)}
              </p>
              <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{r.body}</p>
              {files(r.fileIds, r.fromFamily ? w('your reply') : w('the answer'))}
            </li>
          ))}
        </ol>
      </section>

      {q.you.canReply ? (
        <section className="ep-card" aria-labelledby="q-reply">
          <h2 id="q-reply" className="fp-section-title">
            {w('Write to the school')}
          </h2>
          <form action={queryAction} className="ep-adm-ask__form">
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="what" value="reply" />
            <input type="hidden" name="applicationId" value={regId} />
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">{w('Message')} *</span>
              <textarea
                className="ep-input"
                name="body"
                rows={3}
                required
                minLength={2}
                maxLength={4000}
              />
            </label>
            {regId ? (
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
            ) : null}
            <div className="ep-form-actions ep-adm-ask__wide">
              <button className="ep-btn ep-btn--primary" type="submit">
                {w('Send')}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {q.you.canReopen ? (
        <section className="ep-card" aria-labelledby="q-reopen">
          <h2 id="q-reopen" className="fp-section-title">
            {w('Not answered fully?')}
          </h2>
          <form action={queryAction} className="ep-adm-ask__form">
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="what" value="reopen" />
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">{w('What is still open')} *</span>
              <textarea
                className="ep-input"
                name="reason"
                rows={2}
                required
                minLength={5}
                maxLength={1000}
              />
              {q.you.reopenUntil ? (
                <span className="ep-field__help">
                  {w('You can reopen it until')} {dmy(q.you.reopenUntil)}.
                </span>
              ) : null}
            </label>
            <div className="ep-form-actions ep-adm-ask__wide">
              <button className="ep-btn ep-btn--secondary" type="submit">
                {w('Reopen')}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {q.you.canRate ? (
        <section className="ep-card" aria-labelledby="q-rate">
          <h2 id="q-rate" className="fp-section-title">
            {w('How was the answer?')}
          </h2>
          <form action={queryAction} className="ep-adm-ask__form">
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="what" value="rate" />
            <fieldset className="ep-adm-rate ep-adm-ask__wide">
              <legend className="ep-field__label">{w('Your rating')} *</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="ep-check">
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    required
                    defaultChecked={q.rating === n}
                  />{' '}
                  {n}
                </label>
              ))}
            </fieldset>
            <label className="ep-field ep-adm-ask__wide">
              <span className="ep-field__label">{w('A comment (optional)')}</span>
              <input
                className="ep-input"
                name="comment"
                maxLength={500}
                defaultValue={q.ratingComment ?? ''}
              />
            </label>
            <div className="ep-form-actions ep-adm-ask__wide">
              <button className="ep-btn ep-btn--secondary" type="submit">
                {q.rating ? w('Change the rating') : w('Rate')}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
