import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { VisitorForm } from '@/components/visitors/VisitorForm';
import { apiFetch, getMe } from '@/lib/api';
import type { VisitorOptions } from '@/lib/visitors';

/** The gate registers a walk-in visitor (no appointment) and lets them in. */
export default async function NewVisitorPage() {
  const [me, options] = await Promise.all([getMe(), apiFetch<VisitorOptions>('/visitors/options')]);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Visitors', href: '/engagement/visitors' }, { label: 'Register' }]}
      />
      <PageHeader
        kicker="Visitors"
        title="Register a visitor"
        description="For a visitor without an appointment. Start with the mobile number; a returning visitor’s details are filled in."
      />
      <AppointmentNav current="" permissions={me.permissions} />
      <VisitorForm options={options} />
    </>
  );
}
