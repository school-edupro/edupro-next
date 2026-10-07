const TABS: Array<{ href: string; label: string; permission: string }> = [
  { href: '/staff/activity', label: 'My day', permission: 'staff.activity.fill' },
  { href: '/staff/activity/review', label: 'Review', permission: 'staff.activity.review' },
  {
    href: '/staff/activity/dashboard',
    label: 'Dashboard and reports',
    permission: 'staff.activity.review',
  },
  { href: '/staff/activity/setup', label: 'Set-up', permission: 'staff.activity.setup' },
];

/** The daily activity log's own tabs: only what the role may open. */
export function ActivityNav({ current, permissions }: { current: string; permissions: string[] }) {
  return (
    <nav
      className="ep-tabs-links"
      aria-label="Daily activity log"
      style={{ marginBottom: 'var(--sp-4)' }}
    >
      {TABS.filter((t) => permissions.includes(t.permission)).map((t) => (
        <a key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
