import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound } from 'next/navigation';
import { bff } from '@/lib/bff';
import { LEAVE_STATUS, dmy, leaveDates, type LeaveDetail } from '@/lib/leave';
import { askCancelMyLeave, decideMyLeave, decideMyLeaveCancel, withdrawMyLeave } from '../actions';

const STEP: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Not approved',
  skipped: 'Passed on',
};

/** One leave in the staff app (docs/design/85): facts, days, approvers; decide, withdraw, ask to cancel. */
export default async function MyLeaveDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let d: LeaveDetail;
  try {
    d = await bff.api.fetch<LeaveDetail>(`/leave/requests/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const decision = (
    action: (fd: FormData) => Promise<void>,
    yes: string,
    no: string,
    fid: string,
  ) => (
    <form action={action} className="ep-form-section__body">
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">Decision</legend>
        <label className="ep-check" htmlFor={`${fid}-y`}>
          <input
            id={`${fid}-y`}
            type="radio"
            name="outcome"
            value="approved"
            defaultChecked
            className="ep-check__input"
          />
          <span className="ep-check__box" />
          {yes}
        </label>
        <label className="ep-check" htmlFor={`${fid}-n`}>
          <input
            id={`${fid}-n`}
            type="radio"
            name="outcome"
            value="rejected"
            className="ep-check__input"
          />
          <span className="ep-check__box" />
          {no}
        </label>
      </fieldset>
      <label className="ep-field" htmlFor={`${fid}-note`}>
        <span className="ep-field__label">Remark (needed for “{no}”)</span>
        <textarea id={`${fid}-note`} name="note" rows={2} maxLength={500} className="ep-input" />
      </label>
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        Send the decision
      </button>
    </form>
  );
  return (
    <>
      <PageHeader
        kicker="Leave"
        title={`${d.number} · ${d.leaveType.name}`}
        description={`${d.employee.name} (${d.employee.code}) · ${leaveDates(d)} · ${String(d.days)} day${d.days === 1 ? '' : 's'}`}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail ?? 'That did not work.'}
        </p>
      ) : null}
      <Card>
        <p>
          <Badge tone={LEAVE_STATUS[d.status].tone}>{LEAVE_STATUS[d.status].label}</Badge>
          {d.status === 'pending' && d.waitingWith ? ` with ${d.waitingWith}` : ''}
          {d.cancelStatus === 'pending' ? ' · a cancellation is asked' : ''}
        </p>
        <p>{d.reason}</p>
        {d.note ? <p className="ep-field__help">Counted: {d.note}</p> : null}
        {d.lopPart ? (
          <p className="ep-field__help">
            {d.lopPart.days} day{d.lopPart.days === 1 ? '' : 's'} loss of pay ({d.lopPart.number}):
            the balance was short.
          </p>
        ) : null}
        {d.decisionNote ? <p className="ep-field__help">Remark: {d.decisionNote}</p> : null}
        <ul style={{ margin: 0 }}>
          {d.dayRows.map((x) => (
            <li key={`${x.day}-${x.session ?? 'all'}`}>
              {dmy(x.day)}
              {x.portion < 1 ? ` (${x.session === 'second' ? 'second' : 'first'} half)` : ''}
              {x.kind !== 'work' ? ' · weekly off / holiday (sandwich)' : ''}
            </li>
          ))}
        </ul>
      </Card>
      {d.can.decide ? (
        <Card>
          <h2 className="ep-card__title">Your decision</h2>
          {decision(decideMyLeave.bind(null, d.id), 'Approve', 'Not approved', 'ml-d')}
        </Card>
      ) : null}
      {d.can.decideCancel ? (
        <Card>
          <h2 className="ep-card__title">Cancel this approved leave?</h2>
          <p className="ep-field__help">Asked: {d.cancelReason}</p>
          {decision(
            decideMyLeaveCancel.bind(null, d.id),
            'Cancel the leave',
            'Keep the leave',
            'ml-c',
          )}
        </Card>
      ) : null}
      {d.can.withdraw || d.can.requestCancel ? (
        <Card>
          <h2 className="ep-card__title">
            {d.can.withdraw ? 'Withdraw this leave' : 'Ask to cancel this leave'}
          </h2>
          <form
            action={
              d.can.withdraw ? withdrawMyLeave.bind(null, d.id) : askCancelMyLeave.bind(null, d.id)
            }
            className="ep-form-section__body"
          >
            <label className="ep-field" htmlFor="ml-why">
              <span className="ep-field__label">Why</span>
              <textarea
                id="ml-why"
                name="reason"
                rows={2}
                maxLength={500}
                minLength={d.can.withdraw ? 0 : 3}
                required={!d.can.withdraw}
                className="ep-input"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              {d.can.withdraw ? 'Withdraw' : 'Ask to cancel'}
            </button>
          </form>
        </Card>
      ) : null}
      {d.approval.length ? (
        <Card>
          <h2 className="ep-card__title">Who approves</h2>
          <ol style={{ margin: 0 }}>
            {d.approval.map((s) => (
              <li key={s.level}>
                {s.name} ({s.people.join(', ') || '—'}): {STEP[s.status]}
                {s.actedBy ? ` by ${s.actedBy}` : ''}
                {s.note ? ` — ${s.note}` : ''}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      <p>
        <a href="/my-leave">Back to my leave</a>
      </p>
    </>
  );
}
