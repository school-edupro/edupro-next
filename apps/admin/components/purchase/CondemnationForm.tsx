'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { saveCondemnation } from '@/lib/purchase-actions';
import {
  CONDEMNATION_REASON,
  type CondemnationCandidates,
  type CondemnationDetail,
} from '@/lib/purchase';

type Reason = keyof typeof CONDEMNATION_REASON;
interface Line {
  key: string;
  kind: 'asset' | 'stock';
  assetId: string;
  stockKey: string;
  batch: string;
  qty: string;
  reasonKind: Reason;
  reason: string;
}
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
let seq = 0;
const blank = (kind: 'asset' | 'stock'): Line => ({
  key: `l${String((seq += 1))}`,
  kind,
  assetId: '',
  stockKey: '',
  batch: '',
  qty: '',
  reasonKind: kind === 'asset' ? 'unserviceable' : 'expired',
  reason: '',
});

/**
 * A condemnation proposal (docs/design/84, part 9): assets (by tag, unserviceable ones first) and stock
 * quantities (a store's item, a batch for a batch item), each with why; the book value is worked out
 * when saved. Stock in it is held from issue while it is open.
 */
export function CondemnationForm({
  lists,
  existing,
}: {
  lists: CondemnationCandidates;
  existing: CondemnationDetail | null;
}) {
  const router = useRouter();
  const stockOf = useMemo(
    () => new Map(lists.stock.map((s) => [`${s.storeId}:${s.itemId}`, s])),
    [lists.stock],
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    existing
      ? existing.lineItems.map((l) => ({
          ...blank(l.kind),
          kind: l.kind,
          assetId: l.assetId ?? '',
          stockKey: l.kind === 'stock' && l.storeId && l.itemId ? `${l.storeId}:${l.itemId}` : '',
          batch: l.batch ?? '',
          qty: l.qty === null ? '' : String(l.qty),
          reasonKind: l.reasonKind,
          reason: l.reason ?? '',
        }))
      : [blank('asset')],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, p: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.key === k ? { ...l, ...p } : l)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const body = {
          title,
          note: note || undefined,
          lines: lines
            .filter((l) => (l.kind === 'asset' ? l.assetId : l.stockKey && l.qty))
            .map((l) => {
              if (l.kind === 'asset')
                return {
                  kind: 'asset',
                  assetId: l.assetId,
                  reasonKind: l.reasonKind,
                  reason: l.reason || undefined,
                };
              const [storeId, itemId] = l.stockKey.split(':');
              return {
                kind: 'stock',
                storeId,
                itemId,
                batch: l.batch || undefined,
                qty: l.qty,
                reasonKind: l.reasonKind,
                reason: l.reason || undefined,
              };
            }),
        };
        if (!body.lines.length) {
          setError('Add an asset or a stock line');
          return;
        }
        start(async () => {
          const r = await saveCondemnation(existing?.id ?? null, body);
          if (r.ok)
            router.push(
              `/purchase/condemnations/${r.id}?ok=1&detail=${encodeURIComponent(existing ? 'Saved' : `${r.number ?? 'Proposal'} drafted: send it to the committee when ready`)}`,
            );
          else setError(r.error);
        });
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="2">
        <label className="ep-field" htmlFor="cd-title">
          <span className="ep-field__label" data-required="true">
            Title
          </span>
          <input
            id="cd-title"
            className="ep-input"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="cd-note">
          <span className="ep-field__label">Note</span>
          <input
            id="cd-note"
            className="ep-input"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="ep-purch-lines" style={{ marginTop: 'var(--sp-4)' }}>
        {lines.map((l, i) => {
          const n = String(i + 1);
          const s = stockOf.get(l.stockKey);
          const bs = s?.tracksBatch
            ? lists.batches.filter((b) => `${b.storeId}:${b.itemId}` === l.stockKey)
            : [];
          return (
            <fieldset key={l.key} className="ep-purch-line ep-purch-line--wide">
              <legend className="ep-purch-line__item">
                {n}. {l.kind === 'asset' ? 'An asset' : 'Stock'}
              </legend>
              {l.kind === 'asset' ? (
                <label className="ep-field" htmlFor={`cd-${n}-a`}>
                  <span className="ep-field__label">Asset</span>
                  <select
                    id={`cd-${n}-a`}
                    className="ep-select"
                    value={l.assetId}
                    onChange={(e) => set(l.key, { assetId: e.target.value })}
                  >
                    <option value="">Pick the asset</option>
                    {lists.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.tag} · {a.item} · {a.condition} · ₹{fmt(a.bookValue)}
                        {a.place ? ` · ${a.place}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="ep-field" htmlFor={`cd-${n}-s`}>
                    <span className="ep-field__label">Store and item</span>
                    <select
                      id={`cd-${n}-s`}
                      className="ep-select"
                      value={l.stockKey}
                      onChange={(e) => set(l.key, { stockKey: e.target.value, batch: '' })}
                    >
                      <option value="">Pick the item</option>
                      {lists.stock.map((x) => (
                        <option key={`${x.storeId}:${x.itemId}`} value={`${x.storeId}:${x.itemId}`}>
                          {x.store} · {x.name} ({x.code}) — {fmt(x.free)} {x.unit} free
                        </option>
                      ))}
                    </select>
                  </label>
                  {bs.length ? (
                    <label className="ep-field" htmlFor={`cd-${n}-b`}>
                      <span className="ep-field__label" data-required="true">
                        Batch
                      </span>
                      <select
                        id={`cd-${n}-b`}
                        className="ep-select"
                        value={l.batch}
                        onChange={(e) => set(l.key, { batch: e.target.value })}
                      >
                        <option value="">Pick the batch</option>
                        {bs.map((b) => (
                          <option key={`${b.batch}-${b.expiry ?? ''}`} value={b.batch}>
                            {b.batch}
                            {b.expiry ? ` · expires ${b.expiry}` : ''} · {fmt(b.qty)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="ep-field" htmlFor={`cd-${n}-q`}>
                    <span className="ep-field__label">Quantity{s ? ` (${s.unit})` : ''}</span>
                    <input
                      id={`cd-${n}-q`}
                      className="ep-input"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => set(l.key, { qty: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label className="ep-field" htmlFor={`cd-${n}-r`}>
                <span className="ep-field__label">Why</span>
                <select
                  id={`cd-${n}-r`}
                  className="ep-select"
                  value={l.reasonKind}
                  onChange={(e) => set(l.key, { reasonKind: e.target.value as Reason })}
                >
                  {Object.entries(CONDEMNATION_REASON).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor={`cd-${n}-d`}>
                <span className="ep-field__label">What is wrong</span>
                <input
                  id={`cd-${n}-d`}
                  className="ep-input"
                  maxLength={300}
                  value={l.reason}
                  onChange={(e) => set(l.key, { reason: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
              >
                Remove line {n}
              </button>
            </fieldset>
          );
        })}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setLines((cur) => [...cur, blank('asset')])}
          >
            Add an asset
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setLines((cur) => [...cur, blank('stock')])}
          >
            Add stock
          </button>
        </div>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          Save the draft
        </button>
      </div>
    </form>
  );
}
