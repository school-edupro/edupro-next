import { Badge } from '@edupro/ui';
import { AdmissionSignIn } from '@/components/AdmissionSignIn';
import { dmy, rupees, type PortalSession } from '@/lib/admission';
import { t, type Lang } from '@/lib/i18n';

/**
 * The admission portal signed out (docs/design/42, part 1): a centred sign-in card like the parent
 * portal's login, then the open sessions with each class's dates, date of birth window, fee and merit
 * points, the school's instructions and the way to send an enquiry.
 */
export function AdmissionLanding({
  school,
  schoolName,
  sessions,
  lang,
  error,
  returnTo,
}: {
  school: string;
  schoolName: string;
  sessions: PortalSession[];
  lang: Lang;
  error?: string;
  /** where sign-in comes back to (an enquiry's invitation travels with it) */
  returnTo: string;
}) {
  const w = (en: string) => t(lang, en);
  const back = encodeURIComponent(`/${school}/admission`);
  const dob = (from: string | null, to: string | null) =>
    from || to
      ? `${from ? `${w('from')} ${dmy(from)}` : ''}${from && to ? ' ' : ''}${to ? `${w('to')} ${dmy(to)}` : ''}`
      : '-';
  return (
    <div className="ep-adm-land">
      <section
        className="ep-card ep-card--elevated ep-adm-signin"
        id="sign-in"
        aria-labelledby="adm-signin-title"
      >
        <div className="ep-adm-signin__top">
          <span className="ep-kicker">{schoolName}</span>
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=${back}`}
            lang={lang === 'hi' ? 'en' : 'hi'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
        </div>
        <h1 id="adm-signin-title" className="ep-page-title">
          {w('Admission portal')}
        </h1>
        <p className="ep-adm-signin__lead">
          {w(
            'One sign-in for all your children’s registrations. Families who registered before can use the registration number.',
          )}
        </p>
        {error ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            {error}
          </div>
        ) : null}
        <AdmissionSignIn school={school} returnTo={returnTo} lang={lang} />
        <p className="ep-adm-signin__foot ep-field__help">
          {w('Have a question first?')}{' '}
          <a href={`/${school}/admission/enquire`}>{w('Send an enquiry')}</a>
        </p>
      </section>

      <section className="ep-adm-open" aria-labelledby="adm-open-title">
        <h2 id="adm-open-title" className="ep-adm-open__title">
          {w('Open for registration')}
        </h2>
        {sessions.length === 0 ? (
          <p className="ep-card ep-adm-open__none">
            {w('No admission session is open at the moment.')}
          </p>
        ) : null}
        {sessions.map((s) => (
          <article key={s.id} className="ep-card ep-adm-session" aria-labelledby={`adm-s-${s.id}`}>
            <div>
              <h3 id={`adm-s-${s.id}`}>{s.name}</h3>
              <p className="ep-kicker">
                {/* the year's own name ("Session 2026-27") reads alone */}
                {s.academicYear} · {w('registrations close')} {dmy(s.closesAt)}
              </p>
            </div>
            <ul className="ep-adm-classes">
              {s.classes.map((k) => (
                <li key={k.id} className="ep-adm-class">
                  <div className="ep-adm-class__head">
                    <strong>{k.name}</strong>
                    <Badge tone={k.open ? 'success' : 'neutral'}>
                      {k.open
                        ? w('Open')
                        : new Date(k.opensAt).getTime() > Date.now()
                          ? w('Opens soon')
                          : w('Closed')}
                    </Badge>
                  </div>
                  <dl>
                    <div>
                      <dt>{w('Registration dates')}</dt>
                      <dd>
                        {dmy(k.opensAt)} {w('to')} {dmy(k.closesAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>{w('Date of birth')}</dt>
                      <dd>{dob(k.dobFrom, k.dobTo)}</dd>
                    </div>
                    <div>
                      <dt>{w('Registration fee')}</dt>
                      <dd>
                        {k.registrationFee !== null
                          ? rupees(k.registrationFee)
                          : k.feeFrom !== null
                            ? `${w('from')} ${rupees(k.feeFrom)}`
                            : w('No fee')}
                      </dd>
                    </div>
                  </dl>
                  {k.open ? (
                    <a className="ep-btn ep-btn--secondary ep-btn--sm" href="#sign-in">
                      {w('Sign in to register')}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            {s.instructions ? (
              <details className="ep-adm-more">
                <summary>{w('Instructions')}</summary>
                <p style={{ whiteSpace: 'pre-line' }}>{s.instructions}</p>
              </details>
            ) : null}
            {s.classes.some((k) => k.points?.length) ? (
              <details className="ep-adm-more ep-adm-points">
                <summary>{w('Merit points')}</summary>
                <p className="ep-kicker">
                  {w(
                    'Points come from the form’s answers and are checked with the documents; test and interview marks, where there are any, are added. Equal totals: the older child first, then a draw of lots.',
                  )}
                </p>
                {s.classes
                  .filter((k) => k.points?.length)
                  .map((k) => (
                    <div key={k.id} className="ep-adm-points__class">
                      <h4 className="ep-kicker">{k.name}</h4>
                      <ul>
                        {k.points!.map((p) => (
                          <li key={p.name}>
                            {p.name}: <strong>{p.points}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </details>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
