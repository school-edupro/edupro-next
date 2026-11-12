'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importStructureSheet } from '@/lib/payroll-actions';

type Result = NonNullable<Awaited<ReturnType<typeof importStructureSheet>>['result']>;

/**
 * Salary structures from Excel (legacy "Upload salary structure"): download the sheet with the amounts in force,
 * change them, check it — each row's employee, head, amount and date or what is wrong — then save the good rows
 * as drafts for a payroll checker.
 */
export function StructureImport() {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState(false);
  const [pending, start] = useTransition();
  const read = (f: File | undefined) => {
    setResult(null);
    setError(null);
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
      const r = await importStructureSheet(file, dryRun);
      setResult(r.result);
      setError(r.error);
      if (r.result && !dryRun) router.refresh();
    });
  const shown = result ? (only ? result.rows.filter((r) => r.error) : result.rows) : [];
  return (
    <>
      <ol className="ep-field__help" style={{ paddingLeft: 'var(--sp-5)' }}>
        <li>
          Download the sheet: a row for each employee and head, with the amount in force today.
        </li>
        <li>Change the amounts and the Effective from date; delete the rows that do not change.</li>
        <li>Choose the filled sheet and press Check: nothing is saved yet.</li>
        <li>Save the good rows. They are drafts until a payroll checker approves them.</li>
      </ol>
      <div className="ep-grid__toolbar">
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/api/payroll/structure-format">
          Download the sheet (Excel)
        </a>
        <label className="ep-field" htmlFor="si-file">
          <span className="ep-field__label">The filled sheet</span>
          <input
            id="si-file"
            type="file"
            className="ep-input"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => read(e.currentTarget.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--ghost"
          disabled={!file || pending}
          onClick={() => go(true)}
        >
          {pending ? 'Working…' : 'Check'}
        </button>
        {result && result.counts.ok > 0 && !result.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save the {result.counts.ok} good row(s) as drafts
          </button>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {error ? <p className="ep-field__error">{error}</p> : null}
        {result ? (
          <p>
            {name ? `${name}: ` : ''}
            {result.saved
              ? `${String(result.saved)} row(s) saved as drafts. A payroll checker approves them under Drafts to approve.`
              : `${String(result.counts.ok)} good, ${String(result.counts.error)} with a problem.`}
          </p>
        ) : null}
      </div>
      {result?.rows.length ? (
        <>
          {result.counts.error ? (
            <label className="ep-check" htmlFor="si-only">
              <input
                id="si-only"
                type="checkbox"
                checked={only}
                onChange={(e) => setOnly(e.currentTarget.checked)}
              />{' '}
              Only the rows with a problem
            </label>
          ) : null}
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="The rows of the sheet"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Employee code</th>
                  <th scope="col">Head</th>
                  <th scope="col">Amount (₹)</th>
                  <th scope="col">From</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.code}</td>
                    <td>{r.head}</td>
                    <td>{r.amount}</td>
                    <td>{r.from ?? ''}</td>
                    <td>
                      {r.error ? (
                        <Badge tone="danger">{r.error}</Badge>
                      ) : (
                        <Badge tone="success">{result.saved ? 'Saved' : 'Good'}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 500 ? (
            <p className="ep-field__help">The first 500 rows are shown.</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
