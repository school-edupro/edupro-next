import { PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { AppointmentSetup } from '@/components/appointments/AppointmentSetup';
import { apiFetch, getMe } from '@/lib/api';
import type { AppointmentSetup as Setup } from '@/lib/appointments';

/** Appointment set-up (admin): the booking QR, the rules, who can be met and when, the messages. */
export default async function AppointmentSetupPage() {
  const [me, setup] = await Promise.all([getMe(), apiFetch<Setup>('/appointments/setup')]);
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="Appointment set-up"
        description="Who can be met and when, how slots work, what an outside visitor must give, and the messages that go out."
      />
      <AppointmentNav current="/engagement/appointments/setup" permissions={me.permissions} />
      <AppointmentSetup initial={setup} />
    </>
  );
}
