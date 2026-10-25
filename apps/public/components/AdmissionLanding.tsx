import { Badge } from '@edupro/ui';
import { AdmissionSignIn } from '@/components/AdmissionSignIn';
import { dmy, rupees, type PortalSession } from '@/lib/admission';
import { t, type Lang } from '@/lib/i18n';
import type { SchoolProfile } from '@/lib/school';

/** A registration form being filled: a clipboard with ticks, a pencil and a cap (our own drawing). */
function Illustration() {
  return (
    <svg viewBox="0 0 400 360" className="ep-adm-art__svg" role="presentation" focusable="false">
      <circle cx="320" cy="70" r="34" className="ep-adm-art__soft" />
      <rect x="40" y="70" width="70" height="90" rx="8" className="ep-adm-art__paper" />
      <rect x="52" y="86" width="46" height="6" rx="3" className="ep-adm-art__line" />
      <rect x="52" y="100" width="34" height="6" rx="3" className="ep-adm-art__line" />
      <rect x="52" y="114" width="40" height="6" rx="3" className="ep-adm-art__line" />
      <rect x="120" y="40" width="170" height="250" rx="14" className="ep-adm-art__board" />
      <rect x="134" y="62" width="142" height="214" rx="8" className="ep-adm-art__paper" />
      <rect x="175" y="28" width="60" height="26" rx="8" className="ep-adm-art__clip" />
      <rect x="160" y="80" width="90" height="8" rx="4" className="ep-adm-art__accent" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(0 ${String(i * 36)})`}>
          <rect
            x="150"
            y="104"
            width="22"
            height="22"
            rx="5"
            className={i < 3 ? 'ep-adm-art__tick' : 'ep-adm-art__box'}
          />
          {i < 3 ? <path d="M155 115l5 5 8-9" className="ep-adm-art__check" /> : null}
          <rect x="182" y="108" width="78" height="6" rx="3" className="ep-adm-art__line" />
          <rect
            x="182"
            y="118"
            width="50"
            height="5"
            rx="2.5"
            className="ep-adm-art__line ep-adm-art__line--light"
          />
        </g>
      ))}
      <g transform="rotate(35 320 230)">
        <rect x="306" y="150" width="20" height="120" rx="4" className="ep-adm-art__pencil" />
        <path d="M306 270h20l-10 22z" className="ep-adm-art__clip" />
      </g>
      <path d="M40 250l50-22 50 22-50 22z" className="ep-adm-art__cap" />
      <path d="M62 260v22c18 12 38 12 56 0v-22" className="ep-adm-art__capband" />
      <rect x="20" y="320" width="360" height="6" rx="3" className="ep-adm-art__ground" />
    </svg>
  );
}

/**
 * The school's instructions as it typed them, laid out: the first line as the heading when it reads
 * like one; a line ending with ":" opens a list of the lines under it (until a blank line); lines
 * starting with "-", "*" or "•" are list items too; the rest are paragraphs.
 */
function Instructions({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: React.ReactNode[] = [];
  let list: string[] | null = null;
  const flush = (key: number) => {
    if (list?.length)
      out.push(
        <ul key={`l${String(key)}`} className="ep-adm-split__steps">
          {list.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>,
      );
    list = null;
  };
  lines.forEach((l, i) => {
    const bullet = /^[-*•]\s*/.test(l);
    if (!l) return flush(i);
    if (bullet || list) {
      (list ??= []).push(l.replace(/^[-*•]\s*/, ''));
      return;
    }
    if (i === 0 && !/[.:!?]$/.test(l)) {
      out.push(
        <h2 key={i} className="ep-adm-split__h2">
          {l}
        </h2>,
      );
      return;
    }
    out.push(
      <p key={i} className="ep-adm-split__lead">
        {l}
      </p>,
    );
    if (l.endsWith(':')) list = [];
  });
  flush(lines.length);
  return <div className="ep-adm-split__instructions">{out}</div>;
}

/**
 * The admission portal's front page signed out (laid out like the school's sample): a coloured panel
 * with a drawing; beside it the school, "Registration form for admission" with the session, the
 * session's instructions, the session to choose; once chosen its classes and the sign-in; the email for
 * technical queries at the foot.
 */
export function AdmissionLanding({
  school,
  profile,
  schoolName,
  sessions,
  chosen,
  enquiry,
  lang,
  error,
  returnTo,
}: {
  school: string;
  profile: SchoolProfile | null;
  schoolName: string;
  sessions: PortalSession[];
  /** the session code from ?session= */
  chosen?: string;
  /** an enquiry's invitation, kept through the session choice */
  enquiry?: string | null;
  lang: Lang;
  error?: string;
  /** where sign-in comes back to (an enquiry's invitation travels with it) */
  returnTo: string;
}) {
  const w = (en: string) => t(lang, en);
  // one open session is chosen by itself; several wait for the family's choice
  const session =
    sessions.find((s) => s.code.toLowerCase() === chosen?.toLowerCase()) ??
    (sessions.length === 1 ? sessions[0] : undefined);
  const back = encodeURIComponent(
    `/${school}/admission${session ? `?session=${encodeURIComponent(session.code)}` : ''}`,
  );
  const years = [...new Set(sessions.map((s) => s.academicYear))];
  const dob = (from: string | null, to: string | null) =>
    from || to
      ? `${from ? `${w('from')} ${dmy(from)}` : ''}${from && to ? ' ' : ''}${to ? `${w('to')} ${dmy(to)}` : ''}`
      : '-';
  return (
    <div className="ep-adm-split">
      <div className="ep-adm-art" aria-hidden="true">
        <div className="ep-adm-art__card">
          <Illustration />
        </div>
      </div>
      <main className="ep-adm-split__panel">
        <div className="ep-adm-split__top">
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=${back}`}
            lang={lang === 'hi' ? 'en' : 'hi'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
        </div>
        <div className="ep-adm-brand">
          {profile?.logo ? (
            <img
              className="ep-adm-brand__logo"
              src={`/api/school-logo/${school}?v=${profile.logo}`}
              alt=""
            />
          ) : null}
          <span>
            <span className="ep-adm-brand__name">{schoolName}</span>
            {profile?.subtitle || profile?.address ? (
              <span className="ep-adm-brand__sub">{profile.subtitle ?? profile.address}</span>
            ) : null}
          </span>
        </div>

        <h1 className="ep-adm-split__title">{w('Registration form for admission')}</h1>
        {years.length ? (
          <p className="ep-adm-split__session">
            {/* a year named "Session 2026-27" reads alone */}
            {/^session\b/i.test(years[0] ?? '') ? '' : `${w('Session')} – `}
            {session ? session.academicYear : years.join(' / ')}
          </p>
        ) : null}

        {error ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            {error}
          </div>
        ) : null}

        {sessions.length === 0 ? (
          <p className="ep-card ep-adm-open__none">
            {w('No admission session is open at the moment.')}
          </p>
        ) : (
          <>
            <section aria-label={w('Instructions')}>
              {session?.instructions ? (
                <Instructions text={session.instructions} />
              ) : (
                <>
                  <h2 className="ep-adm-split__h2">
                    {w('Instructions for filling out the online registration form')}
                  </h2>
                  <p className="ep-adm-split__lead">
                    {w(
                      'Please read the instructions carefully to ensure a smooth registration process.',
                    )}
                  </p>
                </>
              )}
              {session?.instructions ? null : (
                <ul className="ep-adm-split__steps">
                  <li>
                    {w('Keep the photographs and documents the form asks for ready to upload.')}
                  </li>
                  <li>{w('Sign in with your mobile number or email and the code sent to it.')}</li>
                  <li>
                    {w('Each tab of the form is saved when you press Next; you can finish later.')}
                  </li>
                  <li>{w('Please review the details carefully before submitting the form.')}</li>
                </ul>
              )}
            </section>

            {sessions.length > 1 || !session ? (
              <form method="get" className="ep-adm-split__choose">
                {enquiry ? <input type="hidden" name="enquiry" value={enquiry} /> : null}
                <label className="ep-field">
                  <span className="ep-field__label">{w('Session')}</span>
                  <select
                    className="ep-select"
                    name="session"
                    defaultValue={session?.code ?? ''}
                    required
                  >
                    <option value="" disabled>
                      {w('Select one')}
                    </option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.name} ({s.academicYear})
                      </option>
                    ))}
                  </select>
                </label>
                <button className="ep-btn ep-btn--secondary" type="submit">
                  {w('Continue')}
                </button>
              </form>
            ) : null}

            {session ? (
              <>
                <section aria-labelledby="adm-classes">
                  <h2 id="adm-classes" className="ep-adm-split__h2">
                    {w('Classes open for registration')}
                  </h2>
                  <div className="ep-table-wrap ep-adm-classlist">
                    <table className="ep-table">
                      <caption className="ep-sr-only">{w('Classes open for registration')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{w('Class')}</th>
                          <th scope="col">{w('Registration dates')}</th>
                          <th scope="col">{w('Date of birth')}</th>
                          <th scope="col">{w('Registration fee')}</th>
                          <th scope="col">{w('Status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.classes.map((k) => (
                          <tr key={k.id}>
                            <th scope="row">{k.name}</th>
                            <td>
                              {dmy(k.opensAt)} {w('to')} {dmy(k.closesAt)}
                            </td>
                            <td>{dob(k.dobFrom, k.dobTo)}</td>
                            <td>
                              {k.registrationFee !== null
                                ? rupees(k.registrationFee)
                                : k.feeFrom !== null
                                  ? `${w('from')} ${rupees(k.feeFrom)}`
                                  : w('No fee')}
                            </td>
                            <td>
                              <Badge tone={k.open ? 'success' : 'neutral'}>
                                {k.open
                                  ? w('Open')
                                  : new Date(k.opensAt).getTime() > Date.now()
                                    ? w('Opens soon')
                                    : w('Closed')}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {session.classes.some((k) => k.points?.length) ? (
                    <details className="ep-adm-more ep-adm-points">
                      <summary>{w('Merit points')}</summary>
                      {session.classes
                        .filter((k) => k.points?.length)
                        .map((k) => (
                          <div key={k.id} className="ep-adm-points__class">
                            <h3 className="ep-kicker">{k.name}</h3>
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
                </section>

                <section
                  className="ep-card ep-adm-split__signin"
                  id="sign-in"
                  aria-labelledby="adm-signin"
                >
                  <h2 id="adm-signin" className="ep-adm-split__h2">
                    {w('Sign in to fill the form')}
                  </h2>
                  <p className="ep-field__help">
                    {w(
                      'One sign-in for all your children’s registrations. Families who registered before can use the registration number.',
                    )}
                  </p>
                  <AdmissionSignIn school={school} returnTo={returnTo} lang={lang} />
                </section>
              </>
            ) : null}
          </>
        )}

        <p className="ep-adm-split__foot">
          {profile?.email ? (
            <>
              {w('Only for any')} <span className="ep-adm-split__tech">{w('technical query')}</span>
              , {w('mail to')}: <a href={`mailto:${profile.email}`}>{profile.email}</a>
              <br />
            </>
          ) : null}
          {w('Have a question first?')}{' '}
          <a href={`/${school}/admission/enquire`}>{w('Send an enquiry')}</a> ·{' '}
          <a href={`/${school}/admission/help`}>{w('Help')}</a>
        </p>
      </main>
    </div>
  );
}
