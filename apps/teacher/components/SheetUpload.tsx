'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { SheetOut, SheetPreview } from '@/lib/sheet-actions';

export interface SheetWords {
  file: string;
  checking: string;
  rows: string;
  ready: string;
  errors: string;
  save: string;
  saved: string;
  nothing: string;
  tooLarge: string;
  unreadable: string;
  row: string;
  admissionNo: string;
  pupil: string;
  problem: string;
}

/**
 * Upload a filled section sheet (docs/design/71): every row is checked and the ones in error listed;
 * Save writes it only when none is. The words come from the page in the teacher's language.
 */
export function SheetUpload({
  upload,
  words,
}: {
  /** bound on the page to the kind, the exam and the section */
  upload: (file: string, apply: boolean) => Promise<SheetOut>;
  words: SheetWords;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const read = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error(words.unreadable));
      r.readAsDataURL(f);
    });

  const check = (f: File) =>
    start(async () => {
      setMsg(null);
      setPreview(null);
      if (f.size > 1_400_000) {
        setMsg({ tone: 'danger', text: words.tooLarge });
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
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <label className="ep-field">
        <span className="ep-field__label">{words.file}</span>
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
          {words.checking}
        </p>
      ) : null}
      {preview ? (
        <div className={`ep-alert ep-alert--${preview.errors ? 'danger' : 'info'}`} role="status">
          {preview.rows.length} {words.rows} · {preview.ready} {words.ready}
          {preview.errors ? ` · ${String(preview.errors)} ${words.errors}` : ''}
        </div>
      ) : null}
      {bad.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={words.problem}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{words.problem}</caption>
            <thead>
              <tr>
                <th scope="col">{words.row}</th>
                <th scope="col">{words.admissionNo}</th>
                <th scope="col">{words.pupil}</th>
                <th scope="col">{words.problem}</th>
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
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !file}
            onClick={() =>
              start(async () => {
                const r = await upload(file!, true);
                if (r.ok && r.data.applied) {
                  setMsg({ tone: 'success', text: `${words.saved} (${String(r.data.ready)})` });
                  setPreview(null);
                  setFile(null);
                  if (input.current) input.current.value = '';
                  router.refresh();
                } else setMsg({ tone: 'danger', text: r.ok ? words.nothing : r.error });
              })
            }
          >
            {words.save} ({preview.ready})
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
