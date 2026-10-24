'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  previewAdmissionCancel,
  requestAdmissionCancel,
  withdrawAdmissionCancel,
  type CancelOutcome,
} from '@/lib/student-correction-actions';

export interface CancelItem {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  settlement: 'refund' | 'retain';
  reason: string;
  preview: CancelOutcome;
  result: CancelOutcome | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  waitingAt: string | null;
  mine: boolean;
}
export interface CancelSetup {
  definitionId: string;
  levels: Array<{ level: number; name: string; approvers: string }>;
}

const STATUS: Record<CancelItem['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  applied: { label: 'Admission cancelled', tone: 'danger' },
  rejected: { label: 'Not cancelled', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** What cancelling the admission does: the fee before and after, refunds or money kept, logins. */
export function CancelOutcomeView({ o }: { o: CancelOutcome }) {
  const f = o.fee;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">Fee of the year, before and after</caption>
          <thead>
            <tr>
              <th scope="col">Fee of the year</th>
              <th scope="col">Charged</th>
              <th scope="col">Paid</th>
              <th scope="col">Due</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Now</th>
              <td>{rs(f.before.charged)}</td>
              <td>{rs(f.before.paid)}</td>
              <td>{rs(f.before.due)}</td>
            </tr>
            <tr>
              <th scope="row">After</th>
              <td>{rs(f.after.charged)}</td>
              <td>{rs(f.after.paid)}</td>
              <td>
                <strong>{rs(f.after.due)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul style={{ margin: 0 }}>
        <li>Unpaid fee cancelled: {rs(f.cancelled)}.</li>
        {o.settlement === 'refund' ? (
          <li>
            {f.refunds
              ? `${rs(f.refundTotal)} paid goes back as ${String(f.refunds)} refund(s), after the refund approvers agree.`
              : 'Nothing paid to refund.'}
          </li>
        ) : (
          <li>The school keeps what was paid: {rs(f.retained)}.</li>
        )}
        {o.admissionFee ? (
          <li>
            Admission fee {rs(o.admissionFee.paid)}:{' '}
            {o.admissionFee.refund > 0
              ? `${rs(o.admissionFee.refund)} refunded after the deduction of ${rs(o.admissionFee.deduction)}`
              : 'kept by the school'}
            ; the registration is cancelled.
          </li>
        ) : null}
        <li>
          The pupil leaves the class: out of strength, attendance and result reports (marks and
          attendance stay on the record).
          {o.hostelBed ? ' The hostel bed is given up.' : ''}
        </li>
        <li>
          Logins stopped: {o.logins.student ? 'the pupil’s' : 'no pupil login'}
          {o.logins.parents
            ? `, ${String(o.logins.parents)} parent login(s)`
            : ' (a parent with another child here keeps theirs)'}
          .
        </li>
      </ul>
    </div>
  );
}

/**
 * "Cancel admission" (docs/design/37, part 4): the pupil was admitted by mistake. Choose whether what was
 * paid is refunded or kept, see what happens, give the reason; the approval levels decide.
 */
export function AdmissionCancel({
  studentId,
  active,
  setup,
  history,
  canRequest,
  canSetUp,
}: {
  studentId: string;
  active: boolean;
  setup: CancelSetup;
  history: CancelItem[];
  canRequest: boolean;
  canSetUp: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [settlement, setSettlement] = useState<'refund' | 'retain'>('refund');
  const [preview, setPreview] = useState<CancelOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const waiting = history.find((x) => x.status === 'pending');

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        Admitted by mistake? The admission is cancelled with the money settled: what was paid is
        refunded, or the school keeps it. Decided by{' '}
        {setup.levels.map((l, i) => (
          <span key={l.level}>
            {i ? ', then ' : ''}
            <strong>{l.name}</strong> ({l.approvers})
          </span>
        ))}
        .{' '}
        {canSetUp ? (
          <a
            href={`/workflow/definitions?edit=${setup.definitionId}`}
            style={{ textDecoration: 'underline' }}
          >
            Change who approves
          </a>
        ) : null}
      </p>
      {waiting ? (
        <div className="ep-alert ep-alert--warning" role="status">
          A cancellation is waiting{waiting.waitingAt ? ` at ${waiting.waitingAt}` : ''}.
        </div>
      ) : null}
      {canRequest && active && !waiting ? (
        open ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">What was paid</legend>
              {(
                [
                  ['refund', 'Refund it (through the refund approvals)'],
                  ['retain', 'The school keeps it'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="ep-radio">
                  <input
                    type="radio"
                    className="ep-radio__input"
                    name={`${uid}-settle`}
                    checked={settlement === v}
                    onChange={() => {
                      setSettlement(v);
                      setPreview(null);
                    }}
                  />
                  <span className="ep-radio__dot" aria-hidden="true" />
                  <span className="ep-check__text">{label}</span>
                </label>
              ))}
            </fieldset>
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg(null);
                    const r = await previewAdmissionCancel(studentId, settlement);
                    if (r.ok) setPreview(r.data);
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                See what changes
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setPreview(null);
                }}
              >
                Cancel
              </button>
            </div>
            {preview ? (
              <>
                <CancelOutcomeView o={preview} />
                <label className="ep-field" htmlFor={`${uid}-reason`}>
                  <span className="ep-field__label">Reason</span>
                  <input
                    id={`${uid}-reason`}
                    className="ep-input"
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    placeholder="e.g. admitted by mistake: no seat in the class"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="ep-form-actions">
                  <button
                    type="button"
                    className="ep-btn ep-btn--danger"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() =>
                      start(async () => {
                        const r = await requestAdmissionCancel(studentId, {
                          settlement,
                          reason: reason.trim(),
                        });
                        if (r.ok) {
                          setMsg({
                            tone: 'success',
                            text: 'Sent for approval. The admission is cancelled when it is approved.',
                          });
                          setOpen(false);
                          setPreview(null);
                          router.refresh();
                        } else setMsg({ tone: 'danger', text: r.error });
                      })
                    }
                  >
                    Send for approval
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                setMsg(null);
                setOpen(true);
              }}
            >
              Cancel admission
            </button>
          </div>
        )
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      {history.length ? (
        <ul className="ep-rp__events">
          {history.map((x) => (
            <li key={x.id}>
              <span className={`ep-badge ep-badge--${STATUS[x.status].tone}`}>
                {STATUS[x.status].label}
              </span>{' '}
              {x.settlement === 'refund' ? 'Refund what was paid' : 'The school keeps the money'} ·{' '}
              {x.reason}
              <div className="ep-field__help">
                Asked by {x.requestedBy ?? ''} {when(x.requestedAt)}
                {x.status === 'pending' && x.waitingAt ? ` · at ${x.waitingAt}` : ''}
                {x.decidedAt ? ` · decided by ${x.decidedBy ?? ''} ${when(x.decidedAt)}` : ''}
                {x.note ? ` · ${x.note}` : ''}
              </div>
              {x.applyError ? <div className="ep-field__help">{x.applyError}</div> : null}
              <details>
                <summary>{x.result ? 'What it did' : 'What it would do'}</summary>
                <CancelOutcomeView o={x.result ?? x.preview} />
              </details>
              {x.status === 'pending' && x.mine ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await withdrawAdmissionCancel(studentId, x.id);
                      if (r.ok) router.refresh();
                      else setMsg({ tone: 'danger', text: r.error });
                    })
                  }
                >
                  Withdraw
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
