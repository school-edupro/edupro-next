/** The hostel module's own tabs: only the pages this person's role may open. */
const TABS: Array<{ href: string; label: string; permission: string }> = [
  { href: '/hostel', label: 'Occupancy', permission: 'hostel.room.view' },
  { href: '/hostel/allot', label: 'Allot / transfer / vacate', permission: 'hostel.allot.manage' },
  { href: '/hostel/leave', label: 'Leave and outings', permission: 'hostel.leave.view' },
  { href: '/hostel/rollcall', label: 'Roll-call', permission: 'hostel.room.view' },
  { href: '/hostel/register', label: 'Register', permission: 'hostel.room.view' },
  { href: '/hostel/setup', label: 'Set-up', permission: 'hostel.setup.manage' },
  { href: '/hostel/upload', label: 'Upload (Excel)', permission: 'hostel.allot.manage' },
];

export function HostelNav({ current, permissions }: { current: string; permissions: string[] }) {
  return (
    <nav className="ep-tabs-links" aria-label="Hostel" style={{ marginBottom: 'var(--sp-4)' }}>
      {TABS.filter((t) => permissions.includes(t.permission)).map((t) => (
        <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
