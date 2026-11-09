'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importAssets, type AssetImportResult } from '@/lib/purchase-actions';

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Existing assets from Excel (docs/design/84, part 9; "As built — the asset master and the import
 * format"): download the format (drop-downs from the set-up, a Quantity for many alike), fill it, check
 * it — each row's item, how many assets it makes and their cost, or what is wrong — then save the good
 * rows.
 */
export function AssetImport() {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<AssetImportResult | null>(null);
  const [only, setOnly] = useState(false);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
  const read = (f: File | undefined) => {
    setResult(null);
    setName(f?.name ?? '');
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      setFile(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(f);
  };
  const go = (dryRun: boolean) =>
    start(async () => {
      if (!file) return;
      const r = await importAssets(file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  const good = ok ? ok.rows.filter((r) => r.ok).length : 0;
  const bad = ok ? ok.rows.length - good : 0;
  const shown = ok ? (only ? ok.rows.filter((r) => !r.ok) : ok.rows) : [];
  return (
    <>
      <ol className="ep-field__help" style={{ paddingLeft: 'var(--sp-5)' }}>
        <li>
          Download the format. Pick the item, store or department, custodian, condition and vendor
          from the drop-downs; type a Quantity for many alike (40 chairs: one row, Quantity 40).
        </li>
        <li>Choose the filled sheet and press Check: nothing is saved yet.</li>
        <li>Correct the rows with a problem in Excel and check again, or save the good rows.</li>
      </ol>
      <div className="ep-grid__toolbar">
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/api/purchase/assets-format">
          Download the format (Excel)
        </a>
        <label className="ep-field" htmlFor="ai-file">
          <span className="ep-field__label">The filled sheet</span>
          <input
            id="ai-file"
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
          onClick={() => go(true)}
        >
          {pending ? 'Checking…' : 'Check'}
        </button>
        {ok && good && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save {ok.units.toLocaleString('en-IN')} asset{ok.units === 1 ? '' : 's'} from the {good}{' '}
            good row{good === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {result.error}
        </p>
      ) : null}
      {ok ? (
        <>
          <p
            className={
              ok.saved
                ? 'ep-alert ep-alert--success'
                : bad
                  ? 'ep-alert ep-alert--warning'
                  : 'ep-alert ep-alert--info'
            }
            role="status"
          >
            {ok.saved
              ? `${ok.saved.toLocaleString('en-IN')} assets saved to the register, cost ${inr(ok.cost)}${bad ? `; ${String(bad)} row${bad === 1 ? '' : 's'} not saved (below)` : ''}.`
              : `${name ? `${name}: ` : ''}${String(good)} of ${String(ok.rows.length)} rows are good — ${ok.units.toLocaleString('en-IN')} asset${ok.units === 1 ? '' : 's'}, cost ${inr(ok.cost)}.${bad ? ` ${String(bad)} row${bad === 1 ? ' has' : 's have'} a problem: correct ${bad === 1 ? 'it' : 'them'} in the sheet and check again, or save the good rows.` : ''}`}
          </p>
          {bad ? (
            <label className="ep-check" htmlFor="ai-only">
              <input
                id="ai-only"
                type="checkbox"
                className="ep-check__input"
                checked={only}
                onChange={(e) => setOnly(e.target.checked)}
              />
              <span className="ep-check__box" />
              Only the rows with a problem
            </label>
          ) : null}
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Assets
                  </th>
                  <th scope="col">Tag</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Cost
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.item || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.units || '—'}</td>
                    <td>{r.tag || (r.units > 1 ? 'new tags' : 'new tag')}</td>
                    <td style={{ textAlign: 'right' }}>{r.ok ? inr(r.cost) : '—'}</td>
                    <td>
                      {r.ok ? (
                        ok.saved ? (
                          'Saved'
                        ) : (
                          'Good'
                        )
                      ) : (
                        <span style={{ color: 'var(--status-danger-text)' }}>{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
