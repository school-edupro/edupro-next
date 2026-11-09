/**
 * The staff app's screens, shared by both web apps (docs/design/83, "As built — Quick Actions for every
 * user"): every staff screen once — its group, what it is for, and the right it needs. The staff app's
 * sidebar, tab bar and home read it, and so does the admin home's "Teacher app" tab, so both show a
 * person only what their role opens (nothing greyed out). No server-only imports: either app may use it.
 */
export interface StaffItem {
  href: string;
  label: string;
  help: string;
  /** may this person open it (with what waits on them today) */
  allowed: (can: (p: string) => boolean, waiting: StaffWaiting) => boolean;
}
/** What waits on this person (from the home's counts; a screen with work waiting is always shown). */
export interface StaffWaiting {
  approvals: number;
  /** staff profile changes routed to me */
  profileChanges?: number;
  /** colleagues' exits waiting at my approval level */
  exits?: number;
  /** colleagues' no-dues waiting for a department I clear */
  noDues?: number;
  /** admission registrations at a level I am named in, and those I decided lately (docs/design/50) */
  admissions?: number;
  /** purchase indents waiting at my approval level, or a colleague's handed to me (docs/design/83) */
  purchase?: number;
  /** purchase requisitions at my level, and comparative statements for me to sign (the committee) */
  requisitions?: number;
  /** purchase orders and emergency purchases at my level */
  orders?: number;
  /** goods and services received, waiting for my inspection or signature (docs/design/84) */
  receipts?: number;
  /** what a store issued to my department, waiting for my acknowledgement */
  issues?: number;
  /** assets in my care, and those handed to me waiting for my acknowledgement */
  assets?: number;
  /** colleagues' leave and cancellations at my approval level (docs/design/85) */
  staffLeave?: number;
  /** colleagues' attendance corrections at my approval level (docs/design/85, phase C) */
  staffRegularisations?: number;
  /** leave & attendance reports the leave office gave me (docs/design/85, phase D) */
  leaveReports?: number;
  /** the staff who report to me (docs/design/85, "my reportees' attendance") */
  team?: number;
}
export interface StaffGroup {
  id: string;
  label: string;
  /** an icon name both apps draw (each app's components/nav-icons.tsx) */
  icon: string;
  items: StaffItem[];
}

const always = () => true;

