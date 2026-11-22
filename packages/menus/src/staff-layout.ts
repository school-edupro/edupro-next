/**
 * The staff app's layout kept by the school (docs/design/94): the bottom tabs (Home, three chosen, More), the Home
 * shortcuts and the Home's work cards — one layout for the school's staff; each person gets what their rights (and the
 * work waiting on them) open, and may keep their own shortcuts. The catalogue, the layout a school starts with, the
 * checks and the layout a person gets live here for the API, admin and the app.
 */
import { STAFF_MENU, screenIcon, staffScreens, type StaffWaiting } from './staff';

/** The standard list tabs (docs/design/94, part 3): the app's Attendance and Classes tabs as they were. */
export const ATTENDANCE_LIST = 'attendance';
export const CLASSES_TAB = 'classes';

/**
 * A tab that lists screens the school chose (docs/design/94, part 3), as the families' Academics tab: its name (and
 * Hindi name), its screens in order; its icon is its first screen's. A person gets the tab when they can open its
 * first screen the school has not hidden; inside, only the screens they can open.
 */
export interface StaffListTab {
  /** What the tabs name it by: lower-case letters, digits and dashes (e.g. `attendance`, `list-3`). */
  key: string;
  label: string;
  /** null: the name goes through the apps' dictionary. */
  labelHi: string | null;
  items: string[];
}

export interface StaffLayout {
  /** The three tabs between Home and More: staff screens or list keys (`lists`). */
  tabs: string[];
  /** The Home shortcut tiles, in order (4 to 12). */
  shortcuts: string[];
  /** The Home cards under the shortcuts, in order (keys of STAFF_CARDS). */
  cards: string[];
  /**
   * The staff website's side menu and the app's More list (docs/design/94, part 2): the groups in order, each with the
   * school's name for it (null: the standard one) and its screens in order — every staff screen in exactly one
   * group. None: as built.
   */
  menu?: StaffMenuGroupLayout[];
  /**
   * Screens the school hides from staff (with those of hidden groups): left out of the menu, More, the tabs, the
   * shortcuts, the cards and the Home tiles. Their pages still open from a link (pending work is never stuck); rights
   * (Access → Roles) still decide what a person may do.
   */
  hidden?: string[];
  /** The list tabs the school keeps (up to five; the tabs choose among them). None: the two standard ones. */
  lists?: StaffListTab[];
}

