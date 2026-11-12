'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ReportingImportResult } from '@/lib/reporting';
import { importReporting } from '@/lib/reporting-actions';

/**
 * Reporting managers from Excel (docs/design/30): download the sheet (every employee with their manager's
 * code now), change the codes, upload, Check (each row old → new, or why it is refused), then save the
 * good rows.
 */
export function ReportingImport() {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<ReportingImportResult | null>(null);
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
      const r = await importReporting(file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  const shown = ok ? ok.rows.filter((r) => r.status !== 'same') : [];
  return (
    <>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/api/people/reporting-format">
          Download the sheet (Excel)
        </a>
        <label className="ep-field" htmlFor="rm-file">
          <span className="ep-field__label">The filled sheet</span>
          <input
            id="rm-file"
            type="file"
            className="ep-input"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
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
        {ok && ok.counts.change && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save {ok.counts.change} change{ok.counts.change === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The sheet comes filled with today’s managers: change the <strong>Reports to (code)</strong>{' '}
        column (empty: reports to nobody), upload it and Check.
      </p>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {result.error}
        </p>
      ) : null}
      {ok ? (
        <>
          <p className={ok.saved ? 'ep-alert ep-alert--success' : 'ep-field__help'} role="status">
            {ok.saved
              ? `${String(ok.saved)} saved.${ok.waiting ? ` ${String(ok.waiting)} leave or corrections already waiting with an old manager stay with them.` : ''}`
              : `${String(ok.counts.change)} to change · ${String(ok.counts.same)} unchanged · ${String(ok.counts.error)} refused.`}
          </p>
          {shown.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Reports to now</th>
                    <th scope="col">Becomes</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.employee}</td>
                      <td>{r.from ?? 'Nobody'}</td>
                      <td>{r.status === 'error' ? '—' : (r.to ?? 'Nobody')}</td>
                      <td>
                        {r.status === 'change' ? (
                          ok.saved ? (
                            'Saved'
                          ) : (
                            'Changes'
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
          ) : null}
        </>
      ) : null}
    </>
  );
}
