/**
 * The family app's layout kept by the school (docs/design/90): the bottom tabs (Home, three chosen, More), the Home
 * shortcuts, the Home cards and the Academics tab's list — one for students and one for parents. The catalogue, the
 * layout a school starts with (the app as it was), the checks, and the layout a person gets (their rights applied,
 * their own shortcuts) live here for the API, admin, the website and the app.
 */
import { FAMILY_MENU, familyIcon, familyScreens, type Audience } from './family';

/** A tab that lists the screens of the layout's Academics list. */
export const ACADEMICS_TAB = 'academics';

export interface FamilyLayout {
  /** The three tabs between Home and More: family screens or `academics`. */
  tabs: string[];
  /** The Home shortcut tiles, in order (4 to 12). */
  shortcuts: string[];
  /** The Home cards under the shortcuts, in order (keys of FAMILY_CARDS). */
  cards: string[];
  /** The screens the Academics tab lists, in order. */
  academics: string[];
  /** The Academics tab's name the school gave (docs/design/94, part 3); null or none: Academics. */
  academicsLabel?: string | null;
  /** Its Hindi name (null or none: the dictionary's). */
  academicsLabelHi?: string | null;
  /**
   * The website's side menu and the app's More list: the groups in order, each with the school's name for it (null:
   * the standard one) and its screens in order — every screen of the audience in exactly one group. None: as built.
   */
  menu?: FamilyMenuGroupLayout[];
  /**
   * Screens the school hides from families (with those of hidden groups): left out of the menu, More, the tabs, the
   * shortcuts, the cards, the Academics list, Edit shortcuts and Help; their web address says the school does not
   * offer them. Rights (Access → Roles) still decide what data a person may read.
   */
  hidden?: string[];
}

export interface FamilyMenuGroupLayout {
  /** A group of the family menu (its section in FAMILY_MENU; Home stays first and is not one). */
  key: string;
  label: string | null;
  labelHi: string | null;
  items: string[];
  /** The whole group hidden from families (every screen in it). */
  hidden?: boolean;
}

export interface FamilyCard {
  key: string;
  label: string;
  labelHi: string;
  /** The screen the card is about: a person who cannot open it does not get the card. */
  needs: string;
  /** Only parents get it (students have no such right in the app today). */
  parentOnly?: boolean;
}

/** The Home cards a school may show, in the order a new card list offers them. */
export const FAMILY_CARDS: readonly FamilyCard[] = [
  {
    key: 'attendance_today',
    label: 'Attendance today',
    labelHi: 'आज की उपस्थिति',
    needs: '/attendance',
  },
  { key: 'classes_today', label: "Today's classes", labelHi: 'आज की कक्षाएँ', needs: '/timetable' },
  { key: 'homework_due', label: 'Homework due', labelHi: 'बाकी गृहकार्य', needs: '/homework' },
  { key: 'next_exam', label: 'Next exam', labelHi: 'अगली परीक्षा', needs: '/date-sheet' },
  { key: 'notices', label: 'Latest notices', labelHi: 'नवीनतम सूचनाएँ', needs: '/notices' },
  {
    key: 'coming_up',
    label: 'Coming up (holidays and events)',
    labelHi: 'आगे (अवकाश और कार्यक्रम)',
    needs: '/calendar',
  },
  { key: 'fees_due', label: 'Fees due', labelHi: 'बकाया शुल्क', needs: '/fees' },
  { key: 'library', label: 'Library books', labelHi: 'पुस्तकालय की पुस्तकें', needs: '/library' },
];
const CARD = new Map(FAMILY_CARDS.map((c) => [c.key, c]));

/** The screens a layout may name for an audience: the family menu without Home (a student has no parent-only ones). */
export function familyLayoutScreens(
  audience: Audience,
): Array<{ href: string; label: string; icon: string }> {
  return FAMILY_MENU.flatMap((g) =>
    g.items
      .filter((i) => i.href !== '/' && (audience === 'parent' || !i.parentOnly))
      .map((i) => ({ href: i.href, label: i.label, icon: familyIcon(i.href, g.icon) })),
  );
}

