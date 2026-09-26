import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { ApiError, getMe } from '@/lib/api';

/** Authenticated shell: loads /me once per request and projects navigation from permissions. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let me;
  try {
    me = await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const h = await headers();
  const currentPath = h.get('x-invoke-path') ?? h.get('next-url') ?? '/';
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
