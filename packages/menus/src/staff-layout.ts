/**
 * The staff app's layout kept by the school (docs/design/94): the bottom tabs (Home, three chosen, More), the Home
 * shortcuts and the Home's work cards — one layout for the school's staff; each person gets what their rights (and the
 * work waiting on them) open, and may keep their own shortcuts. The catalogue, the layout a school starts with, the
 * checks and the layout a person gets live here for the API, admin and the app.
 */
import { STAFF_MENU, screenIcon, staffScreens, type StaffWaiting } from './staff';

/** The app's Classes tab (my sections: homework, marks), which is not a menu screen of its own. */
export const CLASSES_TAB = 'classes';

export interface StaffLayout {
  /** The three tabs between Home and More: staff screens or `classes`. */
  tabs: string[];
  /** The Home shortcut tiles, in order (4 to 12). */
  shortcuts: string[];
  /** The Home cards under the shortcuts, in order (keys of STAFF_CARDS). */
  cards: string[];
}

export interface StaffCard {
  key: string;
  label: string;
  labelHi: string;
  /** The screen the card is about: a person who cannot open it does not get the card (null: everyone). */
  needs: string | null;
}

/** The Home work cards a school may show, in the order a new card list offers them. */
export const STAFF_CARDS: readonly StaffCard[] = [
  { key: 'to_mark', label: 'Classes to mark', labelHi: 'उपस्थिति लगानी है', needs: '/attendance' },
  { key: 'periods_today', label: "Today's periods", labelHi: 'आज के पीरियड', needs: '/timetable' },
  { key: 'marks_to_enter', label: 'Marks to enter', labelHi: 'अंक भरने हैं', needs: '/marks' },
  { key: 'approvals', label: 'Approvals waiting', labelHi: 'प्रतीक्षारत स्वीकृतियाँ', needs: null },
  { key: 'my_leave', label: 'My leave', labelHi: 'मेरा अवकाश', needs: '/my-leave' },
  { key: 'notices', label: 'Latest messages', labelHi: 'नवीनतम संदेश', needs: '/messages' },
];
const CARD = new Map(STAFF_CARDS.map((c) => [c.key, c]));

/** Every staff screen a layout may name (whoever may open it), with its icon. */
export function staffLayoutScreens(): Array<{ href: string; label: string; icon: string }> {
  return STAFF_MENU.flatMap((g) =>
    g.items.map((i) => ({ href: i.href, label: i.label, icon: screenIcon(i.href, g.icon) })),
  );
}

/** The layout every school starts with: the app's tabs as they were, its work cards first, the common screens. */
export const DEFAULT_STAFF_LAYOUT: StaffLayout = {
  tabs: ['/attendance', CLASSES_TAB, '/messages'],
  shortcuts: [
    '/attendance',
    '/daily-work',
    '/marks',
    '/timetable',
    '/my-leave',
    '/my-attendance',
    '/leave-approvals',
    '/my-payslips',
    '/messages',
    '/queries',
    '/office-orders',
    '/help',
  ],
  cards: ['to_mark', 'periods_today', 'marks_to_enter', 'approvals', 'my_leave', 'notices'],
};

export const STAFF_LAYOUT_LIMITS = {
  tabs: 3,
  shortcuts: { min: 4, max: 12 },
  cards: { min: 1, max: STAFF_CARDS.length },
} as const;

/** What is wrong with a staff layout (empty: it may be saved). */
export function checkStaffLayout(l: StaffLayout): string[] {
  const screens = new Set(staffLayoutScreens().map((s) => s.href));
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (l.tabs.length !== STAFF_LAYOUT_LIMITS.tabs)
    problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  for (const t of l.tabs)
    if (t !== CLASSES_TAB && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  if (
    l.shortcuts.length < STAFF_LAYOUT_LIMITS.shortcuts.min ||
    l.shortcuts.length > STAFF_LAYOUT_LIMITS.shortcuts.max
  )
    problems.push('Choose 4 to 12 Home shortcuts.');
  if (!distinct(l.shortcuts)) problems.push('A shortcut is chosen twice.');
  for (const s of l.shortcuts)
    if (!screens.has(s)) problems.push(`${s} cannot be a shortcut here.`);
  if (l.cards.length < STAFF_LAYOUT_LIMITS.cards.min)
    problems.push('Choose at least one Home card.');
  if (!distinct(l.cards)) problems.push('A card is chosen twice.');
  for (const c of l.cards) if (!CARD.has(c)) problems.push(`${c} is not a Home card.`);
  return problems;
}

export interface StaffEntry {
  href: string;
  label: string;
  icon: string;
}
export interface MyStaffLayout {
  /** Home, the three, More — each with its name and icon. */
  tabs: StaffEntry[];
  shortcuts: StaffEntry[];
  /** Whether `shortcuts` are the person's own (not the school's). */
  ownShortcuts: boolean;
  cards: Array<{ key: string; label: string; labelHi: string; href: string | null }>;
  /** Every screen the person may open (the choices of "Edit shortcuts"). */
  screens: StaffEntry[];
}

/** Can a person use the Classes tab (their sections' homework and marks)? */
const classesOpen = (open: Set<string>) => open.has('/daily-work') || open.has('/marks');

/**
 * The layout a person gets: only what they can open (their rights and the work waiting on them); a tab they cannot
 * open gives its place to the next of the shortcuts (then the menu) that is not already a tab; their own shortcuts
 * when they kept any that they can still open.
 */
export function myStaffLayout(
  permissions: readonly string[],
  waiting: StaffWaiting,
  layout: StaffLayout,
  own: string[] | null,
): MyStaffLayout {
  const open = staffScreens(permissions, waiting).flatMap((g) =>
    g.items.map((i) => ({ href: i.href, label: i.label, icon: screenIcon(i.href, g.icon) })),
  );
  const byHref = new Map(open.map((e) => [e.href, e]));
  const pick = (hrefs: string[]) =>
    hrefs.map((h) => byHref.get(h)).filter((e): e is StaffEntry => !!e);
  const classes: StaffEntry | null = classesOpen(new Set(byHref.keys()))
    ? { href: CLASSES_TAB, label: 'Classes', icon: 'book' }
    : null;
  const tabs: StaffEntry[] = [];
  for (const t of layout.tabs) {
    const e = t === CLASSES_TAB ? classes : byHref.get(t);
    if (e && !tabs.some((x) => x.href === e.href)) tabs.push(e);
  }
  for (const e of [...pick(layout.shortcuts), ...open]) {
    if (tabs.length >= STAFF_LAYOUT_LIMITS.tabs) break;
    if (!tabs.some((x) => x.href === e.href)) tabs.push(e);
  }
  const mine = own ? pick(own) : [];
  const ownShortcuts = mine.length > 0;
  return {
    tabs: [
      { href: '/', label: 'Home', icon: 'home' },
      ...tabs,
      { href: 'more', label: 'More', icon: 'grid' },
    ],
    shortcuts: ownShortcuts ? mine : pick(layout.shortcuts),
    ownShortcuts,
    cards: layout.cards
      .map((k) => CARD.get(k))
      .filter((c): c is StaffCard => !!c && (c.needs === null || byHref.has(c.needs)))
      .map((c) => ({ key: c.key, label: c.label, labelHi: c.labelHi, href: c.needs })),
    screens: open,
  };
}
