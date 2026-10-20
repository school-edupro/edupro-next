import { Badge, Card, PageHeader } from '@edupro/ui';
import { CandidateSignIn } from '@/components/CandidateSignIn';
import { APPLICATION_STATUS, careersFetch, careersMe, dmy, type CareerSignIn } from '@/lib/careers';

/** My applications and where each stands; my application form. */
export default async function MyApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ applied?: string }>;
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
          <Card title="Applications">
            {me.applications.length ? (
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <caption className="ep-sr-only">My applications</caption>
                  <thead>
                    <tr>
                      <th scope="col">Post</th>
                      <th scope="col">Application</th>
                      <th scope="col">Sent on</th>
                      <th scope="col">Where it stands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.applications.map((a) => (
                      <tr key={a.id}>
                        <td>{a.title}</td>
                        <td>{a.number}</td>
                        <td>{dmy(a.submittedAt)}</td>
                        <td>
                          <Badge tone="info">{APPLICATION_STATUS[a.status] ?? a.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0 }}>No application yet. Pick a post from the careers page.</p>
            )}
          </Card>
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
