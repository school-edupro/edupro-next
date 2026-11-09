'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importAttendanceSheet, type SheetResult } from '@/lib/leave-actions';

/** Attendance days or punches from Excel (docs/design/85, phase C): download, fill, check, save. */
export function AttendanceSheetImport({ what }: { what: 'days' | 'punches' }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<SheetResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
  const good = ok ? ok.rows.filter((r) => r.ok).length : 0;
  const id = `as-${what}`;
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
      const r = await importAttendanceSheet(what, file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  return (
    <>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/leave/attendance-format?what=${what}`}
        >
          Download the sheet (Excel)
        </a>
        <label className="ep-field" htmlFor={id}>
          <span className="ep-field__label">The filled sheet</span>
          <input
            id={id}
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
            Save {good} row{good === 1 ? '' : 's'}
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
              ? `${String(ok.saved)} saved.`
              : `${String(good)} of ${String(ok.rows.length)} rows are good.`}
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Date</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {ok.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.employee}</td>
                    <td>{r.day}</td>
                    <td>
                      {r.ok ? (
                        'Good'
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
