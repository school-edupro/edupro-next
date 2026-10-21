import { Badge, Card, PageHeader } from '@edupro/ui';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import {
  APPLICATION_STATUS,
  careersFetch,
  careersMe,
  dmy,
  istText,
  type CareerSignIn,
} from '@/lib/careers';

const TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  submitted: 'info',
  returned: 'warning',
  screening: 'info',
  on_hold: 'warning',
  selected: 'success',
  joined: 'success',
  rejected: 'neutral',
  withdrawn: 'neutral',
};
const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const EYE = icon(
  'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
);
const SAVE = icon('M12 4v12m0 0-4-4m4 4 4-4M4 20h16');

/** My applications and where each stands; my application form. */
export default async function MyApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ applied?: string; corrected?: string; changed?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const me = await careersMe(school);
  const channels = me ? null : await careersFetch<CareerSignIn>(`/${school}/sign-in`, {}, null);
  return (
    <>
      <PageHeader
        kicker="Careers"
        title="My applications"
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/careers`}>
              All posts
            </a>
            {me ? (
              <form action={`/api/careers/logout?to=/${school}/careers`} method="post">
                <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                  Sign out
                </button>
              </form>
            ) : null}
          </span>
        }
      />
      {!me ? (
        <Card title="Sign in">
          <CandidateSignIn
            school={school}
            returnTo={`/${school}/careers/mine`}
            channels={channels!}
          />
        </Card>
      ) : (
        <>
          {sp.applied ? (
            <div
              className="ep-alert ep-alert--success"
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              Your application {sp.applied} is sent. The school will contact you if you are
              shortlisted.
            </div>
          ) : null}
          {sp.corrected ? (
            <div
              className="ep-alert ep-alert--success"
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              Your corrected application is sent
              {sp.changed ? ` (changed: ${sp.changed.slice(0, 300)})` : ''}. A copy is on its way to
              your email.
            </div>
          ) : null}
          {me.applications.length ? (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {me.applications.map((a) => (
                <article
                  key={a.id}
                  className="ep-card ep-career-app"
                  style={{ padding: 'var(--sp-4)' }}
                >
                  <div className="ep-career-app__head">
                    <h2 className="ep-card__title" style={{ margin: 0 }}>
                      {a.open ? (
                        <a href={`/${school}/careers/${a.vacancyId}`}>{a.title}</a>
                      ) : (
                        a.title
                      )}
                    </h2>
                    <Badge tone={TONE[a.status] ?? 'neutral'}>
                      {APPLICATION_STATUS[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    {[a.department, a.subject, a.employeeType, a.campus]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p style={{ margin: 0 }}>
                    Application <strong>{a.number}</strong> · sent {istText(a.submittedAt)}
                  </p>
                  {a.correction ? (
                    <div
                      className={`ep-alert ep-alert--${a.correction.overdue ? 'danger' : 'warning'} ep-career-app__fix`}
                      role="status"
                    >
                      <div>
                        <strong>The school asks you to correct your application</strong>
                        <p style={{ margin: 'var(--sp-1) 0 0' }}>“{a.correction.remark}”</p>
                        <p style={{ margin: 'var(--sp-1) 0 0' }}>
                          To correct: {a.correction.parts}. Please send it again by{' '}
                          <strong>{dmy(a.correction.dueOn)}</strong>
                          {a.correction.overdue
                            ? ' (the date has passed; send it as soon as you can)'
                            : ''}
                          .
                        </p>
                        <a
                          className="ep-btn ep-btn--primary ep-btn--sm"
                          style={{ marginTop: 'var(--sp-2)' }}
                          href={`/${school}/careers/form?correct=${a.id}`}
                        >
                          Correct and send again
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {a.next ? (
                    <p className="ep-alert ep-alert--info" role="status" style={{ margin: 0 }}>
                      <span>
                        <strong>{a.next.stage}</strong>: {istText(a.next.at)}
                        {a.next.venue ? ` · ${a.next.venue}` : ''}
                      </span>
                    </p>
                  ) : null}
                  <div className="ep-career-app__tools">
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/api/careers/application-pdf/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View application ${a.number}`}
                    >
                      {EYE} View
                    </a>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/api/careers/application-pdf/${a.id}?save=1`}
                      aria-label={`Download application ${a.number} (PDF)`}
                    >
                      {SAVE} Download
                    </a>
                    {a.open ? (
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/${school}/careers/${a.vacancyId}`}
                      >
                        The post
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Card>No application yet. Pick a post from the careers page.</Card>
          )}
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <Card title="My application form">
              <p style={{ marginTop: 0 }}>
                Signed in as {me.candidate.name ?? me.candidate.mobile ?? me.candidate.email}.{' '}
                {me.missing.length
                  ? `Still needed before you apply: ${me.missing.join(', ')}.`
                  : 'Complete.'}
              </p>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/${school}/careers/form`}>
                Open the form
              </a>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
