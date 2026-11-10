'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importApprovers, type ApproversImportResult } from '@/lib/leave-actions';

/**
 * Who approves, by employee, through Excel: download every employee with their approvers now, change the
 * codes, upload, check, save. Only the rows that change are saved (as the employees' own approvers).
 */
export function ApproversImport({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [result, setResult] = useState<ApproversImportResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
  const changed = ok ? ok.rows.filter((r) => r.ok && r.changes.length).length : 0;
  const bad = ok ? ok.rows.filter((r) => !r.ok).length : 0;
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
      const r = await importApprovers(file, dryRun);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  // the rows worth showing: refused, and the ones that change
  const shown = ok ? ok.rows.filter((r) => !r.ok || r.changes.length) : [];
  return (
    <>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/api/leave/approvers-format">
          Download (Excel)
        </a>
        {canManage ? (
          <>
            <label className="ep-field" htmlFor="ap-file">
              <span className="ep-field__label">The changed sheet</span>
              <input
                id="ap-file"
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
            {ok && changed && !ok.saved ? (
              <button
                type="button"
                className="ep-btn ep-btn--primary ep-btn--sm"
                disabled={pending}
                onClick={() => go(false)}
              >
                Save {changed} employee{changed === 1 ? '' : 's'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <p className="ep-field__help">
        A cell holds approver employee codes: <strong>E003</strong> one person;{' '}
        <strong>E003, E005</strong> any one of them; <strong>E003 + E005</strong> all of them. A
        changed row becomes that employee’s own approvers; an empty length goes back to the general
        rules; an unchanged row changes nothing.
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
              ? `${String(ok.saved)} employee${ok.saved === 1 ? '' : 's'} saved.`
              : `${String(ok.rows.length)} rows read: ${String(changed)} change, ${String(bad)} refused, the rest are as they are.`}
          </p>
          {shown.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Employee</th>
                    <th scope="col">What changes</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.employee}</td>
                      <td>
                        {r.ok ? (
                          <ul className="ep-approvers">
                            {r.changes.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
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
