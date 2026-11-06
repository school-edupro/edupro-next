'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { returnToStore } from '@/lib/purchase-actions';
import type { IssueDetail } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Goods brought back against an issue (docs/design/84, part 8): per line the quantity, unused (back
 * into stock at the rate it went out at) or damaged (recorded for condemnation, with what is wrong).
 */
export function ReturnToStoreForm({ issue }: { issue: IssueDetail }) {
  const router = useRouter();
  const lines = issue.lineItems.filter((l) => l.returnable > 0);
  const [state, setState] = useState<
    Record<string, { qty: string; condition: 'unused' | 'damaged'; reason: string }>
  >(() =>
    Object.fromEntries(lines.map((l) => [l.id, { qty: '', condition: 'unused', reason: '' }])),
  );
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const body = {
          note: note || undefined,
          lines: lines
            .map((l) => ({ l, v: state[l.id]! }))
            .filter(({ v }) => Number(v.qty || 0) > 0)
            .map(({ l, v }) => ({
              issueLineId: l.id,
              qty: v.qty,
              condition: v.condition,
              reason: v.reason || undefined,
            })),
        };
        if (!body.lines.length) {
          setMsg({ ok: false, text: 'Give the quantity that came back on a line' });
          return;
        }
        start(async () => {
          const r = await returnToStore(issue.id, body);
          if (r.ok) {
            setMsg({ ok: true, text: `${r.number ?? 'Return'} recorded` });
            router.refresh();
          } else setMsg({ ok: false, text: r.error });
        });
      }}
      noValidate
    >
      <div className="ep-purch-lines">
        {lines.map((l, i) => {
          const v = state[l.id]!;
          const n = String(i + 1);
          const set = (p: Partial<typeof v>) =>
            setState((cur) => ({ ...cur, [l.id]: { ...cur[l.id]!, ...p } }));
          return (
            <fieldset key={l.id} className="ep-purch-line ep-purch-line--wide">
              <legend className="ep-purch-line__item">
                {n}. {l.item} — issued {fmt(l.qty)} {l.unit}
                {l.returned ? `, ${fmt(l.returned)} back already` : ''}
              </legend>
              <label className="ep-field" htmlFor={`rs-${n}-q`}>
                <span className="ep-field__label">Came back ({l.unit})</span>
                <input
                  id={`rs-${n}-q`}
                  className="ep-input"
                  inputMode="decimal"
                  value={v.qty}
                  onChange={(e) => set({ qty: e.target.value })}
                />
                <span className="ep-field__help">Up to {fmt(l.returnable)}</span>
              </label>
              <label className="ep-field" htmlFor={`rs-${n}-c`}>
                <span className="ep-field__label">Condition</span>
                <select
                  id={`rs-${n}-c`}
                  className="ep-select"
                  value={v.condition}
                  onChange={(e) => set({ condition: e.target.value as 'unused' | 'damaged' })}
                >
                  <option value="unused">Unused: back into stock</option>
                  <option value="damaged">Damaged: recorded, not in stock</option>
                </select>
              </label>
              <label className="ep-field" htmlFor={`rs-${n}-r`}>
                <span
                  className="ep-field__label"
                  data-required={v.condition === 'damaged' ? 'true' : undefined}
                >
                  {v.condition === 'damaged' ? 'What is wrong' : 'Why it came back'}
                </span>
                <input
                  id={`rs-${n}-r`}
                  className="ep-input"
                  maxLength={300}
                  value={v.reason}
                  onChange={(e) => set({ reason: e.target.value })}
                />
              </label>
            </fieldset>
          );
        })}
      </div>
      <label className="ep-field" htmlFor="rs-note">
        <span className="ep-field__label">Note</span>
        <input
          id="rs-note"
          className="ep-input"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
          Record the return
        </button>
      </div>
    </form>
  );
}
