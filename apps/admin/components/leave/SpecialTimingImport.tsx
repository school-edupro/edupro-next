'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importSpecialTimings, type SpecialImportResult } from '@/lib/leave-actions';

const WHAT = { new: 'New', change: 'Changes', same: 'As it is' } as const;

/**
 * Special timings in bulk through Excel: download the sheet (the timings there are, to change, and new
 * rows to add), upload it, Check every row, then save the good ones.
 */
export function SpecialTimingImport() {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<SpecialImportResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
  const good = ok ? ok.rows.filter((r) => r.ok && r.what !== 'same').length : 0;
  const bad = ok ? ok.rows.filter((r) => !r.ok).length : 0;
  const read = (f: File | undefined) => {
    setResult(null);
    if (!f) {
      setFile(null);
      setName('');
      return;
    }
    if (!/\.xlsx$/i.test(f.name)) {
      setFile(null);
      setName('');
      setResult({ ok: false, error: 'Choose the Excel (.xlsx) file downloaded here.' });
      return;
    }
    setName(f.name);
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
      const r = await importSpecialTimings(file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) {
        router.push(
          `/leave/setup/timings?tab=special&ok=1&detail=${encodeURIComponent(
            `${String(r.saved)} special timing${r.saved === 1 ? '' : 's'} saved from Excel${bad ? ` (${String(bad)} row${bad === 1 ? '' : 's'} not saved)` : ''}. Days already worked out change when worked out again.`,
          )}`,
        );
      }
    });
  return (
    <div className="ep-weekoff__content" style={{ padding: 0 }}>
      <ol className="ep-steps-plain">
        <li>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/api/leave/special-timings-format"
          >
            Download the sheet (Excel)
          </a>{' '}
          <span className="ep-field__help">
            It has the special timings there are now (change them) — add a row for each new one.
          </span>
        </li>
        <li>
          Fill it: Employee, From / To date, Start / End time (24-hour, like 07:30), Present and
          Half-day hours (7 h 30 m is 7.50); grace, the late / early rule and a remark if needed.
        </li>
        <li>
          <label className="ep-field" htmlFor="st-file">
            <span className="ep-field__label">Upload the filled sheet</span>
            <input
              id="st-file"
              type="file"
              className="ep-input"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => read(e.target.files?.[0])}
            />
          </label>
        </li>
      </ol>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={!file || pending}
          onClick={() => go(true)}
        >
          {pending && !ok ? 'Checking…' : `Check${name ? ` ${name}` : ''}`}
        </button>
        {ok && good && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save {good} timing{good === 1 ? '' : 's'}
            {bad ? ` (skip ${String(bad)} with errors)` : ''}
          </button>
        ) : null}
      </div>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{result.error}</span>
        </p>
      ) : null}
      {ok ? (
        <>
          <p
            className={bad ? 'ep-alert ep-alert--warning' : 'ep-alert ep-alert--info'}
            role="status"
          >
            {ok.rows.length === 0 ? (
              <span>
                The sheet has no rows yet: add one row per employee and dates under the headings,
                then upload it again.
              </span>
            ) : (
              <span>
                {ok.rows.length} rows read: {good} to save
                {ok.rows.filter((r) => r.what === 'same').length
                  ? `, ${String(ok.rows.filter((r) => r.what === 'same').length)} as they are`
                  : ''}
                {bad ? `, ${String(bad)} with errors (fix them in the sheet and check again)` : ''}.
              </span>
            )}
          </p>
          {ok.rows.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Dates</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.rows.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.employee}</td>
                      <td>{r.dates}</td>
                      <td>
                        {r.ok ? (
                          WHAT[r.what ?? 'new']
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
    </div>
  );
}