export interface StaffMenuGroupLayout {
  /** A group of the staff menu (its id in STAFF_MENU; Home stays first and is not one). */
  key: string;
  label: string | null;
  labelHi: string | null;
  items: string[];
  /** The whole group hidden from staff (every screen in it). */
  hidden?: boolean;
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

/** The staff menu as built: the groups and their screens, with the standard names. */
export function defaultStaffMenu(): StaffMenuGroupLayout[] {
  return STAFF_MENU.map((g) => ({
    key: g.id,
    label: null,
    labelHi: null,
    hidden: false,
    items: g.items.map((i) => i.href),
  }));
}

/** The standard name of a staff menu group (e.g. My classes). */
export function staffGroupLabel(key: string): string {
  return STAFF_MENU.find((g) => g.id === key)?.label ?? key;
}

/**
 * A layout's staff menu made whole: the school's groups in its order (unknown ones dropped, missing ones added at the
 * end), each screen once (one the school's menu does not place — e.g. a new screen — goes into its standard group).
 */
export function staffMenuOf(l: Pick<StaffLayout, 'menu'>): StaffMenuGroupLayout[] {
  const screens = new Set(staffLayoutScreens().map((x) => x.href));
  const standard = defaultStaffMenu();
  if (!l.menu?.length) return standard;
  const known = new Set(standard.map((g) => g.key));
  const seen = new Set<string>();
  const groups: StaffMenuGroupLayout[] = [];
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

/** The screens a layout hides from staff: those hidden one by one and every screen of a hidden group. */
export function staffHiddenScreens(l: StaffLayout): Set<string> {
  const screens = new Set(staffLayoutScreens().map((x) => x.href));
  const hidden = new Set((l.hidden ?? []).filter((h) => screens.has(h)));
  for (const g of staffMenuOf(l)) if (g.hidden) g.items.forEach((h) => hidden.add(h));
  return hidden;
}

/** The list tabs every layout starts with: the app's Attendance and Classes tabs as they were. */
export function defaultStaffLists(): StaffListTab[] {
  return [
    {
      key: ATTENDANCE_LIST,
      label: 'Attendance',
      labelHi: 'उपस्थिति',
      items: ['/attendance', '/my-attendance', '/my-leave'],
    },
    {
      key: CLASSES_TAB,
      label: 'Classes',
      labelHi: 'कक्षाएँ',
      items: ['/daily-work', '/marks', '/timetable', '/my-payslips'],
    },
  ];
}

const LIST_KEY = /^[a-z][a-z0-9-]{1,23}$/;

/**
 * A layout's list tabs and tabs as they are read: a layout kept before lists has the two standard ones, and its tab
 * `/attendance` (which the app showed as the Attendance list) becomes that list.
 */
export function staffLayoutOf(l: StaffLayout): StaffLayout & { lists: StaffListTab[] } {
  if (l.lists) return { ...l, lists: l.lists };
  return {
    ...l,
    tabs: l.tabs.map((x) => (x === '/attendance' ? ATTENDANCE_LIST : x)),
    lists: defaultStaffLists(),
  };
}

/** The layout every school starts with: the app's tabs as they were, its work cards first, the common screens. */
export const DEFAULT_STAFF_LAYOUT: StaffLayout = {
  tabs: [ATTENDANCE_LIST, CLASSES_TAB, '/messages'],
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
  menu: defaultStaffMenu(),
  hidden: [],
  lists: defaultStaffLists(),
};

export const STAFF_LAYOUT_LIMITS = {
  tabs: 3,
  shortcuts: { min: 4, max: 12 },
  cards: { min: 1, max: STAFF_CARDS.length },
  groupName: 40,
  lists: { max: 5, items: { min: 1, max: 12 }, name: 20 },
} as const;

/** What is wrong with a staff layout (empty: it may be saved). */
export function checkStaffLayout(given: StaffLayout): string[] {
  const l = staffLayoutOf(given);
  const screens = new Set(staffLayoutScreens().map((s) => s.href));
  const problems: string[] = [];
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  const listKeys = new Set(l.lists.map((x) => x.key));
  if (l.tabs.length !== STAFF_LAYOUT_LIMITS.tabs)
    problems.push('Choose three tabs between Home and More.');
  if (!distinct(l.tabs)) problems.push('A tab is chosen twice.');
  for (const t of l.tabs)
    if (!listKeys.has(t) && !screens.has(t)) problems.push(`${t} cannot be a tab here.`);
  // two bottom tabs under one name (a list and a screen, say) would confuse staff
  const screenName = new Map(staffLayoutScreens().map((s) => [s.href, s.label]));
  const tabNames = l.tabs.map((t) =>
    (l.lists.find((x) => x.key === t)?.label ?? screenName.get(t) ?? t).trim(),
  );
  for (const [i, n] of tabNames.entries())
    if (n && tabNames.findIndex((m) => m.toLowerCase() === n.toLowerCase()) < i)
      problems.push(`Two bottom tabs are both named ${n}: rename the list or choose another tab.`);
  // the list tabs (part 3)
  const { lists: LL } = STAFF_LAYOUT_LIMITS;
  if (l.lists.length > LL.max) problems.push(`Keep at most ${String(LL.max)} tab lists.`);
  if (!distinct(l.lists.map((x) => x.key))) problems.push('Two tab lists have the same key.');
  if (!distinct(l.lists.map((x) => x.label.trim().toLowerCase())))
    problems.push('Two tab lists have the same name.');
  for (const x of l.lists) {
    const name = x.label.trim() || x.key;
    if (!LIST_KEY.test(x.key)) problems.push(`${x.key} cannot be a tab list's key.`);
    for (const [what, v] of [
      ['name', x.label],
      ['Hindi name', x.labelHi],
    ] as const)
      if (v !== null && (v.trim().length < 1 || v.trim().length > LL.name))
        problems.push(`A tab list's ${what} takes 1 to ${String(LL.name)} letters.`);
    if (x.items.length < LL.items.min || x.items.length > LL.items.max)
      problems.push(`The tab list ${name} takes 1 to ${String(LL.items.max)} screens.`);
    if (!distinct(x.items)) problems.push(`A screen is in the tab list ${name} twice.`);
    for (const h of x.items)
      if (!screens.has(h)) problems.push(`${h} cannot be in the tab list ${name}.`);
  }
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
  if (l.menu) {
    const keys = new Set(STAFF_MENU.map((g) => g.id));
    const given = l.menu.map((g) => g.key);
    if (!distinct(given)) problems.push('A menu group is there twice.');
    for (const k of given) if (!keys.has(k)) problems.push(`${k} is not a menu group.`);
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
        if (v !== null && (v.trim().length < 1 || v.trim().length > STAFF_LAYOUT_LIMITS.groupName))
          problems.push(
            `A menu group's ${name} takes 1 to ${String(STAFF_LAYOUT_LIMITS.groupName)} letters.`,
          );
  }
  if (l.hidden) {
    if (!distinct(l.hidden)) problems.push('A screen is hidden twice.');
    for (const h of l.hidden) if (!screens.has(h)) problems.push(`${h} cannot be hidden here.`);
  }
  return problems;
}

export interface StaffEntry {
  href: string;
  label: string;
  icon: string;
  /** A list tab's Hindi name the school gave (null or absent: through the dictionary). */
  labelHi?: string | null;
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
  /** The screens the school hides from staff (left out everywhere; their pages still open from a link). */
  hidden: string[];
  /**
   * The staff website's side menu and the app's More: the groups in the school's order with their names (`labelHi`
   * only when the school gave one), each with the screens the person may open; empty groups left out.
   */
  menu: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    icon: string;
    items: StaffEntry[];
  }>;
  /** The list tabs the person got (in tab order): each with the screens they can open, in the school's order. */
  lists: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    icon: string;
    items: StaffEntry[];
  }>;
}

