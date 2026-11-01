'use client';
import { Tabs } from '@edupro/ui';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/nav-icons';

export interface Action {
  href: string;
  label: string;
  section: string;
  sectionLabel: string;
  icon: IconName;
  /** a page outside the admin app (a school link, the teacher app): opens in a new tab */
  external?: boolean;
}

function Tiles({ tiles, empty }: { tiles: Action[]; empty: string }) {
  if (!tiles.length) return <p className="db-empty">{empty}</p>;
  return (
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
  );
}

/**
 * The user's quick actions as tiles, and a search over every page the user may open (type a few letters:
 * "fee", "visitor", "roll"). Pinned actions come from the user, else the role, else the first pages. The
 * teacher app's pages the user may use (marks, indicators, remarks, date sheet) sit on their own tab.
 */
export function QuickActions({
  pinned,
  all,
  teacher = [],
}: {
  pinned: Action[];
  all: Action[];
  teacher?: Action[];
}) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return [...all, ...teacher]
      .filter((a) => `${a.label} ${a.sectionLabel}`.toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, all, teacher]);
  const searching = q.trim().length >= 2;
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
      {searching ? (
        <Tiles tiles={hits} empty={`No page matches “${q}”.`} />
      ) : teacher.length ? (
        <Tabs
          ariaLabel="Quick actions"
          items={[
            {
              id: 'admin',
              label: 'Admin pages',
              content: <Tiles tiles={pinned} empty="No quick action yet." />,
            },
            {
              id: 'teacher',
              label: 'Teacher app',
              content: <Tiles tiles={teacher} empty="No teacher app page for your role." />,
            },
          ]}
        />
      ) : (
        <Tiles tiles={pinned} empty="No quick action yet." />
      )}
    </div>
  );
}
