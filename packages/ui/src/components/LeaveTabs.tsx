import type { ReactNode } from 'react';
import {
  LEAVE_STATUS,
  dmy,
  type AttendanceRegister,
  type LeaveStatus,
  type MyLeave,
  type TeamAttendance,
  type TeamEmployee,
  type TeamLeave,
} from '../leave-views';
import { DateChips, LeaveStatusCell, halfWords, when } from './LeaveCells';
import { LeaveDialogButton } from './LeaveDialogButton';
import { ListBar, Pages } from './LeaveListBar';

/**
 * The Employee Leave / Attendance page's tabs (docs/design/85; shared by the admin and the staff website,
 * docs/design/99): My Leave, Reporties Leave, Reporties Attendance and its month grid. Links and actions are each
 * website's own; the admin's paths unless given.
 */

/** where the page's links go */
export interface LeavePaths {
  /** the page itself (its filter forms) */
  base: string;
  /** one leave */
  request: (id: string) => string;
  /** one person's day of attendance */
  day: (employeeId: string, day: string) => string;
}
export const ADMIN_LEAVE_PATHS: LeavePaths = {
  base: '/leave',
  request: (id) => `/leave/requests/${id}`,
  day: (employeeId, day) => `/leave/attendance/day?emp=${employeeId}&day=${day}`,
};
/** a server action on one leave, bound to its id in the row */
export type LeaveAct = (id: string, fd: FormData) => void | Promise<void>;
/** a leave's attached document as the website shows files (View / Download); none given: the word "Attached" */
export type LeaveFileLink = (fileId: string, label: string) => ReactNode;

/** My Leave's columns (the admin's table and the staff website's list that loads as it scrolls). */
export const MY_LEAVE_HEAD = [
  'Sr No',
  'Leave Id',
  'Leave Type',
  'Days',
  'Attachment',
  'Is Half Day',
  'Reason',
  'Applied Date',
  'Action By',
  'Action Date',
  'Actions',
  'Status',
] as const;
/** Reporties Leave's columns. */
export const TEAM_LEAVE_HEAD = [
  'Sr.No.',
  'Leave Id',
  'Emp Name',
  'Applied Date',
  'Attachment',
  'Days',
  'Is Half Day',
  'Leave Type',
  'On Behalf?',
  'On Behalf Created By',
  'Reason',
  'Action',
  'Status',
] as const;

