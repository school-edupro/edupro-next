import { Alert } from '@edupro/ui';

const TABS: Array<{ href: string; label: string; permission: string }> = [
  {
    href: '/engagement/appointments',
    label: 'Front desk',
    permission: 'engagement.appointment.view',
  },
  {
    href: '/engagement/appointments/calendar',
    label: 'Calendar',
    permission: 'engagement.appointment.view',
  },
  {
    href: '/engagement/appointments/dashboard',
    label: 'Dashboard',
    permission: 'engagement.appointment.view',
  },
  {
    href: '/engagement/appointments/gate',
    label: 'Gate',
    permission: 'engagement.appointment.checkin',
  },
  {
    href: '/engagement/appointments/setup',
    label: 'Set-up',
    permission: 'engagement.appointment_setup.manage',
  },
];

const OK: Record<string, string> = {
  booked: 'Appointment booked. The visitor has been told.',
  approved: 'Confirmed. The visitor has been told and has the pass.',
  rejected: 'Declined. The visitor has been told.',
  rescheduled: 'Moved to the new time and confirmed. The visitor has been told.',
  cancelled: 'Cancelled. The visitor has been told.',
  checked_in: 'Checked in. The visit is in the visitor log.',
  checked_out: 'Checked out.',
  no_show: 'Marked as did not come.',
};

/** The appointment screens' own tabs, and the message a finished action leaves behind. */
export function AppointmentNav({
  current,
  permissions,
  ok,
}: {
  current: string;
  permissions: string[];
  ok?: string;
}) {
  return (
    <>
      <nav
        className="ep-tabs-links"
        aria-label="Appointments"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {TABS.filter((t) => permissions.includes(t.permission)).map((t) => (
          <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {ok && OK[ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[ok]}</Alert>
        </div>
      ) : null}
    </>
  );
}
