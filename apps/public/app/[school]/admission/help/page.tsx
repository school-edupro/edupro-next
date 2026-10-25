import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ADMISSION_COOKIE, admissionFetch } from '@/lib/admission';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';

/** How admission works, in the order a family meets it. */
const STEPS = [
  'Sign in with your mobile number or email and the code sent to it.',
  'Choose the class under Apply for a class and fill the form tab by tab; each tab is saved when you press Next.',
  'Submit the form and pay the registration fee: the registration number and the receipt come by email.',
  'The school checks the documents and may ask for a correction; then the test or interaction, with an admit card.',
  'If your child is offered a seat, pay the admission fee by its last date.',
  'After admission the parent portal takes over: sign in there with the same mobile.',
];

const FAQS: Array<[string, string]> = [
  [
    'I did not get the code.',
    'Email can take a minute; look in the spam folder too. You can ask for a new code after 30 seconds. Using a registration number sends the code to the mobile and email of that registration.',
  ],
  [
    'Can I register more than one child?',
    'Yes. Use "Register another child" under Apply for a class; each child has their own form. A child can hold one registration per academic year.',
  ],
  [
    'I left the form half filled.',
    'Your answers are kept. Open My registrations, or the class under Apply for a class, and continue where you stopped.',
  ],
  [
    'Registrations are closed. Can I still apply?',
    'Only with a late-entry passcode from the school. Ask the school office; enter the passcode under Apply for a class.',
  ],
  [
    'Is the registration fee refunded?',
    'The registration fee is not refunded. If an admission is cancelled after the admission fee is paid, the school refunds it as its rules say.',
  ],
];

/**
 * Help (docs/design/42, part 4): how the admission works, the common questions, the school's contact and
 * a way to send an enquiry. Works signed in (in the portal's shell) and signed out.
 */
export default async function AdmissionHelpPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school } = await params;
  const profile = await schoolProfile(school);
  if (!profile) notFound();
  const signedIn = Boolean((await cookies()).get(ADMISSION_COOKIE)?.value);
  const newAnswers = signedIn
    ? await admissionFetch<{ unread: number }>('/me/queries')
        .then((x) => x.unread)
        .catch(() => 0)
    : 0;
  const lang = await currentLang();
  const w = (en: string) => t(lang, en);
  return (
    <>
      <div className="ep-adm-pagehead">
        <p className="ep-kicker">{profile.name}</p>
        <h1 className="ep-page-title">{w('Help')}</h1>
      </div>
      <div className="fp-two ep-adm-help">
        <section className="ep-card" aria-labelledby="help-how">
          <h2 id="help-how" className="fp-section-title">
            {w('How admission works')}
          </h2>
          <ol className="ep-adm-help__steps">
            {STEPS.map((s) => (
              <li key={s}>{w(s)}</li>
            ))}
          </ol>
        </section>
        <section className="ep-card" aria-labelledby="help-contact">
          <h2 id="help-contact" className="fp-section-title">
            {w('Contact the school')}
          </h2>
          <dl className="pp-facts">
            {profile.phone ? (
              <div>
                <dt>{w('Phone')}</dt>
                <dd>
                  <a href={`tel:${profile.phone.replace(/[^\d+]/g, '')}`}>{profile.phone}</a>
                </dd>
              </div>
            ) : null}
            {profile.email ? (
              <div>
                <dt>{w('Email')}</dt>
                <dd>
                  <a href={`mailto:${profile.email}`}>{profile.email}</a>
                </dd>
              </div>
            ) : null}
            {profile.address ? (
              <div>
                <dt>{w('Address')}</dt>
                <dd>{profile.address}</dd>
              </div>
            ) : null}
            {profile.website ? (
              <div>
                <dt>{w('Website')}</dt>
                <dd>
                  <a href={profile.website} rel="noopener">
                    {profile.website.replace(/^https?:\/\//, '')}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          {/* signed out, a new family's question goes to the enquiry desk (docs/design/43, part 3);
              a registered family asks about its registration by these contacts */}
          {signedIn ? (
            <>
              <p className="ep-field__help">
                {w(
                  'A question about your registration? Ask the school: the answer comes in My queries and by email.',
                )}
              </p>
              <span className="ep-adm-help__ask">
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/${school}/admission/queries#ask`}
                >
                  {w('Ask the school')}
                </a>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/${school}/admission/queries`}
                >
                  {w('My queries')}
                  {newAnswers ? ` (${String(newAnswers)} ${w('new')})` : ''}
                </a>
              </span>
            </>
          ) : (
            <>
              <p className="ep-field__help">
                {w('A question about admission? Send it to the school.')}
              </p>
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/${school}/admission/enquire`}
              >
                {w('Send an enquiry')}
              </a>
            </>
          )}
        </section>
      </div>
      <section className="ep-card ep-adm-faq" aria-labelledby="help-faq">
        <h2 id="help-faq" className="fp-section-title">
          {w('Common questions')}
        </h2>
        {FAQS.map(([q, a]) => (
          <details key={q} className="ep-adm-more">
            <summary>{w(q)}</summary>
            <p>{w(a)}</p>
          </details>
        ))}
      </section>
    </>
  );
}
