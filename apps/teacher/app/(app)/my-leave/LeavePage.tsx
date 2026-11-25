import {
  LEAVE_TABS,
  LeaveBalanceSection,
  LeaveTabsNav,
  MyAttendanceTab,
  MyLeaveTab,
  PageHeader,
  TeamAttendanceTab,
  TeamLeaveTab,
  type LeavePaths,
  type LeaveTab,
} from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound } from 'next/navigation';
import { LeaveApplyForm } from '@/components/LeaveApplyForm';
import { bff } from '@/lib/bff';
import { currentLang, t as tr } from '@/lib/i18n';
import {
  LEAVE_STATUS,
  type MyAttendance,
  type MyLeave,
  type TeamAttendance,
  type TeamEmployee,
  type TeamLeave,
} from '@/lib/leave';
import {
  applyMyLeave,
  askCancelMyLeave,
  decideMyLeave,
  decideMyLeaveCancel,
  withdrawMyLeave,
} from './actions';
import { LeaveFeed } from './LeaveFeed';

/** My Leave and Reporties Leave: the latest 10 first, the rest as the person scrolls (docs/design/89). */
const FEED = '10';

const TEAM_STATUSES = ['waiting', 'all', ...Object.keys(LEAVE_STATUS)];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const SIZES = ['25', '50', '100'];
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

/** each tab's page on the staff website: My attendance and My team's attendance are menu pages of their own */
const TAB_PATH: Record<LeaveTab, string> = {
  attendance: '/my-attendance',
  leave: '/my-leave',
  'team-leave': '/my-leave',
  'team-attendance': '/my-team',
};
const hrefOf = (t: LeaveTab, month: string) =>
  t === 'attendance'
    ? `/my-attendance?month=${month}`
    : t === 'team-leave'
      ? '/my-leave?tab=team-leave'
      : TAB_PATH[t];

/**
 * Leave & attendance on the staff website as the admin's Employee Leave / Attendance (docs/design/99): the
 * leave cards with Leave Details, Download Leave / Attendance and Apply Leave; the tabs My Attendance (a day
 * each, Regularise from the row), My Leave, Reporties Leave (Approve / Reject in the row) and Reporties
 * Attendance. My leave, My attendance and My team's attendance open it on their tab.
 */
