import type { ReactNode } from 'react';
import type { Me } from '@/lib/api';
import { SchoolYearSwitcher } from './SchoolYearSwitcher';

/** Navigation is projected from permissions (ADR-004 point 10). Add entries as modules land. */
const NAV: Array<{
  section: string;
  items: Array<{ href: string; label: string; permission: string | null }>;
}> = [
  {
    section: 'Overview',
    items: [{ href: '/', label: 'Dashboard', permission: null }],
  },
  {
    section: 'Academics',
    items: [
      {
        href: '/academics/classes',
        label: 'Classes and sections',
        permission: 'academics.class.view',
      },
    ],
  },
  {
    section: 'Access',
    items: [
      { href: '/access/roles', label: 'Roles and permissions', permission: 'access.role.view' },
      { href: '/access/assignments', label: 'Assignments', permission: 'access.assignment.view' },
      { href: '/access/memberships', label: 'Members', permission: 'access.assignment.view' },
      { href: '/access/delegations', label: 'Delegations', permission: 'access.delegation.create' },
    ],
  },
  {
    section: 'System',
    items: [
      { href: '/system/school', label: 'School profile', permission: 'platform.school.view' },
      { href: '/system/years', label: 'Years', permission: 'platform.year.view' },
      { href: '/system/settings', label: 'Settings', permission: 'platform.settings.view' },
      { href: '/system/audit', label: 'Audit log', permission: 'platform.audit.view' },
    ],
  },
];

export function Shell({
  me,
  currentPath,
  children,
}: {
  me: Me;
  currentPath: string;
  children: ReactNode;
}) {
  const allowed = new Set(me.permissions);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  return (
    <div className="ep-shell">
      <aside className="ep-sidebar" aria-label="Primary">
        <div className="ep-sidebar__brand">
          Edu<b>Pro</b>&nbsp;Next
        </div>
        <nav>
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => i.permission === null || allowed.has(i.permission),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.section}>
                <div className="ep-nav__section">{group.section}</div>
                {items.map((item) => (
                  <a
                    key={item.href}
                    className="ep-nav__link"
                    href={item.href}
                    aria-current={isCurrent(item.href) ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <header className="ep-header">
        <div className="ep-header__context">
          <SchoolYearSwitcher me={me} />
        </div>
        <div className="ep-header__context">
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>
            {me.user.displayName}
          </span>
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="ep-main">{children}</main>
    </div>
  );
}
