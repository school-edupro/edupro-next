/**
 * Staff app layout (0413, docs/design/94): the shapes of GET /platform/staff-app-layout and the editor's helpers. The
 * API checks again on save (`checkStaffLayout` in @edupro/menus — keep these alike).
 */

/**
 * A list tab (docs/design/94, part 3): its name (and Hindi name) and the screens it lists, as the families' Academics
 * tab; the bottom tabs name it by its key.
 */
export interface StaffListTab {
  key: string;
  label: string;
  labelHi: string | null;
  items: string[];
}

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
  /** The list tabs (part 3); the API gives every layout its lists (the two standard ones at first). */
  lists?: StaffListTab[];
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
      lists: { max: number; items: { min: number; max: number }; name: number };
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
    lists: (l.lists ?? []).map((x) => [x.key, x.label.trim(), x.labelHi?.trim() || null, x.items]),
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

/** A name for a new list tab: New list, New list 2… the first no list has. */
export function newListName(lists: StaffListTab[]): string {
  const taken = new Set(lists.map((x) => x.label.trim().toLowerCase()));
  let n = 1;
  while (taken.has((n === 1 ? 'New list' : `New list ${String(n)}`).toLowerCase())) n += 1;
  return n === 1 ? 'New list' : `New list ${String(n)}`;
}

/** A key for a new list tab the school makes: `list-1`, `list-2`… the first not taken. */
export function newListKey(lists: StaffListTab[]): string {
  const taken = new Set(lists.map((x) => x.key));
  let n = 1;
  while (taken.has(`list-${String(n)}`)) n += 1;
  return `list-${String(n)}`;
}

/**
 * The tabs staff get as far as the draft decides (rights aside): a hidden screen gives its place, a list shows when it
 * has a screen the school shows; the places go on to the shortcuts.
 */
export function staffShownTabs(l: StaffLayout, hidden: Set<string>): string[] {
  const lists = new Map((l.lists ?? []).map((x) => [x.key, x]));
  const tabs: string[] = [];
  for (const t of l.tabs) {
    const x = lists.get(t);
    const ok = x ? x.items.some((h) => !hidden.has(h)) : !hidden.has(t);
    if (ok && !tabs.includes(t)) tabs.push(t);
  }
  for (const h of l.shortcuts) {
    if (tabs.length >= 3) break;
    if (!hidden.has(h) && !tabs.includes(h)) tabs.push(h);
  }
  return tabs;
}

/** What is wrong before saving (the API's checks). */
export function staffLayoutProblems(l: StaffLayout, c: StaffLayoutSetup['catalogue']): string[] {
  const screens = new Set(c.screens.map((s) => s.href));
  const cards = new Set(c.cards.map((x) => x.key));
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (l.tabs.length !== c.limits.tabs) problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  const lists = l.lists ?? [];
  const listKeys = new Set(lists.map((x) => x.key));
  for (const t of l.tabs)
    if (!listKeys.has(t) && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  // two bottom tabs under one name (a list and a screen, say) would confuse staff
  const tabName = (t: string) =>
    (
      lists.find((x) => x.key === t)?.label ??
      c.screens.find((s) => s.href === t)?.label ??
      t
    ).trim();
  const tabNames = l.tabs.map(tabName);
  for (const [i, n] of tabNames.entries())
    if (n && tabNames.findIndex((m) => m.toLowerCase() === n.toLowerCase()) < i)
      problems.push(`Two bottom tabs are both named ${n}: rename the list or choose another tab.`);
  // the list tabs (part 3), as the API checks them
  const LL = c.limits.lists;
  if (lists.length > LL.max) problems.push(`Keep at most ${String(LL.max)} tab lists.`);
  if (!distinct(lists.map((x) => x.label.trim().toLowerCase())))
    problems.push('Two tab lists have the same name.');
  for (const x of lists) {
    const name = x.label.trim() || x.key;
    if (!x.label.trim()) problems.push('Every tab list needs a name.');
    for (const [what, v] of [
      ['name', x.label],
      ['Hindi name', x.labelHi],
    ] as const)
      if (v && v.trim().length > LL.name)
        problems.push(`A tab list's ${what} takes 1 to ${String(LL.name)} letters.`);
    if (x.items.length < LL.items.min || x.items.length > LL.items.max)
      problems.push(`The tab list ${name} takes 1 to ${String(LL.items.max)} screens.`);
  }
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
  // each once (two lists of one name would say the same thing twice)
  return [...new Set(problems)];
}
