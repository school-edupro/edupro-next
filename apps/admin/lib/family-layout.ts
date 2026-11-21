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
  /** The website's side menu and the app's More: the groups in order, every screen in exactly one. */
  menu?: FamilyMenuGroup[];
  /**
   * Screens hidden from families one by one (with those of hidden groups: left out everywhere for families — menu,
   * More, tabs, shortcuts, cards, Academics, Help). Rights (Access → Roles) still decide data.
   */
  hidden?: string[];
}

/** A group of the side menu: the school's name for it (null: the standard one) and its screens in order. */
export interface FamilyMenuGroup {
  key: string;
  label: string | null;
  labelHi: string | null;
  items: string[];
  /** The whole group hidden from families. */
  hidden?: boolean;
}

/**
 * The standard names of the side-menu groups (Home stays first and is not one). The API's catalogue does not send
 * them: keep alike with FAMILY_MENU's labels in packages/menus/src/family.ts (familyGroupLabel).
 */
export const MENU_GROUP_NAME: Record<FamilyAudience, Record<string, string>> = {
  parent: { child: 'My child', school: 'School', fees: 'Fees', help: 'Help desk' },
  student: { child: 'My school day', school: 'School', fees: 'Fees', help: 'Help desk' },
};

/** The longest name a menu group takes (LAYOUT_LIMITS.groupName in @edupro/menus). */
export const GROUP_NAME_MAX = 40;

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

const menuKey = (m: FamilyMenuGroup[] | undefined) =>
  (m ?? []).map((g) => [g.key, g.label ?? null, g.labelHi ?? null, g.items, g.hidden === true]);
/** The hidden screens in a fixed order (the order they were saved in does not matter). */
const hiddenKey = (h: string[] | undefined) => [...(h ?? [])].sort();

/** Two layouts are the same when their four lists, their side menu and what they hide are. */
export const sameLayout = (a: FamilyLayout, b: FamilyLayout) =>
  JSON.stringify([
    a.tabs,
    a.shortcuts,
    a.cards,
    a.academics,
    menuKey(a.menu),
    hiddenKey(a.hidden),
  ]) ===
  JSON.stringify([b.tabs, b.shortcuts, b.cards, b.academics, menuKey(b.menu), hiddenKey(b.hidden)]);

/**
 * The screens a layout hides from families: those hidden one by one and every screen of a hidden group (as
 * familyHiddenScreens in @edupro/menus).
 */
export function hiddenScreens(l: FamilyLayout): Set<string> {
  const hidden = new Set(l.hidden ?? []);
  for (const g of l.menu ?? []) if (g.hidden) g.items.forEach((h) => hidden.add(h));
  return hidden;
}

/**
 * The three tabs families get, as the API gives them (myFamilyLayout in @edupro/menus, rights left aside): the
 * school's tabs that are not hidden (Academics while its list has a screen shown), then the next shortcuts, then the
 * other screens, until there are three.
 */
export function shownTabs(l: FamilyLayout, screens: string[], hidden: Set<string>): string[] {
  const open = screens.filter((h) => !hidden.has(h));
  const academicsShown = l.academics.some((h) => !hidden.has(h));
  const tabs: string[] = [];
  for (const t of l.tabs) {
    const ok = t === ACADEMICS_TAB ? academicsShown : open.includes(t);
    if (ok && !tabs.includes(t)) tabs.push(t);
  }
  for (const h of [...l.shortcuts.filter((x) => !hidden.has(x)), ...open]) {
    if (tabs.length >= 3) break;
    if (!tabs.includes(h)) tabs.push(h);
  }
  return tabs;
}

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
  if (l.menu) {
    const keys = Object.keys(MENU_GROUP_NAME[audience]);
    const given = l.menu.map((g) => g.key);
    if (!distinct(given)) problems.push('A menu group is there twice.');
    for (const k of given) if (!keys.includes(k)) problems.push(`${k} is not a menu group.`);
    for (const k of keys) if (!given.includes(k)) problems.push(`The menu group ${k} is missing.`);
    const placed = l.menu.flatMap((g) => g.items);
    if (!distinct(placed)) problems.push('A screen is in the menu twice.');
    for (const h of placed) if (!screens.has(h)) problems.push(`${h} cannot be in the menu here.`);
    for (const h of screens)
      if (!placed.includes(h)) problems.push(`${h} is not in any menu group.`);
    for (const g of l.menu)
      for (const [name, v] of [
        ['name', g.label],
        ['Hindi name', g.labelHi],
      ] as const)
        if (v !== null && (v.trim().length < 1 || v.trim().length > GROUP_NAME_MAX))
          problems.push(`A menu group's ${name} takes 1 to ${String(GROUP_NAME_MAX)} letters.`);
  }
  if (l.hidden) {
    if (!distinct(l.hidden)) problems.push('A screen is hidden twice.');
    for (const h of l.hidden) if (!screens.has(h)) problems.push(`${h} cannot be hidden here.`);
  }
  return [...new Set(problems)];
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