/** The groups of the side menu a school may arrange (Home is always first and alone). */
const MENU_GROUPS = FAMILY_MENU.filter((g) => g.section !== 'home');

/** The side menu as built: the groups and their screens for an audience, with the standard names. */
export function defaultFamilyMenu(audience: Audience): FamilyMenuGroupLayout[] {
  return MENU_GROUPS.map((g) => ({
    key: g.section,
    label: null,
    labelHi: null,
    hidden: false,
    items: g.items.filter((i) => audience === 'parent' || !i.parentOnly).map((i) => i.href),
  }));
}

/**
 * A layout's side menu made whole: the school's groups in its order (unknown ones dropped, missing ones added at the
 * end), each screen once (one the school's menu does not place — e.g. a new screen — goes into its standard group).
 */
export function familyMenuOf(
  audience: Audience,
  l: Pick<FamilyLayout, 'menu'>,
): FamilyMenuGroupLayout[] {
  const screens = new Set(familyLayoutScreens(audience).map((x) => x.href));
  const standard = defaultFamilyMenu(audience);
  if (!l.menu?.length) return standard;
  const known = new Set(standard.map((g) => g.key));
  const seen = new Set<string>();
  const groups: FamilyMenuGroupLayout[] = [];
  for (const g of l.menu) {
    if (!known.has(g.key) || groups.some((x) => x.key === g.key)) continue;
    const items = g.items.filter((h) => screens.has(h) && !seen.has(h));
    items.forEach((h) => seen.add(h));
    groups.push({
      key: g.key,
      label: g.label ?? null,
      labelHi: g.labelHi ?? null,
      items,
      hidden: g.hidden === true,
    });
  }
  for (const g of standard)
    if (!groups.some((x) => x.key === g.key)) groups.push({ ...g, items: [], hidden: false });
  for (const g of standard)
    for (const h of g.items)
      if (!seen.has(h)) {
        groups.find((x) => x.key === g.key)!.items.push(h);
        seen.add(h);
      }
  return groups;
}

/** The screens a layout hides from families: those hidden one by one and every screen of a hidden group. */
export function familyHiddenScreens(audience: Audience, l: FamilyLayout): Set<string> {
  const screens = new Set(familyLayoutScreens(audience).map((x) => x.href));
  const hidden = new Set((l.hidden ?? []).filter((h) => screens.has(h)));
  for (const g of familyMenuOf(audience, l)) if (g.hidden) g.items.forEach((h) => hidden.add(h));
  return hidden;
}

/** The standard name of a menu group for an audience (e.g. My child / My school day). */
export function familyGroupLabel(audience: Audience, key: string): string {
  return FAMILY_MENU.find((g) => g.section === key)?.label[audience] ?? key;
}

/** The layout every school starts with: the app as it was before the school arranged it. */
export const DEFAULT_FAMILY_LAYOUT: Record<Audience, FamilyLayout> = {
  student: {
    tabs: ['/homework', '/timetable', '/results'],
    shortcuts: [
      '/attendance',
      '/homework',
      '/timetable',
      '/fees',
      '/calendar',
      '/date-sheet',
      '/notices',
      '/messages',
    ],
    cards: ['attendance_today', 'classes_today', 'homework_due', 'next_exam', 'notices'],
    academics: ['/attendance', '/homework', '/timetable', '/date-sheet', '/results', '/calendar'],
    menu: defaultFamilyMenu('student'),
  },
  parent: {
    tabs: [ACADEMICS_TAB, '/fees', '/messages'],
    shortcuts: [
      '/attendance',
      '/homework',
      '/timetable',
      '/results',
      '/calendar',
      '/date-sheet',
      '/notices',
      '/queries',
    ],
    cards: ['attendance_today', 'classes_today', 'homework_due', 'next_exam', 'notices'],
    academics: ['/attendance', '/homework', '/timetable', '/date-sheet', '/results', '/calendar'],
    menu: defaultFamilyMenu('parent'),
  },
};

