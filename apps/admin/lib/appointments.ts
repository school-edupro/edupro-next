/** Appointments v2 (0059): the shapes the screens share with the API, labels and small helpers. */
export type AppointmentState =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
export type AppointmentSource = 'parent' | 'public' | 'front_desk';
export type Ask = 'off' | 'optional' | 'required';

export interface Appointment {
  id: string;
  number: string;
  source: AppointmentSource;
  state: AppointmentState;
  purpose: string;
  hostId: string | null;
  hostName: string | null;
  hostKind: string | null;
  withName: string | null;
  place: string | null;
  startsAt: string | null;
  endsAt: string | null;
  preferredSlots: string[];
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  visitorName: string | null;
  visitorMobile: string | null;
  visitorEmail: string | null;
  visitorOrg: string | null;
  partySize: number;
  idProofKind: string | null;
  idProofLast4: string | null;
  passCode: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  rescheduleCount: number;
  previousStartsAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  hasPhoto: boolean;
}
export interface AppointmentDetail extends Appointment {
  passLink: string | null;
  passQr: string | null;
  events: Array<{
    kind: string;
    at: string;
    actor: string | null;
    detail: Record<string, unknown>;
  }>;
  you: { canDecide: boolean; canCheckIn: boolean };
}
export interface AppointmentList {
  data: Appointment[];
  page: { number: number; size: number; total: number };
  counts: { open: number; today: number; upcoming: number; inside: number };
}
export interface HostHours {
  weekday: number;
  starts: string;
  ends: string;
}
export interface BookableHost {
  id: string;
  name: string;
  kind: 'desk' | 'person' | 'class_teacher';
  person: string | null;
  location: string | null;
  slotMinutes: number;
  hours: HostHours[];
}
export interface Slot {
  time: string;
  startsAt: string;
  free: number;
  available: boolean;
}
export interface SlotList {
  closed: string | null;
  slots: Slot[];
}
export interface AppointmentSettings {
  publicEnabled: boolean;
  autoApprove: boolean;
  minNoticeHours: number;
  maxDaysAhead: number;
  maxParty: number;
  askOrganisation: Ask;
  askIdProof: Ask;
  askPhoto: Ask;
  idProofKinds: string[];
  purposes: string[];
  notifySms: boolean;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  reminderHours: number;
  noShowMinutes: number;
  closedDates: string[];
  instructions: string | null;
}
export interface SetupHost {
  id: string;
  name: string;
  kind: 'desk' | 'person' | 'class_teacher';
  employeeId: string | null;
  employeeName: string | null;
  location: string | null;
  openPublic: boolean;
  openParent: boolean;
  slotMinutes: number;
  capacity: number;
  sortOrder: number;
  status: string;
  used: number;
  hours: HostHours[];
}
export interface AppointmentSetup {
  settings: AppointmentSettings;
  hosts: SetupHost[];
  staff: Array<{ id: string; name: string }>;
  templates: Array<{
    code: string;
    channel: string;
    name: string;
    active: boolean;
    ready: boolean;
  }>;
  booking: { url: string; qr: string; school: string };
}
export interface AppointmentDashboard {
  today: { total: number; expected: number; inside: number; done: number; noShow: number };
  waiting: number;
  waitingLong: number;
  week: Array<{ day: string; confirmed: number; waiting: number }>;
  months: Array<{
    month: string;
    total: number;
    fromPublic: number;
    fromParent: number;
    fromDesk: number;
    confirmed: number;
    rejected: number;
    cancelled: number;
    completed: number;
    noShow: number;
    rescheduled: number;
    decideHours: number | null;
  }>;
  hosts: Array<{ name: string; total: number; noShow: number }>;
  purposes: Array<{ name: string; total: number }>;
}

export const STATE_LABEL: Record<AppointmentState, string> = {
  requested: 'Waiting',
  approved: 'Confirmed',
  rejected: 'Not confirmed',
  cancelled: 'Cancelled',
  checked_in: 'Arrived',
  completed: 'Completed',
  no_show: 'Did not come',
};
export const STATE_TONE: Record<
  AppointmentState,
  'warning' | 'success' | 'danger' | 'info' | 'neutral'
> = {
  requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  checked_in: 'info',
  completed: 'neutral',
  no_show: 'danger',
};
export const SOURCE_LABEL: Record<AppointmentSource, string> = {
  parent: 'Parent app',
  public: 'QR / outside',
  front_desk: 'Front desk',
};
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ASK_LABEL: Record<Ask, string> = {
  off: 'Do not ask',
  optional: 'Ask, optional',
  required: 'Must give',
};
export const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

const IST = 'Asia/Kolkata';
/** 05 Oct 2026, 09:30 am in school time. */
export const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: IST,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
export const timeOf = (v: string | null) =>
  v
    ? new Date(v).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' })
    : '';
/** The school day (YYYY-MM-DD) of a timestamp. */
export const dayOf = (v: string) =>
  new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const today = () => dayOf(new Date().toISOString());
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Mon, 05 Oct */
export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
/** The person behind the appointment: the visitor, or the pupil's guardian with the pupil. */
export const whoOf = (a: Appointment) =>
  [a.visitorName, a.student ? `for ${a.student}${a.section ? ` (${a.section})` : ''}` : null]
    .filter(Boolean)
    .join(' ') || 'Visitor';
/** Visiting hours on one line: Mon–Fri 09:30–12:30. */
export function hoursLine(hours: HostHours[]): string {
  const groups = new Map<string, number[]>();
  for (const h of hours) {
    const k = `${h.starts}–${h.ends}`;
    groups.set(k, [...(groups.get(k) ?? []), h.weekday]);
  }
  return (
    [...groups.entries()]
      .map(([time, days]) => {
        const d = [...new Set(days)].sort((a, b) => a - b);
        const run = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
        const label =
          d.length > 2 && run
            ? `${WEEKDAYS[d[0]! - 1]!}–${WEEKDAYS[d[d.length - 1]! - 1]!}`
            : d.map((x) => WEEKDAYS[x - 1]).join(', ');
        return `${label} ${time}`;
      })
      .join(' · ') || 'No visiting hours'
  );
}
