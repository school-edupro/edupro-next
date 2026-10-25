'use client';
import { useState, useTransition } from 'react';
import { importEnquiries } from '@/lib/admission-enquiry-actions';

type Result = {
  added: number;
  duplicates: Array<{ row: number; message: string }>;
  errors: Array<{ row: number; message: string }>;
};

/** Upload a filled enquiry sheet (docs/design/45, part 2); the rows to correct or left out are listed. */
export function EnquiryImport() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError('');
      setResult(null);
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await importEnquiries(btoa(bin));
      if (r.ok) setResult(r);
      else setError(r.error);
    });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <label className="ep-field">
        <span className="ep-field__label">The filled sheet (.xlsx)</span>
        <input
          className="ep-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="ep-form-actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={!file || pending}
          onClick={send}
        >
          {pending ? 'Reading the sheet…' : 'Add the enquiries'}
        </button>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {result.errors.length ? (
            <p className="ep-alert ep-alert--danger">
              Nothing was added: correct these rows in the sheet and upload it again.
            </p>
          ) : (
            <p className="ep-alert ep-alert--success">
              {result.added} enquiries added
              {result.duplicates.length
                ? `; ${String(result.duplicates.length)} left out as duplicates`
                : ''}
              .
            </p>
          )}
          {[...result.errors, ...result.duplicates].length ? (
            <ul className="ep-rp__events">
              {result.errors.map((x) => (
                <li key={`e${String(x.row)}`}>
                  Row {x.row}: {x.message}
                </li>
              ))}
              {result.duplicates.map((x) => (
                <li key={`d${String(x.row)}`}>
                  Row {x.row}: duplicate, {x.message}
                </li>
              ))}
            </ul>
          ) : null}
          {result.added ? <a href="/admissions/enquiries">See them on the board</a> : null}
        </div>
      ) : null}
    </div>
  );
}
