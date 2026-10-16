/** Landing page (docs/design/26-admin-landing.md): the layout from the API and each widget's data from its module. */
import { apiFetch } from './api';
import { myApprovals, type ApprovalGroup } from './approvals';

export interface QuickItem {
  href: string;
  label?: string;
  icon?: string;
}

export interface Layout {
  role: string | null;
  roleName: string | null;
  widgets: Array<{ key: string; title: string; wide?: boolean; days?: number; count?: number }>;
  hidden: string[];
  available: Array<{ key: string; title: string }>;
  /** in order, with the school's own label and icon */
  quickActions: QuickItem[];
  /** the role's links to pages outside EduPro */
  links: QuickItem[];
  /** the school keeps the role's page as set */
  locked: boolean;
  personal: boolean;
}

/** A page outside EduPro (opens in a new tab). */
export const isExternal = (href: string) => href.startsWith('https://');

export interface Person {
  id: string;
  name: string;
  sub: string | null;
  section: string | null;
  photoFileId: string | null;
  days: number;
  wished: boolean;
}

export interface Principal {
  date: string;
  attendance: {
    strength: number;
    present: number;
    absent: number;
    pct: number | null;
    sections: number;
    markedSections: number;
    trend: Array<{ date: string; strength: number; present: number; pct: number | null }>;
  };
  fees: {
    dueTillDate: string;
    collectedTillDate: string;
    balance: string;
    collectedToday: string;
    collected7d: string;
    previous7d: string;
    byMode30d: Array<{ mode: string; amount: string; receipts: number }>;
    defaulters: Array<{
      studentId: string;
      name: string;
      admissionNo: string;
      section: string;
      balance: string;
      daysOverdue: number;
    }>;
    ageing: Array<{ bucket: string; balance: string; students: number }>;
  };
}

