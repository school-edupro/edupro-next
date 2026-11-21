import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiError } from '@edupro/bff';
import { FamilyShell, audienceOf } from '@/components/FamilyShell';
import { homeLayout, isHidden } from '@/lib/home-layout';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/** Signed-in parent and student screens share the portal frame (sidebar, header, phone tab bar). */
export default async function FamilyLayout({ children }: { children: ReactNode }) {
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
  // unread school messages for the header badge; best effort, never blocks the page
  const unread = await bff.api
    .fetch<{ unread: number }>('/comms/inbox/unread')
    .then((r) => r.unread)
    .catch(() => 0);
  // a withdrawn pupil's (or the parent's) days on the portal are over: no rights are left in this school
  const ended = me.permissions.length === 0;
  // opened inside the mobile app: the app has its own header, menu and back button (docs/design/89). A session the
  // app handed over AND the app's own web view (it adds "EduProApp/<version>" to its user agent): the same session in
  // an ordinary browser (the app's web preview shares the computer's browser) keeps the portal's frame
  const inApp =
    (await bff.session.read())?.mobile &&
    /\bEduProApp\//.test((await headers()).get('user-agent') ?? '');
  if (inApp)
    return (
      <main id="main" className="ep-main">
        {ended ? <p role="status">{t(lang, 'Portal access has ended')}</p> : children}
      </main>
    );
  // the school's published layout (docs/design/90): the side menu and the phone bar follow it; else as built
  const got = ended ? null : await homeLayout(audienceOf(me));
  const layout = got?.published ? got : null;
  // a screen the school hides from families: its address says so (the shell, menu and header stay)
  const hidden = isHidden(layout, currentPath);
  return (
    <FamilyShell me={me} lang={lang} currentPath={currentPath} unread={unread} layout={layout}>
      {ended ? (
        <div className="ep-card" role="status">
          <h1>{t(lang, 'Portal access has ended')}</h1>
          <p>
            {t(
              lang,
              'Your access to this school portal has ended. Please contact the school office for any paper you need.',
            )}
          </p>
        </div>
      ) : hidden ? (
        <div className="ep-card" role="status" style={{ maxWidth: '40rem' }}>
          <h1 style={{ marginTop: 0 }}>{t(lang, 'Your school does not offer this here.')}</h1>
          <p style={{ marginBottom: 0 }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/">
              {t(lang, 'Go to Home')}
            </a>
          </p>
        </div>
      ) : (
        children
      )}
    </FamilyShell>
  );
}
