import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { Notice } from '@/components/Notice';
import { HostelVisitPanel } from '@/components/visitors/HostelVisitPanel';
import { VisitorForm } from '@/components/visitors/VisitorForm';
import { apiFetch, getMe } from '@/lib/api';
import type { VisitorOptions } from '@/lib/visitors';

/**
 * The gate registers a walk-in visitor (no appointment) and lets them in; or, for a school with a hostel,
 * a visitor for a boarder (checked against the approved list and the visiting hours). Both go in the one
 * visitor register.
 */
export default async function NewVisitorPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    q?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const mayHostel = me.permissions.includes('hostel.visit.gate');
  const mayWalkIn = me.permissions.includes('engagement.visitor.manage');
  const options = mayWalkIn
    ? await apiFetch<VisitorOptions>('/visitors/options')
    : ({ hostelVisits: true } as VisitorOptions);
  const hostel = mayHostel && options.hostelVisits && (sp.kind === 'hostel' || !mayWalkIn);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Visitors', href: '/engagement/visitors' }, { label: 'Register' }]}
      />
      <PageHeader
        kicker="Visitors"
        title="Register a visitor"
        description={
          hostel
            ? 'A visitor for a boarder. People on the approved list are let in during visiting hours; anyone else waits for the warden, and the parent is told.'
            : 'For a visitor without an appointment. Start with the mobile number; a returning visitor’s details are filled in.'
        }
      />
      <AppointmentNav current="" permissions={me.permissions} />
      <Notice params={sp} />
      {mayHostel && options.hostelVisits && mayWalkIn ? (
        <nav
          className="ep-tabs-links"
          aria-label="Kind of visitor"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <a href="/engagement/visitors/new" aria-current={hostel ? undefined : 'page'}>
            Visitor
          </a>
          <a href="/engagement/visitors/new?kind=hostel" aria-current={hostel ? 'page' : undefined}>
            Hostel visit (boarder)
          </a>
        </nav>
      ) : null}
      {hostel ? (
        <HostelVisitPanel q={sp.q} student={sp.student} />
      ) : (
        <VisitorForm options={options} />
      )}
    </>
  );
}