export async function StaffLeavePage({
  searchParams,
  defaultTab,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
  defaultTab: LeaveTab;
}) {
  const sp = await searchParams;
  const tab: LeaveTab = LEAVE_TABS.some((t) => t.id === sp.tab) ? (sp.tab as LeaveTab) : defaultTab;
  const base = TAB_PATH[tab];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const year = /^\d{4}$/.test(sp.year ?? '') ? sp.year! : today.slice(0, 4);
  const mon = /^(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : today.slice(5, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : `${year}-${mon}`;
  const size = SIZES.includes(sp.size ?? '') ? sp.size! : '50';
  const page = Math.max(1, Number(sp.page) || 1);
  /** a date filter: as given (empty for an open end) once it is in the address, else the default */
  const given = (k: string, dflt: string) =>
    k in sp ? (DAY.test(sp[k] ?? '') ? sp[k]! : '') : dflt;
  const fy = leaveYear(today);
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
  const fetch = <T,>(path: string) => bff.api.fetch<T>(path);

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
      fetch<MyLeave>(
        `/leave/mine?${tab === 'leave' ? q({ page: '1', size: FEED, from: lf.from, to: lf.to }) : 'size=25'}`,
      ).catch((e: unknown) => {
        if (tab !== 'leave') throw e;
        leaveProblem = refused(e);
        return fetch<MyLeave>('/leave/mine?size=25');
      }),
      tab === 'attendance'
        ? fetch<MyAttendance>(`/staff-attendance/mine?month=${month}`)
        : Promise.resolve(null),
      tab === 'team-leave'
        ? fetch<TeamLeave>(
            `/leave/self/team?${q({
              page: '1',
              size: FEED,
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
        ? fetch<TeamAttendance>(
            `/staff-attendance/team?${q({ page: String(page), size, from: af.from, to: af.to, employeeId })}`,
          ).catch((e: unknown) => {
            attProblem = refused(e);
            return null;
          })
        : Promise.resolve(null),
      fetch<{ team: number; leave: number }>('/leave/menu')
        .then((r) => [r.team, r.leave] as const)
        .catch(() => [0, 0] as const),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const teamList: TeamEmployee[] =
    tab === 'team-attendance' && !teamAtt && team
      ? await fetch<TeamAttendance>('/staff-attendance/team?size=25')
          .then((r) => r.employees)
          .catch(() => [])
      : [];
  // the leave & attendance reports the leave office gave me (docs/design/85, phase D)
  const reports = await fetch<{ leaveReports?: number }>('/me/staff-waiting')
    .then((w) => (w.leaveReports ?? 0) > 0)
    .catch(() => false);
  /** a tab's page at a size, its filters kept (an empty date is an open end, kept as such) */
  const link =
    (params: Record<string, string>) =>
    (p: number, sz: string = size) => {
      const k = new URLSearchParams({ ...(tab === 'team-leave' ? { tab } : {}), ...params });
      if (sz !== '50') k.set('size', sz);
      if (p > 1) k.set('page', String(p));
      const s = k.toString();
      return `${base}${s ? `?${s}` : ''}`;
    };
  const lang = await currentLang();
  const foot = {
    more: tr(lang, 'Show more'),
    loading: tr(lang, 'Loading…'),
    failed: tr(lang, 'Could not load more.'),
    end: tr(lang, 'That is everything.'),
  };
  const leaveActions = {
    withdraw: withdrawMyLeave,
    askCancel: askCancelMyLeave,
    decide: decideMyLeave,
    decideCancel: decideMyLeaveCancel,
  };
  const teamFilters: Record<string, string> = {
    from: lf.from,
    to: lf.to,
    ...(status === 'all' ? {} : { status }),
    ...(employeeId ? { employeeId } : {}),
    ...(leaveTypeId ? { leaveTypeId } : {}),
  };
  const paths: LeavePaths = {
    base,
    request: (id) => `/my-leave/${id}`,
    day: (emp, day) => `/my-team/${emp}?month=${day.slice(0, 7)}`,
  };
  return (
    <>
      <PageHeader
        kicker="Leave & attendance"
        title="Employee Leave / Attendance"
        description="Your leave balance, your attendance day by day, your leave, and — for the staff reporting to you — their leave and attendance."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave-approvals">
              Leave waiting for me{d.waiting ? ` (${String(d.waiting)})` : ''}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/attendance-corrections">
              Corrections waiting
            </a>
            {reports ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave-reports">
                Reports
              </a>
            ) : null}
          </div>
        }
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          <span>{sp.detail || 'Done.'}</span>
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{sp.detail || sp.error}</span>
        </p>
      ) : null}

      <LeaveBalanceSection
        d={d}
        month={month}
        applyOpen={sp.apply === '1'}
        applyForm={
          <LeaveApplyForm
            types={d.types}
            balances={d.balances.map((b) => ({ typeId: b.typeId, available: b.available }))}
            apply={applyMyLeave}
            detailPath="/my-leave/"
          />
        }
      />

      <LeaveTabsNav
        tab={tab}
        month={month}
        base="/my-leave"
        hrefOf={hrefOf}
        waitingWithMe={waitingWithMe}
        team={team}
      />

      {tab === 'attendance' && att ? (
        <MyAttendanceTab
          att={att}
          month={month}
          today={today}
          base="/my-attendance"
          regularise={(_emp, day) => `/my-attendance/${day}`}
        />
      ) : null}

      {tab === 'leave' ? (
        <>
          {leaveProblem ? (
            <p className="ep-alert ep-alert--warning" role="alert">
              <span>{leaveProblem}</span>
            </p>
          ) : null}
          <MyLeaveTab
            d={d}
            from={lf.from}
            to={lf.to}
            size={size}
            link={link(lf)}
            paths={paths}
            actions={{ withdraw: withdrawMyLeave, askCancel: askCancelMyLeave }}
            feed={
              <LeaveFeed
                key={`${lf.from}-${lf.to}`}
                which="mine"
                first={d.rows}
                more={Number(FEED) < d.total}
                filters={{ from: lf.from, to: lf.to }}
                back={link(lf)(1)}
                empty={
                  d.employee ? 'No Leave Records in these dates.' : 'No leave for this sign-in.'
                }
                actions={leaveActions}
                foot={foot}
              />
            }
          />
        </>
      ) : null}

      {tab === 'team-leave' ? (
        teamLeave ? (
          <TeamLeaveTab
            t={teamLeave}
            f={{ employeeId, leaveTypeId, status, from: lf.from, to: lf.to, size }}
            link={link({ ...lf, status, employeeId, leaveTypeId })}
            paths={paths}
            actions={{ decide: decideMyLeave, decideCancel: decideMyLeaveCancel }}
            feed={
              <LeaveFeed
                key={JSON.stringify(teamFilters)}
                which="team"
                first={teamLeave.rows}
                more={Number(FEED) < teamLeave.total}
                filters={teamFilters}
                back={link({ ...lf, status, employeeId, leaveTypeId })(1)}
                empty={status === 'waiting' ? 'No Leaves waiting for you.' : 'No Leaves.'}
                actions={leaveActions}
                foot={foot}
              />
            }
          />
        ) : (
          <p className="ep-alert ep-alert--warning" role="alert">
            <span>
              {leaveProblem ?? 'The list could not be shown.'}{' '}
              <a href="/my-leave?tab=team-leave">Start again</a>
            </span>
          </p>
        )
      ) : null}

      {tab === 'team-attendance' && team ? (
        <p className="ep-field__help">
          Every punch of the staff who report to you, as the machines brought them in:{' '}
          <a href="/my-team?tab=punches" style={{ textDecoration: 'underline' }}>
            their punches
          </a>
          .
        </p>
      ) : null}
      {tab === 'team-attendance' ? (
        <TeamAttendanceTab
          a={teamAtt}
          employees={teamList}
          f={{ employeeId, from: af.from, to: af.to, size }}
          link={link({ ...af, employeeId })}
          problem={attProblem}
          paths={paths}
        />
      ) : null}
    </>
  );
}
