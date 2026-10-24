import type { ReactNode } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { Icon, type IconName } from './nav-icons';
import { SidebarToggle } from './SidebarToggle';

/** The portal's menu; Home, the registrations and help are always there (docs/design/42). */
const MENU: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '', label: 'Home', icon: 'home' },
  { path: '#registrations', label: 'My registrations', icon: 'users' },
  { path: '#apply', label: 'Apply for a class', icon: 'userPlus' },
  { path: '#messages', label: 'Messages', icon: 'message' },
  { path: '/enquire', label: 'Help', icon: 'help' },
];
/** Phone tab bar: the screens a family opens most. */
const TABS = MENU.filter((m) => m.path !== '#registrations');

/**
 * The candidate portal's frame after sign-in, laid out like the parent portal (docs/design/42): a navy
 * sidebar "Admission Portal", a top bar (school, Hindi, messages, the family, sign out) and a tab bar on
 * phones. The shell styles are the shared ones (`ep-shell`, `ep-sidebar`, `ep-header`, `fp-*`).
 */
export function AdmissionShell({
  school,
  lang,
  currentPath,
  family,
  children,
}: {
  school: { code: string; name: string };
  lang: Lang;
  /** the page's path, to mark the menu and come back after a language switch */
  currentPath: string;
  /** the signed-in family: a name, else the mobile or email they signed in with */
  family: string;
  children: ReactNode;
}) {
  const base = `/${school.code}/admission`;
  const href = (path: string) => `${base}${path}`;
  const isCurrent = (path: string) =>
    path === '' ? currentPath === base : path.startsWith('/') && currentPath.startsWith(href(path));
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
            <b>{t(lang, 'Admission Portal')}</b>
          </span>
        </div>
        <nav className="ep-nav" aria-label={t(lang, 'Main menu')}>
          {MENU.map((m) => (
            <a
              key={m.label}
              className="ep-nav__link ep-nav__link--top"
              href={href(m.path)}
              aria-current={isCurrent(m.path) ? 'page' : undefined}
              title={t(lang, m.label)}
            >
              <Icon name={m.icon} />
              <span className="ep-nav__text">{t(lang, m.label)}</span>
            </a>
          ))}
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
            <span className="fp-context">
              <span className="fp-context__school">{school.name}</span>
              <span className="fp-context__year">{t(lang, 'Admissions')}</span>
            </span>
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
            className="ep-header__icon-btn"
            href={href('#messages')}
            aria-label={t(lang, 'Messages')}
            title={t(lang, 'Messages')}
          >
            <Icon name="message" size={22} />
          </a>
          <span className="ep-header__user" title={family}>
            <Icon name="user" size={20} />
            <span className="ep-header__user-name">{family}</span>
          </span>
          <form method="post" action="/api/admission/logout">
            <input type="hidden" name="school" value={school.code} />
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
      <div className="ep-main fp-content">{children}</div>
      <nav className="fp-tabbar" aria-label={t(lang, 'Quick menu')}>
        {TABS.map((m) => (
          <a
            key={m.label}
            href={href(m.path)}
            aria-current={isCurrent(m.path) ? 'page' : undefined}
          >
            <Icon name={m.icon} size={22} />
            <span>{t(lang, m.label === 'Apply for a class' ? 'Apply' : m.label)}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
