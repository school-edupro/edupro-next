'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { inspectReceipt } from '@/lib/purchase-actions';
import type { ReceiptDetail } from '@/lib/purchase';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * The inspection of a receipt (docs/design/84, part 7): per line the quantity accepted and rejected
 * (with the reason; for serial numbers, the ones rejected ticked), or the whole receipt rejected with
 * the reason. The committee's members sign the same inspection; changing it asks the others to sign
 * again.
 */
export function InspectionForm({ receipt }: { receipt: ReceiptDetail }) {
  const router = useRouter();
  const lines = receipt.lineItems.filter((l) => l.received > 0);
  const [state, setState] = useState(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          accepted: String(l.accepted ?? l.received),
          rejected: String(l.rejected ?? 0),
          reason: l.rejectReason ?? '',
          serials: new Set(l.rejectedSerials),
        },
      ]),
    ),
  );
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const service = receipt.kind === 'service';
  const committee = receipt.inspection === 'committee';
  const send = (action: 'accept' | 'reject') => {
    setMsg(null);
    if (action === 'reject' && note.trim().length < 3) {
      setMsg('Give the reason for rejecting it');
      return;
    }
    const body = {
      action,
      note: note.trim() || undefined,
      lines:
        action === 'reject'
          ? []
          : lines.map((l) => {
              const v = state[l.id]!;
              return {
                lineId: l.id,
                acceptedQty: v.accepted || 0,
                rejectedQty: v.rejected || 0,
                reason: v.reason || undefined,
                rejectedSerials: [...v.serials],
              };
            }),
    };
    start(async () => {
      const r = await inspectReceipt(receipt.id, body);
      if (r.ok) router.refresh();
      else setMsg(r.error);
    });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send('accept');
      }}
      noValidate
    >
      <div className="ep-purch-lines">
        {lines.map((l) => {
          const v = state[l.id]!;
          const n = String(l.seq);
          const set = (patch: Partial<typeof v>) =>
            setState((cur) => ({ ...cur, [l.id]: { ...cur[l.id]!, ...patch } }));
          return (
            <fieldset key={l.id} className="ep-purch-line ep-purch-line--wide">
              <legend className="ep-purch-line__item">
                {n}. {l.description} — {service ? 'done' : 'received'} {qty(l.received)} {l.uom}
                {l.batch ? ` · batch ${l.batch}` : ''}
              </legend>
              <label className="ep-field" htmlFor={`in-${n}-a`}>
                <span className="ep-field__label">Accepted ({l.uom})</span>
                <input
                  id={`in-${n}-a`}
                  className="ep-input"
                  inputMode="decimal"
                  value={v.accepted}
                  onChange={(e) => {
                    const a = e.target.value;
                    const rest = Math.max(0, l.received - Number(a || 0));
                    set({ accepted: a, rejected: String(Math.round(rest * 1000) / 1000) });
                  }}
                />
              </label>
              <label className="ep-field" htmlFor={`in-${n}-r`}>
                <span className="ep-field__label">Rejected</span>
                <input
                  id={`in-${n}-r`}
                  className="ep-input"
                  inputMode="decimal"
                  value={v.rejected}
                  onChange={(e) => set({ rejected: e.target.value })}
                />
              </label>
              {Number(v.rejected || 0) > 0 ? (
                <label className="ep-field" htmlFor={`in-${n}-why`}>
                  <span className="ep-field__label" data-required="true">
                    Why rejected
                  </span>
                  <input
                    id={`in-${n}-why`}
                    className="ep-input"
                    maxLength={300}
                    value={v.reason}
                    onChange={(e) => set({ reason: e.target.value })}
                  />
                </label>
              ) : null}
              {l.serials.length && Number(v.rejected || 0) > 0 ? (
                <fieldset className="ep-purch-checks">
                  <legend className="ep-field__label">Serial numbers rejected</legend>
                  {l.serials.map((sn) => (
                    <label key={sn} className="ep-check">
                      <input
                        type="checkbox"
                        checked={v.serials.has(sn)}
                        onChange={(e) => {
                          const next = new Set(v.serials);
                          if (e.target.checked) next.add(sn);
                          else next.delete(sn);
                          set({ serials: next });
                        }}
                      />{' '}
                      {sn}
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <label className="ep-field" htmlFor="in-note">
        <span className="ep-field__label">Note (the reason, when rejecting it all)</span>
        <textarea
          id="in-note"
          className="ep-input"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {msg ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {msg}
        </p>
      ) : null}
      <div
        style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}
      >
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {committee
            ? 'Sign the inspection'
            : service
              ? 'Certify the work'
              : 'Accept what is marked accepted'}
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--danger"
          disabled={pending}
          onClick={() => send('reject')}
        >
          {service ? 'Not done: reject it' : 'Reject it all'}
        </button>
      </div>
    </form>
  );
}
