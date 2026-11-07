'use client';
import { useState, useTransition } from 'react';
import { importVendors, type ImportResult } from '@/lib/purchase-actions';

/**
 * Vendors from Excel (docs/design/83, part 1): every row is checked first and the result shown; then
 * the good rows are imported, under the same rules as the vendor form (country, state, city and bank
 * from the masters; a blank code gets the next one). Imported vendors wait for approval.
 */
export function VendorImport() {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const read = (f: File | undefined) => {
    setResult(null);
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      setFile({ name: f.name, data: s.slice(s.indexOf(',') + 1) });
    };
    r.readAsDataURL(f);
  };
  const go = (dryRun: boolean) =>
    file && start(async () => setResult(await importVendors(file.data, dryRun)));
  const ok = result?.ok ? result : null;
  return (
    <section className="ep-card" aria-labelledby="vi-h" style={{ marginTop: 'var(--sp-4)' }}>
      <h2 id="vi-h" className="ep-card__title">
        Import vendors from Excel
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        <a href="/api/purchase/vendors-format">Download the format</a>, fill one row per vendor and
        upload it. The format has drop-downs for kind, GST status, country, state, city, payment
        term and bank, and notes on every column; leave the code empty for the next one. Every row
        is checked first with the same rules as the form, and imported vendors wait for approval.
      </p>
      <div className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="vi-file">
          <span className="ep-field__label">Excel file</span>
          <input
            id="vi-file"
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
          Check
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--primary ep-btn--sm"
          disabled={!ok || !ok.dryRun || ok.good === 0 || pending}
          onClick={() => go(false)}
        >
          Import the good rows
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
              ? `${String(ok.good)} of ${String(ok.rows)} rows are good${ok.good < ok.rows ? '; the others are listed below' : ''}.`
              : `${String(ok.saved)} vendors imported: they wait for approval.`}
          </p>
          {ok.results.some((r) => !r.ok) ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Rows not imported"
            >
              <table className="ep-table" data-density="dense">
                <caption className="ep-sr-only">Rows not imported</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Code</th>
                    <th scope="col">Why not</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.results
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
    </section>
  );
}
