'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  approvalSheet,
  approvalSheetUpload,
  type SheetResult,
} from '@/lib/admission-approvals-actions';

const STATUS: Record<string, string> = {
  ok: 'Ready',
  done: 'Decided',
  skipped: 'Skipped',
  error: 'Error',
};

/**
 * Decisions by Excel (docs/design/55): pick a stage and level, download its sheet, fill Decision and
 * Remark (and Marks), upload to check, then apply the good rows.
 */
export function ApprovalSheet({
  places,
}: {
  places: Array<{ value: string; label: string; count: number }>;
}) {
  const router = useRouter();
  const [place, setPlace] = useState(places[0]?.value ?? '');
  const [result, setResult] = useState<SheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const download = () =>
    start(async () => {
      setError(null);
      const r = await approvalSheet(place);
      if (!r.ok) return setError(r.error);
      const bytes = Uint8Array.from(atob(r.data.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.data.contentType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.data.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  const send = (apply: boolean) =>
    start(async () => {
      setError(null);
      const f = file.current?.files?.[0];
      if (!f) return setError('Choose the filled sheet.');
      const fd = new FormData();
      fd.set('file', f);
      if (apply) fd.set('apply', '1');
      const r = await approvalSheetUpload(fd);
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      if (apply) router.refresh();
    });

  if (!places.length)
    return <p style={{ margin: 0 }}>Nothing waits for a decision now, so there is no sheet.</p>;
  return (
    <div className="ep-asheet">
      <div className="ep-lead-filter">
        <label className="ep-field ep-asheet__place">
          <span className="ep-field__label">Stage and level</span>
          <select className="ep-select" value={place} onChange={(e) => setPlace(e.target.value)}>
            {places.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} ({p.count})
              </option>
            ))}
          </select>
        </label>
        <span>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending}
            onClick={download}
          >
            Download the sheet
          </button>
        </span>
        <label className="ep-field">
          <span className="ep-field__label">Filled sheet (.xlsx)</span>
          <input
            ref={file}
            className="ep-input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={() => setResult(null)}
          />
        </label>
        <span className="ep-asheet__btns">
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending}
            onClick={() => send(false)}
          >
            Check
          </button>
          {result && !result.applied && result.ok > 0 ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() => send(true)}
            >
              Apply {result.ok} decision{result.ok === 1 ? '' : 's'}
            </button>
          ) : null}
        </span>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <>
          <p className="ep-alert ep-alert--info" role="status">
            {result.place}:{' '}
            {result.applied
              ? `${String(result.done)} decided`
              : `${String(result.ok)} ready to apply`}
            , {result.skipped} skipped, {result.errors} with an error
            {result.errors ? ' (fix them in the sheet and check again)' : ''}.
          </p>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Rows of the sheet (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Rows of the sheet</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Registration</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="ep-num">{r.row}</td>
                    <td>
                      {r.candidate ?? '-'}
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {r.number}
                      </div>
                    </td>
                    <td>{r.decision ?? '-'}</td>
                    <td>
                      <strong>{STATUS[r.status]}</strong>
                      {r.reason ? (
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          {r.reason}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
