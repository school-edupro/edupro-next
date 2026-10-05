import { Alert } from '@edupro/ui';

const TABS: Array<{ href: string; label: string; permission: string }> = [
  { href: '/attendance', label: 'Dashboard', permission: 'attendance.session.view' },
  { href: '/attendance/register', label: 'Class register', permission: 'attendance.session.view' },
  { href: '/attendance/bus-roll', label: 'Bus attendance', permission: 'attendance.bus.mark' },
  {
    href: '/attendance/registers',
    label: 'Monthly registers',
    permission: 'attendance.session.view',
  },
  { href: '/attendance/setup', label: 'Set-up', permission: 'attendance.setup.manage' },
];
const OK: Record<string, string> = {
  saved: 'Saved.',
  reopened: 'The day is open again for the teacher until the time shown.',
};

/** The attendance screens' own tabs (only the pages this role may open) and the message of a finished action. */
export function AttendanceNav({
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
        aria-label="Attendance"
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
