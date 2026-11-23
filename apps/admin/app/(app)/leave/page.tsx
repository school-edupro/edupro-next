import {
  Breadcrumbs,
  LEAVE_TABS,
  LeaveBalanceSection,
  LeaveTabsNav,
  MyAttendanceTab,
  PageHeader,
  type LeaveTab,
} from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { MyLeaveTab } from '@/components/leave/MyLeaveTab';
import { TeamAttendanceTab } from '@/components/leave/TeamAttendanceTab';
import { TeamLeaveTab } from '@/components/leave/TeamLeaveTab';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { NAV } from '@/lib/nav';
import {
  LEAVE_STATUS,
  type MyAttendance,
  type MyLeave,
  type TeamAttendance,
  type TeamEmployee,
  type TeamLeave,
} from '@/lib/leave';
import { applyLeave } from '@/lib/leave-actions';

type Tab = LeaveTab;
const TABS = LEAVE_TABS;
const TEAM_STATUSES = ['waiting', 'all', ...Object.keys(LEAVE_STATUS)];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
/** the leave year a day is in: 1 April to 31 March, the year balances run on */
const leaveYear = (day: string) => {
  const y = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0);
  return { from: `${String(y)}-04-01`, to: `${String(y + 1)}-03-31` };
};
const lastOf = (d: string) => addDays(`${addDays(`${d.slice(0, 7)}-01`, 32).slice(0, 7)}-01`, -1);

/**
 * My leave and attendance on one page, as in the earlier module's Employee Leave / Attendance: the leave
 * cards (available and availed, or the most a single application may take), Leave details, Download
 * leave, Download attendance and Apply leave; then a tab each for my attendance (every day of the month,
 * a correction asked from a day), my leave, my reporties' leave and my reporties' attendance.
 */
