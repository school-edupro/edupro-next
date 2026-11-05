'use client';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { UploadPreview } from '@/lib/exam-entry-actions';

type Out = { ok: true; data: UploadPreview } | { ok: false; error: string };

/**
 * Upload a filled Excel sheet (marks or subject choices, docs/design/65): every row is checked first and
 * shown; Save writes it only when no row has an error — or, with `partial` (holds, docs/design/75), the
 * rows without one, the others listed and left out.
 */
export function ExcelUpload({
  label,
  upload,
  partial = false,
  saveLabel,
  savedText,
  onSaved,
}: {
  label: string;
  /** bound on the page to the exam / section / subject */
  upload: (file: string, apply: boolean) => Promise<Out>;
  /** save the rows without an error even when others have one */
  partial?: boolean;
  /** the Save button's words for n rows (default "Save n rows") */
  saveLabel?: (n: number) => string;
  /** the message once n rows are saved (default "n rows saved.") */
  savedText?: (n: number) => string;
  /** after a save (the page refreshes too) */
  onSaved?: () => void;
}) {
  const t = useTranslations('examHub.upload');
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
      r.onerror = () => reject(new Error(t('unreadableFile')));
      r.readAsDataURL(f);
    });

  const check = (f: File) =>
    start(async () => {
      setMsg(null);
      setPreview(null);
      if (f.size > 1_400_000) {
        setMsg({ tone: 'danger', text: t('fileTooLarge') });
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
          {t('checking')}
        </p>
      ) : null}
      {preview ? (
        <div className={`ep-alert ep-alert--${preview.errors ? 'danger' : 'info'}`} role="status">
          {t('read', { rows: preview.rows.length, ready: preview.ready })}
          {preview.errors
            ? partial
              ? t('withErrorsLeftOut', { n: preview.errors })
              : t('withErrors', { n: preview.errors })
            : ''}
          .
        </div>
      ) : null}
      {bad.length ? (
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">{t('errorRows')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('row')}</th>
                <th scope="col">{t('admissionNo')}</th>
                <th scope="col">{t('student')}</th>
                <th scope="col">{t('problem')}</th>
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
      {preview && (partial || !preview.errors) && preview.ready ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !file}
            onClick={() =>
              start(async () => {
                const r = await upload(file!, true);
                if (r.ok && r.data.applied) {
                  setMsg({
                    tone: 'success',
                    text: savedText ? savedText(r.data.ready) : t('saved', { n: r.data.ready }),
                  });
                  setPreview(null);
                  setFile(null);
                  if (input.current) input.current.value = '';
                  onSaved?.();
                  router.refresh();
                } else setMsg({ tone: 'danger', text: r.ok ? t('nothingSaved') : r.error });
              })
            }
          >
            {saveLabel ? saveLabel(preview.ready) : t('saveRows', { n: preview.ready })}
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
