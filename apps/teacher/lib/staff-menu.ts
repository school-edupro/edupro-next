import type { Me } from '@edupro/bff';
import type { IconName } from '@/components/nav-icons';

/**
 * Every staff screen once: its group, what it is for, and the right it needs. The sidebar, the phone tab
 * bar and the home all read this, so a warden, a driver or a teacher sees only what they may open
 * (nothing greyed out).
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
}
export interface StaffGroup {
  id: string;
  label: string;
  icon: IconName;
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
        help: 'Rate your section on the indicators and the progress card',
        allowed: (can) => can('exams.indicator.enter'),
      },
      {
        href: '/remarks',
        label: 'Remarks',
        help: 'Remarks by category for your sections (a subject teacher, their subject’s)',
        allowed: (can) => can('exams.remark.enter') || can('exams.marks.enter'),
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
export function staffMenu(me: Me, waiting: StaffWaiting = { approvals: 0 }): StaffGroup[] {
  const can = (p: string) => me.permissions.includes(p);
  return STAFF_MENU.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.allowed(can, waiting)),
  })).filter((g) => g.items.length > 0);
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
