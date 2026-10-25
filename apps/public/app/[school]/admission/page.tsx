import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  admissionFetch,
  type PortalInbox,
  type PortalDashboard,
  type PortalMe,
  type PortalSession,
} from '@/lib/admission';
import { AdmissionHome } from '@/components/AdmissionHome';
import { AdmissionLanding } from '@/components/AdmissionLanding';
import { currentLang } from '@/lib/lang';

/**
 * The admission portal of a school (docs/design/39, part 3): the open sessions with each class's dates,
 * age window and registration fee; sign-in by a code; the family's registrations; a new registration.
 */
export default async function AdmissionPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ session?: string; error?: string; enquiry?: string; child?: string }>;
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
  const inbox = me ? await admissionFetch<PortalInbox>('/me/inbox').catch(() => null) : null;
  // an invitation from the enquiry desk: kept through the sign-in and given to the new registration
  const enquiry = /^[A-Za-z0-9_-]{16,64}$/.test(sp.enquiry ?? '') ? sp.enquiry! : null;
  const sessions = sp.session
    ? open.sessions
        .filter((s) => s.code.toLowerCase() === sp.session!.toLowerCase())
        .concat(open.sessions.filter((s) => s.code.toLowerCase() !== sp.session!.toLowerCase()))
    : open.sessions;

  const lang = await currentLang();
  // signed out: the sign-in card and the open classes (docs/design/42, part 1)
  if (!me)
    return (
      <AdmissionLanding
        school={school}
        schoolName={open.school.name}
        sessions={sessions}
        lang={lang}
        error={sp.error}
        returnTo={`/${school}/admission${enquiry ? `?enquiry=${enquiry}${sp.session ? `&session=${encodeURIComponent(sp.session)}` : ''}` : ''}`}
      />
    );

  // an enquiry's invitation goes on to Apply for a class with its token (docs/design/42, part 3)
  if (enquiry)
    redirect(
      `/${school}/admission/apply?enquiry=${enquiry}${sp.session ? `&session=${encodeURIComponent(sp.session)}` : ''}`,
    );
  // signed in: the family's home first (docs/design/42, part 2)
  const dash = await admissionFetch<PortalDashboard>('/me/dashboard').catch(() => null);
  return (
    <>
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.error}
        </div>
      ) : null}

      {dash ? (
        <AdmissionHome
          school={school}
          schoolName={open.school.name}
          data={dash}
          inbox={inbox}
          chosen={sp.child}
          lang={lang}
        />
      ) : null}
    </>
  );
}
