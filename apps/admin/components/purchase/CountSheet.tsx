'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importCount, saveCountLines } from '@/lib/purchase-actions';
import type { CountDetail } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Counting a store (docs/design/84, part 8): what is found per line (the book quantity shows only once
 * a line is counted), the reason for each difference, an item or batch found that is not listed, or
 * the filled Excel sheet uploaded. Saved as it goes; sent for approval from the page.
 */
export function CountSheet({
  count,
  items,
}: {
  count: CountDetail;
  /** the items kept in stock, for a line found that is not listed */
  items: Array<{ id: string; code: string; name: string; tracksBatch: boolean }>;
}) {
  const router = useRouter();
  const [state, setState] = useState(() =>
    Object.fromEntries(
      count.lineItems.map((l) => [
        l.id,
        { counted: l.counted === null ? '' : String(l.counted), reason: l.reason ?? '' },
      ]),
    ),
  );
  const [countedBy, setCountedBy] = useState(count.countedBy ?? '');
  const [extra, setExtra] = useState({
    itemId: '',
    batch: '',
    expiry: '',
    counted: '',
    reason: '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    setMsg(null);
    const lines: Array<Record<string, unknown>> = count.lineItems.map((l) => {
      const v = state[l.id]!;
      return {
        lineId: l.id,
        countedQty: v.counted === '' ? null : v.counted,
        reason: v.reason || undefined,
      };
    });
    if (extra.itemId && extra.counted !== '')
      lines.push({
        itemId: extra.itemId,
        batch: extra.batch || undefined,
        expiry: extra.expiry || undefined,
        countedQty: extra.counted,
        reason: extra.reason || 'Found, not on the list',
      });
    start(async () => {
      const r = await saveCountLines(count.id, { countedBy: countedBy || undefined, lines });
      if (r.ok) {
        setMsg({ ok: true, text: 'Saved' });
        setExtra({ itemId: '', batch: '', expiry: '', counted: '', reason: '' });
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      start(async () => {
        const r = await importCount(count.id, s.slice(s.indexOf(',') + 1));
        setMsg(
          r.ok
            ? { ok: true, text: r.detail ?? 'Counted from the sheet' }
            : { ok: false, text: r.error },
        );
        if (r.ok) router.refresh();
      });
    };
    reader.readAsDataURL(f);
  };
  const extraItem = items.find((i) => i.id === extra.itemId);
  return (
    <>
      <div className="ep-grid__toolbar">
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/purchase/stock-doc/counts/${count.id}?sheet=1`}
        >
          Download the sheet (Excel)
        </a>
        <label className="ep-field" htmlFor="cs-file">
          <span className="ep-field__label">Upload the filled sheet</span>
          <input
            id="cs-file"
            type="file"
            className="ep-input"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="The count sheet">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Counted
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Book
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Difference
                </th>
                <th scope="col">Reason for a difference</th>
              </tr>
            </thead>
            <tbody>
              {count.lineItems.map((l) => {
                const v = state[l.id]!;
                return (
                  <tr key={l.id}>
                    <td>
                      {l.item} ({l.itemCode})
                      <span className="ep-mr-col__desc">
                        {[
                          l.category,
                          l.batch ? `Batch ${l.batch}` : null,
                          l.expiry ? `expiry ${l.expiry}` : null,
                          l.added ? 'found, not listed' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        className="ep-input"
                        style={{ maxWidth: '8rem', textAlign: 'right' }}
                        inputMode="decimal"
                        aria-label={`Counted: ${l.item}${l.batch ? ` batch ${l.batch}` : ''} (${l.unit})`}
                        value={v.counted}
                        onChange={(e) =>
                          setState((cur) => ({ ...cur, [l.id]: { ...v, counted: e.target.value } }))
                        }
                      />{' '}
                      {l.unit}
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.book === null ? '—' : fmt(l.book)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.difference === null || !l.difference ? '' : fmt(l.difference)}
                    </td>
                    <td>
                      <input
                        className="ep-input"
                        maxLength={300}
                        aria-label={`Reason: ${l.item}`}
                        value={v.reason}
                        onChange={(e) =>
                          setState((cur) => ({ ...cur, [l.id]: { ...v, reason: e.target.value } }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <fieldset
          className="ep-purch-line ep-purch-line--wide"
          style={{ marginTop: 'var(--sp-3)' }}
        >
          <legend className="ep-purch-line__item">Found, not on the list</legend>
          <label className="ep-field" htmlFor="cs-x-item">
            <span className="ep-field__label">Item</span>
            <select
              id="cs-x-item"
              className="ep-select"
              value={extra.itemId}
              onChange={(e) => setExtra({ ...extra, itemId: e.target.value })}
            >
              <option value="">Pick the item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </select>
          </label>
          {extraItem?.tracksBatch ? (
            <>
              <label className="ep-field" htmlFor="cs-x-batch">
                <span className="ep-field__label">Batch</span>
                <input
                  id="cs-x-batch"
                  className="ep-input"
                  maxLength={40}
                  value={extra.batch}
                  onChange={(e) => setExtra({ ...extra, batch: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor="cs-x-exp">
                <span className="ep-field__label">Expiry</span>
                <input
                  id="cs-x-exp"
                  type="date"
                  className="ep-input"
                  value={extra.expiry}
                  onChange={(e) => setExtra({ ...extra, expiry: e.target.value })}
                />
              </label>
            </>
          ) : null}
          <label className="ep-field" htmlFor="cs-x-q">
            <span className="ep-field__label">Counted</span>
            <input
              id="cs-x-q"
              className="ep-input"
              inputMode="decimal"
              value={extra.counted}
              onChange={(e) => setExtra({ ...extra, counted: e.target.value })}
            />
          </label>
        </fieldset>
        <label className="ep-field" htmlFor="cs-by" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="ep-field__label">Counted by (names)</span>
          <input
            id="cs-by"
            className="ep-input"
            maxLength={200}
            value={countedBy}
            onChange={(e) => setCountedBy(e.target.value)}
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
            Save the counts
          </button>
        </div>
      </form>
    </>
  );
}