export const LAYOUT_LIMITS = {
  tabs: 3,
  shortcuts: { min: 4, max: 12 },
  cards: { min: 1, max: FAMILY_CARDS.length },
  academics: { min: 2, max: 12 },
  groupName: 40,
  tabName: 20,
} as const;

/** What is wrong with a layout for an audience (empty: it may be saved). */
export function checkFamilyLayout(audience: Audience, l: FamilyLayout): string[] {
  const screens = new Set(familyLayoutScreens(audience).map((s) => s.href));
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (l.tabs.length !== LAYOUT_LIMITS.tabs)
    problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  for (const t of l.tabs)
    if (t !== ACADEMICS_TAB && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  if (
    l.shortcuts.length < LAYOUT_LIMITS.shortcuts.min ||
    l.shortcuts.length > LAYOUT_LIMITS.shortcuts.max
  )
    problems.push('Choose 4 to 12 Home shortcuts.');
  if (!distinct(l.shortcuts)) problems.push('A shortcut is chosen twice.');
  for (const s of l.shortcuts)
    if (!screens.has(s)) problems.push(`${s} cannot be a shortcut here.`);
  if (l.cards.length < LAYOUT_LIMITS.cards.min) problems.push('Choose at least one Home card.');
  if (!distinct(l.cards)) problems.push('A card is chosen twice.');
  for (const c of l.cards) {
    const card = CARD.get(c);
    if (!card) problems.push(`${c} is not a Home card.`);
    else if (card.parentOnly && audience === 'student')
      problems.push(`${card.label} is for parents.`);
  }
  if (!distinct(l.academics)) problems.push('A screen is in the Academics list twice.');
  if (l.academics.length > LAYOUT_LIMITS.academics.max)
    problems.push('The Academics list takes at most 12 screens.');
  for (const a of l.academics)
    if (!screens.has(a)) problems.push(`${a} cannot be in the Academics list here.`);
  if (l.tabs.includes(ACADEMICS_TAB) && l.academics.length < LAYOUT_LIMITS.academics.min)
    problems.push('With an Academics tab, its list needs at least two screens.');
  for (const [what, v] of [
    ['name', l.academicsLabel],
    ['Hindi name', l.academicsLabelHi],
  ] as const)
    if (v != null && (v.trim().length < 1 || v.trim().length > LAYOUT_LIMITS.tabName))
      problems.push(
        `The Academics tab's ${what} takes 1 to ${String(LAYOUT_LIMITS.tabName)} letters.`,
      );
  if (l.menu) {
    const keys = new Set(MENU_GROUPS.map((g) => g.section));
    const given = l.menu.map((g) => g.key);
    if (!distinct(given)) problems.push('A menu group is there twice.');
    for (const k of given) if (!keys.has(k)) problems.push(`${k} is not a menu group.`);
    for (const k of keys) if (!given.includes(k)) problems.push(`The menu group ${k} is missing.`);
    const placed = l.menu.flatMap((g) => g.items);
    if (!distinct(placed)) problems.push('A screen is in the menu twice.');
    for (const h of placed) if (!screens.has(h)) problems.push(`${h} cannot be in the menu here.`);
    for (const h of screens)
      if (!placed.includes(h)) problems.push(`${h} is not in any menu group.`);
    for (const g of l.menu) {
      for (const [name, v] of [
        ['name', g.label],
        ['Hindi name', g.labelHi],
      ] as const)
        if (v !== null && (v.trim().length < 1 || v.trim().length > LAYOUT_LIMITS.groupName))
          problems.push(`A menu group's ${name} takes 1 to ${LAYOUT_LIMITS.groupName} letters.`);
    }
  }
  if (l.hidden) {
    if (!distinct(l.hidden)) problems.push('A screen is hidden twice.');
    for (const h of l.hidden) if (!screens.has(h)) problems.push(`${h} cannot be hidden here.`);
  }
  return problems;
}

export interface FamilyEntry {
  href: string;
  label: string;
  icon: string;
  /** The Academics tab's Hindi name the school gave (null or absent: through the dictionary). */
  labelHi?: string | null;
}
export interface MyFamilyLayout {
  audience: Audience;
  /** Home, the three, More — each with its name and icon. */
  tabs: FamilyEntry[];
  shortcuts: FamilyEntry[];
  /** Whether `shortcuts` are the person's own (not the school's). */
  ownShortcuts: boolean;
  cards: Array<{ key: string; label: string; labelHi: string; href: string }>;
  academics: FamilyEntry[];
  /** The Academics tab's name (the school's, else Academics) and its Hindi name (null: the dictionary's). */
  academicsLabel: string;
  academicsLabelHi: string | null;
  /** Every screen the person may open (the choices of "Edit shortcuts"). */
  screens: FamilyEntry[];
  /** The screens the school hides from families (their web address says the school does not offer them). */
  hidden: string[];
  /**
   * The side menu (website) and More (app): the groups in the school's order with their names (`labelHi` only when
   * the school gave one; else put the standard name in Hindi), each with the screens the person may open.
   */
  menu: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    icon: string;
    items: FamilyEntry[];
  }>;
}

