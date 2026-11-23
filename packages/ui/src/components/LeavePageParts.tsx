import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { LeaveDialogButton } from './LeaveDialogButton';
import {
  LEAVE_STATUS,
  correctionPeople,
  dmy,
  type LeaveStatus,
  type MyAttendance,
  type MyLeave,
} from '../leave-views';

/**
 * The Employee Leave / Attendance page's own parts (docs/design/85; shared by the admin and the staff website,
 * docs/design/99): the balance with its buttons and cards, the tab row, and My Attendance. The downloads are at
 * `/api/leave/…` on each website.
 */

export type LeaveTab = 'attendance' | 'leave' | 'team-leave' | 'team-attendance';
export const LEAVE_TABS: Array<{ id: LeaveTab; label: string }> = [
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
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/**
 * The person's leave balance, as the old Employee Leave screen: who they are, **Leave Details** (each type's policy,
 * available, held, availed, most at a time), **Download Leave**, **Download Attendance**, **＋ Apply Leave** (the
 * website's own form), then a card a leave type.
 */
export function LeaveBalanceSection({
  d,
  month,
  applyForm,
  applyOpen = false,
}: {
  d: MyLeave;
  /** the month My Attendance shows (its download) */
  month: string;
  /** the website's Apply Leave form; none: no Apply button */
  applyForm: ReactNode | null;
  /** open the Apply Leave dialog at once (`?apply=1`) */
  applyOpen?: boolean;
}) {
  const balance = new Map(d.balances.map((b) => [b.typeId, b]));
  return (
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
              This sign-in is not linked to an active employee record, so it has no leave balance or
              attendance of its own.
            </span>
          </p>
        )}
        <div className="ep-myleave__actions">
          {d.employee ? (
            <>
              <LeaveDialogButton
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
                            <td style={{ textAlign: 'right' }}>{b ? b.availed.toFixed(2) : '—'}</td>
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
              </LeaveDialogButton>
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
          {d.employee && d.can.apply && applyForm ? (
            <LeaveDialogButton
              id="ml-apply"
              label="＋ Apply Leave"
              title="Apply for leave"
              open={applyOpen}
            >
              {applyForm}
            </LeaveDialogButton>
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
                      <span className="ep-myleave__avail">{b.available.toFixed(2)}</span> Available
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
  );
}

/** The four tabs as links (each a page of its own), with what waits on me and how many report to me. */
export function LeaveTabsNav({
  tab,
  month,
  base,
  waitingWithMe,
  team,
  hrefOf,
}: {
  tab: LeaveTab;
  month: string;
  /** the page's address: /leave (admin), /my-leave (staff) */
  base: string;
  /** each tab's own address (the staff website: My attendance and My team's attendance are menu pages) */
  hrefOf?: (tab: LeaveTab, month: string) => string;
  waitingWithMe: number;
  team: number;
}) {
  return (
    <div className="ep-tabs">
      <div role="tablist" aria-label="My leave and attendance" className="ep-tabs__list">
        {LEAVE_TABS.map((t) => (
          <a
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className="ep-tabs__tab"
            href={
              hrefOf
                ? hrefOf(t.id, month)
                : `${base}?tab=${t.id}${t.id === 'attendance' ? `&month=${month}` : ''}`
            }
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
  );
}

/**
 * My Attendance: Select Year and Month, then every day of the month — S.No., Date, Day, Attendance (the code and
 * words, late, early, a remark, a correction's state), In, Out and **Regularise** on a past day (not in a locked
 * month, not before the correction window); the corrections asked in the month.
 */
export function MyAttendanceTab({
  att,
  month,
  today,
  base,
  regularise,
}: {
  att: MyAttendance;
  month: string;
  /** India's today, yyyy-mm-dd */
  today: string;
  base: string;
  /** a day's page with its correction form */
  regularise: (employeeId: string, day: string) => string;
}) {
  const years = Array.from({ length: 4 }, (_, i) => String(Number(today.slice(0, 4)) - 2 + i));
  const monthForm = (
    <form method="get" action={base} className="ep-card ep-myleave__filter" aria-label="Month">
      <input type="hidden" name="tab" value="attendance" />
      <label className="ep-field" htmlFor="ma-year">
        <span className="ep-field__label">Select Year</span>
        <select id="ma-year" name="year" className="ep-select" defaultValue={month.slice(0, 4)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field" htmlFor="ma-month">
        <span className="ep-field__label">Select Month</span>
        <select id="ma-month" name="month" className="ep-select" defaultValue={month.slice(5, 7)}>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, '0')}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        Search
      </button>
    </form>
  );
  const myDays = () => {
    if (!att.employee) return null;
    const employee = att.employee;
    const by = new Map(att.days.map((x) => [x.day, x]));
    // the latest correction asked for a day (newest first): its status and who it waits for / who decided
    const regOf = new Map<string, (typeof att.regularisations)[number]>();
    for (const g of att.regularisations) if (!regOf.has(g.day)) regOf.set(g.day, g);
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
            {regOf.get(day) && correctionPeople(regOf.get(day)!) ? (
              <span className="ep-mr-col__desc">
                Correction: {correctionPeople(regOf.get(day)!)}
              </span>
            ) : null}
          </td>
          <td>{x?.in ?? ''}</td>
          <td>{x?.out ?? ''}</td>
          <td>
            {day <= today && !att.locked && (!att.correctionFrom || day >= att.correctionFrom) ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={regularise(employee.id, day)}
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
    <section aria-label="My attendance">
      {monthForm}
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
          ) : att.correctionFrom && att.correctionFrom > att.month.slice(0, 10) ? (
            <p className="ep-alert ep-alert--info" role="status">
              <span>
                Corrections can be asked for days from {dmy(att.correctionFrom)} on; for an earlier
                day, ask the leave office. Each correction goes to your approver and the day changes
                only once it is approved.
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
                  <a href={regularise(att.employee!.id, g.day)}>{dmy(g.day)}</a> ·{' '}
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
                  {correctionPeople(g) ? (
                    <span className="ep-mr-col__desc">{correctionPeople(g)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">None in this month.</p>
          )}
        </>
      )}
    </section>
  );
}
