import type { Me } from '@edupro/bff';
import { staffScreens, type StaffGroup, type StaffWaiting } from '@edupro/bff/staff-menu';
import type { IconName } from '@/components/nav-icons';

/**
 * The staff app's screens come from the shared menu (packages/bff/src/staff-menu.ts), which the admin
 * home's "Teacher app" tab reads too; here the person's own groups and the phone tab bar.
 */
export {
  STAFF_MENU,
  screenIcon,
  staffTiles,
  type StaffGroup,
  type StaffItem,
  type StaffWaiting,
} from '@edupro/bff/staff-menu';

/** The groups with only what this person may open; empty groups dropped. */
export function staffMenu(me: Me, waiting: StaffWaiting = { approvals: 0 }): StaffGroup[] {
  return staffScreens(me.permissions, waiting);
}

/** Phone tab bar: Home plus up to four of this person's most used screens, in this order. */
const TAB_ORDER: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/attendance', label: 'Attendance', icon: 'check' },
  { href: '/hostel', label: 'Hostel', icon: 'users' },
  { href: '/bus-attendance', label: 'Bus', icon: 'bus' },
  { href: '/daily-work', label: 'Daily work', icon: 'book' },
  { href: '/marks', label: 'Marks', icon: 'clipboard' },
  { href: '/gate-passes', label: 'Gate passes', icon: 'key' },
  { href: '/messages', label: 'Messages', icon: 'message' },
  { href: '/queries', label: 'Queries', icon: 'inbox' },
];

export function staffTabs(me: Me, waiting?: StaffWaiting) {
  const open = new Set(staffMenu(me, waiting).flatMap((g) => g.items.map((i) => i.href)));
  return [
    { href: '/', label: 'Home', icon: 'home' as IconName },
    ...TAB_ORDER.filter((t) => open.has(t.href)).slice(0, 4),
  ];
}
