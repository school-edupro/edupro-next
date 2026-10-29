'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { UploadPreview } from '@/lib/exam-entry-actions';

type Out = { ok: true; data: UploadPreview } | { ok: false; error: string };

/**
 * Upload a filled Excel sheet (marks or subject choices, docs/design/65): every row is checked first and
 * shown; Save writes it only when no row has an error.
 */
export function ExcelUpload({
  label,
  upload,
}: {
  label: string;
  /** bound on the page to the exam / section / subject */
  upload: (file: string, apply: boolean) => Promise<Out>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const read = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error('The file could not be read'));
      r.readAsDataURL(f);
    });

  const check = (f: File) =>
    start(async () => {
      setMsg(null);
      setPreview(null);
      if (f.size > 1_400_000) {
        setMsg({ tone: 'danger', text: 'The file is larger than 1.4 MB; split it' });
        return;
      }
      const b64 = await read(f);
      setFile(b64);
      const r = await upload(b64, false);
      if (r.ok) setPreview(r.data);
      else setMsg({ tone: 'danger', text: r.error });
    });

  const bad = preview?.rows.filter((x) => x.error) ?? [];
  return (
    <div className="ep-rp__act">
      <label className="ep-field">
        <span className="ep-field__label">{label}</span>
        <input
          ref={input}
          type="file"
          className="ep-input"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) check(f);
          }}
        />
      </label>
      {pending && !preview ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          Checking the sheet…
        </p>
      ) : null}
      {preview ? (
        <div className={`ep-alert ep-alert--${preview.errors ? 'danger' : 'info'}`} role="status">
          {preview.rows.length} rows read: {preview.ready} ready to save
          {preview.errors
            ? `, ${String(preview.errors)} with an error (fix them and upload again)`
            : ''}
          .
        </div>
      ) : null}
      {bad.length ? (
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Rows with an error</caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Admission no</th>
                <th scope="col">Student</th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {bad.slice(0, 50).map((x) => (
                <tr key={x.row}>
                  <td>{x.row}</td>
                  <td>{x.admissionNo}</td>
                  <td>{x.name ?? '-'}</td>
                  <td>{x.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {preview && !preview.errors && preview.ready ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !file}
            onClick={() =>
              start(async () => {
                const r = await upload(file!, true);
                if (r.ok && r.data.applied) {
                  setMsg({ tone: 'success', text: `${String(r.data.ready)} rows saved.` });
                  setPreview(null);
                  setFile(null);
                  if (input.current) input.current.value = '';
                  router.refresh();
                } else setMsg({ tone: 'danger', text: r.ok ? 'Nothing was saved' : r.error });
              })
            }
          >
            Save {preview.ready} rows
          </button>
        </div>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
