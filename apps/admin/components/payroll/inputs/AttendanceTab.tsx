import { Badge, KpiTile } from '@edupro/ui';
import { Pager, PerPage } from '@/components/Pager';
import { DialogButton } from '@/components/leave/DialogButton';
import { apiFetch } from '@/lib/api';
import { monthName, SOURCE, type AttendanceMonth } from '@/lib/payroll-inputs';
import {
  finaliseAttendance,
  markPresent,
  pullAttendance,
  unfinaliseAttendance,
} from '@/lib/payroll-inputs-actions';
import { AttendanceUpload } from './AttendanceUpload';

const SHOW = [
  ['all', 'All'],
  ['missing', 'Not pulled'],
  ['open', 'Not finalised'],
  ['finalised', 'Finalised'],
  ['manual', 'Changed by hand'],
  ['warnings', 'To look at'],
] as const;

/** The month's attendance for payroll: figures, the register's locks, the actions in the legacy order, the list. */
export async function AttendanceTab({
  month,
  sp,
}: {
  month: string;
  sp: Record<string, string | undefined>;
}) {
  const show = SHOW.find(([v]) => v === sp.show)?.[0] ?? 'all';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (p: number) => {
    const u = new URLSearchParams({
      month,
      tab: 'attendance',
      show,
      size: String(size),
      page: String(p),
    });
    if (q) u.set('q', q);
    return u.toString();
  };
  const d = await apiFetch<AttendanceMonth>(
    `/payroll/inputs/attendance?${new URLSearchParams({ month, show, size: String(size), page: String(page), ...(q ? { q } : {}) }).toString()}`,
  );
  const f = d.figures;
  const counted = f.staff - f.skipped;
  const allFinal = counted > 0 && f.finalised >= counted;
  const frozen = d.runs.some((s) => ['PROCESSING', 'APPROVED', 'LOCKED', 'PAID'].includes(s));
  return (
    <>
      <div className="ep-dash-kpis">
        <KpiTile label="On the roster" value={String(f.staff)} />
        <KpiTile label="Pulled" value={`${String(f.pulled)} of ${String(counted)}`} />
        <KpiTile label="Not pulled" value={String(f.missing)} />
        <KpiTile label="Finalised" value={`${String(f.finalised)} of ${String(counted)}`} />
        <KpiTile label="Changed by hand" value={String(f.manual)} />
        <KpiTile label="Held · skipped" value={`${String(f.held)} · ${String(f.skipped)}`} />
      </div>
      {d.register.unlocked.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>Lock the month in the attendance register first.</strong>{' '}
            {d.register.unlocked.map(monthName).join(' and ')} is over but not locked there: payroll
            pulls only a locked month (Employee leave &amp; attendance → Attendance register).
          </div>
        </div>
      ) : d.register.running.length ? (
        <div className="ep-alert ep-alert--info" role="status">
          <div>
            {d.register.running.map(monthName).join(' and ')} is still running: a pull now is
            provisional; pull again once it is over and locked.
          </div>
        </div>
      ) : null}
      <section className="ep-card" aria-labelledby="ia-steps">
        <h2 id="ia-steps" className="ep-card__title">
          {d.monthWords}:{' '}
          {d.window.from === `${month}-01`
            ? 'the calendar month'
            : `${d.window.from} to ${d.window.to}`}
        </h2>
        <ol className="ep-field__help" style={{ paddingLeft: 'var(--sp-5)', marginTop: 0 }}>
          <li>
            Pull the month from the attendance register (a maker). Look at the rows marked “To look
            at”.
          </li>
          <li>
            Correct a row by hand, upload the sheet, or mark the month present with exceptions (a
            checker).
          </li>
          <li>Finalise (a checker): the month’s run reads only finalised attendance.</li>
        </ol>
        <div className="ep-grid__toolbar">
          {d.can.manage && !allFinal && !frozen ? (
            <form action={pullAttendance.bind(null, month)}>
              <button
                type="submit"
                className="ep-btn ep-btn--primary"
                disabled={d.register.unlocked.length > 0}
              >
                Pull from the register
              </button>
            </form>
          ) : null}
          {d.can.approve && !allFinal && !frozen ? (
            <DialogButton
              id="ia-present"
              label="Mark the month present"
              title="Mark the month present"
              className="ep-btn ep-btn--secondary"
            >
              <form action={markPresent.bind(null, month)} className="ep-form-section__body">
                <p className="ep-field__help">
                  Everyone not finalised is paid the whole month, except the exceptions as typed. It
                  replaces what was pulled for them. Check first: nothing is saved.
                </p>
                <label className="ep-field" htmlFor="ia-ex">
                  <span className="ep-field__label">Exceptions</span>
                  <textarea
                    id="ia-ex"
                    name="exceptions"
                    className="ep-input"
                    rows={5}
                    placeholder={'E014 2\nE021 0 1.5 6'}
                  />
                  <span className="ep-field__help">
                    One a line: employee code, loss-of-pay days, then paid-leave days and OT hours
                    if any
                  </span>
                </label>
                <label className="ep-field" htmlFor="ia-why">
                  <span className="ep-field__label">Reason</span>
                  <input
                    id="ia-why"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </label>
                <p className="ep-grid__toolbar">
                  <button
                    type="submit"
                    name="do"
                    value="check"
                    className="ep-btn ep-btn--secondary"
                  >
                    Check
                  </button>
                  <button type="submit" name="do" value="save" className="ep-btn ep-btn--primary">
                    Mark present
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
          {d.can.manage && !allFinal && !frozen ? (
            <DialogButton
              id="ia-sheet"
              label="Upload the sheet"
              title="The month’s attendance from Excel"
              className="ep-btn ep-btn--secondary"
            >
              <AttendanceUpload month={month} />
            </DialogButton>
          ) : null}
          <span className="ep-grid__spacer" />
          {d.can.approve && !allFinal && f.pulled > 0 && !frozen ? (
            <form action={finaliseAttendance.bind(null, month)}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Finalise the month
              </button>
            </form>
          ) : null}
          {allFinal ? <Badge tone="success">Finalised</Badge> : null}
          {d.can.admin && f.finalised > 0 ? (
            <DialogButton
              id="ia-unfinal"
              label="Un-finalise"
              title="Open the month again"
              className="ep-btn ep-btn--ghost ep-btn--sm"
            >
              <form
                action={unfinaliseAttendance.bind(null, month)}
                className="ep-form-section__body"
              >
                <p className="ep-field__help">
                  Only while no run of the month is past draft. The reason is in the audit log.
                </p>
                <label className="ep-field" htmlFor="ia-unwhy">
                  <span className="ep-field__label">Reason</span>
                  <input
                    id="ia-unwhy"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </label>
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Un-finalise
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
        </div>
      </section>
      <section className="ep-card" aria-labelledby="ia-list" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ia-list" className="ep-card__title">
          Staff
        </h2>
        <form method="get" className="ep-pfilter ep-grid__toolbar">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="tab" value="attendance" />
          <label className="ep-field" htmlFor="ia-q">
            <span className="ep-field__label">Name or code</span>
            <input id="ia-q" name="q" className="ep-input" defaultValue={q} maxLength={60} />
          </label>
          <label className="ep-field" htmlFor="ia-show">
            <span className="ep-field__label">Show</span>
            <select id="ia-show" name="show" className="ep-select" defaultValue={show}>
              {SHOW.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <PerPage id="ia-size" value={String(size)} />
          <button type="submit" className="ep-btn ep-btn--ghost">
            Show
          </button>
        </form>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ia-list">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Days</th>
                <th scope="col">Paid leave</th>
                <th scope="col">Loss of pay</th>
                <th scope="col">Not employed</th>
                <th scope="col">Paid days</th>
                <th scope="col">OT hours</th>
                <th scope="col">From</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => {
                  const a = r.attendance;
                  const off = a ? Number(a.preJoinDays) + Number(a.postLeaveDays) : 0;
                  return (
                    <tr key={r.employee.id}>
                      <td>
                        <a href={`/payroll/inputs/attendance/${r.employee.id}?month=${month}`}>
                          {r.employee.name}
                        </a>
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          {r.employee.code}
                          {r.employee.department ? ` · ${r.employee.department}` : ''}
                        </span>
                      </td>
                      <td>{a?.monthDays ?? ''}</td>
                      <td>{a?.paidLeaveDays ?? ''}</td>
                      <td>
                        {a ? Number(a.lopDays) ? <strong>{a.lopDays}</strong> : a.lopDays : ''}
                      </td>
                      <td>{off ? String(off) : ''}</td>
                      <td>{a?.paidDays ?? ''}</td>
                      <td>{a && Number(a.otHours) ? a.otHours : ''}</td>
                      <td>{a ? SOURCE[a.source] : ''}</td>
                      <td>
                        {r.hold ? (
                          <Badge tone={r.hold.mode === 'SKIP' ? 'neutral' : 'warning'}>
                            {r.hold.mode === 'SKIP' ? 'Skipped' : 'Held'}
                          </Badge>
                        ) : null}{' '}
                        {!a ? (
                          r.hold?.mode === 'SKIP' ? null : (
                            <Badge tone="danger">Not pulled</Badge>
                          )
                        ) : a.finalised ? (
                          <Badge tone="success">Finalised</Badge>
                        ) : (
                          <Badge tone="neutral">Open</Badge>
                        )}{' '}
                        {a && a.warnings ? <Badge tone="warning">To look at</Badge> : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9}>Nobody to show.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={d.page}
          size={d.size}
          total={d.total}
          href={(p) => `/payroll/inputs?${qs(p)}`}
          noun="staff"
        />
      </section>
    </>
  );
}