const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Everything the widgets of the layout need, each read once, a failing one left out. */
export async function loadWidgets(layout: Layout, permissions: string[]) {
  const keys = new Set(layout.widgets.map((w) => w.key));
  const has = (p: string) => permissions.includes(p);
  const need = (...k: string[]) => k.some((x) => keys.has(x));
  const setting = (k: string) => layout.widgets.find((w) => w.key === k);
  const [
    principal,
    desk,
    punch,
    notices,
    calendar,
    approvals,
    birthdaysStaff,
    birthdaysStudents,
    admissions,
    visitors,
    appointments,
    gatePasses,
    helpdesk,
    clinic,
    hostel,
    transport,
    library,
    cheques,
    refunds,
    feesOnly,
  ] = await Promise.all([
    need('today', 'attendance_trend', 'fees_today', 'fees_dues') && has('insights.dashboard.view')
      ? quiet(apiFetch<Principal>('/insights/principal'))
      : null,
    need('today', 'attendance_trend') &&
    (has('attendance.session.view') || has('attendance.session.mark'))
      ? quiet(
          apiFetch<{
            class: {
              strength: number;
              present: number;
              absent: number;
              percent: number | null;
              unmarked: number;
              sections: number;
              markedSections: number;
            };
            trend: Array<{ date: string; percent: number | null; present: number }>;
          }>('/attendance/desk/dashboard'),
        )
      : null,
    need('today', 'staff_attendance', 'attendance_trend') && has('attendance.punch.view')
      ? quiet(apiFetch<{ present: number; absent: number }>('/attendance/punch/summary'))
      : null,
    need('news')
      ? quiet(
          apiFetch<{
            data: Array<{
              id: string;
              kind: string;
              title: string;
              publishFrom: string;
              isPinned: boolean;
            }>;
          }>(
            `/academics/notices?status=published&size=${String(setting('news')?.count ?? 8)}`,
          ).then((r) => r.data),
        )
      : null,
    need('holidays')
      ? quiet(
          apiFetch<{
            holidays: Array<{
              id: string;
              name: string;
              kind: string;
              startsOn: string;
              endsOn: string;
            }>;
          }>(
            `/academics/calendar?from=${new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10)}`,
          ).then((r) => r.holidays.filter((h) => h.kind !== 'working_day')),
        )
      : null,
    need('approvals', 'today') ? quiet(myApprovals(permissions)) : null,
    need('birthdays_staff')
      ? quiet(
          apiFetch<{ today: Person[]; upcoming: Person[] }>(
            `/dashboard/w/birthdays_staff?days=${String(setting('birthdays_staff')?.days ?? 7)}`,
          ),
        )
      : null,
    need('birthdays_students')
      ? quiet(
          apiFetch<{ today: Person[]; upcoming: Person[] }>(
            `/dashboard/w/birthdays_students?days=${String(setting('birthdays_students')?.days ?? 7)}`,
          ),
        )
      : null,
    need('admissions')
      ? quiet(
          apiFetch<{ byStatus: Array<{ status: string; count: number }> }>('/admissions/dashboard'),
        )
      : null,
    need('front_office', 'today') && has('engagement.visitor.manage')
      ? quiet(
          apiFetch<{ counts: { inside: number; waiting: number; today: number } }>(
            '/visitors',
          ).then((r) => r.counts),
        )
      : null,
    need('front_office') && has('engagement.appointment.view')
      ? quiet(
          apiFetch<{
            today: {
              total: number;
              expected: number;
              inside: number;
              done: number;
              noShow: number;
            };
            waiting: number;
          }>('/appointments/dashboard'),
        )
      : null,
    need('front_office') && has('engagement.gate_pass.view')
      ? quiet(
          apiFetch<{
            counts: {
              approval: number;
              handover: number;
              gate: number;
              out: number;
              today: number;
            };
            overdue: number;
          }>('/gate-passes/dashboard'),
        )
      : null,
    need('helpdesk', 'today')
      ? quiet(
          apiFetch<{
            total: number;
            overdue: number;
            latest: Array<{ id: string; number: string; desk: string; subject: string }>;
          }>('/helpdesk/waiting'),
        )
      : null,
    need('clinic')
      ? quiet(
          apiFetch<{
            today: {
              visits: number;
              inClinic: number;
              sentHome: number;
              referred: number;
              thisMonth: number;
            };
          }>('/clinic/dashboard'),
        )
      : null,
    need('hostel')
      ? quiet(
          apiFetch<{
            boarders: number;
            away: number;
            overdue: number;
            toHandOver: number;
            waiting: number;
            rollsTaken: number;
            sessions: number;
            absentToday: number;
          }>('/hostel/today'),
        )
      : null,
    need('transport')
      ? quiet(
          apiFetch<{ pending: unknown[]; kpis: Record<string, unknown> }>(
            '/transport/desk/dashboard',
          ),
        )
      : null,
    need('library')
      ? quiet(
          apiFetch<{ page: { total: number } }>('/library/loans?status=overdue&size=1').then(
            (r) => r.page.total,
          ),
        )
      : null,
    need('fees_today', 'fees_dues') && has('fees.ledger.view')
      ? quiet(
          apiFetch<{ data: Array<{ amount: string; mode: string }> }>(
            '/fees/deposit-slips/pending',
          ).then((r) => r.data),
        )
      : null,
    need('fees_today') && (has('fees.refund.request') || has('fees.refund.approve'))
      ? quiet(
          apiFetch<{ page: { total: number } }>('/payments/refunds?status=requested&size=1').then(
            (r) => r.page.total,
          ),
        )
      : null,
    // without the insights right, the fee figures come from the landing page's own endpoint
    need('today', 'fees_today', 'fees_dues') &&
    !has('insights.dashboard.view') &&
    (has('fees.ledger.view') || has('fees.demand.view'))
      ? quiet(apiFetch<Principal['fees']>('/dashboard/w/fees_today'))
      : null,
  ]);
  return {
    today: today(),
    principal,
    fees: principal?.fees ?? feesOnly,
    desk,
    punch,
    notices,
    calendar,
    approvals: approvals as ApprovalGroup[] | null,
    birthdaysStaff,
    birthdaysStudents,
    admissions,
    visitors,
    appointments,
    gatePasses,
    helpdesk,
    clinic,
    hostel,
    transport,
    library,
    cheques,
    refunds,
  };
}
export type WidgetData = Awaited<ReturnType<typeof loadWidgets>>;
