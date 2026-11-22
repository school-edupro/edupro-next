/**
 * The parent and student portal's menu (docs/design/89): its groups, the phone tab bar, and the right each
 * screen needs. The parent web app, the API (the mobile app's menu) and so the mobile app read it here.
 */

export type Audience = 'parent' | 'student';

export interface FamilyItem {
  href: string;
  label: string;
  /** Family-only items (payments, consents, meetings, leave) are hidden from student logins. */
  parentOnly?: boolean;
}
export interface FamilyGroup {
  section: string;
  label: { parent: string; student: string };
  /** an icon name the apps draw */
  icon: string;
  items: FamilyItem[];
}

export const FAMILY_MENU: FamilyGroup[] = [
  {
    section: 'home',
    label: { parent: 'Home', student: 'Home' },
    icon: 'home',
    items: [{ href: '/', label: 'Home' }],
  },
  {
    section: 'child',
    label: { parent: 'My child', student: 'My school day' },
    icon: 'users',
    items: [
      { href: '/profile', label: 'Profile' },
      { href: '/attendance', label: 'Attendance' },
      { href: '/timetable', label: 'Timetable' },
      { href: '/teachers', label: 'My teachers' },
      { href: '/homework', label: 'Daily work' },
      { href: '/documents', label: 'Session plan and date sheets' },
      { href: '/results', label: 'Results' },
      { href: '/date-sheet', label: 'Exam date sheet' },
      { href: '/health', label: 'Health' },
      { href: '/certificates', label: 'Certificates' },
    ],
  },
  {
    section: 'school',
    label: { parent: 'School', student: 'School' },
    icon: 'book',
    items: [
      { href: '/messages', label: 'Messages' },
      { href: '/notices', label: 'Notices' },
      { href: '/calendar', label: 'Calendar' },
      { href: '/directory', label: 'School directory' },
      { href: '/transport', label: 'School bus' },
      { href: '/hostel', label: 'Hostel' },
      { href: '/library', label: 'Library' },
    ],
  },
  {
    section: 'fees',
    label: { parent: 'Fees', student: 'Fees' },
    icon: 'wallet',
    // students see their own fees too, view only (19 Nov 2026): paying stays with the parent's right
    items: [{ href: '/fees', label: 'Dues and receipts' }],
  },
  {
    section: 'help',
    label: { parent: 'Help desk', student: 'Help desk' },
    icon: 'message',
    items: [
      { href: '/queries', label: 'Queries', parentOnly: true },
      { href: '/appointments', label: 'Appointments', parentOnly: true },
      { href: '/gate-passes', label: 'Gate passes', parentOnly: true },
      { href: '/consents', label: 'Consent forms', parentOnly: true },
      { href: '/assistant', label: 'Assistant' },
      { href: '/help', label: 'Help' },
    ],
  },
];

/** Phone tab bar: the four screens families open most, plus Home. */
export const FAMILY_TABS: Record<Audience, Array<{ href: string; label: string; icon: string }>> = {
  parent: [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/attendance', label: 'Attendance', icon: 'check' },
    { href: '/homework', label: 'Daily work', icon: 'book' },
    { href: '/fees', label: 'Fees', icon: 'wallet' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  student: [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/attendance', label: 'Attendance', icon: 'check' },
    { href: '/homework', label: 'Daily work', icon: 'book' },
    { href: '/results', label: 'Results', icon: 'clipboard' },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
};

/**
 * The right each portal screen needs. The school decides what a login may open through its roles
 * (a withdrawn pupil's "Former student / parent" role keeps only a few), so the menu, the phone tab bar
 * and the home tiles all ask here. Screens not listed are open to every signed-in family.
 */
export const FAMILY_NEEDS: Record<string, string> = {
  '/profile': 'engagement.family.view',
  '/attendance': 'attendance.session.view',
  '/timetable': 'academics.timetable.view',
  '/teachers': 'academics.daily_work.view',
  '/homework': 'academics.daily_work.view',
  '/documents': 'academics.daily_work.view',
  '/results': 'exams.family.view',
  '/date-sheet': 'exams.family.view',
  '/health': 'engagement.family.view',
  '/certificates': 'engagement.family.view',
  '/notices': 'academics.notice.view',
  '/calendar': 'academics.calendar.view',
  '/directory': 'academics.daily_work.view',
  '/transport': 'transport.request.view',
  '/library': 'library.family.view',
  '/fees': 'fees.family.view',
  '/queries': 'engagement.query.create',
  '/appointments': 'engagement.family.view',
  '/gate-passes': 'engagement.family.view',
  '/consents': 'engagement.family.view',
  '/assistant': 'insights.assistant.use',
};

/** May a family member with these rights open the screen? */
export function familyCanOpen(permissions: readonly string[], href: string): boolean {
  const need = FAMILY_NEEDS[href];
  return !need || permissions.includes(need);
}

/** The groups with only what this parent or student may open; empty groups dropped. */
export function familyScreens(audience: Audience, permissions: readonly string[]): FamilyGroup[] {
  return FAMILY_MENU.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => (audience === 'parent' || !i.parentOnly) && familyCanOpen(permissions, i.href),
    ),
  })).filter((g) => g.items.length > 0);
}

/** A portal screen's own icon (the names the apps draw), else its group's. */
const FAMILY_ICON: Record<string, string> = {
  '/profile': 'user',
  '/attendance': 'check',
  '/timetable': 'calendar',
  '/teachers': 'users',
  '/homework': 'book',
  '/documents': 'file',
  '/results': 'chart',
  '/date-sheet': 'calendar',
  '/health': 'heart',
  '/certificates': 'file',
  '/messages': 'message',
  '/notices': 'bell',
  '/calendar': 'calendar',
  '/directory': 'search',
  '/transport': 'bus',
  '/hostel': 'bed',
  '/library': 'book',
  '/fees': 'wallet',
  '/queries': 'inbox',
  '/appointments': 'calendar',
  '/gate-passes': 'key',
  '/consents': 'check',
  '/assistant': 'message',
  '/help': 'search',
};
export function familyIcon(href: string, groupIcon: string): string {
  return FAMILY_ICON[href] ?? groupIcon;
}
