'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reorderIndent } from '@/lib/purchase-actions';
import type { ReorderRow } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Items at or below their reorder level in one store (docs/design/84, part 9): tick the ones to ask
 * for, change the quantity (in the purchase unit) and raise a draft indent for the store's department.
 */
export function ReorderList({
  store,
  rows,
}: {
  store: { id: string; name: string; mine: boolean };
  rows: ReorderRow[];
}) {
  const router = useRouter();
  const [state, setState] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.itemId, { on: !r.indents, qty: String(r.suggest) }])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = String(store.id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const lines = rows
          .filter((r) => state[r.itemId]!.on && Number(state[r.itemId]!.qty) > 0)
          .map((r) => ({ itemId: r.itemId, quantity: state[r.itemId]!.qty }));
        if (!lines.length) {
          setMsg('Tick at least one item');
          return;
        }
        start(async () => {
          const r = await reorderIndent({ storeId: store.id, lines });
          if (r.ok)
            router.push(
              `/purchase/indents/${r.id}?ok=1&detail=${encodeURIComponent('Draft indent made: check it and send it for approval')}`,
            );
          else setMsg(r.error);
        });
      }}
      noValidate
    >
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={`Reorder for ${store.name}`}
      >
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Ask for</th>
              <th scope="col">Item</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Free
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                On order
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Reorder level
              </th>
              <th scope="col">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = state[r.itemId]!;
              return (
                <tr key={r.itemId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Ask for ${r.name}`}
                      checked={v.on}
                      disabled={!store.mine}
                      onChange={(e) =>
                        setState((cur) => ({ ...cur, [r.itemId]: { ...v, on: e.target.checked } }))
                      }
                    />
                  </td>
                  <td>
                    {r.name} ({r.code})
                    {r.indents ? (
                      <span className="ep-mr-col__desc">Already on {r.indents}</span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmt(r.free)} {r.unit}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.onOrder ? fmt(r.onOrder) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {fmt(r.reorderLevel)}
                    {r.maxQty !== null ? (
                      <span className="ep-mr-col__desc">max {fmt(r.maxQty)}</span>
                    ) : null}
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      style={{ maxWidth: '7rem' }}
                      inputMode="decimal"
                      aria-label={`Quantity of ${r.name} in ${r.purchaseUnit}`}
                      value={v.qty}
                      disabled={!store.mine}
                      onChange={(e) =>
                        setState((cur) => ({ ...cur, [r.itemId]: { ...v, qty: e.target.value } }))
                      }
                    />{' '}
                    {r.purchaseUnit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {msg}
        </p>
      ) : null}
      {store.mine ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <button
            type="submit"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            id={`ro-${n}`}
          >
            Raise an indent for {store.name}
          </button>
        </div>
      ) : null}
    </form>
  );
}
