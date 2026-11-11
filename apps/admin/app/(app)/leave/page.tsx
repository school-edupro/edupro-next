import type { ReactNode } from 'react';
import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { DialogButton } from '@/components/leave/DialogButton';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { MyLeaveTab } from '@/components/leave/MyLeaveTab';
import { TeamAttendanceTab } from '@/components/leave/TeamAttendanceTab';
import { TeamLeaveTab } from '@/components/leave/TeamLeaveTab';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  LEAVE_STATUS,
  dmy,
  type LeaveStatus,
  type MyAttendance,
  type MyLeave,
  type TeamAttendance,
  type TeamEmployee,
  type TeamLeave,
} from '@/lib/leave';
import { applyLeave } from '@/lib/leave-actions';

type Tab = 'attendance' | 'leave' | 'team-leave' | 'team-attendance';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'attendance', label: 'My Attendance' },
  { id: 'leave', label: 'My Leave' },
  { id: 'team-leave', label: 'Reporties Leave' },
  { id: 'team-attendance', label: 'Reporties Attendance' },
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** the cards' left edges, in turn */
const EDGE = [
  'var(--action-primary)',
  'var(--status-warning)',
  'var(--status-danger)',
  'var(--status-info)',
  'var(--status-success)',
];
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
  const balance = new Map(d.balances.map((b) => [b.typeId, b]));
  const years = Array.from({ length: 4 }, (_, i) => String(Number(today.slice(0, 4)) - 2 + i));

  const monthForm = (id: string, extra?: ReactNode) => (
    <form method="get" action="/leave" className="ep-card ep-myleave__filter" aria-label="Month">
      <input type="hidden" name="tab" value={tab} />
      <label className="ep-field" htmlFor={`${id}-year`}>
        <span className="ep-field__label">Select Year</span>
        <select
          id={`${id}-year`}
          name="year"
          className="ep-select"
          defaultValue={month.slice(0, 4)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field" htmlFor={`${id}-month`}>
        <span className="ep-field__label">Select Month</span>
        <select
          id={`${id}-month`}
          name="month"
          className="ep-select"
          defaultValue={month.slice(5, 7)}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {extra}
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        Search
      </button>
    </form>
  );

  const myDays = () => {
    if (!att?.employee) return null;
    const by = new Map(att.days.map((x) => [x.day, x]));
    const first = att.month.slice(0, 10);
    const rows: ReactNode[] = [];
    for (
      let day = first, n = 1;
      day.slice(0, 7) === first.slice(0, 7);
      day = addDays(day, 1), n++
    ) {
      const x = by.get(day);
      rows.push(
        <tr key={day}>
          <td>{n}</td>
          <td>{dmy(day)}</td>
          <td>{WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]}</td>
          <td>
            {x ? (
              <>
                <strong>{x.code}</strong> {x.words}
                {x.late ? <span className="ep-mr-col__desc">late {x.late} min</span> : null}
                {x.early ? <span className="ep-mr-col__desc">left {x.early} min early</span> : null}
                {x.remark ? <span className="ep-mr-col__desc">{x.remark}</span> : null}
              </>
            ) : null}
          </td>
          <td>{x?.in ?? ''}</td>
          <td>{x?.out ?? ''}</td>
          <td>
            {day <= today && !att.locked ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/leave/attendance/day?emp=${att.employee.id}&day=${day}`}
                aria-label={`Regularise ${dmy(day)}`}
              >
                Regularise
              </a>
            ) : null}
          </td>
        </tr>,
      );
    }
    return rows;
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

      <section className="ep-card ep-myleave" aria-label="My leave balance">
        <div className="ep-myleave__top">
          {d.employee ? (
            <p className="ep-myleave__who">
              <strong>{d.employee.name}</strong> ({d.employee.code})
              {d.employee.department ? ` · ${d.employee.department}` : ''}
            </p>
          ) : (
            <p className="ep-alert ep-alert--info ep-myleave__who" role="status">
              <span>
                This sign-in is not linked to an active employee record, so it has no leave balance
                or attendance of its own.
              </span>
            </p>
          )}
          <div className="ep-myleave__actions">
            {d.employee ? (
              <>
                <DialogButton
                  id="ml-details"
                  label="Leave Details"
                  title="Leave details"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                >
                  <div
                    className="ep-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label="Leave details"
                  >
                    <table className="ep-table ep-table--dense">
                      <thead>
                        <tr>
                          <th scope="col">Leave type</th>
                          <th scope="col">Policy</th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Available
                          </th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Held this month
                          </th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Availed this year
                          </th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Most at a time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.types.map((t) => {
                          const b = balance.get(t.id);
                          return (
                            <tr key={t.id}>
                              <td>
                                {t.name} ({t.code})
                                {t.halfDay ? (
                                  <span className="ep-mr-col__desc">half days allowed</span>
                                ) : null}
                              </td>
                              <td>{b?.policy ?? (t.keepsBalance ? '—' : 'No balance kept')}</td>
                              <td style={{ textAlign: 'right' }}>
                                {b ? b.available.toFixed(2) : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>{b ? b.held.toFixed(2) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>
                                {b ? b.availed.toFixed(2) : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {t.maxDays ? `${String(t.maxDays)} days` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="ep-field__help">
                    Available: what you can take now (leave waiting for approval is held from it).
                    Availed: approved leave this leave year, April to March.
                  </p>
                </DialogButton>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href="/api/leave/my-leave-file?format=xlsx"
                  download
                >
                  Download Leave
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/leave/my-attendance-file?month=${month}&format=xlsx`}
                  download
                >
                  Download Attendance
                </a>
              </>
            ) : null}
            {d.employee && d.can.apply ? (
              <DialogButton
                id="ml-apply"
                label="＋ Apply Leave"
                title="Apply for leave"
                open={sp.apply === '1'}
              >
                <LeaveApplyForm
                  types={d.types}
                  balances={d.balances.map((b) => ({ typeId: b.typeId, available: b.available }))}
                  apply={applyLeave}
                />
              </DialogButton>
            ) : null}
          </div>
        </div>
        {d.employee && d.types.length ? (
          <ul className="ep-myleave__cards" aria-label="Leave balance">
            {d.types.map((t, i) => {
              const b = balance.get(t.id);
              return (
                <li
                  key={t.id}
                  className="ep-myleave__card"
                  style={{ borderLeftColor: EDGE[i % EDGE.length] }}
                >
                  <span className="ep-myleave__name">{t.name}</span>
                  <strong className="ep-myleave__code">{t.code}</strong>
                  {b ? (
                    <>
                      <span>
                        <span className="ep-myleave__avail">{b.available.toFixed(2)}</span>{' '}
                        Available
                      </span>
                      <span>
                        <strong>{b.availed.toFixed(2)}</strong> Availed
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="ep-myleave__none">— No balance</span>
                      <span>
                        {t.maxDays ? (
                          <>
                            <strong>{t.maxDays}</strong> Max / application
                          </>
                        ) : (
                          <span className="ep-myleave__none">No limit</span>
                        )}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <div className="ep-tabs">
        <div role="tablist" aria-label="My leave and attendance" className="ep-tabs__list">
          {TABS.map((t) => (
            <a
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className="ep-tabs__tab"
              href={`/leave?tab=${t.id}${t.id === 'attendance' ? `&month=${month}` : ''}`}
            >
              {t.label}
              {t.id === 'team-leave' && waitingWithMe
                ? ` (${String(waitingWithMe)} waiting)`
                : t.id === 'team-attendance' && team
                  ? ` (${String(team)})`
                  : ''}
            </a>
          ))}
        </div>
      </div>

      {tab === 'attendance' && att ? (
        <section aria-label="My attendance">
          {monthForm('ma')}
          {!att.employee ? (
            <p className="ep-field__help">There is no attendance to show for this sign-in.</p>
          ) : (
            <>
              {att.locked ? (
                <p className="ep-alert ep-alert--info" role="status">
                  <span>
                    {att.monthWords} is locked for payroll: corrections can no longer be asked.
                  </span>
                </p>
              ) : null}
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My days">
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th scope="col">S.No.</th>
                      <th scope="col">Date</th>
                      <th scope="col">Day</th>
                      <th scope="col">Attendance</th>
                      <th scope="col">In Time</th>
                      <th scope="col">Out Time</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>{myDays()}</tbody>
                </table>
              </div>
              <h2 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
                Corrections I asked
              </h2>
              {att.regularisations.length ? (
                <ul className="ep-list">
                  {att.regularisations.map((g) => (
                    <li key={g.id}>
                      <a href={`/leave/attendance/day?emp=${att.employee!.id}&day=${g.day}`}>
                        {dmy(g.day)}
                      </a>{' '}
                      ·{' '}
                      {[
                        g.in_time ? `IN ${g.in_time}` : null,
                        g.out_time ? `OUT ${g.out_time}` : null,
                        g.day_type,
                      ]
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      — {g.reason}{' '}
                      <Badge tone={LEAVE_STATUS[g.status as LeaveStatus]?.tone ?? 'neutral'}>
                        {LEAVE_STATUS[g.status as LeaveStatus]?.label ?? g.status}
                      </Badge>
                      {g.waiting ? <span className="ep-mr-col__desc">With {g.waiting}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">None in this month.</p>
              )}
            </>
          )}
        </section>
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
