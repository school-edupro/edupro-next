'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { closeMove, requestMove, useAdmissionCredit } from '@/lib/admission-move-actions';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

export interface RegistrationMoveRow {
  id: string;
  status: string;
  direction: 'outgoing' | 'incoming';
  reason: string;
  fromSchool: string;
  toSchool: string;
  fromNumber: string | null;
  toNumber: string | null;
  requestedAt: string;
  requestedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  carried: number | null;
  differenceDue: number | null;
  credit: number | null;
  missing: string[];
}

/** Registered up to the admission fee paid: a registration that may move (docs/design/64). */
const MOVABLE = (status: string, number: string | null) =>
  Boolean(number) && !['draft', 'submitted', 'admitted', 'cancelled', 'withdrawn'].includes(status);

/**
 * A registration and the group's other school (docs/design/64): moved here (the money carried, the
 * credit), waiting to move (withdraw), moved away; Move to another school with a reason; the credit
 * used on an offer.
 */
export function RegistrationMove({
  id,
  status,
  number,
  moves,
  credit,
  targets,
  canMove,
  canUseCredit,
}: {
  id: string;
  status: string;
  number: string | null;
  moves: RegistrationMoveRow[];
  credit: number;
  targets: Array<{ id: string; name: string }>;
  canMove: boolean;
  canUseCredit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [toSchoolId, setToSchoolId] = useState(targets[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState('');
  const open = moves.find((m) => m.direction === 'outgoing' && m.status === 'requested');
  const done = (text: string) => {
    setMsg({ tone: 'success', text });
    setAsking(false);
    setWithdrawing(false);
    router.refresh();
  };
  const mayAsk =
    canMove && !open && targets.length > 0 && MOVABLE(status, number) && status !== 'cancelled';
  if (!moves.length && !mayAsk && !(credit > 0)) return null;

  return (
    <section className="ep-rp__act" aria-label="Move between schools">
      {moves.map((m) => (
        <p key={m.id} style={{ margin: 0 }}>
          {m.direction === 'incoming' ? (
            <>
              Moved here from {m.fromSchool} (registration {m.fromNumber ?? '-'}) on{' '}
              {dmy(m.decidedAt)}: {m.reason}.{m.carried ? ` Carried over ${rupees(m.carried)}` : ''}
              {m.differenceDue ? `; ${rupees(m.differenceDue)} of the registration fee to pay` : ''}
              {m.credit ? `; credit ${rupees(m.credit)} for the admission fee` : ''}
              {m.carried || m.differenceDue || m.credit ? '.' : ''}
              {m.missing.length
                ? ` The family was asked for ${String(m.missing.length)} answer${m.missing.length === 1 ? '' : 's'} this form needs.`
                : ''}
            </>
          ) : m.status === 'requested' ? (
            <>
              Waiting to move to <strong>{m.toSchool}</strong> since {dmy(m.requestedAt)}
              {m.requestedBy ? ` (asked by ${m.requestedBy})` : ''}: {m.reason}
            </>
          ) : m.status === 'accepted' ? (
            <>
              Moved to {m.toSchool}
              {m.toNumber ? ` (registration ${m.toNumber})` : ''} on {dmy(m.decidedAt)}.
            </>
          ) : (
            <span className="ep-field__help" style={{ margin: 0 }}>
              Move to {m.toSchool} {m.status === 'refused' ? 'refused' : 'withdrawn'} on{' '}
              {dmy(m.decidedAt)}
              {m.decisionNote ? `: ${m.decisionNote}` : ''}
            </span>
          )}
        </p>
      ))}

      {open && canMove ? (
        withdrawing ? (
          <div className="ep-rp__row">
            <label className="ep-field">
              <span className="ep-field__label">Why withdraw the move</span>
              <input
                className="ep-input"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={pending || note.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await closeMove(open.id, 'withdraw', note.trim());
                    if (r.ok) done('The move is withdrawn.');
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                Withdraw the move
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                onClick={() => setWithdrawing(false)}
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setWithdrawing(true)}
            >
              Withdraw the move
            </button>
          </div>
        )
      ) : null}

      {credit > 0 ? (
        <p className="ep-alert ep-alert--info" style={{ margin: 0 }}>
          Credit carried over from the other school: <strong>{rupees(credit)}</strong>.{' '}
          {status === 'offered'
            ? 'Use it for the admission fee.'
            : 'It pays the admission fee when admission is offered.'}
          {status === 'offered' && canUseCredit ? (
            <>
              {' '}
              <button
                type="button"
                className="ep-btn ep-btn--primary ep-btn--sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await useAdmissionCredit(id);
                    if (r.ok)
                      done(
                        `${rupees(r.data.used)} of the credit used (receipt ${r.data.receiptNo ?? '-'})${r.data.admissionNo ? `; admission no. ${r.data.admissionNo}` : ''}.`,
                      );
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                Use the credit
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {mayAsk ? (
        asking ? (
          <div className="ep-rp__act">
            <p style={{ margin: 0 }}>
              Registered in the wrong school? The other school accepts it into its session and
              class: a fresh registration there with this form, its documents and the family&rsquo;s
              login; this one is cancelled &ldquo;Moved to …&rdquo;. The fees paid here go with it
              as credit (no cash): the registration fee there first, the rest for its admission fee.
            </p>
            <div className="ep-rp__row">
              <label className="ep-field">
                <span className="ep-field__label">Move to</span>
                <select
                  className="ep-select"
                  value={toSchoolId}
                  onChange={(e) => setToSchoolId(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Reason</span>
                <input
                  className="ep-input"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Registered in Alpha by mistake; the family wants Beta"
                />
              </label>
            </div>
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending || !toSchoolId || reason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await requestMove(id, { toSchoolId, reason: reason.trim() });
                    if (r.ok)
                      done(
                        `Sent to ${targets.find((t) => t.id === toSchoolId)?.name ?? 'the school'}: it moves once they accept it.`,
                      );
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                Send to the other school
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                onClick={() => setAsking(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => setAsking(true)}
            >
              Move to another school
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
    </section>
  );
}
