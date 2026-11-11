import { FileLinks } from '@/components/FileLinks';
import { DialogButton } from '@/components/leave/DialogButton';
import { DateChips, LeaveStatusCell, halfWords, when } from '@/components/leave/LeaveCells';
import { ListBar, Pages } from '@/components/leave/ListBar';
import { LEAVE_STATUS, type LeaveStatus, type TeamLeave } from '@/lib/leave';
import { decideLeave, decideLeaveCancel } from '@/lib/leave-actions';

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
}: {
  t: TeamLeave;
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
      <form method="get" action="/leave" className="ep-card ep-myleave__filter" aria-label="Filter">
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
      <ListBar
        page={t.page}
        size={t.size}
        total={t.total}
        href={(p) => link(p)}
        sizeHref={(s) => link(1, s)}
        noun="leave applications"
        files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
      />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Reporties leave list">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Sr.No.</th>
              <th scope="col">Leave Id</th>
              <th scope="col">Emp Name</th>
              <th scope="col">Applied Date</th>
              <th scope="col">Attachment</th>
              <th scope="col">Days</th>
              <th scope="col">Is Half Day</th>
              <th scope="col">Leave Type</th>
              <th scope="col">On Behalf?</th>
              <th scope="col">On Behalf Created By</th>
              <th scope="col">Reason</th>
              <th scope="col">Action</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.length ? (
              t.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{(t.page - 1) * t.size + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a href={`/leave/requests/${r.id}`}>{r.number}</a>
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
                    {r.documentFileId ? (
                      <FileLinks
                        href={`/api/files/${r.documentFileId}/download`}
                        label={`the document of ${r.number}`}
                      />
                    ) : (
                      '—'
                    )}
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
                        id={r.id}
                        number={r.number}
                        name={r.employee.name}
                        cancellation={!r.can.decide && r.can.decideCancel}
                        back={back}
                      />
                    ) : (
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/leave/requests/${r.id}`}
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
      <Pages page={t.page} size={t.size} total={t.total} href={(p) => link(p)} noun="leave" />
    </section>
  );
}

/** Approve at once, or Reject with the reason the employee is told (a leave, or its cancellation). */
function Decide({
  id,
  number,
  name,
  cancellation,
  back,
}: {
  id: string;
  number: string;
  name: string;
  cancellation: boolean;
  back: string;
}) {
  const action = (cancellation ? decideLeaveCancel : decideLeave).bind(null, id);
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
      <DialogButton
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
      </DialogButton>
    </div>
  );
}
