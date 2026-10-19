/**
 * What a portal opened as someone may do (0183, docs/design/31-portal-view-as.md). View only: reading,
 * plus downloads made on request (report cards, receipts, the profile printout), the assistant and
 * ending the session. Acting: everything the person may do except paying and their own sign-in.
 * Never, in any impersonation: registering this browser for the person's push messages. Acting in the
 * admin app as an employee also keeps sessions as someone else and break-glass out of reach.
 */
const READ_POSTS = [/\/pdf$/, /\/print$/, /^\/insights\/assistant$/, /^\/access\/portal-as\/end$/];
const NEVER = [/^\/comms\/push\/devices(\/|$)/];
const NOT_WHEN_ACTING = [
  /^\/payments(\/|$)/,
  /^\/fees\/.*\/pay(\/|$)/,
  /^\/me\/(email|mobile|password|sign-in|otp|devices|security)(\/|$)/,
  // the admin app opened as an employee (0188): no sessions as someone else from inside one, no break-glass
  /^\/access\/(impersonation|break-glass)(\/|$)/,
  /^\/access\/portal-as(?!\/end(\/|$))(\/|$)/,
];

export function impersonationRefusal(
  mode: 'full' | 'view' | 'act',
  method: string,
  url: string,
): { type: string; detail: string } | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return null;
  // the path after the API prefix, without the query
  const path = (url.split('?')[0] ?? '').replace(/^\/api\/v\d+/, '');
  if (NEVER.some((r) => r.test(path)))
    return {
      type: 'impersonation-restricted',
      detail: 'Not while opened as someone else: this would send their notifications to you',
    };
  if (mode === 'view' && !READ_POSTS.some((r) => r.test(path)))
    return {
      type: 'impersonation-view-only',
      detail: 'View only: nothing can be sent or changed while you look at this portal as them',
    };
  if (mode === 'act' && NOT_WHEN_ACTING.some((r) => r.test(path)))
    return {
      type: 'impersonation-restricted',
      detail: path.startsWith('/access/')
        ? 'Not while opened as someone else: sessions as others and emergency access are only for yourself'
        : 'Payments and sign-in settings are only for the person themselves',
    };
  return null;
}
