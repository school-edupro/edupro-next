import { Icon } from './nav-icons';

/** A child of the signed-in staff member, as the family website shows them. */
export interface SwitchKid {
  id: string;
  name: string;
  detail: string | null;
}

/**
 * Switch (docs/design/89, "Staff who are parents here"): one header menu, as the app's profile switcher — this
 * website ticked, the staff website, and each child as Parent (the family website on that child). Each opens signed
 * in with a one-time link (/api/switch).
 */
export function SwitchMenu({
  kids,
  words,
}: {
  kids: SwitchKid[];
  words: { switchWebsite: string; switchTo: string; admin: string; staff: string; parent: string };
}) {
  return (
    <details className="ep-hmenu ep-hmenu--switch">
      <summary
        className="ep-header__icon-btn"
        aria-label={words.switchWebsite}
        title={words.switchWebsite}
      >
        <Icon name="switch" size={21} />
      </summary>
      <div className="ep-hmenu__panel">
        <p className="ep-hmenu__heading">{words.switchTo}</p>
        <ul className="ep-hmenu__list">
          <li>
            <span className="ep-hmenu__item" aria-current="true">
              <span>{words.admin}</span>
              <Icon name="check" size={16} />
            </span>
          </li>
          <li>
            <form method="post" action="/api/switch">
              <input type="hidden" name="to" value="teacher" />
              <button type="submit" className="ep-hmenu__item">
                <span>{words.staff}</span>
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
                      {words.parent} · {k.name}
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
