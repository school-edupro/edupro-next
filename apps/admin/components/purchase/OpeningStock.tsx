'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  importOpening,
  postOpening,
  type OpeningCheckLine,
  type OpeningImportResult,
} from '@/lib/purchase-actions';
import type { StoreFormLists } from '@/lib/purchase';

interface Line {
  itemId: string;
  qty: string;
  rate: string;
  batch: string;
  expiry: string;
}
const blank = (): Line => ({ itemId: '', qty: '', rate: '', batch: '', expiry: '' });
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** The checked lines: each one's value, the assets it makes, its warnings or why it cannot go in. */
function Checked({
  rows,
  caption,
}: {
  rows: Array<{
    key: string;
    row?: number;
    name: string;
    unit: string;
    qty?: number;
    rate?: number;
    value?: number;
    assets?: number;
    warnings?: string[];
    error?: string;
  }>;
  caption: string;
}) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          <tr>
            {rows.some((r) => r.row) ? <th scope="col">Row</th> : null}
            <th scope="col">Item</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Quantity
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Rate
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Value
            </th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {rows.some((x) => x.row) ? <td>{r.row}</td> : null}
              <td>{r.name}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {r.qty === undefined ? '' : `${qty(r.qty)} ${r.unit}`}
              </td>
              <td style={{ textAlign: 'right' }}>{r.rate === undefined ? '' : money(r.rate)}</td>
              <td style={{ textAlign: 'right' }}>{r.value === undefined ? '' : money(r.value)}</td>
              <td>
                {r.error ? (
                  <Badge tone="danger">{r.error}</Badge>
                ) : r.warnings?.length ? (
                  r.warnings.map((w) => (
                    <Badge key={w} tone="warning">
                      {w}
                    </Badge>
                  ))
                ) : (
                  <Badge tone="success">Good</Badge>
                )}
                {r.assets ? (
                  <span className="ep-mr-col__desc">
                    {r.assets} asset{r.assets === 1 ? '' : 's'} with tags will be made
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Posting a store's opening stock (docs/design/84, part 6; "As built — opening stock corrections", 9 Nov
 * 2026): by hand or from Excel, always checked first — each line's value, the upload's total, the
 * assets an asset item makes, a warning on a ₹0 rate or one far from the last purchase — then posted.
 * A mistake after posting is changed under Opening stock posted while the item has not moved.
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
  const [checked, setChecked] = useState<OpeningCheckLine[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<{ data: string; name: string } | null>(null);
  const [result, setResult] = useState<OpeningImportResult | null>(null);
  const [pending, start] = useTransition();
  const setLine = (i: number, patch: Partial<Line>) => {
    setChecked(null);
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const body = (dryRun: boolean) => ({
    dryRun,
    lines: lines
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        rate: l.rate || 0,
        ...(l.batch ? { batch: l.batch } : {}),
        ...(l.expiry ? { expiry: l.expiry } : {}),
      })),
  });
  const read = (f: File | undefined) => {
    setResult(null);
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      setFile({ data: s.slice(s.indexOf(',') + 1), name: f.name });
    };
    r.readAsDataURL(f);
  };
  const ok = result?.ok ? result : null;
  const handGood = checked && !checked.some((l) => l.error);
  return (
    <>
      <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
        By hand
      </h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const r = await postOpening(storeId, body(true));
            if (r.ok) setChecked(r.lines);
            else setMsg({ ok: false, text: r.error });
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
              onClick={() => {
                setChecked(null);
                setLines((cur) => [...cur, blank()]);
              }}
            >
              Add a line
            </button>
            <button
              type="submit"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending || !lines.some((l) => l.itemId)}
            >
              Check
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={pending || !handGood}
              onClick={() =>
                start(async () => {
                  const r = await postOpening(storeId, body(false));
                  if (r.ok) {
                    setLines([blank()]);
                    setChecked(null);
                    setMsg({
                      ok: true,
                      text: `${String(r.posted)} line${r.posted === 1 ? '' : 's'} of opening stock posted, worth ${money(r.value)}`,
                    });
                    router.refresh();
                  } else setMsg({ ok: false, text: r.error });
                })
              }
            >
              Post the opening stock
            </button>
          </div>
        </div>
      </form>
      {checked ? (
        <>
          <Checked
            caption="The lines checked"
            rows={checked.map((l, i) => ({ key: String(i), ...l }))}
          />
          <p className="ep-field__help">
            Total {money(checked.reduce((a, l) => a + (l.error ? 0 : l.value), 0))}
            {checked.some((l) => l.warnings.length)
              ? ' · look at the warnings before posting: a wrong rate can be changed later only while the item has not moved'
              : ''}
          </p>
        </>
      ) : null}
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
        the items with no opening here yet), fill the quantity and rate, upload it and press Check:
        each row&apos;s value and any warning show before anything is posted.
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
            file &&
            start(async () => setResult(await importOpening(storeId, file.data, true, file.name)))
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
              setResult(await importOpening(storeId, file.data, false, file.name));
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
              ? `${String(ok.good)} rows are good (worth ${money(ok.value)}${ok.assets ? `, ${String(ok.assets)} assets to make` : ''}), ${String(ok.bad)} are not${ok.warned ? `; ${String(ok.warned)} have a warning to look at` : ''}.`
              : `${String(ok.posted)} rows posted, worth ${money(ok.value)}. A mistake can be changed under Opening stock posted.`}
          </p>
          {ok.dryRun ? (
            <Checked
              caption="The rows checked"
              rows={ok.rows.map((r) => ({
                key: String(r.row),
                row: r.row,
                name: r.name ?? r.code ?? '—',
                unit: r.unit ?? '',
                qty: r.qty,
                rate: r.rate,
                value: r.value,
                assets: r.assets,
                warnings: r.warnings,
                error: r.error,
              }))}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