export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : 'attendance';
  const me = await getMe();
  // My leave and My attendance are every employee's (docs/design/85): a sign-in with no staff record has
  // neither, so the section's own link (the breadcrumb) takes it to the first leave screen it may open
  if (!me.permissions.includes('leave.own.apply')) {
    const first = NAV.find((g) => g.section === 'employeeLeave')?.items.find(
      (i) => i.href.startsWith('/leave/') && i.permission && me.permissions.includes(i.permission),
    );
    if (first) redirect(first.href);
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const year = /^\d{4}$/.test(sp.year ?? '') ? sp.year! : today.slice(0, 4);
  const mon = /^(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : today.slice(5, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : `${year}-${mon}`;
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  /** a date filter: as given (empty for an open end) once it is in the address, else the default */
  const given = (k: string, dflt: string) =>
    k in sp ? (DAY.test(sp[k] ?? '') ? sp[k]! : '') : dflt;
  const fy = leaveYear(today);
  // My Leave and Reporties Leave open on this leave year; Reporties Attendance on this month to today
  // (or the month asked, as the old links do)
  const lf = { from: given('from', fy.from), to: given('to', fy.to) };
  const af = {
    from: given(
      'from',
      sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : `${today.slice(0, 7)}-01`,
    ),
    to: given('to', sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? lastOf(`${sp.month}-01`) : today),
  };
  const employeeId = ID.test(sp.employeeId ?? '') ? sp.employeeId! : '';
  const leaveTypeId = ID.test(sp.leaveTypeId ?? '') ? sp.leaveTypeId! : '';
  const status = TEAM_STATUSES.includes(sp.status ?? '') ? sp.status! : 'waiting';

  let d: MyLeave;
  let att: MyAttendance | null = null;
  let teamLeave: TeamLeave | null = null;
  let teamAtt: TeamAttendance | null = null;
  let attProblem: string | null = null;
  let leaveProblem: string | null = null;
  let team = 0;
  let waitingWithMe = 0;
  /** a range the API refuses (From after To, too many days) says why on the tab, not as an error page */
  const refused = (e: unknown) => {
    if (e instanceof ApiError && e.status === 400) {
      const errs = e.problem.errors as Array<{ message?: string }> | undefined;
      return (Array.isArray(errs) ? errs.map((x) => x.message).find(Boolean) : null) ?? e.message;
    }
    throw e;
  };
  const q = (o: Record<string, string>) =>
    new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '')).toString();
  try {
    [d, att, teamLeave, teamAtt, [team, waitingWithMe]] = await Promise.all([
      apiFetch<MyLeave>(
        `/leave/mine?${tab === 'leave' ? q({ page: String(page), size, from: lf.from, to: lf.to }) : 'size=25'}`,
      ).catch((e: unknown) => {
        if (tab !== 'leave') throw e;
        leaveProblem = refused(e);
        return apiFetch<MyLeave>('/leave/mine?size=25');
      }),
      tab === 'attendance'
        ? apiFetch<MyAttendance>(`/staff-attendance/mine?month=${month}`)
        : Promise.resolve(null),
      tab === 'team-leave'
        ? apiFetch<TeamLeave>(
            `/leave/self/team?${q({
              page: String(page),
              size,
              from: lf.from,
              to: lf.to,
              status: status === 'all' ? '' : status,
              employeeId,
              leaveTypeId,
            })}`,
          ).catch((e: unknown) => {
            leaveProblem = refused(e);
            return null;
          })
        : Promise.resolve(null),
      tab === 'team-attendance'
        ? apiFetch<TeamAttendance>(
            `/staff-attendance/team?${q({ page: String(page), size, from: af.from, to: af.to, employeeId })}`,
          ).catch((e: unknown) => {
            attProblem = refused(e);
            return null;
          })
        : Promise.resolve(null),
      apiFetch<{ team: number; leave: number }>('/leave/menu')
        .then((r) => [r.team, r.leave] as const)
        .catch(() => [0, 0] as const),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  // the reportees for the attendance filter when the range was refused
  const teamList: TeamEmployee[] =
    tab === 'team-attendance' && !teamAtt && team
      ? await apiFetch<TeamAttendance>('/staff-attendance/team?size=25')
          .then((r) => r.employees)
          .catch(() => [])
      : [];
  const office = me.permissions.includes('leave.office.manage');
  const reports = me.permissions.includes('leave.report.view');
  /** a tab's page at a size, its filters kept (an empty date is an open end, kept as such) */
  const link =
    (params: Record<string, string>) =>
    (p: number, sz: string = size) => {
      const k = new URLSearchParams({ tab, ...params });
      if (sz !== '50') k.set('size', sz);
      if (p > 1) k.set('page', String(p));
      return `/leave?${k.toString()}`;
    };
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee leave & attendance', href: '/leave' },
          { label: 'Employee Leave / Attendance' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Employee Leave / Attendance"
        description="Your leave balance, your attendance day by day, your leave, and — for the staff reporting to you — their leave and attendance."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/approvals">
              Leave waiting for me{d.waiting ? ` (${String(d.waiting)})` : ''}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/attendance/approvals">
              Corrections waiting
            </a>
            {reports ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/reports">
                Reports
              </a>
            ) : null}
            {office ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/register">
                Leave register
              </a>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />

      <LeaveBalanceSection
        d={d}
        month={month}
        applyOpen={sp.apply === '1'}
        applyForm={
          <LeaveApplyForm
            types={d.types}
            balances={d.balances.map((b) => ({ typeId: b.typeId, available: b.available }))}
            apply={applyLeave}
          />
        }
      />

      <LeaveTabsNav
        tab={tab}
        month={month}
        base="/leave"
        waitingWithMe={waitingWithMe}
        team={team}
      />

      {tab === 'attendance' && att ? (
        <MyAttendanceTab
          att={att}
          month={month}
          today={today}
          base="/leave"
          regularise={(emp, day) => `/leave/attendance/day?emp=${emp}&day=${day}`}
        />
      ) : null}

      {tab === 'leave' ? (
        <>
          {leaveProblem ? (
            <p className="ep-alert ep-alert--warning" role="alert">
              <span>{leaveProblem}</span>
            </p>
          ) : null}
          <MyLeaveTab d={d} from={lf.from} to={lf.to} size={size} link={link(lf)} />
        </>
      ) : null}

      {tab === 'team-leave' ? (
        teamLeave ? (
          <TeamLeaveTab
            t={teamLeave}
            f={{ employeeId, leaveTypeId, status, from: lf.from, to: lf.to, size }}
            link={link({ ...lf, status, employeeId, leaveTypeId })}
          />
        ) : (
          <p className="ep-alert ep-alert--warning" role="alert">
            <span>
              {leaveProblem ?? 'The list could not be shown.'}{' '}
              <a href="/leave?tab=team-leave">Start again</a>
            </span>
          </p>
        )
      ) : null}

      {tab === 'team-attendance' ? (
        <TeamAttendanceTab
          a={teamAtt}
          employees={teamList}
          f={{ employeeId, from: af.from, to: af.to, size }}
          link={link({ ...af, employeeId })}
          problem={attProblem}
        />
      ) : null}
    </>
  );
}
