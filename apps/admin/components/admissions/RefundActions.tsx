'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideAdmissionRefund, payAdmissionRefund } from '@/lib/admission-admit-actions';

/** Approve or reject an admission fee refund, then record its payment (the fee module's refund approvers). */
export function RefundActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('bank');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error ?? 'Not saved');
    });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      {status === 'requested' ? (
        <>
          <input
            className="ep-input"
            aria-label="Note"
            placeholder="Note (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
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
              onClick={() => run(() => decideAdmissionRefund(id, false, note.trim() || undefined))}
            >
              Reject
            </button>
          </span>
        </>
      ) : null}
      {status === 'approved' ? (
        <>
          <select
            className="ep-select"
            aria-label="Paid by"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="gateway">Back to the card / UPI</option>
          </select>
          <input
            className="ep-input"
            aria-label="Reference"
            placeholder="Reference"
            maxLength={80}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() =>
              run(() =>
                payAdmissionRefund(id, {
                  mode,
                  ...(reference.trim() ? { reference: reference.trim() } : {}),
                }),
              )
            }
          >
            Mark paid
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
