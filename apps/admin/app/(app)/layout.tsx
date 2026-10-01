import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FamilyNotice } from '@/components/FamilyNotice';
import { Shell } from '@/components/Shell';
import { ApiError, getMe } from '@/lib/api';

/** Authenticated shell: loads /me once per request and projects navigation from permissions. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const currentPath = h.get('x-pathname') ?? '/';
  let me;
  try {
    me = await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    // A stale working-school cookie (school removed, membership ended, database rebuilt): drop it and
    // let the context route pick a valid membership again.
    if (error instanceof ApiError && error.status === 403) {
      const year = error.problem.type === 'year-forbidden';
      redirect(
        `/api/context?${year ? 'resetYear' : 'reset'}=1&returnTo=${encodeURIComponent(currentPath)}`,
      );
    }
    throw error;
  }
  // Parents and students have no staff membership: their profile lives in the parent app.
  if (
    me.memberships.length > 0 &&
    me.memberships.every((m) => m.personType === 'guardian' || m.personType === 'student')
  ) {
    return <FamilyNotice name={me.user.displayName} />;
  }
  if (!me.school && me.memberships.length > 0) {
    // No working school yet: let the context route pick the first membership and come back.
    redirect(`/api/context?returnTo=${encodeURIComponent(currentPath)}`);
  }
  return (
    <Shell me={me} currentPath={currentPath}>
      {children}
    </Shell>
  );
}
