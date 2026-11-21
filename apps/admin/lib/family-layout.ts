/**
 * The family app's layout kept by the school (0407, docs/design/90): what GET /platform/family-app-layout answers,
 * and the same checks the API makes (`checkFamilyLayout` in @edupro/menus), so the editor shows them as you edit.
 */

export type FamilyAudience = 'student' | 'parent';

export interface FamilyLayout {
  tabs: string[];
  shortcuts: string[];
  cards: string[];
  academics: string[];
}

export interface FamilyLayoutState {
  draft: FamilyLayout;
  published: FamilyLayout;
  everPublished: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  changed: boolean;
}

export interface FamilyScreen {
  href: string;
  label: string;
  icon: string;
}

export interface FamilyCard {
  key: string;
  label: string;
  labelHi: string;
  needs: string;
  parentOnly?: boolean;
}

export interface FamilyLayoutLimits {
  tabs: number;
  shortcuts: { min: number; max: number };
  cards: { min: number; max: number };
  academics: { min: number; max: number };
}

export interface FamilyLayoutSetup {
  layouts: Record<FamilyAudience, FamilyLayoutState>;
  catalogue: {
    screens: Record<FamilyAudience, FamilyScreen[]>;
    cards: FamilyCard[];
    limits: FamilyLayoutLimits;
    defaults: Record<FamilyAudience, FamilyLayout>;
  };
}

/** The tab that lists the Academics screens. */
export const ACADEMICS_TAB = 'academics';

export const AUDIENCE_NAME: Record<FamilyAudience, string> = {
  student: 'Students',
  parent: 'Parents',
};

/** Two layouts are the same when their four lists are. */
export const sameLayout = (a: FamilyLayout, b: FamilyLayout) =>
  JSON.stringify([a.tabs, a.shortcuts, a.cards, a.academics]) ===
  JSON.stringify([b.tabs, b.shortcuts, b.cards, b.academics]);

/** What is wrong with a layout (the API's own words); empty: it may be saved. */
export function layoutProblems(
  audience: FamilyAudience,
  l: FamilyLayout,
  setup: FamilyLayoutSetup['catalogue'],
): string[] {
  const screens = new Set(setup.screens[audience].map((s) => s.href));
  const cards = new Map(setup.cards.map((c) => [c.key, c]));
  const { limits } = setup;
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (l.tabs.length !== limits.tabs) problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  for (const t of l.tabs)
    if (t !== ACADEMICS_TAB && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  if (l.shortcuts.length < limits.shortcuts.min || l.shortcuts.length > limits.shortcuts.max)
    problems.push(
      `Choose ${String(limits.shortcuts.min)} to ${String(limits.shortcuts.max)} Home shortcuts.`,
    );
  if (!distinct(l.shortcuts)) problems.push('A shortcut is chosen twice.');
  for (const s of l.shortcuts)
    if (!screens.has(s)) problems.push(`${s} cannot be a shortcut here.`);
  if (l.cards.length < limits.cards.min) problems.push('Choose at least one Home card.');
  if (!distinct(l.cards)) problems.push('A card is chosen twice.');
  for (const c of l.cards) {
    const card = cards.get(c);
    if (!card) problems.push(`${c} is not a Home card.`);
    else if (card.parentOnly && audience === 'student')
      problems.push(`${card.label} is for parents.`);
  }
  if (!distinct(l.academics)) problems.push('A screen is in the Academics list twice.');
  if (l.academics.length > limits.academics.max)
    problems.push(`The Academics list takes at most ${String(limits.academics.max)} screens.`);
  for (const a of l.academics)
    if (!screens.has(a)) problems.push(`${a} cannot be in the Academics list here.`);
  if (l.tabs.includes(ACADEMICS_TAB) && l.academics.length < limits.academics.min)
    problems.push('With an Academics tab, its list needs at least two screens.');
  return problems;
}

/** "21 Nov 2026, 10:42" in India time. */
export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';
