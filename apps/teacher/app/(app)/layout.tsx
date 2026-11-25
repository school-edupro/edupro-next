import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiError } from '@edupro/bff';
import { AssistantDock } from '@/components/AssistantDock';
import { StaffShell } from '@/components/StaffShell';
import type { StaffWaiting } from '@/lib/staff-menu';
import { myStaffLayout } from '@/lib/staff-layout';
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
  // opened inside the mobile app: the app has its own header, menu and approvals (docs/design/89). A session the
  // app handed over AND the app's own web view (it adds "EduProApp/<version>" to its user agent): the same session in
  // an ordinary browser (the app's web preview shares the computer's browser) keeps the portal's frame
  const inApp =
    (await bff.session.read())?.mobile &&
    /\bEduProApp\//.test((await headers()).get('user-agent') ?? '');
  if (inApp)
    return (
      <main id="main" className="ep-main">
        {children}
      </main>
    );
  // the header badge, what waits on this person and the school's staff menu (docs/design/94: one call, as the app);
  // best effort, never blocks the page
  const mine = await myStaffLayout();
  // also a parent in the school it works in (the chosen one, else the only one): their children for the Switch menu
  const workingSchool = me.school?.id ?? me.memberships[0]?.schoolId;
  const kids = me.memberships.some(
    (m) => m.schoolId === workingSchool && m.personType === 'guardian',
  )
    ? await bff.api
        .fetch<{
          data: Array<{
            kind: string;
            schoolId: string;
            studentId: string | null;
            name: string;
            detail: string | null;
          }>;
        }>('/me/profiles')
        .then((r) =>
          r.data
            .filter((p) => p.kind === 'parent' && p.schoolId === workingSchool && p.studentId)
            .map((p) => ({ id: p.studentId!, name: p.name, detail: p.detail })),
        )
        .catch(() => [])
    : [];
  const unread = mine?.unread ?? 0;
  const waiting: StaffWaiting = mine?.waiting ?? { approvals: 0 };
  // everything waiting for this person's decision, every kind (the server's approvals inbox, as the admin's header and
  // the app): student leave, staff leave, gate passes, profile changes … best effort, never blocks the page
  const approvals = await bff.api
    .fetch<{ total: number }>('/approvals/inbox?view=counts')
    .then((r) => r.total)
    .catch(() => 0);
  return (
    <>
      <StaffShell
        me={me}
        lang={lang}
        currentPath={currentPath}
        unread={unread}
        approvals={approvals}
        waiting={waiting}
        layout={mine?.published ? mine : null}
        kids={kids}
      >
        {children}
      </StaffShell>
      {/* the MobiAI chat window (docs/design/92) for those with the assistant */}
      {me.permissions.includes('insights.assistant.use') ? <AssistantDock lang={lang} /> : null}
    </>
  );
}
