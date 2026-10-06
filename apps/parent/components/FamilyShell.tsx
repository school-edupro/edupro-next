import type { ReactNode } from 'react';
import type { Me } from '@edupro/bff';
import { t, type Lang } from '@/lib/i18n';
import { Icon, type IconName } from './nav-icons';
import { SidebarToggle } from './SidebarToggle';

export type Audience = 'parent' | 'student';

/** A student login (no guardian membership in the working school) gets the student menus and wording. */
export function audienceOf(me: Me): Audience {
  const here = me.memberships.filter((m) => !me.school || m.schoolId === me.school.id);
  return here.length > 0 && here.every((m) => m.personType === 'student') ? 'student' : 'parent';
}

interface NavItem {
  href: string;
  label: string;
  /** Family-only items (payments, consents, meetings, leave) are hidden from student logins. */
  parentOnly?: boolean;
}
interface NavGroup {
  section: string;
  label: { parent: string; student: string };
  icon: IconName;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    section: 'home',
    label: { parent: 'Home', student: 'Home' },
    icon: 'home',
    items: [{ href: '/', label: 'Home' }],
  },
  {
    section: 'child',
    label: { parent: 'My child', student: 'My school day' },
    icon: 'users',
    items: [
      { href: '/profile', label: 'Profile' },
      { href: '/attendance', label: 'Attendance' },
      { href: '/timetable', label: 'Timetable' },
      { href: '/homework', label: 'Homework' },
      { href: '/documents', label: 'Session plan and date sheets' },
      { href: '/results', label: 'Results' },
      { href: '/health', label: 'Health' },
      { href: '/certificates', label: 'Certificates' },
    ],
  },
  {
    section: 'school',
    label: { parent: 'School', student: 'School' },
    icon: 'book',
    items: [
      { href: '/messages', label: 'Messages' },
      { href: '/notices', label: 'Notices' },
      { href: '/calendar', label: 'Calendar' },
      { href: '/directory', label: 'School directory' },
      { href: '/transport', label: 'School bus' },
      { href: '/library', label: 'Library' },
    ],
  },
  {
    section: 'fees',
    label: { parent: 'Fees', student: 'Fees' },
    icon: 'wallet',
    items: [{ href: '/fees', label: 'Dues and receipts', parentOnly: true }],
  },
  {
    section: 'help',
    label: { parent: 'Help desk', student: 'Help desk' },
    icon: 'message',
    items: [
      { href: '/queries', label: 'Queries', parentOnly: true },
      { href: '/appointments', label: 'Appointments', parentOnly: true },
      { href: '/gate-passes', label: 'Gate passes', parentOnly: true },
      { href: '/consents', label: 'Consent forms', parentOnly: true },
      { href: '/assistant', label: 'Assistant' },
      { href: '/help', label: 'Help' },
    ],
  },
];

