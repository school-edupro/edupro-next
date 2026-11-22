/**
 * Staff app layout (0413, docs/design/94): the shapes of GET /platform/staff-app-layout and the editor's helpers. The
 * API checks again on save (`checkStaffLayout` in @edupro/menus — keep these alike).
 */

/** The app's Classes tab (my sections: homework, marks). */
export const CLASSES_TAB = 'classes';

export interface StaffMenuGroup {
  key: string;
  label: string | null;
  labelHi: string | null;
  items: string[];
  /** The whole group hidden from staff. */
  hidden?: boolean;
}

export interface StaffLayout {
  tabs: string[];
  shortcuts: string[];
  cards: string[];
  /** The staff website's side menu and the app's More (part 2): groups in order, renamed or not. */
  menu?: StaffMenuGroup[];
  /** Screens hidden from staff (left out of every menu; their pages still open from a link). */
  hidden?: string[];
}

export interface StaffLayoutSetup {
  draft: StaffLayout;
  published: StaffLayout;
  everPublished: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  changed: boolean;
  catalogue: {
    screens: Array<{ href: string; label: string; icon: string }>;
    cards: Array<{ key: string; label: string; labelHi: string; needs: string | null }>;
    /** The menu groups' standard names. */
    groups: Array<{ key: string; label: string }>;
    limits: {
      tabs: number;
      shortcuts: { min: number; max: number };
      cards: { min: number; max: number };
    };
    defaults: StaffLayout;
  };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const menuKey = (l: StaffLayout) =>
  JSON.stringify({
    menu: (l.menu ?? []).map((g) => ({
      key: g.key,
      label: g.label?.trim() || null,
      labelHi: g.labelHi?.trim() || null,
      items: g.items,
      hidden: g.hidden === true,
    })),
    hidden: l.hidden ?? [],
  });

export const sameStaffLayout = (a: StaffLayout, b: StaffLayout) =>
  sameList(a.tabs, b.tabs) &&
  sameList(a.shortcuts, b.shortcuts) &&
  sameList(a.cards, b.cards) &&
  menuKey(a) === menuKey(b);

/** The screens a draft hides from staff: one by one and with their groups. */
export function staffHidden(l: StaffLayout): Set<string> {
  const hidden = new Set(l.hidden ?? []);
  for (const g of l.menu ?? []) if (g.hidden) g.items.forEach((h) => hidden.add(h));
  return hidden;
}

/** The longest name a menu group takes (STAFF_LAYOUT_LIMITS.groupName in @edupro/menus). */
export const STAFF_GROUP_NAME_MAX = 40;

/** What is wrong before saving (the API's checks). */
export function staffLayoutProblems(l: StaffLayout, c: StaffLayoutSetup['catalogue']): string[] {
  const screens = new Set(c.screens.map((s) => s.href));
  const cards = new Set(c.cards.map((x) => x.key));
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (l.tabs.length !== c.limits.tabs) problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  for (const t of l.tabs)
    if (t !== CLASSES_TAB && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  if (l.shortcuts.length < c.limits.shortcuts.min || l.shortcuts.length > c.limits.shortcuts.max)
    problems.push('Choose 4 to 12 Home shortcuts.');
  if (!distinct(l.shortcuts)) problems.push('A shortcut is chosen twice.');
  if (l.cards.length < c.limits.cards.min) problems.push('Choose at least one Home card.');
  if (!distinct(l.cards)) problems.push('A card is chosen twice.');
  for (const k of l.cards) if (!cards.has(k)) problems.push(`${k} is not a Home card.`);
  for (const g of l.menu ?? [])
    for (const [name, v] of [
      ['name', g.label],
      ['Hindi name', g.labelHi],
    ] as const)
      if (v !== null && v.trim().length > STAFF_GROUP_NAME_MAX)
        problems.push(
          `A menu group's ${name} takes at most ${String(STAFF_GROUP_NAME_MAX)} letters.`,
        );
  return problems;
}
