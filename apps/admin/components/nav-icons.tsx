/**
 * Line icons for the shell (24 px grid, 1.75 stroke, currentColor), one per navigation section plus
 * the header controls. Inline SVG keeps the shell a server component and avoids an icon dependency.
 */
const P = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  calendar:
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4',
  users:
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15 4.13a3.5 3.5 0 0 1 0 6.74',
  userPlus:
    'M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V5a2 2 0 0 1 2-2h11M16 14h5',
  check: 'M9 11.5l2 2 4-4.5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  inbox:
    'M3 13h5l1.5 3h5L16 13h5M3 13l2.2-7.3A1 1 0 0 1 6.2 5h11.6a1 1 0 0 1 1 .7L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13',
  key: 'M14 3a7 7 0 0 0-6.7 9.1L3 16.4V21h4.6l1-1.9h2.1v-2.1h2.1l1.5-1.5A7 7 0 1 0 14 3Zm2.5 5.5h.01',
  message: 'M4 5h16v11H9l-5 4V5Z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  clipboard: 'M9 4h6v3H9V4Zm-3 2h1v14h10V6h1M9 12h6M9 16h4',
  bus: 'M5 4h14a1 1 0 0 1 1 1v11H4V5a1 1 0 0 1 1-1Zm0 12v3h3v-3m8 0v3h3v-3M4 10h16M8 13h.01M16 13h.01',
  chart: 'M4 20V10m6 10V4m6 16v-7M2 20h20',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5H9l-.3 2.5a7.5 7.5 0 0 0-1.7 1L4.7 6.1l-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1L9 20.5h6l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1Z',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h6m-3-3v6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M9 12h10',
  chevron: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.5-4.5',
} as const;

export type IconName = keyof typeof P;

export const SECTION_ICON: Record<string, IconName> = {
  overview: 'home',
  people: 'users',
  admissions: 'userPlus',
  fees: 'wallet',
  attendance: 'check',
  workflow: 'inbox',
  academics: 'book',
  access: 'key',
  communication: 'message',
  engagement: 'heart',
  appointments: 'calendar',
  clinic: 'heart',
  exams: 'clipboard',
  transport: 'bus',
  library: 'book',
  insights: 'chart',
  reports: 'file',
  system: 'settings',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ep-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={P[name]} />
    </svg>
  );
}