/** Phone tab bar: the four screens families open most, plus Home. */
const TABS: Record<Audience, Array<{ href: string; label: string; icon: IconName }>> = {
  parent: [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/attendance', label: 'Attendance', icon: 'check' },
    { href: '/homework', label: 'Homework', icon: 'book' },
    { href: '/fees', label: 'Fees', icon: 'wallet' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  student: [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/attendance', label: 'Attendance', icon: 'check' },
    { href: '/homework', label: 'Homework', icon: 'book' },
    { href: '/results', label: 'Results', icon: 'clipboard' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
};

/** The parent and student portal frame, laid out like the admin portal (sidebar, header, content). */
export function FamilyShell({
  me,
  lang,
  currentPath,
  children,
  unread = 0,
}: {
  me: Me;
  lang: Lang;
  currentPath: string;
  children: ReactNode;
  /** messages from the school not opened yet (header badge) */
  unread?: number;
}) {
  const audience = audienceOf(me);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => audience === 'parent' || !i.parentOnly),
  })).filter((g) => g.items.length > 0);
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0] ?? null;
  const back = encodeURIComponent(currentPath);
  return (
    <div className="ep-shell fp-shell">
      <aside className="ep-sidebar" aria-label={t(lang, 'Sidebar')}>
        <div className="ep-sidebar__brand">
          <span className="ep-sidebar__logo" aria-hidden="true">
            <Icon name="book" size={22} />
          </span>
          <span className="ep-sidebar__brand-text">
            <small>EduPro Next</small>
            <b>{t(lang, audience === 'student' ? 'Student Portal' : 'Parent Portal')}</b>
          </span>
        </div>
        <nav className="ep-nav" aria-label={t(lang, 'Main menu')}>
          {groups.map((g) => {
            const label = t(lang, g.label[audience]);
            if (g.items.length === 1) {
              const item = g.items[0]!;
              return (
                <a
                  key={g.section}
                  className="ep-nav__link ep-nav__link--top"
                  href={item.href}
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                  title={label}
                >
                  <Icon name={g.icon} />
                  <span className="ep-nav__text">{label}</span>
                </a>
              );
            }
            const active = g.items.some((i) => isCurrent(i.href));
            return (
              <details key={g.section} className="ep-nav__group" open={active || undefined}>
                <summary
                  className="ep-nav__link ep-nav__link--top"
                  data-active={active ? 'true' : undefined}
                  title={label}
                >
                  <Icon name={g.icon} />
                  <span className="ep-nav__text">{label}</span>
                  <span className="ep-nav__chevron" aria-hidden="true">
                    <Icon name="chevron" size={16} />
                  </span>
                </summary>
                <div className="ep-nav__children">
                  {g.items.map((item) => (
                    <a
                      key={item.href}
                      className="ep-nav__link"
                      href={item.href}
                      aria-current={isCurrent(item.href) ? 'page' : undefined}
                    >
                      <span className="ep-nav__dot" aria-hidden="true" />
                      <span className="ep-nav__text">{t(lang, item.label)}</span>
                    </a>
                  ))}
                </div>
              </details>
            );
          })}
        </nav>
        <div className="ep-sidebar__foot">
          <SidebarToggle className="ep-sidebar__collapse" label={t(lang, 'Collapse')}>
            <Icon name="back" size={18} />
            <span className="ep-nav__text">{t(lang, 'Collapse')}</span>
          </SidebarToggle>
        </div>
      </aside>
      <header className="ep-header">
        <div className="ep-header__context">
          <SidebarToggle className="ep-header__icon-btn" label={t(lang, 'Show or hide the menu')}>
            <Icon name="menu" size={22} />
          </SidebarToggle>
          <div className="ep-header__module">
            <form method="post" action="/api/context" className="fp-context">
              <span className="fp-context__school">{school?.schoolName ?? 'EduPro'}</span>
              {me.academicYears && me.academicYears.length > 1 ? (
                <>
                  <label className="ep-sr-only" htmlFor="academicYearId">
                    {t(lang, 'Session')}
                  </label>
                  <select
                    id="academicYearId"
                    name="academicYearId"
                    className="ep-select"
                    defaultValue={me.academicYear?.id ?? ''}
                  >
                    {me.academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.code}
                        {y.status === 'active'
                          ? ` · ${t(lang, 'current')}`
                          : ` · ${t(lang, 'previous')}`}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    {t(lang, 'View')}
                  </button>
                </>
              ) : me.academicYear?.code ? (
                <span className="fp-context__year">{me.academicYear.code}</span>
              ) : null}
            </form>
          </div>
        </div>
        <div className="ep-header__context">
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=${back}`}
            lang={lang === 'hi' ? 'en' : 'hi'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
          <a
            className="ep-header__icon-btn fp-msgbtn"
            href="/messages"
            aria-label={
              unread
                ? `${t(lang, 'Messages')}: ${String(unread)} ${t(lang, 'new')}`
                : t(lang, 'Messages')
            }
            title={t(lang, 'Messages')}
          >
            <Icon name="message" size={22} />
            {unread ? (
              <span className="fp-msgbtn__badge" aria-hidden="true">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </a>
          <a
            className="ep-header__icon-btn"
            href="/notices"
            aria-label={t(lang, 'Notices')}
            title={t(lang, 'Notices')}
          >
            <Icon name="bell" size={22} />
          </a>
          <a className="ep-header__user" href="/profile" title={me.user.displayName}>
            <Icon name="user" size={20} />
            <span className="ep-header__user-name">{me.user.displayName}</span>
          </a>
          <form method="post" action="/api/auth/logout">
            <button
              type="submit"
              className="ep-header__icon-btn"
              aria-label={t(lang, 'Sign out')}
              title={t(lang, 'Sign out')}
            >
              <Icon name="logout" size={22} />
            </button>
          </form>
        </div>
      </header>
      <div className="ep-main fp-content">
        {me.academicYear && me.academicYear.status !== 'active' ? (
          <div className="ep-alert ep-alert--warning" role="status">
            {t(lang, 'Viewing a previous session (read-only)')}
          </div>
        ) : null}
        {children}
      </div>
      <nav className="fp-tabbar" aria-label={t(lang, 'Quick menu')}>
        {TABS[audience].map((tab) => (
          <a key={tab.href} href={tab.href} aria-current={isCurrent(tab.href) ? 'page' : undefined}>
            <Icon name={tab.icon} size={22} />
            <span>{t(lang, tab.label)}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
