'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideAdmissionRefund, payAdmissionRefund } from '@/lib/admission-admit-actions';

/**
 * Approve or reject an admission fee refund at the viewer's level (docs/design/54; a remark is needed
 * to reject), then Accounts pay it out with the mode, reference and date.
 */
export function RefundActions({
  id,
  mayDecide,
  mayPay,
  today,
}: {
  id: string;
  mayDecide: boolean;
  mayPay: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('bank');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error ?? 'Not saved');
    });
  if (!mayDecide && !mayPay) return null;
  return (
    <div className="ep-arf__act">
      {mayDecide ? (
        <>
          <label className="ep-field">
            <span className="ep-field__label">Remark (needed to reject)</span>
            <input
              className="ep-input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <span className="ep-arf__btns">
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={pending}
              onClick={() => run(() => decideAdmissionRefund(id, true, note.trim() || undefined))}
            >
              Approve
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={pending}
              onClick={() => {
                if (!note.trim()) {
                  setError('Write the reason for not approving.');
                  return;
                }
                run(() => decideAdmissionRefund(id, false, note.trim()));
              }}
            >
              Reject
            </button>
          </span>
        </>
      ) : null}
      {mayPay ? (
        <>
          <label className="ep-field">
            <span className="ep-field__label">Paid by</span>
            <select className="ep-select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="bank">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
              <option value="gateway">Back to the card / UPI</option>
            </select>
          </label>
          {mode !== 'cash' ? (
            <label className="ep-field">
              <span className="ep-field__label">
                {mode === 'cheque' ? 'Cheque no.' : 'Reference / UTR'} *
              </span>
              <input
                className="ep-input"
                maxLength={80}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">Paid on</span>
            <input
              className="ep-input"
              type="date"
              max={today}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => {
              if (mode !== 'cash' && !reference.trim()) {
                setError('Give the cheque no. or the transfer reference.');
                return;
              }
              run(() =>
                payAdmissionRefund(id, {
                  mode,
                  ...(reference.trim() ? { reference: reference.trim() } : {}),
                  ...(paidOn ? { paidOn } : {}),
                }),
              );
            }}
          >
            {pending ? 'Saving…' : 'Pay and make the voucher'}
          </button>
        </>
      ) : null}
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
