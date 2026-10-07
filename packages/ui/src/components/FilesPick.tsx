'use client';
import { useRef, useState } from 'react';

/**
 * Attachments added one or several at a time, up to `max`: each chosen file is listed with a Remove
 * button and "Add file" stays until the limit is reached. The files go out in the form under `name`.
 */
export function FilesPick({
  name,
  label,
  max,
  accept,
  maxMb,
}: {
  name: string;
  label: string;
  max: number;
  accept?: string;
  /** The largest size of one file, said in the hint. */
  maxMb?: number;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const put = (next: File[]) => {
    // the real field carries every file kept so far
    const dt = new DataTransfer();
    for (const f of next) dt.items.add(f);
    if (field.current) field.current.files = dt.files;
    setFiles(next);
  };
  return (
    <div className="ep-field">
      <span className="ep-field__label" id={`${name}-label`}>
        {label}
      </span>
      <input ref={field} type="file" name={name} multiple hidden tabIndex={-1} aria-hidden="true" />
      {files.length ? (
        <ol className="ep-filespick__list" aria-labelledby={`${name}-label`}>
          {files.map((f, i) => (
            <li key={`${f.name}-${String(i)}`}>
              <span>
                {i + 1}. {f.name}{' '}
                <span className="ep-field__help">
                  ({Math.max(1, Math.round(f.size / 1024))} KB)
                </span>
              </span>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  put(files.filter((_, j) => j !== i));
                  setNote('');
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {files.length < max ? (
        <span className="ep-filepick">
          <label className="ep-filepick__btn">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{files.length ? 'Add another file' : 'Add file'}</span>
            <input
              className="ep-filepick__input"
              type="file"
              multiple
              accept={accept}
              aria-label={`${label}: add a file`}
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = '';
                const room = max - files.length;
                put([...files, ...picked.slice(0, room)]);
                setNote(
                  picked.length > room
                    ? `Only ${String(max)} files can be attached; the rest were left out.`
                    : '',
                );
              }}
            />
          </label>
        </span>
      ) : null}
      <span className="ep-field__help" role="status">
        {note || `${String(files.length)} of ${String(max)} attached.`}
        {maxMb ? ` Each file up to ${String(maxMb)} MB.` : ''}
      </span>
    </div>
  );
}
