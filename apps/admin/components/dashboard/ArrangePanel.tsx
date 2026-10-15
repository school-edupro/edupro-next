'use client';
import { useState } from 'react';
import { resetMyLayout, saveMyLayout } from '@/lib/dashboard-actions';

interface Item {
  key: string;
  title: string;
}

/**
 * "Arrange my page": move widgets up and down, hide or show them, and pick up to twelve quick actions.
 * Saved for this user only; "Back to the role's page" drops the user's own arrangement.
 */
export function ArrangePanel({
  shown,
  available,
  actions,
  pinned,
}: {
  shown: Item[];
  available: Item[];
  actions: Array<{ href: string; label: string; sectionLabel: string }>;
  pinned: string[];
}) {
  const [order, setOrder] = useState<Item[]>(() => [
    ...shown,
    ...available.filter((a) => !shown.some((s) => s.key === a.key)),
  ]);
  const [off, setOff] = useState<string[]>(() =>
    available.filter((a) => !shown.some((s) => s.key === a.key)).map((a) => a.key),
  );
  const [pins, setPins] = useState<string[]>(pinned);
  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const n = [...o];
      const j = i + d;
      if (j < 0 || j >= n.length) return o;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  return (
    <details className="db-arrange">
      <summary className="ep-btn ep-btn--ghost ep-btn--sm">Arrange my page</summary>
      <form action={saveMyLayout} className="db-arrange__body">
        <input type="hidden" name="widgets" value={order.map((o) => o.key).join(',')} />
        <input type="hidden" name="hidden" value={off.join(',')} />
        <input type="hidden" name="quickActions" value={pins.join(',')} />
        <fieldset className="db-arrange__set">
          <legend className="ep-field__label">Widgets (top to bottom)</legend>
          <ol className="db-arrange__list">
            {order.map((w, i) => (
              <li key={w.key} className="db-arrange__row">
                <label>
                  <input
                    type="checkbox"
                    checked={!off.includes(w.key)}
                    onChange={(e) =>
                      setOff((o) =>
                        e.target.checked ? o.filter((k) => k !== w.key) : [...o, w.key],
                      )
                    }
                  />{' '}
                  {w.title}
                </label>
                <span>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${w.title} up`}
                    disabled={i === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${w.title} down`}
                    disabled={i === order.length - 1}
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </fieldset>
        <fieldset className="db-arrange__set">
          <legend className="ep-field__label">Quick actions ({pins.length} of 12)</legend>
          <div className="db-arrange__pins">
            {actions.map((a) => (
              <label key={a.href} className="db-arrange__pin">
                <input
                  type="checkbox"
                  checked={pins.includes(a.href)}
                  disabled={!pins.includes(a.href) && pins.length >= 12}
                  onChange={(e) =>
                    setPins((p) =>
                      e.target.checked ? [...p, a.href] : p.filter((h) => h !== a.href),
                    )
                  }
                />{' '}
                {a.label} <small className="db-muted">{a.sectionLabel}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="db-arrange__actions">
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Save my page
          </button>
          <button
            type="submit"
            formAction={resetMyLayout}
            className="ep-btn ep-btn--ghost ep-btn--sm"
          >
            Back to the role’s page
          </button>
        </div>
      </form>
    </details>
  );
}
