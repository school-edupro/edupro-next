import { PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { ClinicSetupForm } from '@/components/clinic/ClinicSetupForm';
import { MessageTemplates } from '@/components/MessageTemplates';
import { apiFetch, getMe } from '@/lib/api';
import type { ClinicSetup } from '@/lib/clinic';

/** Clinic set-up (admin): clinics, doctors, nurses, diseases, medicines, the check-up form, the messages. */
export default async function ClinicSetupPage() {
  const [me, setup] = await Promise.all([getMe(), apiFetch<ClinicSetup>('/clinic/setup')]);
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Set-up"
        description="What the clinic's forms pick from. School Doctor and School Nurse are roles you give under Access."
      />
      <ClinicNav current="/engagement/clinic/setup" permissions={me.permissions} />
      <ClinicSetupForm initial={setup} />
      <MessageTemplates
        templates={setup.templates}
        search="clinic"
        builtInEmail="Built-in design"
      />
    </>
  );
}
