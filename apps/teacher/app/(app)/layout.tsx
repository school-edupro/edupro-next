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
  const [
    unread,
    approvals,
    profileChanges,
    exits,
    noDues,
    admissions,
    purchase,
    requisitions,
    orders,
    receipts,
    issues,
    assets,
    leaveMenu,
  ] = await Promise.all([
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
    // admission registrations at my levels, and those I decided lately (docs/design/50)
    bff.api
      .fetch<{ waiting: number; decided: number }>('/admissions/approvals?size=1')
      .then((r) => r.waiting + r.decided)
      .catch(() => 0),
    // purchase indents at my approval level (docs/design/83)
    bff.api
      .fetch<{ total: number }>('/purchase/indents?view=waiting&status=submitted&size=1')
      .then((r) => r.total)
      .catch(() => 0),
    // purchase requisitions at my level, and comparative statements to sign
    bff.api
      .fetch<{ waitingForMe: number; toSign: number }>(
        '/purchase/requisitions?view=waiting&status=submitted&size=1',
      )
      .then((r) => r.waitingForMe + r.toSign)
      .catch(() => 0),
    // purchase orders and emergency purchases at my level
    bff.api
      .fetch<{ waitingForMe: number }>('/purchase/orders?view=waiting&status=submitted&size=1')
      .then((r) => r.waitingForMe)
      .catch(() => 0),
    // goods and services received for my inspection or signature (docs/design/84)
    bff.api
      .fetch<{ waiting: number }>('/purchase/receipts-waiting')
      .then((r) => r.waiting)
      .catch(() => 0),
    // what the store issued to me or my department, to acknowledge (docs/design/84)
    bff.api
      .fetch<{ toAcknowledge: number }>('/purchase/issues?mine=1&page=1')
      .then((r) => r.toAcknowledge)
      .catch(() => 0),
    // assets in my care and those handed to me (docs/design/84, part 9)
    bff.api
      .fetch<{ rows: unknown[]; pending: unknown[] }>('/purchase/assets-mine')
      .then((r) => r.rows.length + r.pending.length)
      .catch(() => 0),
    // Leave & attendance (docs/design/85): colleagues' leave and attendance corrections at my level,
    // the staff who report to me, the reports given to me — one call
    bff.api
      .fetch<{ leave: number; corrections: number; team: number; reports: number }>('/leave/menu')
      .catch(() => ({ leave: 0, corrections: 0, team: 0, reports: 0 })),
  ]);
  return (
    <StaffShell
      me={me}
      lang={lang}
      currentPath={currentPath}
      unread={unread}
      waiting={{
        approvals,
        profileChanges,
        exits,
        noDues,
        admissions,
        purchase,
        requisitions,
        orders,
        receipts,
        issues,
        assets,
        staffLeave: leaveMenu.leave,
        staffRegularisations: leaveMenu.corrections,
        leaveReports: leaveMenu.reports,
        team: leaveMenu.team,
      }}
    >
      {children}
    </StaffShell>
  );
}
