import type { Audience } from '@edupro/menus';
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
}

/** The layout for this parent or student; null when the API has none to give (Home then shows what it always did). */
export function homeLayout(audience: Audience): Promise<HomeLayout | null> {
  return bff.api.fetch<HomeLayout>(`/me/app-layout?kind=${audience}`).catch(() => null);
}

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
