import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { AdmissionShell } from '@/components/AdmissionShell';
import { SchoolFrame } from '@/components/SchoolFrame';
import { ADMISSION_COOKIE, admissionFetch, type PortalInbox, type PortalMe } from '@/lib/admission';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';

/**
 * The admission portal (docs/design/42): signed out, the school's frame around the sign-in card and the
 * open classes; signed in, the portal's own shell like the parent portal (sidebar, top bar, tab bar).
 */
export default async function AdmissionLayout({
  params,
  children,
}: {
  params: Promise<{ school: string }>;
  children: ReactNode;
}) {
  const { school } = await params;
  const profile = await schoolProfile(school);
  const signedIn = Boolean((await cookies()).get(ADMISSION_COOKIE)?.value);
  const me = signedIn ? await admissionFetch<PortalMe>('/me').catch(() => null) : null;
  if (!me || !profile) return <SchoolFrame school={profile}>{children}</SchoolFrame>;
  const currentPath = (await headers()).get('x-pathname') ?? `/${school}/admission`;
  const family = me.candidate.name?.trim() || me.candidate.email || me.candidate.mobile || 'Family';
  // the count on the top bar's Messages (docs/design/42, part 4)
  const unread = await admissionFetch<PortalInbox>('/me/inbox')
    .then((r) => r.unread ?? 0)
    .catch(() => 0);
  return (
    <AdmissionShell
      school={{ code: school.toLowerCase(), name: profile.name }}
      lang={await currentLang()}
      currentPath={currentPath}
      family={family}
      unread={unread}
    >
      {children}
    </AdmissionShell>
  );
}
