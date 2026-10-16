import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { QuickActions, type Action } from '@/components/dashboard/QuickActions';
import { Widget, renderWidget } from '@/components/dashboard/Widgets';
import { SECTION_ICON, isIconName } from '@/components/nav-icons';
import { isExternal, type Layout, type WidgetData } from '@/lib/dashboard';
import { NAV_ITEMS } from '@/lib/nav';

const initials = (name: string) =>
  name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

/** Every page of the menu the permissions open, as quick-action tiles. */
export async function menuActions(permissions: string[]): Promise<Action[]> {
  const nav = await getTranslations('nav');
  const allowed = new Set(permissions);
  return NAV_ITEMS.filter(
    (i) => i.href !== '/' && (i.permission === null || allowed.has(i.permission)),
  ).map((i) => ({
    href: i.href,
    label: nav(i.label),
    section: i.section,
    sectionLabel: nav(i.section),
    icon: SECTION_ICON[i.section] ?? 'grid',
  }));
}

/**
 * The tiles of the quick menu in the school's order with its labels and icons; a page the user may not
 * open is left out. No quick action set: the first eight pages of the user's menu.
 */
export function pinnedActions(layout: Layout, all: Action[]): Action[] {
  if (!layout.quickActions.length) return all.slice(0, 8);
  const byHref = new Map(all.map((a) => [a.href, a]));
  return layout.quickActions.flatMap((q): Action[] => {
    if (isExternal(q.href))
      return [
        {
          href: q.href,
          label: q.label ?? q.href,
          section: 'links',
          sectionLabel: 'School link',
          icon: isIconName(q.icon) ? q.icon : 'link',
          external: true,
        },
      ];
    const a = byHref.get(q.href);
    if (!a) return [];
    return [{ ...a, label: q.label || a.label, icon: isIconName(q.icon) ? q.icon : a.icon }];
  });
}

/**
 * The landing page body (docs/design/26-admin-landing.md): a light band with the greeting (the sidebar is
 * the one dark surface), then the widgets of the layout. Used for the user's own page and the preview.
 */
export function LandingView({
  kicker,
  title,
  sub,
  aside,
  notice,
  layout,
  data,
  permissions,
  actions,
  pinned,
  profile,
}: {
  kicker: string;
  title: string;
  sub: string;
  aside?: ReactNode;
  notice?: ReactNode;
  layout: Layout;
  data: WidgetData;
  permissions: string[];
  actions: Action[];
  pinned: Action[];
  profile: { name: string; role: string; school: string };
}) {
  return (
    <>
      <section className="db-hero">
        <div>
          <p className="ep-kicker">{kicker}</p>
          <h1 className="db-hero__title">{title}</h1>
          <p className="db-hero__sub">{sub}</p>
        </div>
        {aside ? <div className="db-hero__aside">{aside}</div> : null}
      </section>
      {notice}
      <div className="db-grid">
        {layout.widgets.map((w) => {
          const cls = w.wide ? 'db-cell db-cell--wide' : 'db-cell';
          if (w.key === 'profile')
            return (
              <div key={w.key} className={cls}>
                <Widget title={w.title} icon="user">
                  <div className="db-profile">
                    <span className="db-avatar db-avatar--lg" aria-hidden="true">
                      {initials(profile.name)}
                    </span>
                    <div>
                      <strong>{profile.name}</strong>
                      <span className="db-muted db-block">{profile.role}</span>
                      <span className="db-muted db-block">{profile.school}</span>
                    </div>
                  </div>
                </Widget>
              </div>
            );
          if (w.key === 'quick_actions')
            return (
              <div key={w.key} className={cls}>
                <Widget title={w.title} icon="grid">
                  <QuickActions pinned={pinned} all={actions} />
                </Widget>
              </div>
            );
          const node = renderWidget(w.key, w.title, data, {
            permissions,
            wide: w.wide,
            days: w.days,
            count: w.count,
          });
          return node ? (
            <div key={w.key} className={cls}>
              {node}
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}
