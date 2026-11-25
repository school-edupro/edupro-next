import { t, type Lang } from '@/lib/i18n';
import { Icon } from './nav-icons';

/** A child of the signed-in staff member, as the family website shows them. */
export interface SwitchKid {
  id: string;
  name: string;
  detail: string | null;
}

/**
 * Switch (docs/design/89, "Staff who are parents here"): one header menu, as the app's profile switcher — this
 * website ticked, the admin website, and each child as Parent (the family website on that child). Each opens signed
 * in with a one-time link (/api/switch).
 */
export function SwitchMenu({ kids, lang }: { kids: SwitchKid[]; lang: Lang }) {
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
          <li>
            <span className="ep-hmenu__item" aria-current="true">
              <span>{t(lang, 'Staff website')}</span>
              <Icon name="check" size={16} />
            </span>
          </li>
          <li>
            <form method="post" action="/api/switch">
              <input type="hidden" name="to" value="admin" />
              <button type="submit" className="ep-hmenu__item">
                <span>{t(lang, 'Admin website')}</span>
              </button>
            </form>
          </li>
        </ul>
        <ul className="ep-hmenu__list ep-hmenu__list--rule">
          {kids.map((k) => (
            <li key={k.id}>
              <form method="post" action="/api/switch">
                <input type="hidden" name="to" value="parent" />
                <input type="hidden" name="child" value={k.id} />
                <button type="submit" className="ep-hmenu__item">
                  <span>
                    <span className="ep-hmenu__title">
                      {t(lang, 'Parent')} · {k.name}
                    </span>
                    {k.detail ? <span className="ep-hmenu__muted">{k.detail}</span> : null}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