export const STAFF_MENU: StaffGroup[] = [
  {
    id: 'classes',
    label: 'My classes',
    icon: 'book',
    items: [
      {
        href: '/timetable',
        label: 'Timetable',
        help: 'Your sections, subjects and this week’s timetable',
        allowed: (can) => can('academics.timetable.view'),
      },
      {
        href: '/attendance',
        label: 'Attendance',
        help: 'Mark today’s attendance for your sections',
        allowed: (can) => can('attendance.session.mark'),
      },
      {
        href: '/daily-work',
        label: 'Daily work',
        help: 'Post homework and classwork',
        allowed: (can) => can('academics.daily_work.post'),
      },
      {
        href: '/documents',
        label: 'Session plan, curriculum, date sheet',
        help: 'Upload class documents for parents and students',
        allowed: (can) => can('academics.daily_work.post'),
      },
      {
        href: '/syllabus',
        label: 'My syllabus',
        help: 'Chapters and topics of my classes; mark what is taught',
        allowed: (can) => can('academics.lesson_plan.manage'),
      },
      {
        href: '/lesson-plans',
        label: 'Lesson plans',
        help: 'Upload a lesson for approval; see where each one stands',
        allowed: (can) => can('academics.lesson_plan.manage'),
      },
      {
        href: '/marks',
        label: 'Marks',
        help: 'Enter exam marks for your subjects',
        allowed: (can) => can('exams.marks.enter'),
      },
      {
        href: '/verify-marks',
        label: 'Verify marks',
        help: "Check the marks your sections' teachers submitted",
        allowed: (can) => can('exams.marks.verify') || can('exams.remark.enter'),
      },
      {
        href: '/indicators',
        label: 'Indicators and progress card',
        help: 'Rate the indicators given to you (the class teacher: every one) and the progress card',
        allowed: (can) => can('exams.indicator.enter'),
      },
      {
        href: '/remarks',
        label: 'Remarks',
        help: 'Remarks by category: the class teacher every one, a subject teacher their subject’s, others those given to them',
        allowed: (can) => can('exams.remark.enter') || can('exams.marks.enter'),
      },
      {
        href: '/subject-choices',
        label: 'Subject choices',
        help: "Your section's students' subjects for the year",
        allowed: (can) => can('exams.marks.enter') || can('exams.choices.manage'),
      },
      {
        href: '/date-sheet',
        label: 'Exam date sheet',
        help: 'Papers of each exam for your classes',
        allowed: (can) => can('exams.marks.view'),
      },
      {
        href: '/health',
        label: 'Height and weight',
        help: 'Your section’s height and weight in each term exam',
        allowed: (can) => can('exams.health.enter'),
      },
      {
        href: '/exam-register?only=attendance',
        label: 'Exam attendance',
        help: 'Days present for each exam, or counted from daily attendance',
        allowed: (can) => can('exams.attendance.enter'),
      },
      {
        href: '/exam-register',
        label: 'Exam register',
        help: 'Remarks, exam attendance, height and weight',
        allowed: (can) => can('exams.remark.enter'),
      },
    ],
  },
  {
    id: 'care',
    label: 'Students and families',
    icon: 'users',
    items: [
      {
        href: '/leaves',
        label: 'Student leave',
        help: 'Approve the leave families applied for',
        allowed: (can) => can('attendance.leave.decide'),
      },
      {
        href: '/consent-approvals',
        label: 'Answers to approve',
        help: 'Consent form answers from families waiting for your decision',
        // class teachers, and anyone named as an approver who has answers waiting
        allowed: (can, w) => w.approvals > 0 || can('attendance.session.mark'),
      },
      {
        href: '/hostel',
        label: 'Hostel desk',
        help: 'Roll-call, leave to approve, pupils to hand over and pupils away',
        allowed: (can) => can('hostel.rollcall.mark') || can('hostel.leave.view'),
      },
      {
        href: '/bus-attendance',
        label: 'Bus attendance',
        help: 'Mark the morning and afternoon trip of your route',
        allowed: (can) => can('attendance.bus.mark'),
      },
      {
        href: '/gate-passes',
        label: 'Gate passes',
        help: 'Approve the passes that wait on you, and ask for your own',
        allowed: always,
      },
      {
        href: '/appointments',
        label: 'Appointments with me',
        help: 'Parents and visitors coming to meet you',
        allowed: always,
      },
    ],
  },
  {
    // every staff leave and attendance screen together (docs/design/85)
    id: 'leave',
    label: 'Leave & attendance',
    icon: 'calendar',
    items: [
      {
        href: '/my-leave',
        label: 'My leave',
        help: 'Apply for leave, see my balances, withdraw it or ask to cancel it',
        allowed: (can) => can('leave.own.apply'),
      },
      {
        href: '/leave-approvals',
        label: 'Leave to approve',
        help: 'Colleagues’ leave, and cancellations of their leave, waiting at your level',
        allowed: (_can, w) => (w.staffLeave ?? 0) > 0,
      },
      {
        href: '/my-attendance',
        label: 'My attendance',
        help: 'My days from the biometric punches; ask for a day to be corrected',
        allowed: (can) => can('leave.own.apply'),
      },
      {
        href: '/attendance-corrections',
        label: 'Attendance corrections to approve',
        help: 'Days colleagues say are wrong (a forgotten punch, a device that missed them), at your level',
        allowed: (_can, w) => (w.staffRegularisations ?? 0) > 0,
      },
      {
        href: '/my-team',
        label: 'My team’s attendance',
        help: 'The days of the staff who report to you',
        allowed: (_can, w) => (w.team ?? 0) > 0,
      },
      {
        href: '/leave-reports',
        label: 'Leave & attendance reports',
        help: 'The leave and attendance reports the leave office gave you, as Excel or PDF',
        allowed: (_can, w) => (w.leaveReports ?? 0) > 0,
      },
    ],
  },
  {
    id: 'office',
    label: 'Office',
    icon: 'file',
    items: [
      {
        href: '/messages',
        label: 'Messages',
        help: 'SMS, WhatsApp and email the school sent you',
        allowed: always,
      },
      {
        href: '/consents',
        label: 'Forms and declarations',
        help: 'Consent forms, surveys and declarations to answer',
        allowed: always,
      },
      {
        href: '/office-orders',
        label: 'Office orders',
        help: 'Orders and circulars the school issued for staff',
        allowed: (can) => can('academics.notice.view'),
      },
      {
        href: '/profile',
        label: 'My profile',
        help: 'My details as the school has them; update them, download as PDF',
        allowed: always,
      },
      {
        href: '/profile/approvals',
        label: 'Profile changes to approve',
        help: 'Changes colleagues asked for on their profile, routed to you',
        allowed: (_can, w) => (w.profileChanges ?? 0) > 0,
      },
      {
        href: '/resignation',
        label: 'My resignation',
        help: 'Ask for resignation, see where it is, withdraw it until it is accepted',
        allowed: always,
      },
      {
        href: '/admission-approvals',
        label: 'Admission approvals',
        help: 'Registrations waiting at your level of the admission process: decide with your remark',
        allowed: (_can, w) => (w.admissions ?? 0) > 0,
      },
      {
        href: '/exit-approvals',
        label: 'Exits to approve',
        help: 'Resignations of colleagues waiting for your decision',
        allowed: (_can, w) => (w.exits ?? 0) > 0,
      },
      {
        href: '/purchase',
        label: 'Purchase indents',
        help: 'Ask for what your department needs; decide the indents waiting for you',
        allowed: (can, w) => can('purchase.indent.raise') || (w.purchase ?? 0) > 0,
      },
      {
        href: '/purchase/requisitions',
        label: 'Purchase requisitions',
        help: 'Requisitions waiting for your approval; comparative statements to sign (the purchase committee)',
        allowed: (_can, w) => (w.requisitions ?? 0) > 0,
      },
      {
        href: '/purchase/orders',
        label: 'Purchase orders',
        help: 'Purchase orders waiting for your approval; emergency purchases to ratify',
        allowed: (_can, w) => (w.orders ?? 0) > 0,
      },
      {
        href: '/purchase/receipts',
        label: 'Goods received to inspect',
        help: 'Goods and services your department received: check them and accept or reject',
        allowed: (_can, w) => (w.receipts ?? 0) > 0,
      },
      {
        href: '/purchase/issues',
        label: 'Issued to my department',
        help: 'What the store issued to you or your department: confirm you received it; the slips',
        // there for whoever may raise an indent (docs/design/83): what was received earlier keeps its
        // slips; anyone else while something waits for them
        allowed: (can, w) => can('purchase.indent.raise') || (w.issues ?? 0) > 0,
      },
      {
        href: '/purchase/my-assets',
        label: 'Assets in my care',
        help: 'The school’s assets you keep; confirm the ones handed to you',
        allowed: (_can, w) => (w.assets ?? 0) > 0,
      },
      {
        href: '/purchase/my-stores',
        label: 'Stock in my stores',
        help: 'What the stores you keep hold: in hand, reserved, free and below the reorder level',
        allowed: (can) => can('purchase.store.operate'),
      },
      {
        href: '/no-dues',
        label: 'No-dues to clear',
        help: 'Colleagues leaving: clear for your department or note what they owe',
        allowed: (_can, w) => (w.noDues ?? 0) > 0,
      },
      {
        href: '/library',
        label: 'My library books',
        help: 'Books with me, when due, my reservations; find a book on the shelf',
        allowed: always,
      },
      {
        href: '/acr',
        label: 'My ACR',
        help: 'My annual confidential report, and the reports waiting on me',
        allowed: always,
      },
      {
        href: '/activity-log',
        label: 'My day (activity log)',
        help: 'What I did today, in time slots; submit before the cut-off',
        allowed: (can) => can('staff.activity.fill'),
      },
    ],
  },
  {
    id: 'help',
    label: 'Help desk',
    icon: 'message',
    items: [
      {
        href: '/queries',
        label: 'Queries and helpdesk',
        help: 'Family queries, your own queries and ERP tickets',
        allowed: (can) => can('engagement.query.respond') || can('helpdesk.ticket.raise'),
      },
      {
        href: '/assistant',
        label: 'Assistant',
        help: 'Ask about your sections in English, Hindi or Hinglish',
        allowed: (can) => can('insights.assistant.use'),
      },
      {
        href: '/help',
        label: 'Help',
        help: 'Answers to the common questions',
        allowed: always,
      },
    ],
  },
];

