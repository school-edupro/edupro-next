'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { importOpening, postOpening, type OpeningImportResult } from '@/lib/purchase-actions';
import type { StoreFormLists } from '@/lib/purchase';

interface Line {
  itemId: string;
  qty: string;
  rate: string;
  batch: string;
  expiry: string;
}
const blank = (): Line => ({ itemId: '', qty: '', rate: '', batch: '', expiry: '' });

/**
 * A store's opening stock (docs/design/84, part 6): the items it holds on the day it starts in EduPro,
 * by hand (item, quantity in the store unit, rate per store unit, batch and expiry for an item kept by
 * batch) or from Excel (download the format, fill it, check it, post the good rows). Once per store and
 * item: later stock is corrected by a physical count.
 */
export function OpeningStock({
  storeId,
  items,
}: {
  storeId: string;
  items: StoreFormLists['items'];
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<OpeningImportResult | null>(null);
  const [pending, start] = useTransition();
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const read = (f: File | undefined) => {
    setResult(null);
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      setFile(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(f);
  };
  const ok = result?.ok ? result : null;
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          const body = {
            lines: lines
              .filter((l) => l.itemId)
              .map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                rate: l.rate || 0,
                ...(l.batch ? { batch: l.batch } : {}),
                ...(l.expiry ? { expiry: l.expiry } : {}),
              })),
          };
          start(async () => {
            const r = await postOpening(storeId, body);
            if (r.ok) {
              setLines([blank()]);
              setMsg({ ok: true, text: `${String(r.posted)} lines of opening stock posted` });
              router.refresh();
            } else setMsg({ ok: false, text: r.error });
          });
        }}
        noValidate
      >
        <div className="ep-purch-lines">
          {lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const n = String(i + 1);
            return (
              <fieldset key={i} className="ep-purch-line">
                <legend className="ep-sr-only">Line {n}</legend>
                <label className="ep-field" htmlFor={`os-${n}-i`}>
                  <span className="ep-field__label">Item {n}</span>
                  <select
                    id={`os-${n}-i`}
                    className="ep-select"
                    value={l.itemId}
                    onChange={(e) => setLine(i, { itemId: e.target.value })}
                  >
                    <option value="">Pick the item</option>
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor={`os-${n}-q`}>
                  <span className="ep-field__label">Quantity{it ? ` (${it.unit})` : ''}</span>
                  <input
                    id={`os-${n}-q`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`os-${n}-r`}>
                  <span className="ep-field__label">Rate per {it ? it.unit : 'unit'} (₹)</span>
                  <input
                    id={`os-${n}-r`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.rate}
                    onChange={(e) => setLine(i, { rate: e.target.value })}
                  />
                </label>
                {it?.tracksBatch ? (
                  <>
                    <label className="ep-field" htmlFor={`os-${n}-b`}>
                      <span className="ep-field__label" data-required="true">
                        Batch
                      </span>
                      <input
                        id={`os-${n}-b`}
                        className="ep-input"
                        maxLength={40}
                        value={l.batch}
                        onChange={(e) => setLine(i, { batch: e.target.value })}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`os-${n}-e`}>
                      <span className="ep-field__label">Expiry</span>
                      <input
                        id={`os-${n}-e`}
                        type="date"
                        className="ep-input"
                        value={l.expiry}
                        onChange={(e) => setLine(i, { expiry: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
              </fieldset>
            );
          })}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => setLines((cur) => [...cur, blank()])}
            >
              Add a line
            </button>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
              Post the opening stock
            </button>
          </div>
        </div>
      </form>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
        From Excel
      </h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        <a href={`/api/purchase/opening-format?store=${storeId}`}>Download the format</a> (it lists
        the items with no opening here yet), fill the quantity and rate, upload it, check it, then
        post the good rows.
      </p>
      <div className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="os-file">
          <span className="ep-field__label">Excel file</span>
          <input
            id="os-file"
            type="file"
            className="ep-input"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => read(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={!file || pending}
          onClick={() =>
            file && start(async () => setResult(await importOpening(storeId, file, true)))
          }
        >
          Check
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--primary ep-btn--sm"
          disabled={!ok || !ok.dryRun || ok.good === 0 || pending}
          onClick={() =>
            file &&
            start(async () => {
              setResult(await importOpening(storeId, file, false));
              router.refresh();
            })
          }
        >
          Post the good rows
        </button>
      </div>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {result.error}
        </p>
      ) : null}
      {ok ? (
        <div role="status">
          <p>
            {ok.dryRun
              ? `${String(ok.good)} rows are good, ${String(ok.bad)} are not.`
              : `${String(ok.posted)} rows posted.`}
          </p>
          {ok.rows.some((r) => !r.ok) ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows not posted">
              <table className="ep-table" data-density="dense">
                <caption className="ep-sr-only">Rows not posted</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Item code</th>
                    <th scope="col">Why not</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.rows
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.code || '—'}</td>
                        <td>{r.error}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
