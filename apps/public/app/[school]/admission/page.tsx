import { Badge, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  STATUS_TEXT,
  admissionFetch,
  dmy,
  rupees,
  type PortalMe,
  type PortalSession,
} from '@/lib/admission';
import { AdmissionSignIn } from '@/components/AdmissionSignIn';
import { startRegistration } from './actions';

/**
 * The admission portal of a school (docs/design/39, part 3): the open sessions with each class's dates,
 * age window and registration fee; sign-in by a code; the family's registrations; a new registration.
 */
export default async function AdmissionPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ session?: string; error?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const open = await admissionFetch<{
    school: { name: string; code: string };
    sessions: PortalSession[];
  }>(`/schools/${encodeURIComponent(school)}`, {}, null).catch((error: unknown) => {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  });
  const signedIn = Boolean((await cookies()).get(ADMISSION_COOKIE)?.value);
  const me = signedIn ? await admissionFetch<PortalMe>('/me').catch(() => null) : null;
  const sessions = sp.session
    ? open.sessions
        .filter((s) => s.code.toLowerCase() === sp.session!.toLowerCase())
        .concat(open.sessions.filter((s) => s.code.toLowerCase() !== sp.session!.toLowerCase()))
    : open.sessions;

  return (
    <>
      <PageHeader
        kicker="Online admission"
        title={`Registration at ${open.school.name}`}
        description="Fill the registration form, pay the registration fee and follow your child's admission here. You sign in with a code sent to your mobile and email."
        actions={
          me ? (
            <form action="/api/admission/logout" method="post">
              <input type="hidden" name="school" value={school} />
              <button className="ep-btn ep-btn--ghost ep-btn--sm" type="submit">
                Sign out
              </button>
            </form>
          ) : undefined
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.error}
        </div>
      ) : null}

      {me ? (
        <Card elevated title="My registrations" style={{ marginBottom: 'var(--sp-4)' }}>
          {me.applications.length === 0 ? (
            <p style={{ margin: 0 }}>No registration yet. Choose a class below to start one.</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">My registrations</caption>
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Class</th>
                    <th scope="col">Registration no.</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {me.applications.map((a) => {
                    const st = STATUS_TEXT[a.status] ?? {
                      label: a.status,
                      tone: 'neutral' as const,
                    };
                    return (
                      <tr key={a.id}>
                        <td>{a.candidate || 'Not filled yet'}</td>
                        <td>
                          {a.className}
                          <div className="ep-kicker">
                            {a.session} · {a.academicYear}
                          </div>
                        </td>
                        <td>{a.number ?? '-'}</td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {a.status === 'draft' ? (
                            <div className="ep-kicker">{a.progress}% filled</div>
                          ) : null}
                          {a.feeDue ? (
                            <div className="ep-kicker">{rupees(a.feeDue)} due</div>
                          ) : null}
                        </td>
                        <td>
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/${school}/admission/application/${a.id}`}
                          >
                            {a.status === 'draft' || a.status === 'sent_back' ? 'Continue' : 'Open'}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {sessions.length === 0 ? <Card>No admission session is open at the moment.</Card> : null}
      {sessions.map((s) => (
        <Card key={s.id} elevated title={s.name} style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-kicker">
            Academic year {s.academicYear} · registrations close {dmy(s.closesAt)}
          </div>
          {s.instructions ? <p style={{ whiteSpace: 'pre-line' }}>{s.instructions}</p> : null}
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Classes of {s.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Registration dates</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Registration fee</th>
                  <th scope="col">
                    <span className="ep-sr-only">Register</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.classes.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      {dmy(k.opensAt)} to {dmy(k.closesAt)}
                    </td>
                    <td>
                      {k.dobFrom || k.dobTo
                        ? `${k.dobFrom ? `from ${dmy(k.dobFrom)}` : ''}${k.dobFrom && k.dobTo ? ' ' : ''}${k.dobTo ? `to ${dmy(k.dobTo)}` : ''}`
                        : '-'}
                    </td>
                    <td>
                      {k.registrationFee !== null
                        ? rupees(k.registrationFee)
                        : k.feeFrom !== null
                          ? `from ${rupees(k.feeFrom)}`
                          : 'No fee'}
                    </td>
                    <td>
                      {!k.open ? (
                        <Badge tone="neutral">
                          {new Date(k.opensAt).getTime() > Date.now() ? 'Opens soon' : 'Closed'}
                        </Badge>
                      ) : me ? (
                        <form action={startRegistration}>
                          <input type="hidden" name="school" value={school} />
                          <input type="hidden" name="cycleId" value={s.id} />
                          <input type="hidden" name="classId" value={k.id} />
                          <button className="ep-btn ep-btn--primary ep-btn--sm" type="submit">
                            Register for {k.name}
                          </button>
                        </form>
                      ) : (
                        <a className="ep-btn ep-btn--secondary ep-btn--sm" href="#sign-in">
                          Sign in to register
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {!me ? (
        <Card elevated title="Sign in" id="sign-in">
          <p style={{ marginTop: 0 }}>
            One sign-in for all your children&apos;s registrations. Families who registered before
            can use the registration number.
          </p>
          <AdmissionSignIn school={school} returnTo={`/${school}/admission`} />
        </Card>
      ) : null}
    </>
  );
}
