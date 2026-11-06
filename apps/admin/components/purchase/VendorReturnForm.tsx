'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { returnToVendor } from '@/lib/purchase-actions';
import type { Returnable } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
interface Row {
  qty: string;
  reason: string;
  replacement: boolean;
}

/**
 * Goods going back to the vendor (docs/design/84, part 8): per receipt line, what was rejected at
 * inspection (never in stock) and what is taken out of stock because it was found defective; whether
 * a replacement is wanted (the PO waits for it) — without one, close the PO short. One store per note.
 */
export function VendorReturnForm({ data }: { data: Returnable }) {
  const router = useRouter();
  const rows = data.lines.flatMap((l) => [
    ...(l.rejectedLeft > 0
      ? [{ key: `${l.receiptLineId}:rejected`, l, source: 'rejected' as const }]
      : []),
    ...(l.stockLeft > 0 ? [{ key: `${l.receiptLineId}:stock`, l, source: 'stock' as const }] : []),
  ]);
  const [state, setState] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.key,
        {
          qty: r.source === 'rejected' ? String(r.l.rejectedLeft) : '',
          reason: r.source === 'rejected' ? (r.l.rejectReason ?? '') : '',
          replacement: true,
        },
      ]),
    ),
  );
  const [dispatch, setDispatch] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length)
    return (
      <p className="ep-alert ep-alert--info" role="status">
        Nothing of this PO can go back: no rejected goods are waiting and nothing accepted is in
        stock.
      </p>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const body = {
          orderId: data.order.id,
          dispatch: dispatch || undefined,
          note: note || undefined,
          lines: rows
            .map((r) => ({ r, v: state[r.key]! }))
            .filter(({ v }) => Number(v.qty || 0) > 0)
            .map(({ r, v }) => ({
              receiptLineId: r.l.receiptLineId,
              source: r.source,
              qty: v.qty,
              reason: v.reason,
              replacement: v.replacement,
            })),
        };
        if (!body.lines.length) {
          setError('Give the quantity going back on a line');
          return;
        }
        start(async () => {
          const r = await returnToVendor(body);
          if (r.ok)
            router.push(
              `/purchase/returns/${r.id}?ok=1&detail=${encodeURIComponent(`${r.number ?? 'Return'} recorded${r.detail ? `: ${r.detail}` : ''}`)}`,
            );
          else setError(r.error);
        });
      }}
      noValidate
    >
      <div className="ep-purch-lines">
        {rows.map((r, i) => {
          const v = state[r.key]!;
          const n = String(i + 1);
          const set = (p: Partial<Row>) =>
            setState((cur) => ({ ...cur, [r.key]: { ...cur[r.key]!, ...p } }));
          return (
            <fieldset key={r.key} className="ep-purch-line ep-purch-line--wide">
              <legend className="ep-purch-line__item">
                {n}. {r.l.item} · {r.l.receipt} · {r.l.store} —{' '}
                {r.source === 'rejected'
                  ? `${fmt(r.l.rejectedLeft)} ${r.l.unit} rejected at inspection, still here`
                  : `${fmt(r.l.stockLeft)} ${r.l.unit} accepted into stock (found defective)`}
              </legend>
              <label className="ep-field" htmlFor={`vr-${n}-q`}>
                <span className="ep-field__label">Going back ({r.l.unit})</span>
                <input
                  id={`vr-${n}-q`}
                  className="ep-input"
                  inputMode="decimal"
                  value={v.qty}
                  onChange={(e) => set({ qty: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor={`vr-${n}-r`}>
                <span className="ep-field__label" data-required="true">
                  Why
                </span>
                <input
                  id={`vr-${n}-r`}
                  className="ep-input"
                  maxLength={300}
                  value={v.reason}
                  onChange={(e) => set({ reason: e.target.value })}
                />
              </label>
              <label className="ep-check" htmlFor={`vr-${n}-rep`}>
                <input
                  id={`vr-${n}-rep`}
                  className="ep-check__input"
                  type="checkbox"
                  checked={v.replacement}
                  onChange={(e) => set({ replacement: e.target.checked })}
                />
                <span className="ep-check__box" />A replacement is wanted
              </label>
            </fieldset>
          );
        })}
      </div>
      <div className="ep-form-row" data-columns="2" style={{ marginTop: 'var(--sp-3)' }}>
        <label className="ep-field" htmlFor="vr-dispatch">
          <span className="ep-field__label">Sent with (carrier, docket, who took it)</span>
          <input
            id="vr-dispatch"
            className="ep-input"
            maxLength={300}
            value={dispatch}
            onChange={(e) => setDispatch(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="vr-note">
          <span className="ep-field__label">Note</span>
          <input
            id="vr-note"
            className="ep-input"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          Record the return note
        </button>
      </div>
    </form>
  );
}