/** How many in all and the Excel and PDF of everything (a list that loads as it scrolls: no pages). */
function FeedBar({
  total,
  noun,
  files,
}: {
  total: number;
  noun: string;
  files?: { xlsx: string; pdf: string } | null;
}) {
  return (
    <div className="ep-listbar">
      <div className="ep-listbar__end">
        <span className="ep-field__help">
          {total} {noun}
        </span>
        {files && total ? (
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={files.xlsx} download>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={files.pdf} download>
              PDF
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** One leave of My Leave: its row (the admin's table and the staff website's list). */
export function MyLeaveRow({
  r,
  n,
  back,
  paths,
  actions,
  fileLink,
}: {
  r: MyLeave['rows'][number];
  /** its number on the list */
  n: number;
  /** where the actions come back to */
  back: string;
  paths: LeavePaths;
  actions: { withdraw: LeaveAct; askCancel: LeaveAct };
  fileLink?: LeaveFileLink;
}) {
  return (
    <tr>
      <td>{n}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <a href={paths.request(r.id)}>{r.number}</a>
      </td>
      <td>
        {r.leaveType.code} — {r.leaveType.name}
      </td>
      <td>
        <DateChips r={r} />
      </td>
      <td>
        {r.documentFileId
          ? fileLink
            ? fileLink(r.documentFileId, `the document of ${r.number}`)
            : 'Attached'
          : '—'}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{halfWords(r)}</td>
      <td>{r.reason}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{when(r.appliedAt)}</td>
      <td>{r.decidedBy ?? (r.decidedAt ? 'System' : '')}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{when(r.decidedAt)}</td>
      <td>
        <div className="ep-rowacts">
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={paths.request(r.id)}
            aria-label={`View ${r.number}`}
          >
            View
          </a>
          {r.can.withdraw ? (
            <LeaveDialogButton
              id={`ml-wd-${r.id}`}
              label="Withdraw"
              title={`Withdraw ${r.number}`}
              className="ep-btn ep-btn--secondary ep-btn--sm"
            >
              <form action={actions.withdraw.bind(null, r.id)} className="ep-form-section__body">
                <input type="hidden" name="back" value={back} />
                <p className="ep-field__help">
                  It has not been decided yet: withdrawing it gives the days back.
                </p>
                <label className="ep-field" htmlFor={`ml-wd-${r.id}-why`}>
                  <span className="ep-field__label">Why (optional)</span>
                  <textarea
                    id={`ml-wd-${r.id}-why`}
                    name="reason"
                    className="ep-input"
                    rows={2}
                    maxLength={500}
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                  Withdraw the leave
                </button>
              </form>
            </LeaveDialogButton>
          ) : null}
          {r.can.requestCancel ? (
            <LeaveDialogButton
              id={`ml-cx-${r.id}`}
              label="Ask to cancel"
              title={`Ask to cancel ${r.number}`}
              className="ep-btn ep-btn--secondary ep-btn--sm"
            >
              <form action={actions.askCancel.bind(null, r.id)} className="ep-form-section__body">
                <input type="hidden" name="back" value={back} />
                <p className="ep-field__help">
                  It is approved: the cancellation goes to your approvers, as the leave did. The
                  days come back once they approve it.
                </p>
                <label className="ep-field" htmlFor={`ml-cx-${r.id}-why`}>
                  <span className="ep-field__label">Why</span>
                  <textarea
                    id={`ml-cx-${r.id}-why`}
                    name="reason"
                    className="ep-input"
                    rows={2}
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  Send the cancellation
                </button>
              </form>
            </LeaveDialogButton>
          ) : null}
        </div>
      </td>
      <td>
        <LeaveStatusCell r={r} />
      </td>
    </tr>
  );
}

/** One leave of Reporties Leave: its row (the admin's table and the staff website's list). */
export function TeamLeaveRow({
  r,
  n,
  back,
  paths,
  actions,
  fileLink,
}: {
  r: TeamLeave['rows'][number];
  n: number;
  back: string;
  paths: LeavePaths;
  actions: { decide: LeaveAct; decideCancel: LeaveAct };
  fileLink?: LeaveFileLink;
}) {
  return (
    <tr>
      <td>{n}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <a href={paths.request(r.id)}>{r.number}</a>
      </td>
      <td>
        <strong>{r.employee.name}</strong>
        <span className="ep-mr-col__desc">
          {r.employee.code}
          {r.employee.department ? ` · ${r.employee.department}` : ''}
        </span>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{when(r.appliedAt)}</td>
      <td>
        {r.documentFileId
          ? fileLink
            ? fileLink(r.documentFileId, `the document of ${r.number}`)
            : 'Attached'
          : '—'}
      </td>
      <td>
        <DateChips r={r} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{halfWords(r)}</td>
      <td>
        {r.leaveType.code} — {r.leaveType.name}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{onBehalf(r.source)}</td>
      <td>{r.source === 'on_behalf' ? (r.appliedBy ?? '') : ''}</td>
      <td>
        {r.reason}
        {r.what === 'cancellation' && r.cancelReason ? (
          <span className="ep-mr-col__desc">To cancel: {r.cancelReason}</span>
        ) : null}
      </td>
      <td>
        {r.can.decide || r.can.decideCancel ? (
          <Decide
            actions={actions}
            id={r.id}
            number={r.number}
            name={r.employee.name}
            cancellation={!r.can.decide && r.can.decideCancel}
            back={back}
          />
        ) : (
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={paths.request(r.id)}
            aria-label={`View ${r.number}`}
          >
            View
          </a>
        )}
      </td>
      <td>
        <LeaveStatusCell r={r} />
      </td>
    </tr>
  );
}

/**
 * My Leave (My leave → My Leave), as the old screen: From and To, then my leave touching them — Leave Id,
 * type, the dates, the attachment, half day, reason, applied, who acted and when, what I may do, status —
 * a page at a time, all of it as Excel or PDF.
 */
export function MyLeaveTab({
  d,
  from,
  to,
  size,
  link,
  actions,
  paths = ADMIN_LEAVE_PATHS,
  fileLink,
  feed,
}: {
  d: MyLeave;
  /** the staff website: its list that loads as it scrolls, in place of the table and its pages */
  feed?: ReactNode;
  /** withdraw a leave not decided yet; ask to cancel an approved one (each website's server actions) */
  actions: { withdraw: LeaveAct; askCancel: LeaveAct };
  paths?: LeavePaths;
  fileLink?: LeaveFileLink;
  from: string;
  to: string;
  size: string;
  /** this tab at a page and size, filters kept */
  link: (page: number, size?: string) => string;
}) {
  const back = link(d.page);
  const file = (f: 'xlsx' | 'pdf') =>
    `/api/leave/my-leave-file?${new URLSearchParams({ format: f, from, to }).toString()}`;
  return (
    <section aria-label="My leave">
      <form
        method="get"
        action={paths.base}
        className="ep-card ep-myleave__filter"
        aria-label="Filter"
      >
        <input type="hidden" name="tab" value="leave" />
        <input type="hidden" name="size" value={size} />
        <label className="ep-field" htmlFor="ml-from">
          <span className="ep-field__label">From Date</span>
          <input id="ml-from" name="from" type="date" className="ep-input" defaultValue={from} />
        </label>
        <label className="ep-field" htmlFor="ml-to">
          <span className="ep-field__label">To Date</span>
          <input id="ml-to" name="to" type="date" className="ep-input" defaultValue={to} />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Search
        </button>
      </form>
      {feed ? (
        <FeedBar
          total={d.total}
          noun="leave applications"
          files={d.employee ? { xlsx: file('xlsx'), pdf: file('pdf') } : null}
        />
      ) : (
        <ListBar
          page={d.page}
          size={d.size}
          total={d.total}
          href={(p) => link(p)}
          sizeHref={(s) => link(1, s)}
          noun="leave applications"
          files={d.employee ? { xlsx: file('xlsx'), pdf: file('pdf') } : null}
        />
      )}
      {feed ?? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My leave list">
          <table className="ep-table">
            <thead>
              <tr>
                {MY_LEAVE_HEAD.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r, i) => (
                  <MyLeaveRow
                    key={r.id}
                    r={r}
                    n={(d.page - 1) * d.size + i + 1}
                    back={back}
                    paths={paths}
                    actions={actions}
                    fileLink={fileLink}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={12}>
                    {d.employee ? 'No Leave Records in these dates.' : 'No leave for this sign-in.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {feed ? null : (
        <Pages page={d.page} size={d.size} total={d.total} href={(p) => link(p)} noun="leave" />
      )}
    </section>
  );
}

/** Yes (the office entered it), System (late marks, missing punches, absence), Imported, or No */
const onBehalf = (source: string) =>
  source === 'on_behalf'
    ? 'Yes'
    : source === 'import'
      ? 'Imported'
      : source.startsWith('auto')
        ? 'System'
        : 'No';

/**
 * Reporties Leave (My leave → Reporties Leave), as the old screen: Search Employee, Leave Type, Status
 * ("Waiting with me" first: everything at my approval level), From and To; the leave with its attachment,
 * days, half day, who entered it on the employee's behalf, the reason; Approve / Reject in the row, acting
 * at once; a page at a time, all of it as Excel or PDF.
 */
export function TeamLeaveTab({
  t,
  f,
  link,
  actions,
  paths = ADMIN_LEAVE_PATHS,
  fileLink,
  feed,
}: {
  t: TeamLeave;
  /** the staff website: its list that loads as it scrolls, in place of the table and its pages */
  feed?: ReactNode;
  /** decide a leave, or its cancellation, at my level (each website's server actions) */
  actions: { decide: LeaveAct; decideCancel: LeaveAct };
  paths?: LeavePaths;
  fileLink?: LeaveFileLink;
  /** the filters as on screen: status 'all' for every status */
  f: {
    employeeId: string;
    leaveTypeId: string;
    status: string;
    from: string;
    to: string;
    size: string;
  };
  link: (page: number, size?: string) => string;
}) {
  const back = link(t.page);
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/team-leave-file?${new URLSearchParams({
      format,
      from: f.from,
      to: f.to,
      ...(f.status !== 'all' ? { status: f.status } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.leaveTypeId ? { leaveTypeId: f.leaveTypeId } : {}),
    }).toString()}`;
  return (
    <section aria-label="Reporties leave">
      <form
        method="get"
        action={paths.base}
        className="ep-card ep-myleave__filter"
        aria-label="Filter"
      >
        <input type="hidden" name="tab" value="team-leave" />
        <input type="hidden" name="size" value={f.size} />
        <label className="ep-field" htmlFor="tl-emp">
          <span className="ep-field__label">Search Employee</span>
          <select id="tl-emp" name="employeeId" className="ep-select" defaultValue={f.employeeId}>
            <option value="">All employees</option>
            {t.filters.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="tl-type">
          <span className="ep-field__label">Leave Type</span>
          <select
            id="tl-type"
            name="leaveTypeId"
            className="ep-select"
            defaultValue={f.leaveTypeId}
          >
            <option value="">All types</option>
            {t.filters.types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="tl-status">
          <span className="ep-field__label">Status</span>
          <select id="tl-status" name="status" className="ep-select" defaultValue={f.status}>
            <option value="waiting">Waiting with me</option>
            <option value="all">All</option>
            {(Object.keys(LEAVE_STATUS) as LeaveStatus[]).map((s) => (
              <option key={s} value={s}>
                {s === 'pending' ? 'Waiting (any level)' : LEAVE_STATUS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="tl-from">
          <span className="ep-field__label">From Date</span>
          <input id="tl-from" name="from" type="date" className="ep-input" defaultValue={f.from} />
        </label>
        <label className="ep-field" htmlFor="tl-to">
          <span className="ep-field__label">To Date</span>
          <input id="tl-to" name="to" type="date" className="ep-input" defaultValue={f.to} />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Search
        </button>
        <p className="ep-field__help" style={{ flexBasis: '100%', margin: 0 }}>
          Waiting with me: leave and cancellations waiting for YOUR approval, at your level —
          approving or rejecting acts immediately. The other statuses show the leave of the staff
          who report to you ({t.team}).
        </p>
      </form>
      {feed ? (
        <FeedBar
          total={t.total}
          noun="leave applications"
          files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
        />
      ) : (
        <ListBar
          page={t.page}
          size={t.size}
          total={t.total}
          href={(p) => link(p)}
          sizeHref={(s) => link(1, s)}
          noun="leave applications"
          files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
        />
      )}
      {feed ?? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Reporties leave list">
          <table className="ep-table">
            <thead>
              <tr>
                {TEAM_LEAVE_HEAD.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.length ? (
                t.rows.map((r, i) => (
                  <TeamLeaveRow
                    key={r.id}
                    r={r}
                    n={(t.page - 1) * t.size + i + 1}
                    back={back}
                    paths={paths}
                    actions={actions}
                    fileLink={fileLink}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={13}>
                    {f.status === 'waiting' ? 'No Leaves waiting for you.' : 'No Leaves.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {feed ? null : (
        <Pages page={t.page} size={t.size} total={t.total} href={(p) => link(p)} noun="leave" />
      )}
    </section>
  );
}

/** Approve at once, or Reject with the reason the employee is told (a leave, or its cancellation). */
function Decide({
  actions,
  id,
  number,
  name,
  cancellation,
  back,
}: {
  actions: { decide: LeaveAct; decideCancel: LeaveAct };
  id: string;
  number: string;
  name: string;
  cancellation: boolean;
  back: string;
}) {
  const action = (cancellation ? actions.decideCancel : actions.decide).bind(null, id);
  const what = cancellation ? `the cancellation of ${number}` : number;
  return (
    <div className="ep-rowacts">
      <form action={action}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="outcome" value="approved" />
        <button
          type="submit"
          className="ep-btn ep-btn--primary ep-btn--sm"
          aria-label={`Approve ${what} (${name})`}
        >
          {cancellation ? 'Approve cancel' : 'Approve'}
        </button>
      </form>
      <LeaveDialogButton
        id={`tl-rj-${id}`}
        label={cancellation ? 'Reject cancel' : 'Reject'}
        title={`Do not approve ${what}`}
        className="ep-btn ep-btn--secondary ep-btn--sm"
      >
        <form action={action} className="ep-form-section__body">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="outcome" value="rejected" />
          <p className="ep-field__help">
            {name} is told, with your reason.
            {cancellation ? ' The leave stays approved.' : ' The days are given back.'}
          </p>
          <label className="ep-field" htmlFor={`tl-rj-${id}-why`}>
            <span className="ep-field__label">Why</span>
            <textarea
              id={`tl-rj-${id}-why`}
              name="note"
              className="ep-input"
              rows={2}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
            Do not approve
          </button>
        </form>
      </LeaveDialogButton>
    </div>
  );
}

const NOBODY =
  'Nobody reports to you this year (the reporting manager on each employee’s posting).';

/**
 * Reporties Attendance (My leave → Reporties Attendance): Employee, From and To. All employees: a column a
 * day (up to 31 days); one employee: their days one by one (up to 92), as the old screen — S.No., Date,
 * Day, Attendance, In, Out, Remark. A page at a time; all of it as Excel or PDF.
 */
export function TeamAttendanceTab({
  a,
  employees,
  f,
  link,
  problem,
  paths = ADMIN_LEAVE_PATHS,
}: {
  a: TeamAttendance | null;
  paths?: LeavePaths;
  /** for the filter when the range was refused (no answer to take them from) */
  employees: TeamEmployee[];
  f: { employeeId: string; from: string; to: string; size: string };
  link: (page: number, size?: string) => string;
  /** why the range was refused (more than 31 days for all, 92 for one) */
  problem: string | null;
}) {
  const list = a?.employees ?? employees;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/team-attendance-file?${new URLSearchParams({
      format,
      from: f.from,
      to: f.to,
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    }).toString()}`;
  return (
    <section aria-label="Reporties attendance">
      <form
        method="get"
        action={paths.base}
        className="ep-card ep-myleave__filter"
        aria-label="Filter"
      >
        <input type="hidden" name="tab" value="team-attendance" />
        <input type="hidden" name="size" value={f.size} />
        <label className="ep-field" htmlFor="ta-emp">
          <span className="ep-field__label">Employee</span>
          <select id="ta-emp" name="employeeId" className="ep-select" defaultValue={f.employeeId}>
            <option value="">All employees</option>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="ta-from">
          <span className="ep-field__label">From Date</span>
          <input
            id="ta-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={f.from}
            required
          />
        </label>
        <label className="ep-field" htmlFor="ta-to">
          <span className="ep-field__label">To Date</span>
          <input
            id="ta-to"
            name="to"
            type="date"
            className="ep-input"
            defaultValue={f.to}
            required
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Search
        </button>
        <p className="ep-field__help" style={{ flexBasis: '100%', margin: 0 }}>
          All employees: a column a day, up to 31 days. One employee: their days one by one, up to
          92 days.
        </p>
      </form>
      {problem ? (
        <p className="ep-alert ep-alert--warning" role="alert">
          <span>{problem}</span>
        </p>
      ) : !a ? null : !a.team ? (
        <p className="ep-alert ep-alert--info" role="status">
          <span>{NOBODY}</span>
        </p>
      ) : a.mode === 'grid' ? (
        <>
          <p className="ep-field__help">
            {dmy(a.from)} to {dmy(a.to)}: P present, HD half day, A absent, WO weekly off, H
            holiday, the leave’s code; L late, F a punch missing, m set by hand. Click a day to see
            its punches.
          </p>
          <ListBar
            page={a.page}
            size={a.size}
            total={a.total}
            href={(p) => link(p)}
            sizeHref={(s) => link(1, s)}
            noun="staff"
            files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
          />
          <TeamAttendanceGrid dayHref={paths.day} d={a} />
          <Pages page={a.page} size={a.size} total={a.total} href={(p) => link(p)} noun="staff" />
        </>
      ) : (
        <>
          <h2 className="ep-card__title">
            {a.employee.name} ({a.employee.code}) · {dmy(a.from)} to {dmy(a.to)}
          </h2>
          <ul className="ep-chips" aria-label={`${a.employee.name}: the days added up`}>
            {Object.entries(a.totals).map(([k, v]) => (
              <li key={k} className="ep-chip">
                {k === 'late' ? 'Late' : k === 'missing' ? 'Punch missing' : k} <strong>{v}</strong>
              </li>
            ))}
          </ul>
          <ListBar
            page={a.page}
            size={a.size}
            total={a.total}
            href={(p) => link(p)}
            sizeHref={(s) => link(1, s)}
            noun="days"
            files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
          />
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${a.employee.name}: attendance`}
          >
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">S.No.</th>
                  <th scope="col">Date</th>
                  <th scope="col">Day</th>
                  <th scope="col">Attendance</th>
                  <th scope="col">In Time</th>
                  <th scope="col">Out Time</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Hours
                  </th>
                  <th scope="col">Remark</th>
                </tr>
              </thead>
              <tbody>
                {a.days.map((d, i) => (
                  <tr key={d.day}>
                    <td>{(a.page - 1) * a.size + i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a href={paths.day(a.employee.id, d.day)}>{dmy(d.day)}</a>
                    </td>
                    <td>{d.weekday}</td>
                    <td>
                      {d.code && d.code !== '·' ? <strong>{d.code}</strong> : null} {d.words ?? ''}
                      {d.manual ? <span className="ep-mr-col__desc">set by hand</span> : null}
                      {d.missing ? <span className="ep-mr-col__desc">a punch missing</span> : null}
                    </td>
                    <td>{d.in ?? ''}</td>
                    <td>{d.out ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{d.worked ?? ''}</td>
                    <td>
                      {d.lateEarly ? <span className="ep-mr-col__desc">{d.lateEarly}</span> : null}
                      {d.remark ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pages page={a.page} size={a.size} total={a.total} href={(p) => link(p)} noun="days" />
        </>
      )}
    </section>
  );
}

const TONE: Record<string, string> = {
  P: 'var(--status-success-text)',
  HD: 'var(--status-warning-text)',
  A: 'var(--status-danger-text)',
  LOP: 'var(--status-danger-text)',
  HOLD: 'var(--status-danger-text)',
  WO: 'var(--text-muted)',
  H: 'var(--text-muted)',
};
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** A month of my team's days: each day's code with its marks, the totals; a day opens its detail. */
export function TeamAttendanceGrid({
  d,
  dayHref = ADMIN_LEAVE_PATHS.day,
}: {
  d: AttendanceRegister;
  /** one person's day (the admin's day page unless a website gives its own) */
  dayHref?: (employeeId: string, day: string) => string;
}) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My team’s attendance">
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            {d.dates.map((x) => (
              <th key={x} scope="col" style={{ textAlign: 'center', padding: 'var(--sp-1)' }}>
                {Number(x.slice(8, 10))}
                <span className="ep-mr-col__desc">
                  {WEEKDAY[new Date(`${x}T00:00:00Z`).getUTCDay()]}
                </span>
              </th>
            ))}
            {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'Late', 'Miss'].map((h) => (
              <th key={h} scope="col" style={{ textAlign: 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.employee.id}>
              <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                {r.employee.name}
                <span className="ep-mr-col__desc">{r.employee.code}</span>
              </th>
              {r.cells.map((c) => (
                <td
                  key={c.day}
                  style={{ textAlign: 'center', padding: 'var(--sp-1)' }}
                  title={c.title || undefined}
                >
                  {c.code ? (
                    <a
                      href={dayHref(r.employee.id, c.day)}
                      style={{
                        color: TONE[c.code.replace('½', '')] ?? 'var(--text-primary)',
                        textDecoration: 'none',
                        fontWeight: 600,
                      }}
                      aria-label={`${r.employee.name} ${c.day}: ${c.title || c.code}`}
                    >
                      {c.code}
                      {c.late ? <sup className="ep-mk ep-mk--L">L</sup> : null}
                      {c.missing ? <sup className="ep-mk ep-mk--F">F</sup> : null}
                      {c.manual ? <sup className="ep-mk ep-mk--m">m</sup> : null}
                    </a>
                  ) : null}
                </td>
              ))}
              {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'late', 'missing'].map((k) => (
                <td key={k} style={{ textAlign: 'right' }}>
                  {r.totals[k] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