/** The groups with only what this person may open; empty groups dropped. */
export function staffScreens(
  permissions: readonly string[],
  waiting: StaffWaiting = { approvals: 0 },
): StaffGroup[] {
  const can = (p: string) => permissions.includes(p);
  return STAFF_MENU.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.allowed(can, waiting)),
  })).filter((g) => g.items.length > 0);
}

/**
 * A screen's own icon — a drawing both apps have (back, bed, bell, book, bus, calendar, cart, chart, check,
 * clipboard, file, grid, heart, home, inbox, key, message, search, settings, user, userPlus, users,
 * wallet) — else its group's.
 */
const SCREEN_ICON: Array<[string, string]> = [
  ['/timetable', 'calendar'],
  ['/attendance', 'check'],
  ['/daily-work', 'book'],
  ['/documents', 'file'],
  ['/syllabus', 'book'],
  ['/lesson-plans', 'book'],
  ['/verify-marks', 'check'],
  ['/marks', 'clipboard'],
  ['/indicators', 'chart'],
  ['/remarks', 'message'],
  ['/subject-choices', 'clipboard'],
  ['/exam-register', 'clipboard'],
  ['/date-sheet', 'calendar'],
  ['/bus-attendance', 'bus'],
  ['/hostel', 'bed'],
  ['/leaves', 'calendar'],
  ['/gate-passes', 'key'],
  ['/health', 'heart'],
  ['/library', 'book'],
  ['/messages', 'message'],
  ['/queries', 'inbox'],
  ['/appointments', 'calendar'],
  ['/purchase', 'cart'],
  ['/profile', 'user'],
  ['/my-leave', 'calendar'],
  ['/leave-approvals', 'check'],
  ['/my-attendance', 'clock'],
  ['/attendance-corrections', 'check'],
  ['/leave-reports', 'file'],
  ['/my-team', 'users'],
  ['/resignation', 'userPlus'],
  ['/acr', 'file'],
  ['/office-orders', 'file'],
  ['/activity-log', 'clipboard'],
  ['/consent-approvals', 'check'],
  ['/consents', 'check'],
  ['/admission-approvals', 'userPlus'],
  ['/exit-approvals', 'file'],
  ['/no-dues', 'wallet'],
  ['/acknowledgements', 'check'],
];
export function screenIcon(href: string, groupIcon: string) {
  return (
    SCREEN_ICON.find(
      ([p]) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`),
    )?.[1] ?? groupIcon
  );
}

/** The screens as quick-action tiles: label, what it is for, its group and its icon. */
export function staffTiles(permissions: readonly string[], waiting?: StaffWaiting) {
  return staffScreens(permissions, waiting).flatMap((g) =>
    g.items.map((i) => ({
      href: i.href,
      label: i.label,
      help: i.help,
      group: g.label,
      icon: screenIcon(i.href, g.icon),
    })),
  );
}
