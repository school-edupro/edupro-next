/**
 * Staff app layout (0413, docs/design/94): the shapes of GET /platform/staff-app-layout and the editor's helpers. The
 * API checks again on save (`checkStaffLayout` in @edupro/menus — keep these alike).
 */

/** The app's Classes tab (my sections: homework, marks). */
export const CLASSES_TAB = 'classes';

export interface StaffLayout {
  tabs: string[];
  shortcuts: string[];
  cards: string[];
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

export const sameStaffLayout = (a: StaffLayout, b: StaffLayout) =>
  sameList(a.tabs, b.tabs) && sameList(a.shortcuts, b.shortcuts) && sameList(a.cards, b.cards);

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
  return problems;
}
