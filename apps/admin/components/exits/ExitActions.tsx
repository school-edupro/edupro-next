'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideExit, resubmitExit, uploadExitLetter, withdrawExit } from '@/lib/exit-actions';
import type { ExitDetail } from '@/lib/exits';

/**
 * What the signed-in person may do on an exit: the approver approves (with the accepted last working day
 * and the notice), sends back with a remark or rejects; the office withdraws a request not yet accepted,
 * or changes one sent back and sends it again.
 */
export function ExitActions({ x }: { x: ExitDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [lastDay, setLastDay] = useState(x.proposedLastDay);
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState(x.reason);
  const [proposed, setProposed] = useState(x.proposedLastDay);
  const [letter, setLetter] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const done = (r: { ok: true } | { ok: false; error: string }, text: string) => {
    if (r.ok) {
      setMsg({ tone: 'success', text });
      router.refresh();
    } else setMsg({ tone: 'danger', text: r.error });
  };
  const short = x.noticeDays > 0 && lastDay < x.expectedLastDay;

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {x.may.decide ? (
        <section
          className="ep-card"
          style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
        >
          <h2 className="ep-card__title" style={{ margin: 0 }}>
            Your decision{x.waitingAt ? ` (${x.waitingAt})` : ''}
          </h2>
          <div className="ep-profile__grid">
            <label className="ep-field" htmlFor="xd-last">
              <span className="ep-field__label">Accepted last working day</span>
              <input
                id="xd-last"
                className="ep-input"
                type="date"
                value={lastDay}
                min={x.requestedOn}
                onChange={(e) => setLastDay(e.target.value)}
              />
              {x.noticeDays ? (
                <span className="ep-field__help">
                  Notice {x.noticeDays} days: expected last day{' '}
                  {x.expectedLastDay.split('-').reverse().join('-')}.
                </span>
              ) : null}
            </label>
            {short ? (
              <label className="ep-check" style={{ alignSelf: 'center' }}>
                <input
                  type="checkbox"
                  className="ep-check__input"
                  checked={waive}
                  onChange={(e) => setWaive(e.target.checked)}
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">Waive the notice shortfall</span>
              </label>
            ) : null}
          </div>
          <label className="ep-field" htmlFor="xd-note">
            <span className="ep-field__label">Remark (needed to send back or reject)</span>
            <input
              id="xd-note"
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
              disabled={pending}
              onClick={() =>
                start(async () =>
                  done(
                    await decideExit(x.id, 'approve', {
                      ...(note.trim() ? { note: note.trim() } : {}),
                      ...(lastDay !== x.proposedLastDay ? { acceptedLastDay: lastDay } : {}),
                      ...(short ? { waiveNotice: waive } : {}),
                    }),
                    'Approved.',
                  ),
                )
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || note.trim().length < 3}
              onClick={() =>
                start(async () =>
                  done(await decideExit(x.id, 'send-back', { note: note.trim() }), 'Sent back.'),
                )
              }
            >
              Send back
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--danger"
              disabled={pending || note.trim().length < 3}
              onClick={() =>
                start(async () =>
                  done(await decideExit(x.id, 'reject', { note: note.trim() }), 'Rejected.'),
                )
              }
            >
              Reject
            </button>
          </div>
        </section>
      ) : null}
      {x.may.edit ? (
        <section
          className="ep-card"
          style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
        >
          <h2 className="ep-card__title" style={{ margin: 0 }}>
            Change and send again
          </h2>
          <div className="ep-profile__grid">
            <label className="ep-field" htmlFor="xe-last">
              <span className="ep-field__label">Proposed last working day</span>
              <input
                id="xe-last"
                className="ep-input"
                type="date"
                value={proposed}
                min={x.requestedOn}
                onChange={(e) => setProposed(e.target.value)}
              />
            </label>
            <label className="ep-field" htmlFor="xe-letter">
              <span className="ep-field__label">A new letter (optional)</span>
              <input
                id="xe-letter"
                className="ep-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setLetter(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <label className="ep-field" htmlFor="xe-reason">
            <span className="ep-field__label">Reason</span>
            <textarea
              id="xe-reason"
              className="ep-input"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  let letterFileId: string | undefined;
                  if (letter) {
                    const fd = new FormData();
                    fd.set('file', letter);
                    const up = await uploadExitLetter(fd);
                    if (!up.ok) return setMsg({ tone: 'danger', text: up.error });
                    letterFileId = up.data.id;
                  }
                  done(
                    await resubmitExit(x.id, {
                      reason: reason.trim(),
                      proposedLastDay: proposed,
                      ...(letterFileId ? { letterFileId } : {}),
                    }),
                    'Sent for approval again.',
                  );
                })
              }
            >
              Send again
            </button>
          </div>
        </section>
      ) : null}
      {x.may.withdraw ? (
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            disabled={pending}
            onClick={() =>
              start(async () =>
                done(await withdrawExit(x.id, 'Withdrawn by the office'), 'Withdrawn.'),
              )
            }
          >
            Withdraw this {x.exitType.name.toLowerCase()}
          </button>
        </div>
      ) : null}
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
