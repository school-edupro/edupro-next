'use client';
import { useId, useMemo, useState } from 'react';

export interface SearchEntry {
  key: string;
  label: string;
  help: string;
  section: string;
  sectionTitle: string;
  value: string;
}

/** The settings page's search (docs/design/95): a setting by its name, help or value, opening its area at it. */
export function SettingsSearch({ entries }: { entries: SearchEntry[] }) {
  const id = useId();
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || q.trim().length < 2) return [];
    return entries
      .filter((e) => {
        const text = `${e.label} ${e.help} ${e.sectionTitle} ${e.value}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .slice(0, 12);
  }, [q, entries]);
  const searching = q.trim().length >= 2;
  return (
    <div className="ep-card" role="search" style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="ep-field" style={{ marginBottom: 0 }}>
        <label className="ep-field__label" htmlFor={id}>
          Find a setting
        </label>
        <input
          id={id}
          type="search"
          className="ep-input"
          style={{ width: '100%' }}
          placeholder="e.g. late fee, weekly off, session"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </div>
      {searching ? (
        hits.length ? (
          <ul
            aria-label="Settings found"
            style={{ listStyle: 'none', margin: 'var(--sp-3) 0 0', padding: 0, display: 'grid' }}
          >
            {hits.map((h) => (
              <li key={h.key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <a
                  href={`/system/settings/${h.section}#${anchorOf(h.key)}`}
                  style={{ display: 'block', padding: 'var(--sp-2) 0' }}
                >
                  <strong>{h.label}</strong>
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {h.sectionTitle} · now: {h.value}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" role="status" style={{ margin: 'var(--sp-2) 0 0' }}>
            No setting matches “{q.trim()}”.
          </p>
        )
      ) : null}
    </div>
  );
}

/** The id a setting's row has on its area's page. */
export const anchorOf = (key: string) => `set-${key.replace(/[^a-z0-9]+/gi, '-')}`;
