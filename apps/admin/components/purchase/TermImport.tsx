'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importTerms, type ImportResult } from '@/lib/purchase-actions';

/**
 * Payment terms from Excel (docs/design/83): the format comes filled with the school's terms (one row
 * per term, up to four instalments across); every row is checked first and the result shown, then the
 * good rows are saved — a code already there updates its term.
 */
export function TermImport() {
  const router = useRouter();
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
    file &&
    start(async () => {
      const r = await importTerms(file.data, dryRun);
      setResult(r);
      if (!dryRun && r.ok) router.refresh();
    });
  const ok = result?.ok ? result : null;
  const fresh = ok ? ok.results.filter((r) => r.ok && r.action === 'new').length : 0;
  const changed = ok ? ok.results.filter((r) => r.ok && r.action === 'update').length : 0;
  return (
    <section className="ep-card" aria-labelledby="ti-h" style={{ marginTop: 'var(--sp-4)' }}>
      <h2 id="ti-h" className="ep-card__title">
        Upload payment terms from Excel
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        <a href="/api/purchase/payment-terms-format">Download the format</a> — it comes with the
        school’s terms, one row per term with up to four instalments across (%, due on, days), and
        drop-downs and notes on every column. Correct or add rows and upload it: a code already
        there updates its term. Every row is checked first.
      </p>
      <div className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="ti-file">
          <span className="ep-field__label">Excel file</span>
          <input
            id="ti-file"
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
          Save the good rows
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
              ? `${String(ok.good)} of ${String(ok.rows)} rows are good (${String(fresh)} new, ${String(changed)} to update)${ok.good < ok.rows ? '; the others are listed below' : ''}.`
              : `${String(ok.saved)} payment terms saved (${String(fresh)} new, ${String(changed)} updated).`}
          </p>
          {ok.results.some((r) => !r.ok) ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows not saved">
              <table className="ep-table" data-density="dense">
                <caption className="ep-sr-only">Rows not saved</caption>
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
