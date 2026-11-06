'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { makeTransfer } from '@/lib/purchase-actions';
import type { IssueFormLists } from '@/lib/purchase';

interface Line {
  itemId: string;
  qty: string;
  batch: string;
}
const blank = (): Line => ({ itemId: '', qty: '', batch: '' });
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Send stock to another store (docs/design/84, part 8): from a store I keep, to any store in use; per
 * line the item (only free stock goes), the quantity and, for a batch item, the batch (else the
 * earliest expiry first).
 */
export function TransferForm({
  lists,
  allStores,
}: {
  lists: IssueFormLists;
  allStores: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(lists.stores[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stock = useMemo(() => lists.stock.filter((s) => s.storeId === from), [lists.stock, from]);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const body = {
          fromStoreId: from,
          toStoreId: to,
          note: note || undefined,
          lines: lines
            .filter((l) => l.itemId && l.qty)
            .map((l) => ({ itemId: l.itemId, qty: l.qty, ...(l.batch ? { batch: l.batch } : {}) })),
        };
        if (!to) {
          setError('Pick the store it goes to');
          return;
        }
        if (!body.lines.length) {
          setError('Give the item and quantity of at least one line');
          return;
        }
        start(async () => {
          const r = await makeTransfer(body);
          if (r.ok)
            router.push(
              `/purchase/transfers/${r.id}?ok=1&detail=${encodeURIComponent(`${r.number ?? 'Transfer'} sent: in transit until received`)}`,
            );
          else setError(r.error);
        });
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="3">
        <label className="ep-field" htmlFor="tf-from">
          <span className="ep-field__label" data-required="true">
            From
          </span>
          <select
            id="tf-from"
            className="ep-select"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setLines([blank()]);
            }}
          >
            {lists.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="tf-to">
          <span className="ep-field__label" data-required="true">
            To
          </span>
          <select
            id="tf-to"
            className="ep-select"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Pick the store</option>
            {allStores
              .filter((s) => s.id !== from)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="tf-note">
          <span className="ep-field__label">Note</span>
          <input
            id="tf-note"
            className="ep-input"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="ep-purch-lines" style={{ marginTop: 'var(--sp-4)' }}>
        {lines.map((l, i) => {
          const n = String(i + 1);
          const it = stock.find((s) => s.itemId === l.itemId);
          const bs = it?.tracksBatch
            ? lists.batches.filter((b) => b.storeId === from && b.itemId === l.itemId)
            : [];
          return (
            <fieldset key={i} className="ep-purch-line">
              <legend className="ep-sr-only">Line {n}</legend>
              <label className="ep-field" htmlFor={`tf-${n}-i`}>
                <span className="ep-field__label">Item {n}</span>
                <select
                  id={`tf-${n}-i`}
                  className="ep-select"
                  value={l.itemId}
                  onChange={(e) => setLine(i, { itemId: e.target.value, batch: '' })}
                >
                  <option value="">Pick the item</option>
                  {stock.map((x) => (
                    <option key={x.itemId} value={x.itemId}>
                      {x.name} ({x.code}) — {fmt(x.free)} {x.unit} free
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor={`tf-${n}-q`}>
                <span className="ep-field__label">Quantity{it ? ` (${it.unit})` : ''}</span>
                <input
                  id={`tf-${n}-q`}
                  className="ep-input"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                />
              </label>
              {bs.length ? (
                <label className="ep-field" htmlFor={`tf-${n}-b`}>
                  <span className="ep-field__label">Batch</span>
                  <select
                    id={`tf-${n}-b`}
                    className="ep-select"
                    value={l.batch}
                    onChange={(e) => setLine(i, { batch: e.target.value })}
                  >
                    <option value="">Earliest expiry first</option>
                    {bs.map((b) => (
                      <option key={`${b.batch}-${b.expiry ?? ''}`} value={b.batch}>
                        {b.batch}
                        {b.expiry ? ` · expires ${b.expiry}` : ''} · {fmt(b.qty)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </fieldset>
          );
        })}
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          style={{ justifySelf: 'start' }}
          onClick={() => setLines((cur) => [...cur, blank()])}
        >
          Add a line
        </button>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          Send
        </button>
      </div>
    </form>
  );
}
