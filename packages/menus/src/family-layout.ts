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
  },
};

export const LAYOUT_LIMITS = {
  tabs: 3,
  shortcuts: { min: 4, max: 12 },
  cards: { min: 1, max: FAMILY_CARDS.length },
  academics: { min: 2, max: 12 },
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
  return problems;
}

export interface FamilyEntry {
  href: string;
  label: string;
  icon: string;
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
  /** Every screen the person may open (the choices of "Edit shortcuts"). */
  screens: FamilyEntry[];
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
  const open = familyScreens(audience, permissions).flatMap((g) =>
    g.items
      .filter((i) => i.href !== '/')
      .map((i) => ({ href: i.href, label: i.label, icon: familyIcon(i.href, g.icon) })),
  );
  const byHref = new Map(open.map((e) => [e.href, e]));
  const entry = (h: string) => byHref.get(h);
  const pick = (hrefs: string[]) => hrefs.map(entry).filter((e): e is FamilyEntry => !!e);
  const academics = pick(layout.academics);
  const academicsTab: FamilyEntry | null =
    academics.length > 0 ? { href: ACADEMICS_TAB, label: 'Academics', icon: 'book' } : null;
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
    screens: open,
  };
}