/**
 * The layout a person gets: only what they can open (their rights and the work waiting on them); a tab they cannot
 * open gives its place to the next of the shortcuts (then the menu) that is not already a tab; their own shortcuts
 * when they kept any that they can still open.
 */
export function myStaffLayout(
  permissions: readonly string[],
  waiting: StaffWaiting,
  given: StaffLayout,
  own: string[] | null,
): MyStaffLayout {
  const layout = staffLayoutOf(given);
  // a screen the school hides is as one the person cannot open (its page still opens from a link)
  const hidden = staffHiddenScreens(layout);
  const open = staffScreens(permissions, waiting).flatMap((g) =>
    g.items
      .filter((i) => !hidden.has(i.href))
      .map((i) => ({ href: i.href, label: i.label, icon: screenIcon(i.href, g.icon) })),
  );
  const byHref = new Map(open.map((e) => [e.href, e]));
  const pick = (hrefs: string[]) =>
    hrefs.map((h) => byHref.get(h)).filter((e): e is StaffEntry => !!e);
  // a list tab: for those who can open its first screen the school shows; the screens they can open inside
  const lists: MyStaffLayout['lists'] = [];
  const listTab = (key: string): StaffEntry | null => {
    const x = layout.lists.find((y) => y.key === key);
    const lead = x?.items.find((h) => !hidden.has(h));
    const first = lead ? byHref.get(lead) : undefined;
    if (!x || !first) return null;
    lists.push({
      key: x.key,
      label: x.label,
      labelHi: x.labelHi,
      icon: first.icon,
      items: pick(x.items),
    });
    return { href: x.key, label: x.label, labelHi: x.labelHi, icon: first.icon };
  };
  const tabs: StaffEntry[] = [];
  for (const t of layout.tabs) {
    const e = t.startsWith('/') ? byHref.get(t) : listTab(t);
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
    hidden: [...hidden],
    menu: staffMenuOf(layout)
      .map((g) => ({
        key: g.key,
        label: g.label ?? staffGroupLabel(g.key),
        labelHi: g.labelHi,
        icon: STAFF_MENU.find((x) => x.id === g.key)?.icon ?? 'grid',
        items: pick(g.items),
      }))
      .filter((g) => g.items.length > 0),
    lists,
  };
}
