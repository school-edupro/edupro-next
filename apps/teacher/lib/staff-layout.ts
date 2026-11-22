import type { Me } from '@edupro/bff';
import { cache } from 'react';
import { bff } from '@/lib/bff';
import { t, type Lang } from '@/lib/i18n';
import { staffMenu, type StaffWaiting } from '@/lib/staff-menu';

/**
 * The staff layout a person gets (`GET /me/staff-layout`, docs/design/94): the tabs, the menu in the school's order
 * and names with hidden screens left out, and the counts behind the frame (unread, waiting work). Read once per page
 * load: the frame and the page share it (React `cache`).
 */
export interface StaffEntry {
  href: string;
  label: string;
  icon: string;
  /** A list tab's Hindi name the school gave. */
  labelHi?: string | null;
}

/** A list tab the person got (docs/design/94, part 3): its name and the screens they can open, in the school's order. */
export interface StaffListView {
  key: string;
  label: string;
  labelHi: string | null;
  icon: string;
  items: StaffEntry[];
}
export interface StaffLayoutView {
  tabs: StaffEntry[];
  shortcuts: StaffEntry[];
  screens: StaffEntry[];
  hidden: string[];
  menu: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    icon: string;
    items: StaffEntry[];
  }>;
  /** The list tabs the person got, in tab order. */
  lists: StaffListView[];
  /** never published: the menu and the phone bar as built */
  published: boolean;
  waiting: StaffWaiting;
  unread: number;
}

export const myStaffLayout = cache(async (): Promise<StaffLayoutView | null> =>
  bff.api.fetch<StaffLayoutView>('/me/staff-layout').catch(() => null),
);

/** A menu group as the website shows it: its name in the person's language, its screens (labels still English). */
export interface StaffMenuGroupView {
  id: string;
  label: string;
  icon: string;
  items: Array<{ href: string; label: string }>;
}

/**
 * The person's menu groups: the school's published layout (its order and names, hidden screens left out), else the
 * menu as built. The frame, the Home tiles and the Classes page read the same.
 */
export function staffGroups(
  me: Me,
  lang: Lang,
  layout: StaffLayoutView | null,
  waiting?: StaffWaiting,
): StaffMenuGroupView[] {
  if (layout?.published)
    return layout.menu.map((g) => ({
      id: g.key,
      // the school's Hindi name when it gave one; else the name through the dictionary
      label: lang === 'hi' && g.labelHi ? g.labelHi : t(lang, g.label),
      icon: g.icon,
      items: g.items.map((i) => ({ href: i.href, label: i.label })),
    }));
  return staffMenu(me, waiting).map((g) => ({
    id: g.id,
    label: t(lang, g.label),
    icon: g.icon,
    items: g.items.map((i) => ({ href: i.href, label: i.label })),
  }));
}
