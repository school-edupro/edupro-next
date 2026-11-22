import type { Audience } from '@edupro/menus';
import { cache } from 'react';
import type { IconName } from '@/components/nav-icons';
import { bff } from '@/lib/bff';

/**
 * The family app's layout kept by the school (docs/design/90) as the website's Home uses it: the Home shortcuts (the
 * person's own or the school's) and the Home cards in the school's order, the person's rights applied by the API.
 */
export interface LayoutEntry {
  href: string;
  label: string;
  icon: string;
  /** The Academics tab's Hindi name the school gave (docs/design/94, part 3). */
  labelHi?: string | null;
}
export interface HomeLayout {
  audience: Audience;
  shortcuts: LayoutEntry[];
  ownShortcuts: boolean;
  cards: Array<{ key: string; label: string; labelHi: string; href: string }>;
  /** Every screen the person may open (the choices of Edit shortcuts). */
  screens: LayoutEntry[];
  /** The school has published a layout (until then the website's Home stays as it was). */
  published: boolean;
  /** Home, the three the school chose (a screen or `academics`), `more`: the phone bar. */
  tabs: LayoutEntry[];
  /** The screens of the Academics tab (the website's /academics page). */
  academics: LayoutEntry[];
  /** The Academics tab's name (the school's, else Academics) and its Hindi name (null: the dictionary's). */
  academicsLabel?: string;
  academicsLabelHi?: string | null;
  /**
   * The side menu: the school's groups in its order with their names (`labelHi` only when the school gave one; else
   * the name goes through t()), each with the screens the person may open.
   */
  menu: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    icon: string;
    items: LayoutEntry[];
  }>;
  /** The screens the school hides from families (with those of hidden groups); the API leaves them out elsewhere. */
  hidden: string[];
}

/**
 * Does the school's published layout hide this page from families? A hidden screen hides the pages under it too
 * (`/hostel` → `/hostel/…`); Home never is. Nothing is hidden before the school publishes.
 */
export function isHidden(
  layout: Pick<HomeLayout, 'hidden' | 'published'> | null | undefined,
  path: string,
): boolean {
  if (!layout?.published) return false;
  const p = path.split('?')[0] ?? path;
  return (layout.hidden ?? []).some((h) => h !== '/' && (p === h || p.startsWith(`${h}/`)));
}

/** The layout for this parent or student; null when the API has none to give (Home then shows what it always did). */
export const homeLayout = cache((audience: Audience): Promise<HomeLayout | null> =>
  bff.api.fetch<HomeLayout>(`/me/app-layout?kind=${audience}`).catch(() => null),
);

const ICONS = new Set<string>([
  'home',
  'users',
  'userPlus',
  'wallet',
  'check',
  'inbox',
  'book',
  'key',
  'message',
  'heart',
  'clipboard',
  'bus',
  'chart',
  'file',
  'settings',
  'grid',
  'menu',
  'bell',
  'user',
  'search',
]);
/** The menu's icon names the website draws (calendar and bed have no drawing of their own here). */
const NEAREST: Record<string, IconName> = { calendar: 'clipboard', bed: 'home' };
export const iconOf = (name: string): IconName =>
  ICONS.has(name) ? (name as IconName) : (NEAREST[name] ?? 'grid');
