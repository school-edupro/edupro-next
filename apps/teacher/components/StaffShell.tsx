import type { ReactNode } from 'react';
import type { Me } from '@edupro/bff';
import { t, type Lang } from '@/lib/i18n';
import { staffTabs, type StaffWaiting } from '@/lib/staff-menu';
import { staffGroups, type StaffLayoutView } from '@/lib/staff-layout';
import { Icon, type IconName } from './nav-icons';
import { PhoneMenu } from './PhoneMenu';
import { SidebarToggle } from './SidebarToggle';

/**
 * The staff app frame (teachers, wardens, drivers, office staff), laid out like the parent portal:
 * sidebar with only the screens this person may open, header with school, session, language, messages
 * and sign-out, and a tab bar on phones. With the school's published staff layout (docs/design/94) the side menu
 * follows it (the groups in its order and names, hidden screens left out) and the phone bar is the app's: Home, the
 * three tabs, and Menu (the side menu as a panel).
 */
export function StaffShell({
  me,
  lang,
  currentPath,
  children,
  unread = 0,
  approvals = 0,
  waiting,
  layout = null,
}: {
  me: Me;
  lang: Lang;
  currentPath: string;
  children: ReactNode;
  /** messages from the school not opened yet (header badge) */
  unread?: number;
  /** everything waiting for my decision, every kind (header badge; the approvals inbox) */
  approvals?: number;
  waiting?: StaffWaiting;
  /** The school's published staff layout for this person; null: the menu and the phone bar as built. */
  layout?: StaffLayoutView | null;
}) {
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const groups = staffGroups(me, lang, layout, waiting);
  // the phone bar: the app's tabs from the layout (a list tab opens its page, under the school's name), else as built
  const tabs: Array<{ href: string; label: string; icon: IconName }> = layout
    ? layout.tabs
        .filter((x) => x.href !== 'more')
        .map((x) =>
          x.href.startsWith('/')
            ? {
                href: x.href,
                label: x.label,
                icon: (x.href === '/' ? 'home' : x.icon) as IconName,
              }
            : {
                href: `/tabs/${x.href}`,
                label: lang === 'hi' && x.labelHi ? x.labelHi : x.label,
                icon: x.icon as IconName,
              },
        )
    : staffTabs(me, waiting);
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0] ?? null;
  const back = encodeURIComponent(currentPath);
  // a staff member who is also a parent here (their child's record joined to this login, 0423): the family website
  // (the school the header shows: the one chosen, else the only one)
  const parentHere = me.memberships.some(
    (m) => m.schoolId === school?.schoolId && m.personType === 'guardian',
  );
  return (
    <div className="ep-shell fp-shell">
      <aside className="ep-sidebar" aria-label={t(lang, 'Sidebar')}>
        <div className="ep-sidebar__brand">
          <span className="ep-sidebar__logo" aria-hidden="true">
            <Icon name="book" size={22} />
          </span>
          <span className="ep-sidebar__brand-text">
            <small>EduPro Next</small>
            <b>{t(lang, 'Staff app')}</b>
          </span>
        </div>
        <nav className="ep-nav" aria-label={t(lang, 'Main menu')}>
          <a
            className="ep-nav__link ep-nav__link--top"
            href="/"
            aria-current={isCurrent('/') ? 'page' : undefined}
            title={t(lang, 'Home')}
          >
            <Icon name="home" />
            <span className="ep-nav__text">{t(lang, 'Home')}</span>
          </a>
          {groups.map((g) => {
            const label = g.label;
            const active = g.items.some((i) => isCurrent(i.href));
            return (
              <details key={g.id} className="ep-nav__group" open={active || undefined}>
                <summary
                  className="ep-nav__link ep-nav__link--top"
                  data-active={active ? 'true' : undefined}
                  title={label}
                >
                  <Icon name={g.icon as IconName} />
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
              <input type="hidden" name="returnTo" value={currentPath} />
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
          {parentHere ? (
            // the family website, signed in with this login (a one-time link, /api/my-children)
            <form method="post" action="/api/my-children">
              <button
                type="submit"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                title={t(lang, 'Your children at this school, on the family website')}
              >
                {t(lang, 'My children')}
              </button>
            </form>
          ) : null}
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=${back}`}
            lang={lang === 'hi' ? 'en' : 'hi'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
          <a
            className="ep-header__icon-btn fp-msgbtn"
            href="/approvals"
            aria-label={
              approvals
                ? `${t(lang, 'Approvals')}: ${String(approvals)} ${t(lang, 'waiting')}`
                : t(lang, 'Approvals')
            }
            title={t(lang, 'Approvals')}
            aria-current={currentPath === '/approvals' ? 'page' : undefined}
          >
            <Icon name="check" size={22} />
            {approvals ? (
              <span className="fp-msgbtn__badge" aria-hidden="true">
                {approvals > 99 ? '99+' : approvals}
              </span>
            ) : null}
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
          <span className="ep-header__user" title={me.user.displayName}>
            <Icon name="user" size={20} />
            <span className="ep-header__user-name">{me.user.displayName}</span>
          </span>
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
        {tabs.map((tab) => (
          <a key={tab.href} href={tab.href} aria-current={isCurrent(tab.href) ? 'page' : undefined}>
            <Icon name={tab.icon} size={22} />
            <span>{t(lang, tab.label)}</span>
          </a>
        ))}
        {layout ? (
          <PhoneMenu
            label={t(lang, 'Menu')}
            closeLabel={t(lang, 'Close the menu')}
            icon={<Icon name="menu" size={22} />}
            closeIcon={<span aria-hidden="true">×</span>}
          >
            <nav aria-label={t(lang, 'Main menu')} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {groups.map((g) => (
                <section key={g.id} aria-label={g.label}>
                  <h2
                    className="ep-field__help"
                    style={{ margin: '0 0 var(--sp-1)', textTransform: 'uppercase' }}
                  >
                    {g.label}
                  </h2>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
                    {g.items.map((i) => (
                      <li key={i.href}>
                        <a
                          href={i.href}
                          aria-current={isCurrent(i.href) ? 'page' : undefined}
                          style={{
                            display: 'block',
                            padding: 'var(--sp-2) 0',
                            minHeight: '2.75rem',
                            color: 'var(--text-body)',
                            fontWeight: isCurrent(i.href) ? 'var(--fw-semibold)' : undefined,
                          }}
                        >
                          {t(lang, i.label)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          </PhoneMenu>
        ) : null}
      </nav>
    </div>
  );
}
