'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { acceptMove, closeMove, previewMove, type MoveOutcome } from '@/lib/admission-move-actions';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

interface Cycle {
  id: string;
  name: string;
  open: boolean;
  classes: Array<{ id: string; name: string }>;
}

/**
 * The receiving school's decision on a registration moved here (docs/design/64): the session and class
 * (the same class suggested), what accepting does (the fee here, the money carried, a difference to pay
 * or credit, the answers the family will be asked for), Accept; or Refuse with a reason. The first
 * school may withdraw its move.
 */
export function MoveDecide({
  id,
  side,
  cycles = [],
  suggested = null,
  fromSchool,
}: {
  id: string;
  side: 'incoming' | 'outgoing';
  cycles?: Cycle[];
  suggested?: { cycleId: string; classId: string } | null;
  fromSchool: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [cycleId, setCycleId] = useState(suggested?.cycleId ?? cycles[0]?.id ?? '');
  const classes = cycles.find((c) => c.id === cycleId)?.classes ?? [];
  const [classId, setClassId] = useState(suggested?.classId ?? classes[0]?.id ?? '');
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [made, setMade] = useState<{ applicationId: string; number: string | null } | null>(null);

  useEffect(() => {
    if (side !== 'incoming' || !cycleId || !classId) return;
    let live = true;
    setOutcome(null);
    setProblem(null);
    void previewMove(id, { cycleId, classId }).then((r) => {
      if (!live) return;
      if (r.ok) setOutcome(r.data);
      else setProblem(r.error);
    });
    return () => {
      live = false;
    };
  }, [id, side, cycleId, classId]);

  if (made)
    return (
      <div className="ep-alert ep-alert--success" role="status">
        Accepted:{' '}
        {made.number
          ? `registration ${made.number}`
          : 'the registration waits for the fee difference'}
        .{' '}
        <a
          href={`/admissions/registrations/${made.applicationId}`}
          style={{ textDecoration: 'underline' }}
        >
          Open the registration
        </a>
      </div>
    );

  return (
    <div className="ep-rp__act">
      {side === 'incoming' ? (
        <>
          <div className="ep-rp__row">
            <label className="ep-field">
              <span className="ep-field__label">Session here</span>
              <select
                className="ep-select"
                value={cycleId}
                onChange={(e) => {
                  setCycleId(e.target.value);
                  setClassId(cycles.find((c) => c.id === e.target.value)?.classes[0]?.id ?? '');
                }}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.open ? '' : ' (closed)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Class</span>
              <select
                className="ep-select"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {problem ? (
            <div className="ep-alert ep-alert--danger" role="alert">
              {problem}
            </div>
          ) : outcome ? (
            <section aria-label="What accepting does" className="ep-alert ep-alert--info">
              <div>
                <p style={{ margin: 0 }}>
                  A fresh registration in {outcome.className} ({outcome.session})
                  {outcome.category ? `, category ${outcome.category}` : ''}: registration fee{' '}
                  {rupees(outcome.fee)}.
                </p>
                <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
                  <li>
                    Carried over from {fromSchool}: {rupees(outcome.carried)} (no cash; their
                    receipts are closed as transferred).
                  </li>
                  {outcome.toRegistration > 0 ? (
                    <li>{rupees(outcome.toRegistration)} pays the registration fee here.</li>
                  ) : null}
                  {outcome.differenceDue > 0 ? (
                    <li>
                      The family pays the difference of {rupees(outcome.differenceDue)}; the
                      registration number comes after it.
                    </li>
                  ) : (
                    <li>The registration number is given at once.</li>
                  )}
                  {outcome.credit > 0 ? (
                    <li>
                      {rupees(outcome.credit)} stays as credit: it pays the admission fee when
                      admission is offered.
                    </li>
                  ) : null}
                  <li>
                    {outcome.missing.length
                      ? `The family will be asked for what this form needs and the copy lacks: ${outcome.missing.join(', ')}.`
                      : 'Every answer this form needs is in the copy.'}
                  </li>
                </ul>
              </div>
            </section>
          ) : cycleId && classId ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Working out what accepting does…
            </p>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No session of this school takes registrations yet.
            </p>
          )}
          <label className="ep-field">
            <span className="ep-field__label">Note (optional)</span>
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
              className="ep-btn ep-btn--primary"
              disabled={pending || !outcome}
              onClick={() =>
                start(async () => {
                  const r = await acceptMove(id, {
                    cycleId,
                    classId,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  });
                  if (r.ok) {
                    setMade({ applicationId: r.data.applicationId, number: r.data.newNumber });
                    router.refresh();
                  } else setMsg({ tone: 'danger', text: r.error });
                })
              }
            >
              Accept the registration
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--danger"
              disabled={pending || note.trim().length < 3}
              title="Write the reason in the note first"
              onClick={() =>
                start(async () => {
                  const r = await closeMove(id, 'refuse', note.trim());
                  if (r.ok) {
                    setMsg({
                      tone: 'success',
                      text: `Refused: ${fromSchool} keeps the registration.`,
                    });
                    router.refresh();
                  } else setMsg({ tone: 'danger', text: r.error });
                })
              }
            >
              Refuse
            </button>
          </div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            To refuse, write the reason in the note.
          </p>
        </>
      ) : (
        <>
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
                  const r = await closeMove(id, 'withdraw', note.trim());
                  if (r.ok) {
                    setMsg({ tone: 'success', text: 'The move is withdrawn.' });
                    router.refresh();
                  } else setMsg({ tone: 'danger', text: r.error });
                })
              }
            >
              Withdraw the move
            </button>
          </div>
        </>
      )}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