/**
 * The layout a person gets: only what they can open (the menu's rights); a tab they cannot open gives its place to
 * the next of the shortcuts (then the menu) that is not already a tab; their own shortcuts when they kept any that
 * they can still open.
 */
export function myFamilyLayout(
  audience: Audience,
  permissions: readonly string[],
  layout: FamilyLayout,
  own: string[] | null,
): MyFamilyLayout {
  // a screen the school hides is as one the person cannot open
  const hidden = familyHiddenScreens(audience, layout);
  const open = familyScreens(audience, permissions).flatMap((g) =>
    g.items
      .filter((i) => i.href !== '/' && !hidden.has(i.href))
      .map((i) => ({ href: i.href, label: i.label, icon: familyIcon(i.href, g.icon) })),
  );
  const byHref = new Map(open.map((e) => [e.href, e]));
  const entry = (h: string) => byHref.get(h);
  const pick = (hrefs: string[]) => hrefs.map(entry).filter((e): e is FamilyEntry => !!e);
  const academics = pick(layout.academics);
  const academicsLabel = layout.academicsLabel?.trim() || 'Academics';
  const academicsLabelHi = layout.academicsLabelHi?.trim() || null;
  const academicsTab: FamilyEntry | null =
    academics.length > 0
      ? { href: ACADEMICS_TAB, label: academicsLabel, labelHi: academicsLabelHi, icon: 'book' }
      : null;
  const tabs: FamilyEntry[] = [];
  for (const t of layout.tabs) {
    const e = t === ACADEMICS_TAB ? academicsTab : entry(t);
    if (e && !tabs.some((x) => x.href === e.href)) tabs.push(e);
  }
  for (const e of [...pick(layout.shortcuts), ...open]) {
    if (tabs.length >= LAYOUT_LIMITS.tabs) break;
    if (!tabs.some((x) => x.href === e.href)) tabs.push(e);
  }
  const mine = own ? pick(own) : [];
  const ownShortcuts = mine.length > 0;
  return {
    audience,
    tabs: [
      { href: '/', label: 'Home', icon: 'home' },
      ...tabs,
      { href: 'more', label: 'More', icon: 'grid' },
    ],
    shortcuts: ownShortcuts ? mine : pick(layout.shortcuts),
    ownShortcuts,
    cards: layout.cards
      .map((k) => CARD.get(k))
      .filter(
        (c): c is FamilyCard =>
          !!c && byHref.has(c.needs) && (!c.parentOnly || audience === 'parent'),
      )
      .map((c) => ({ key: c.key, label: c.label, labelHi: c.labelHi, href: c.needs })),
    academics,
    academicsLabel,
    academicsLabelHi,
    screens: open,
    hidden: [...hidden],
    menu: familyMenuOf(audience, layout)
      .map((g) => ({
        key: g.key,
        label: g.label ?? familyGroupLabel(audience, g.key),
        labelHi: g.labelHi,
        icon: FAMILY_MENU.find((x) => x.section === g.key)?.icon ?? 'grid',
        items: pick(g.items),
      }))
      .filter((g) => g.items.length > 0),
  };
}
