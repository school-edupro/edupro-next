import type { ReactNode } from 'react';
import type { Me } from '@edupro/bff';
import { FAMILY_MENU, FAMILY_TABS, type Audience, type FamilyGroup } from '@edupro/menus';
import { t, type Lang } from '@/lib/i18n';
import { iconOf, isHidden, type HomeLayout } from '@/lib/home-layout';
import { canOpen } from '@/lib/portal-menu';
import { Icon, type IconName } from './nav-icons';
import { PhoneMenu } from './PhoneMenu';
import { SidebarToggle } from './SidebarToggle';
import { SwitchMenu } from './SwitchMenu';

export type { Audience };
const NAV = FAMILY_MENU as Array<Omit<FamilyGroup, 'icon'> & { icon: IconName }>;
const TABS = FAMILY_TABS as Record<
  Audience,
  Array<{ href: string; label: string; icon: IconName }>
>;

/** A student login (no guardian membership in the working school) gets the student menus and wording. */
export function audienceOf(me: Me): Audience {
  const here = me.memberships.filter((m) => !me.school || m.schoolId === me.school.id);
  return here.length > 0 && here.every((m) => m.personType === 'student') ? 'student' : 'parent';
}

/** The phone bar's short names (the bar has five narrow places). */
const SHORT: Record<string, string> = { '/fees': 'Fees', '/date-sheet': 'Date sheet' };

/** A menu group as the shell draws it: its name already in the page's language, its screens' English names. */
interface NavGroup {
  section: string;
  label: string;
  icon: IconName;
  items: Array<{ href: string; label: string }>;
}

/**
 * The parent and student portal frame, laid out like the admin portal (sidebar, header, content). With the school's
 * published layout (docs/design/90) the side menu and the phone bar follow it: the groups in its order and names, the
 * phone bar = the app's tabs with a Menu that opens the side menu; without one, as built.
 */
export function FamilyShell({
  me,
  lang,
  currentPath,
  children,
  unread = 0,
  layout = null,
  switcher = null,
}: {
  me: Me;
  lang: Lang;
  currentPath: string;
  children: ReactNode;
  /** messages from the school not opened yet (header badge) */
  unread?: number;
  /** The school's published layout for this person; null: the menu and the phone bar as built. */
  layout?: HomeLayout | null;
  /**
   * opened from the staff or admin website (Switch, 0425): the Switch menu — the staff and admin websites, and the
   * children (the one shown ticked)
   */
  switcher?: {
    kids: Array<{ id: string; name: string; section: string | null }>;
    current: string | null;
  } | null;
}) {
  const audience = audienceOf(me);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const groups: NavGroup[] = (
    layout
      ? [
          {
            section: 'home',
            label: t(lang, 'Home'),
            icon: 'home' as IconName,
            items: [{ href: '/', label: 'Home' }],
          },
          ...layout.menu.map((g) => ({
            section: g.key,
            label: lang === 'hi' && g.labelHi ? g.labelHi : t(lang, g.label),
            icon: iconOf(g.icon),
            items: g.items.filter((i) => canOpen(me, i.href)),
          })),
        ]
      : NAV.map((g) => ({
          section: g.section,
          label: t(lang, g.label[audience]),
          icon: g.icon,
          items: g.items.filter(
            (i) => (audience === 'parent' || !i.parentOnly) && canOpen(me, i.href),
          ),
        }))
  ).filter((g) => g.items.length > 0);
  // the phone bar: the app's tabs (Home, the three, then Menu) or as built
  const tabs: Array<{ href: string; label: string; icon: IconName }> = layout
    ? layout.tabs
        .filter((x) => x.href !== 'more')
        .map((x) =>
          x.href === '/'
            ? { href: '/', label: 'Home', icon: 'home' as IconName }
            : x.href === 'academics'
              ? {
                  href: '/academics',
                  // the school's name for it (docs/design/94, part 3); its Hindi name in Hindi
                  label: lang === 'hi' && x.labelHi ? x.labelHi : x.label,
                  icon: 'book' as IconName,
                }
              : { href: x.href, label: SHORT[x.href] ?? x.label, icon: iconOf(x.icon) },
        )
        .filter((x) => x.href === '/academics' || canOpen(me, x.href))
    : TABS[audience].filter((tab) => canOpen(me, tab.href));
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
            const label = g.label;
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
          {switcher ? (
            <SwitchMenu kids={switcher.kids} current={switcher.current} back={back} lang={lang} />
          ) : null}
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=${back}`}
            lang={lang === 'hi' ? 'en' : 'hi'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
          {isHidden(layout, '/messages') ? null : (
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
          )}
          {isHidden(layout, '/notices') ? null : (
            <a
              className="ep-header__icon-btn"
              href="/notices"
              aria-label={t(lang, 'Notices')}
              title={t(lang, 'Notices')}
            >
              <Icon name="bell" size={22} />
            </a>
          )}
          {isHidden(layout, '/profile') ? (
            <span className="ep-header__user" title={me.user.displayName}>
              <Icon name="user" size={20} />
              <span className="ep-header__user-name">{me.user.displayName}</span>
            </span>
          ) : (
            <a className="ep-header__user" href="/profile" title={me.user.displayName}>
              <Icon name="user" size={20} />
              <span className="ep-header__user-name">{me.user.displayName}</span>
            </a>
          )}
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
                <section key={g.section} aria-label={g.label}>
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
