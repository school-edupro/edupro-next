'use client';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/nav-icons';

export interface Action {
  href: string;
  label: string;
  section: string;
  sectionLabel: string;
  icon: IconName;
  /** a page outside EduPro: opens in a new tab */
  external?: boolean;
}

/**
 * The user's quick actions as tiles, and a search over every page the user may open (type a few letters:
 * "fee", "visitor", "roll"). Pinned actions come from the user, else the role, else the first pages.
 */
export function QuickActions({ pinned, all }: { pinned: Action[]; all: Action[] }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return all.filter((a) => `${a.label} ${a.sectionLabel}`.toLowerCase().includes(t)).slice(0, 12);
  }, [q, all]);
  const tiles = q.trim().length >= 2 ? hits : pinned;
  return (
    <div className="db-qa">
      <label className="db-qa__search">
        <span className="ep-sr-only">Search pages</span>
        <Icon name="search" size={16} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pages…"
          aria-label="Search pages"
        />
      </label>
      {tiles.length ? (
        <ul className="db-qa__grid">
          {tiles.map((a) => (
            <li key={a.href}>
              <a
                className="db-qa__tile"
                href={a.href}
                {...(a.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <span className="db-qa__icon" aria-hidden="true">
                  <Icon name={a.icon} size={20} />
                </span>
                <span className="db-qa__label">
                  {a.label}
                  {a.external ? <span className="ep-sr-only"> (opens in a new tab)</span> : null}
                </span>
                <span className="db-qa__section">{a.sectionLabel}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="db-empty">
          {q.trim().length >= 2 ? `No page matches “${q}”.` : 'No quick action yet.'}
        </p>
      )}
    </div>
  );
}
