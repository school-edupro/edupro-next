'use client';
import { useEffect, useRef, useState } from 'react';
import { LEAVE_STATUS, type LeaveDetail, type LeaveStep } from '@/lib/leave';
import { loadLeave } from '@/lib/leave-actions';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const wd = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
/** dd-mm-yyyy hh:mm, India time */
const when = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(',', '')
    : '—';
const STEP: Record<LeaveStep['status'], [string, string]> = {
  pending: ['Awaiting', ''],
  approved: ['Approved', 'ep-stage--ok'],
  rejected: ['Rejected', 'ep-stage--no'],
  skipped: ['Passed on', 'ep-stage--off'],
};

/**
 * Leave Approval Details (as the old register's): opened from a leave on the register (`[data-lv]` links, a
 * plain click; Ctrl / ⌘ still opens the leave's own page) — the leave's facts, the approval workflow level by
 * level, the cancellation's levels, the days — with Close, the leave's full page, and Cancel Leave for the
 * office (with the reason).
 */
export function LeaveDetailDialog({
  cancel,
  back,
}: {
  cancel: (id: string, fd: FormData) => Promise<void>;
  back: string;
}) {
  const [id, setId] = useState<string | null>(null);
  const [d, setD] = useState<LeaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-lv]');
      if (!a?.dataset.lv) return;
      e.preventDefault();
      setD(null);
      setError(null);
      setAsking(false);
      setId(a.dataset.lv);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    if (!id) return;
    const el = ref.current;
    if (el && !el.open) el.showModal();
    let live = true;
    void loadLeave(id).then((r) => {
      if (!live) return;
      if (r.ok) setD(r.d);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return null;
  const close = () => ref.current?.close();
  const steps = (list: LeaveStep[], current: number | null, cancellation: boolean) => (
    <div
      className="ep-table-wrap"
      tabIndex={0}
      role="region"
      aria-label={cancellation ? 'Cancellation levels' : 'Approval levels'}
    >
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Approver</th>
            <th scope="col">Status</th>
            <th scope="col">Remark</th>
            <th scope="col">{cancellation ? 'Action Date Time' : 'Action Date'}</th>
            {cancellation ? <th scope="col">Applied Date Time</th> : null}
            <th scope="col">Action By</th>
          </tr>
        </thead>
        <tbody>
          {list.length ? (
            list.map((s) => {
              // a level not reached yet shows a dash; the one waiting, Awaiting
              const waiting = s.status === 'pending' && (current === null || s.level === current);
              const [words, cls] = s.status === 'pending' && !waiting ? ['—', ''] : STEP[s.status];
              return (
                <tr key={s.level}>
                  <td>
                    <span className="ep-lvl">L{s.level}</span>
                  </td>
                  <td>
                    <strong>{s.people.join(', ') || s.name}</strong>
                    {s.people.length ? <span className="ep-mr-col__desc">{s.name}</span> : null}
                  </td>
                  <td>
                    <span className={`ep-stage ${cls}`}>{words}</span>
                    {waiting && s.overdue ? <span className="ep-mr-col__desc">overdue</span> : null}
                  </td>
                  <td>{s.note || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(s.actedAt)}</td>
                  {cancellation ? (
                    <td style={{ whiteSpace: 'nowrap' }}>{when(d?.cancelRaisedAt)}</td>
                  ) : null}
                  <td>{s.actedBy ?? '—'}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={cancellation ? 7 : 6} style={{ textAlign: 'center' }}>
                <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                  {cancellation
                    ? 'No cancellation records'
                    : 'No approval levels (entered or deducted directly)'}
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const applied =
    d &&
    `${when(d.appliedAt)} by ${
      d.source === 'self'
        ? `${d.employee.code} — ${d.employee.name}`
        : d.source.startsWith('auto')
          ? 'the system'
          : (d.appliedBy ?? '—')
    }`;
  const days = d?.dayRows ?? [];
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="xl"
      aria-labelledby="lvd-title"
      onClose={() => setId(null)}
    >
      <div className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="lvd-title" className="ep-card__title">
            Leave Approval Details — {d ? `#${d.number}` : '…'}
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="ep-dialog__content ep-weekoff__content">
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>{error}</span>
            </p>
          ) : !d ? (
            <p className="ep-field__help">Loading…</p>
          ) : (
            <>
              <section className="ep-lvd__card" aria-label="The leave">
                <dl className="ep-lvd__facts">
                  <dt>Employee</dt>
                  <dd>
                    {d.employee.code} — {d.employee.name}
                    {d.employee.department ? (
                      <span className="ep-mr-col__desc">{d.employee.department}</span>
                    ) : null}
                  </dd>
                  <dt>Leave Type</dt>
                  <dd>
                    {d.leaveType.code} — {d.leaveType.name}
                  </dd>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={`ep-stage ${d.status === 'approved' ? 'ep-stage--ok' : d.status === 'rejected' ? 'ep-stage--no' : d.status === 'pending' ? '' : 'ep-stage--off'}`}
                    >
                      {LEAVE_STATUS[d.status].label}
                    </span>
                    {d.cancelStatus === 'pending' ? (
                      <span className="ep-mr-col__desc">cancellation asked</span>
                    ) : null}
                  </dd>
                  <dt>From — To</dt>
                  <dd>
                    {dmy(d.from)}{' '}
                    <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                      {wd(d.from)}
                    </span>{' '}
                    — {dmy(d.to)}{' '}
                    <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                      {wd(d.to)}
                    </span>
                    {d.halfDay ? (
                      <span className="ep-mr-col__desc">
                        {d.session === 'first' ? 'first half' : 'second half'}
                      </span>
                    ) : null}
                  </dd>
                  <dt>Days</dt>
                  <dd>{d.days}</dd>
                  <dt>Applied</dt>
                  <dd>{applied}</dd>
                  <dt>Reason</dt>
                  <dd className="ep-lvd__wide">{d.reason}</dd>
                  {d.note ? (
                    <>
                      <dt>Note</dt>
                      <dd className="ep-lvd__wide">{d.note}</dd>
                    </>
                  ) : null}
                </dl>
              </section>
              <section className="ep-lvd__card" aria-labelledby="lvd-wf">
                <h4 id="lvd-wf" className="ep-lvd__title ep-lvd__title--ok">
                  Approval Workflow
                </h4>
                {steps(d.approval, d.status === 'pending' ? d.level : null, false)}
              </section>
              <section className="ep-lvd__card" aria-labelledby="lvd-cx">
                <h4 id="lvd-cx" className="ep-lvd__title ep-lvd__title--no">
                  Leave Cancellation Details
                </h4>
                {d.cancelReason ? (
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    Asked because: {d.cancelReason}
                  </p>
                ) : null}
                {steps(d.cancellation, null, true)}
              </section>
              <section className="ep-lvd__card" aria-labelledby="lvd-days">
                <h4 id="lvd-days" className="ep-lvd__title">
                  Days
                </h4>
                <ul className="ep-lvd__days">
                  {days.map((x) => (
                    <li key={x.day} className="ep-lvd__day">
                      {dmy(x.day)}{' '}
                      <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                        {wd(x.day)}
                      </span>
                      {x.portion < 1 ? ' ½' : ''}
                      {x.kind !== 'work' ? (
                        <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                          {' '}
                          · {x.kind === 'weekoff' ? 'weekly off' : x.kind}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
              {asking && d.can.cancel ? (
                <form
                  action={cancel.bind(null, d.id)}
                  className="ep-note ep-note--warn ep-form-section__body"
                >
                  <input type="hidden" name="back" value={back} />
                  <label className="ep-field" htmlFor="lvd-why">
                    <span className="ep-field__label">Why cancel #{d.number}</span>
                    <textarea
                      id="lvd-why"
                      name="reason"
                      className="ep-input"
                      rows={2}
                      minLength={3}
                      maxLength={400}
                      required
                    />
                  </label>
                  <div className="ep-bulk__row">
                    <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                      Cancel the leave
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      onClick={() => setAsking(false)}
                    >
                      Keep it
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </div>
        <div className="ep-dialog__actions ep-weekoff__actions">
          {d ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/leave/requests/${d.id}`}>
              Full page
            </a>
          ) : null}
          <button type="button" className="ep-btn ep-btn--primary ep-btn--sm" onClick={close}>
            Close
          </button>
          {d?.can.cancel && !asking ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              onClick={() => setAsking(true)}
            >
              Cancel Leave
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
