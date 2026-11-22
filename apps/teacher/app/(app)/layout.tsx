import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiError } from '@edupro/bff';
import { AssistantDock } from '@/components/AssistantDock';
import { StaffShell } from '@/components/StaffShell';
import type { StaffWaiting } from '@/lib/staff-menu';
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
  // the header badge and what waits on this person (docs/design/94: the API counts them, as for the app's menu);
  // best effort, never blocks the page
  const { unread, waiting } = await bff.api
    .fetch<{ unread: number; waiting: StaffWaiting }>('/me/staff-waiting')
    .catch(() => ({ unread: 0, waiting: { approvals: 0 } as StaffWaiting }));
  return (
    <>
      <StaffShell me={me} lang={lang} currentPath={currentPath} unread={unread} waiting={waiting}>
        {children}
      </StaffShell>
      {/* the MobiAI chat window (docs/design/92) for those with the assistant */}
      {me.permissions.includes('insights.assistant.use') ? <AssistantDock lang={lang} /> : null}
    </>
  );
}
