import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiError } from '@edupro/bff';
import { StaffShell } from '@/components/StaffShell';
import { bff } from '@/lib/bff';
import { currentLang } from '@/lib/i18n';

/** Signed-in staff screens share the staff frame (sidebar, header, phone tab bar). */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const currentPath = (await headers()).get('x-pathname') ?? '/';
  const lang = await currentLang();
  let me;
  try {
    me = await bff.api.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      redirect('/login?error=session-expired');
    throw error;
  }
  // the header badge and what waits on this person; best effort, never blocks the page
  const [unread, approvals, profileChanges, exits, noDues] = await Promise.all([
    bff.api
      .fetch<{ unread: number }>('/comms/inbox/unread')
      .then((r) => r.unread)
      .catch(() => 0),
    bff.api
      .fetch<{ data: unknown[] }>('/engagement/mine/consent-approvals')
      .then((r) => r.data.length)
      .catch(() => 0),
    bff.api
      .fetch<{ awaitingMe: number }>('/people/staff-profile-approvals')
      .then((r) => r.awaitingMe)
      .catch(() => 0),
    bff.api
      .fetch<{ data: unknown[] }>('/people/exits/to-approve')
      .then((r) => r.data.length)
      .catch(() => 0),
    bff.api
      .fetch<{ data: unknown[] }>('/people/exits/clearance/mine')
      .then((r) => r.data.length)
      .catch(() => 0),
  ]);
  return (
    <StaffShell
      me={me}
      lang={lang}
      currentPath={currentPath}
      unread={unread}
      waiting={{ approvals, profileChanges, exits, noDues }}
    >
      {children}
    </StaffShell>
  );
}
