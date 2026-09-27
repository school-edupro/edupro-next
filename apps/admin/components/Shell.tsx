import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Me } from '@/lib/api';
import { SchoolYearSwitcher } from './SchoolYearSwitcher';

/** Navigation is projected from permissions (ADR-004 point 10). Labels come from the message catalogue (S4-01). */
const NAV: Array<{
  section: string;
  items: Array<{ href: string; label: string; permission: string | null }>;
}> = [
  { section: 'overview', items: [{ href: '/', label: 'dashboard', permission: null }] },
  {
    section: 'people',
    items: [
      { href: '/people/students', label: 'students', permission: 'people.student.view' },
      { href: '/people/employees', label: 'employees', permission: 'people.employee.view' },
      { href: '/people/search', label: 'peopleSearch', permission: 'people.person.search' },
    ],
  },
  {
    section: 'academics',
    items: [{ href: '/academics/classes', label: 'classes', permission: 'academics.class.view' }],
  },
  {
    section: 'access',
    items: [
      { href: '/access/roles', label: 'roles', permission: 'access.role.view' },
      { href: '/access/assignments', label: 'assignments', permission: 'access.assignment.view' },
      { href: '/access/memberships', label: 'members', permission: 'access.assignment.view' },
      { href: '/access/delegations', label: 'delegations', permission: 'access.delegation.create' },
    ],
  },
  {
    section: 'communication',
    items: [
      { href: '/comms/templates', label: 'templates', permission: 'comms.template.view' },
      { href: '/comms/messages', label: 'deliveryLog', permission: 'comms.message.view' },
    ],
  },
  {
    section: 'reports',
    items: [{ href: '/reports/exports', label: 'exportCentre', permission: 'reports.export.view' }],
  },
  {
    section: 'system',
    items: [
      { href: '/system/school', label: 'schoolProfile', permission: 'platform.school.view' },
      { href: '/system/years', label: 'years', permission: 'platform.year.view' },
      { href: '/system/settings', label: 'settings', permission: 'platform.settings.view' },
      { href: '/system/audit', label: 'auditLog', permission: 'platform.audit.view' },
      { href: '/system/jobs', label: 'jobs', permission: 'platform.jobs.view' },
    ],
  },
];

export async function Shell({
  me,
  currentPath,
  children,
}: {
  me: Me;
  currentPath: string;
  children: ReactNode;
}) {
  const [t, nav, common, locale] = await Promise.all([
    getTranslations('shell'),
    getTranslations('nav'),
    getTranslations('common'),
    getLocale(),
  ]);
  const allowed = new Set(me.permissions);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const canSearch = allowed.has('people.person.search');
  return (
    <div className="ep-shell">
      <aside className="ep-sidebar" aria-label="Sidebar">
        <div className="ep-sidebar__brand">
          Edu<b>Pro</b>&nbsp;Next
        </div>
        <nav aria-label={t('primaryNavigation')}>
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => i.permission === null || allowed.has(i.permission),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.section}>
                <div className="ep-nav__section">{nav(group.section)}</div>
                {items.map((item) => (
                  <a
                    key={item.href}
                    className="ep-nav__link"
                    href={item.href}
                    aria-current={isCurrent(item.href) ? 'page' : undefined}
                  >
                    {nav(item.label)}
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
          {canSearch ? (
            <form
              method="get"
              action="/people/search"
              role="search"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
            >
              <input
                className="ep-input"
                type="search"
                name="q"
                placeholder={t('searchPlaceholder')}
                aria-label={t('search')}
                minLength={2}
                required
                style={{ minWidth: 240 }}
              />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {t('search')}
              </button>
            </form>
          ) : null}
        </div>
        <div className="ep-header__context">
          <form
            method="post"
            action="/api/locale"
            style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
          >
            <label className="ep-field__label" htmlFor="locale" style={{ margin: 0 }}>
              {t('language')}
            </label>
            <select id="locale" name="locale" className="ep-select" defaultValue={locale}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              {common('apply')}
            </button>
          </form>
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>
            {me.user.displayName}
          </span>
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              {t('signOut')}
            </button>
          </form>
        </div>
      </header>
      <main className="ep-main">{children}</main>
    </div>
  );
}
