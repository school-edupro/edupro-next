import { t, type Lang } from '@/lib/i18n';
import { Icon } from './nav-icons';

/**
 * Switch (docs/design/89, "Staff who are parents here"): on a family website session opened from the staff or admin
 * website, one header menu as the app's profile switcher — the staff and admin websites (signed in again with a
 * one-time link, /api/switch), and each child as Parent, the one shown ticked (the sibling switch).
 */
export function SwitchMenu({
  kids,
  current,
  back,
  lang,
}: {
  kids: Array<{ id: string; name: string; section: string | null }>;
  /** the child the pages show */
  current: string | null;
  /** where a child's pick comes back to (this page) */
  back: string;
  lang: Lang;
}) {
  return (
    <details className="ep-hmenu ep-hmenu--switch">
      <summary
        className="ep-header__icon-btn"
        aria-label={t(lang, 'Switch website')}
        title={t(lang, 'Switch website')}
      >
        <Icon name="switch" size={22} />
      </summary>
      <div className="ep-hmenu__panel">
        <p className="ep-hmenu__heading">{t(lang, 'Switch to')}</p>
        <ul className="ep-hmenu__list">
          {(['teacher', 'admin'] as const).map((to) => (
            <li key={to}>
              <form method="post" action="/api/switch">
                <input type="hidden" name="to" value={to} />
                <button type="submit" className="ep-hmenu__item">
                  <span>{t(lang, to === 'admin' ? 'Admin website' : 'Staff website')}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <ul className="ep-hmenu__list ep-hmenu__list--rule">
          {kids.map((k) => (
            <li key={k.id}>
              <a
                className="ep-hmenu__item"
                href={`/api/child?id=${k.id}&back=${back}`}
                aria-current={k.id === current ? 'true' : undefined}
              >
                <span>
                  <span className="ep-hmenu__title">
                    {t(lang, 'Parent')} · {k.name}
                  </span>
                  {k.section ? <span className="ep-hmenu__muted">{k.section}</span> : null}
                </span>
                {k.id === current ? <Icon name="check" size={16} /> : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
