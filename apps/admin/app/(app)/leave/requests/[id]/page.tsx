import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { LEAVE_STATUS, dmy, leaveDates, type LeaveDetail, type LeaveStep } from '@/lib/leave';
import {
  askCancelLeave,
  cancelLeave,
  decideLeave,
  decideLeaveCancel,
  overrideLeave,
  trimLeave,
  withdrawLeave,
} from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const KIND: Record<string, string> = {
  work: '',
  weekoff: ' · weekly off (sandwich)',
  holiday: ' · holiday (sandwich)',
  optional: ' · optional holiday',
};
const STEP: Record<
  LeaveStep['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  skipped: { label: 'Passed on', tone: 'neutral' },
};

function Steps({ id, title, steps }: { id: string; title: string; steps: LeaveStep[] }) {
  return (
    <section className="ep-card" aria-labelledby={id} style={{ marginTop: 'var(--sp-4)' }}>
      <h2 id={id} className="ep-card__title">
        {title}
      </h2>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby={id}>
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Who</th>
              <th scope="col">Status</th>
              <th scope="col">By, when</th>
              <th scope="col">Remark</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.level}>
                <td>
                  {s.level}. {s.name}
                </td>
                <td>{s.people.join(', ') || '—'}</td>
                <td>
                  <Badge tone={STEP[s.status].tone}>{STEP[s.status].label}</Badge>
                  {s.overdue && s.status === 'pending' ? (
                    <span className="ep-mr-col__desc">past its time limit</span>
                  ) : null}
                </td>
                <td>
                  {s.actedBy ?? '—'}
                  {s.actedAt ? (
                    <span className="ep-mr-col__desc">
                      {new Date(s.actedAt).toLocaleString('en-IN')}
                    </span>
                  ) : null}
                </td>
                <td>{s.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One leave (docs/design/85, phase B): its facts, the days counted, who approves and what they did, the
 * cancellation, the changes; and what the viewer may do — decide at their level, withdraw, ask to cancel;
 * the office: cancel, decide for the approvers, shorten the dates.
 */
export default async function LeaveRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ID.test(id)) notFound();
  let d: LeaveDetail;
  try {
    d = await apiFetch<LeaveDetail>(`/leave/requests/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const st = LEAVE_STATUS[d.status];
  const reasonField = (fid: string, label: string, required = true) => (
    <label className="ep-field" htmlFor={fid}>
      <span className="ep-field__label">{label}</span>
      <textarea
        id={fid}
        name={fid.endsWith('note') ? 'note' : 'reason'}
        rows={2}
        maxLength={500}
        minLength={required ? 3 : 0}
        required={required}
        className="ep-input"
      />
    </label>
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'My leave', href: '/leave' }, { label: d.number }]} />
      <PageHeader
        kicker={`Leave · ${d.employee.name} (${d.employee.code})`}
        title={`${d.number} · ${d.leaveType.name}`}
        description={`${leaveDates(d)} · ${String(d.days)} day${d.days === 1 ? '' : 's'} · ${d.sourceWords}${d.appliedBy ? ` by ${d.appliedBy}` : ''} on ${dmy(d.appliedAt.slice(0, 10))}`}
        actions={<Badge tone={st.tone}>{st.label}</Badge>}
      />
      <Notice params={sp} />
      {d.status === 'pending' && d.waitingWith ? (
        <p className="ep-alert ep-alert--info" role="status">
          Waiting with {d.waitingWith}
          {d.level && d.levels ? ` (level ${String(d.level)} of ${String(d.levels)})` : ''}.
        </p>
      ) : null}
      {d.cancelStatus === 'pending' ? (
        <p className="ep-alert ep-alert--warning" role="status">
          A cancellation is asked: {d.cancelReason}
          {d.waitingWith ? ` — waiting with ${d.waitingWith}` : ''}.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="lr-facts">
        <h2 id="lr-facts" className="ep-card__title">
          The leave
        </h2>
        <dl className="ep-myprofile">
          <div>
            <dt>Reason</dt>
            <dd>{d.reason}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{d.employee.department ?? '—'}</dd>
          </div>
          {d.note ? (
            <div>
              <dt>Counted</dt>
              <dd>{d.note}</dd>
            </div>
          ) : null}
          {d.lopPart ? (
            <div>
              <dt>Loss of pay</dt>
              <dd>
                {d.lopPart.number}: {d.lopPart.days} day{d.lopPart.days === 1 ? '' : 's'} (the
                balance was short); decided with this leave
              </dd>
            </div>
          ) : null}
          {d.linkedRequestId ? (
            <div>
              <dt>Part of</dt>
              <dd>
                <a href={`/leave/requests/${d.linkedRequestId}`}>the paid part</a> (decided with it)
              </dd>
            </div>
          ) : null}
          {d.decidedBy ? (
            <div>
              <dt>Decided</dt>
              <dd>
                {d.decidedBy}
                {d.decidedAt ? `, ${new Date(d.decidedAt).toLocaleString('en-IN')}` : ''}
                {d.decisionNote ? ` — ${d.decisionNote}` : ''}
              </dd>
            </div>
          ) : null}
          {d.documentFileId ? (
            <div>
              <dt>Document</dt>
              <dd>
                <FileLinks
                  href={`/api/files/${d.documentFileId}/download`}
                  label={`the document of ${d.number}`}
                />
              </dd>
            </div>
          ) : null}
        </dl>
        <h3 className="ep-field__label" style={{ marginTop: 'var(--sp-3)' }}>
          Days counted
        </h3>
        <ul style={{ margin: 0 }}>
          {d.dayRows.map((x) => (
            <li key={`${x.day}-${x.session ?? 'all'}`}>
              {dmy(x.day)}
              {x.portion < 1 ? ` (${x.session === 'second' ? 'second' : 'first'} half)` : ''}
              {KIND[x.kind]}
              {x.status !== d.status ? ` · ${LEAVE_STATUS[x.status].label.toLowerCase()}` : ''}
            </li>
          ))}
        </ul>
      </section>
      {d.can.decide ? (
        <section
          className="ep-card"
          aria-labelledby="lr-decide"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="lr-decide" className="ep-card__title">
            Your decision
          </h2>
          <form action={decideLeave.bind(null, d.id)} className="ep-form-section__body">
            <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
              <legend className="ep-field__label">Decision</legend>
              <label className="ep-check" htmlFor="lr-ok">
                <input
                  id="lr-ok"
                  type="radio"
                  name="outcome"
                  value="approved"
                  defaultChecked
                  className="ep-check__input"
                />
                <span className="ep-check__box" />
                Approve
              </label>
              <label className="ep-check" htmlFor="lr-no">
                <input
                  id="lr-no"
                  type="radio"
                  name="outcome"
                  value="rejected"
                  className="ep-check__input"
                />
                <span className="ep-check__box" />
                Not approved
              </label>
            </fieldset>
            {reasonField('lr-note', 'Remark (needed when not approved)', false)}
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Send the decision
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {d.can.decideCancel ? (
        <section className="ep-card" aria-labelledby="lr-dc" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="lr-dc" className="ep-card__title">
            Cancel this approved leave?
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {d.employee.name} asks: {d.cancelReason}
          </p>
          <form action={decideLeaveCancel.bind(null, d.id)} className="ep-form-section__body">
            <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
              <legend className="ep-field__label">Decision</legend>
              <label className="ep-check" htmlFor="lr-cok">
                <input
                  id="lr-cok"
                  type="radio"
                  name="outcome"
                  value="approved"
                  defaultChecked
                  className="ep-check__input"
                />
                <span className="ep-check__box" />
                Cancel the leave
              </label>
              <label className="ep-check" htmlFor="lr-cno">
                <input
                  id="lr-cno"
                  type="radio"
                  name="outcome"
                  value="rejected"
                  className="ep-check__input"
                />
                <span className="ep-check__box" />
                Keep the leave
              </label>
            </fieldset>
            {reasonField('lr-cnote', 'Remark (needed to keep the leave)', false)}
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Send the decision
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {d.can.withdraw || d.can.requestCancel ? (
        <section className="ep-card" aria-labelledby="lr-mine" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="lr-mine" className="ep-card__title">
            {d.can.withdraw ? 'Withdraw this leave' : 'Ask to cancel this leave'}
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {d.can.withdraw
              ? 'It is still waiting: withdrawing gives the days back at once.'
              : 'It is approved: your approvers decide the cancellation; until then the leave stands.'}
          </p>
          <form
            action={
              d.can.withdraw ? withdrawLeave.bind(null, d.id) : askCancelLeave.bind(null, d.id)
            }
            className="ep-form-section__body"
          >
            {reasonField('lr-why', 'Why', !d.can.withdraw)}
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {d.can.withdraw ? 'Withdraw' : 'Ask to cancel'}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {d.can.override || d.can.cancel || d.can.trim ? (
        <section
          className="ep-card"
          aria-labelledby="lr-office"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="lr-office" className="ep-card__title">
            The leave office
          </h2>
          {d.can.override ? (
            <form action={overrideLeave.bind(null, d.id)} className="ep-form-section__body">
              <h3 className="ep-field__label">Decide for the approvers</h3>
              <select
                name="outcome"
                className="ep-select"
                aria-label="Decision for the approvers"
                defaultValue="approved"
              >
                <option value="approved">Approve</option>
                <option value="rejected">Not approved</option>
              </select>
              {reasonField('lr-ovr', 'Why the office decides')}
              <div className="ep-form-actions">
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Decide
                </button>
              </div>
            </form>
          ) : null}
          {d.can.trim ? (
            <form action={trimLeave.bind(null, d.id)} className="ep-form-section__body">
              <h3 className="ep-field__label">Shorten the dates (one end at a time)</h3>
              <div className="ep-grid__toolbar">
                <label className="ep-field" htmlFor="lr-tf">
                  <span className="ep-field__label">From</span>
                  <input
                    id="lr-tf"
                    name="from"
                    type="date"
                    min={d.from}
                    max={d.to}
                    defaultValue={d.from}
                    className="ep-input"
                    required
                  />
                </label>
                <label className="ep-field" htmlFor="lr-tt">
                  <span className="ep-field__label">To</span>
                  <input
                    id="lr-tt"
                    name="to"
                    type="date"
                    min={d.from}
                    max={d.to}
                    defaultValue={d.to}
                    className="ep-input"
                    required
                  />
                </label>
              </div>
              {reasonField('lr-trim', 'Why')}
              <div className="ep-form-actions">
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Shorten
                </button>
              </div>
            </form>
          ) : null}
          {d.can.cancel ? (
            <form action={cancelLeave.bind(null, d.id)} className="ep-form-section__body">
              <h3 className="ep-field__label">Cancel the leave now</h3>
              {reasonField('lr-cancel', 'Why')}
              <div className="ep-form-actions">
                <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                  Cancel the leave
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      {d.approval.length ? <Steps id="lr-steps" title="Who approves" steps={d.approval} /> : null}
      {d.cancellation.length ? (
        <Steps id="lr-csteps" title="The cancellation" steps={d.cancellation} />
      ) : null}
      {d.changes.length ? (
        <section
          className="ep-card"
          aria-labelledby="lr-changes"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="lr-changes" className="ep-card__title">
            Changes
          </h2>
          <ul style={{ margin: 0 }}>
            {d.changes.map((x) => (
              <li key={x.at}>
                {x.from} → {x.to}: {x.reason} ({x.by ?? 'the office'},{' '}
                {new Date(x.at).toLocaleString('en-IN')})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
