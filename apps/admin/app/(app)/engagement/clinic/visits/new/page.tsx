import { PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { VisitForm } from '@/components/clinic/VisitForm';
import { apiFetch, getMe } from '@/lib/api';
import { today } from '@/lib/appointments';
import type { ClinicOptions } from '@/lib/clinic';

/** A new clinic visit of a pupil or a member of staff. */
export default async function NewClinicVisitPage() {
  const [me, options] = await Promise.all([getMe(), apiFetch<ClinicOptions>('/clinic/options')]);
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="New clinic visit"
        description="Find the pupil or the member of staff, then record the examination, the treatment and the medicines given."
      />
      <ClinicNav current="/engagement/clinic/visits/new" permissions={me.permissions} />
      <VisitForm options={options} today={today()} />
    </>
  );
}
