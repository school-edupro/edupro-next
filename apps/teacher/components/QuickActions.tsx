'use client';
import { Tabs } from '@edupro/ui';
import { useMemo, useState } from 'react';
import { Icon, isIconName } from '@/components/nav-icons';

export interface QuickTile {
  href: string;
  label: string;
  /** the screen's group, under the label */
  section: string;
  icon: string;
  /** the admin app: opens in a new tab */
  external?: boolean;
}

function Tiles({ tiles, empty }: { tiles: QuickTile[]; empty: string }) {
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
              <Icon name={isIconName(a.icon) ? a.icon : 'grid'} size={20} />
            </span>
            <span className="db-qa__label">
              {a.label}
              {a.external ? <span className="ep-sr-only"> (opens in a new tab)</span> : null}
            </span>
            <span className="db-qa__section">{a.section}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The staff app's Quick Actions (docs/design/83, "As built — Quick Actions for every user"): the screens
 * this person's role opens as icon tiles, and a search over them (type a few letters: "leave", "pass",
 * "indent"). Someone who also works in the admin app gets its tab. Labels come translated.
 */
export function QuickActions({
  tiles,
  admin = [],
  words,
}: {
  tiles: QuickTile[];
  admin?: QuickTile[];
  words: {
    search: string;
    staff: string;
    admin: string;
    none: string;
    noMatch: string;
  };
}) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return [...tiles, ...admin]
      .filter((a) => `${a.label} ${a.section}`.toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, tiles, admin]);
  const searching = q.trim().length >= 2;
  return (
    <div className="db-qa">
      <label className="db-qa__search">
        <span className="ep-sr-only">{words.search}</span>
        <Icon name="search" size={16} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`${words.search}…`}
          aria-label={words.search}
        />
      </label>
      {searching ? (
        <Tiles tiles={hits} empty={`${words.noMatch} “${q}”.`} />
      ) : admin.length ? (
        <Tabs
          ariaLabel="Quick actions"
          items={[
            {
              id: 'staff',
              label: words.staff,
              content: <Tiles tiles={tiles} empty={words.none} />,
            },
            {
              id: 'admin',
              label: words.admin,
              content: <Tiles tiles={admin} empty={words.none} />,
            },
          ]}
        />
      ) : (
        <Tiles tiles={tiles} empty={words.none} />
      )}
    </div>
  );
}
