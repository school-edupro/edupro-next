'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ResultsSheetResult } from '@/lib/admission-results';
import { resultsExport, resultsSheet, resultsSheetUpload } from '@/lib/admission-results-actions';

const STATUS: Record<string, string> = {
  ok: 'Ready',
  done: 'Saved',
  skipped: 'Skipped',
  error: 'Error',
};

/** A base64 file from the server saved in the browser. */
const save = (f: { filename: string; contentType: string; base64: string }) => {
  const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * The class's results sheet (docs/design/57, part 2): download it with a column per part, fill the
 * marks, Absent, Decision (Select / Hold) and Remark, upload it (.xlsx or .csv) to check each row,
 * then save the good rows. Export the grid as filtered.
 */
export function ResultsTools({
  place,
  query,
  canEdit,
  slotId,
  title = 'Sheet and downloads',
  help,
}: {
  place: { cycleId: string; classId: string; stageId: string };
  query: string;
  canEdit: boolean;
  /** a slot's sheet: only its candidates (Tests and interviews) */
  slotId?: string;
  title?: string;
  help?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ResultsSheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /** a download: the error in words, or null */
  const run = (job: () => Promise<string | null>) =>
    start(async () => {
      setError(null);
      setError(await job());
    });
  const send = (apply: boolean) =>
    start(async () => {
      setError(null);
      const f = file.current?.files?.[0];
      if (!f) return setError('Choose the filled sheet.');
      const fd = new FormData();
      fd.set('file', f);
      if (apply) fd.set('apply', '1');
      const r = await resultsSheetUpload(fd);
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      if (apply) router.refresh();
    });

  return (
    <section
      className="ep-card"
      aria-labelledby={`rs-sheet-h-${place.classId}`}
      style={{ marginBottom: 'var(--sp-4)' }}
    >
      <h2 id={`rs-sheet-h-${place.classId}`} className="ep-card__title">
        {title}
      </h2>
      {help ? (
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {help}
        </p>
      ) : null}
      <div className="ep-lead-filter">
        {canEdit ? (
          <>
            <span>
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await resultsSheet({ ...place, ...(slotId ? { slotId } : {}) });
                    if (!r.ok) return r.error;
                    save(r.data);
                    return null;
                  })
                }
              >
                Download the sheet
              </button>
            </span>
            <label className="ep-field">
              <span className="ep-field__label">Filled sheet (.xlsx or .csv)</span>
              <input
                ref={file}
                className="ep-input"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
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
                  Save {result.ok} row{result.ok === 1 ? '' : 's'}
                </button>
              ) : null}
            </span>
          </>
        ) : null}
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
          {(['xlsx', 'pdf'] as const).map((f) => (
            <button
              key={f}
              type="button"
              style={{ whiteSpace: 'nowrap' }}
              className="ep-btn ep-btn--secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await resultsExport(query, f);
                  if (!r.ok) return r.error;
                  save(r.data);
                  return null;
                })
              }
            >
              {f === 'xlsx' ? 'Export Excel' : 'Export PDF'}
            </button>
          ))}
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
            {result.applied ? `${String(result.done)} saved` : `${String(result.ok)} ready to save`}
            , {result.skipped} skipped, {result.errors} with an error
            {result.errors ? ' (fix them in the sheet and check again)' : ''}.
          </p>
          {result.notFound.length ? (
            <p className="ep-alert ep-alert--warning" role="status">
              <strong>Registration numbers not found in this class and stage:</strong>{' '}
              {result.notFound.join(', ')}
            </p>
          ) : null}
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
                  <th scope="col">Total</th>
                  <th scope="col">What changes</th>
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
                    <td className="ep-num">{r.total ?? '-'}</td>
                    <td>{r.change ?? r.decision ?? '-'}</td>
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
    </section>
  );
}
