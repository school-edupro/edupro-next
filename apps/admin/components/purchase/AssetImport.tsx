'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importAssets, type AssetImportResult } from '@/lib/purchase-actions';

/** Existing assets from Excel (docs/design/84, part 9): download the format, fill it, check, save. */
export function AssetImport() {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<AssetImportResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
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
  const go = (dryRun: boolean) =>
    start(async () => {
      if (!file) return;
      const r = await importAssets(file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  const good = ok ? ok.rows.filter((r) => r.ok).length : 0;
  return (
    <>
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
          Check
        </button>
        {ok && good && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save the {good} good rows
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
          <p className={ok.saved ? 'ep-alert ep-alert--success' : 'ep-field__help'} role="status">
            {ok.saved
              ? `${String(ok.saved)} assets saved to the register`
              : `${String(good)} of ${String(ok.rows.length)} rows are good`}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Tag</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {ok.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.tag || 'new tag'}</td>
                    <td>{r.ok ? 'Good' : r.error}</td>
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
