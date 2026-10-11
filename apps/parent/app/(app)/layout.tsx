import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiError } from '@edupro/bff';
import { FamilyShell } from '@/components/FamilyShell';
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
  return (
    <FamilyShell me={me} lang={lang} currentPath={currentPath} unread={unread}>
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
      ) : (
        children
      )}
    </FamilyShell>
  );
}
