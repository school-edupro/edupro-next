'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { importAttendance } from '@/lib/payroll-inputs-actions';

type Result = NonNullable<Awaited<ReturnType<typeof importAttendance>>['result']>;

/** The month's attendance from Excel: download the sheet, fill it, check it, then save the good rows. */
export function AttendanceUpload({ month }: { month: string }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const read = (f: File | undefined) => {
    setResult(null);
    setError(null);
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
      const r = await importAttendance(month, file, reason, dryRun);
      setResult(r.result);
      setError(r.error);
      if (r.result && !dryRun) router.refresh();
    });
  return (
    <div className="ep-form-section__body">
      <ol className="ep-field__help" style={{ paddingLeft: 'var(--sp-5)', marginTop: 0 }}>
        <li>
          Download the sheet: a row for each employee on the month’s roster, with what is there now.
        </li>
        <li>
          Type the loss-of-pay days (and paid leave, present days, OT hours when they differ) and a
          reason.
        </li>
        <li>
          Check it: nothing is saved. Then save the good rows. Employees not in the file are not
          changed.
        </li>
      </ol>
      <p>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/payroll/attendance-format?month=${month}`}
        >
          Download the sheet (Excel)
        </a>
      </p>
      <label className="ep-field" htmlFor="au-file">
        <span className="ep-field__label">The filled sheet</span>
        <input
          id="au-file"
          type="file"
          className="ep-input"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => read(e.currentTarget.files?.[0])}
        />
      </label>
      <label className="ep-field" htmlFor="au-why">
        <span className="ep-field__label">Reason (for rows without one)</span>
        <input
          id="au-why"
          className="ep-input"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          maxLength={200}
        />
      </label>
      <p className="ep-grid__toolbar">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={!file || reason.trim().length < 3 || pending}
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
            Save the {result.counts.ok} good row(s)
          </button>
        ) : null}
      </p>
      <div role="status" aria-live="polite">
        {error ? <p className="ep-field__error">{error}</p> : null}
        {result ? (
          <p>
            {result.saved
              ? `${String(result.saved)} row(s) saved.`
              : `${String(result.counts.ok)} good, ${String(result.counts.error)} with a problem.`}
          </p>
        ) : null}
      </div>
      {result?.rows.some((r) => r.error) ? (
        <ul className="ep-field__help">
          {result.rows
            .filter((r) => r.error)
            .slice(0, 50)
            .map((r) => (
              <li key={r.row}>
                Row {r.row} ({r.code}): <Badge tone="danger">{r.error}</Badge>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
