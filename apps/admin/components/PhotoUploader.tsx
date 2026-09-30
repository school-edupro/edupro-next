'use client';
import { useId, useRef } from 'react';

/** Pick a photo and it uploads straight away (the form posts on change). */
export function PhotoUploader({
  action,
  studentId,
  label,
  fields = { kind: 'photo', tab: 'overview' },
}: {
  action: (fd: FormData) => void | Promise<void>;
  studentId: string;
  label: string;
  /** Extra hidden fields (e.g. which parent the photo belongs to). */
  fields?: Record<string, string>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const inputId = useId();
  return (
    <form ref={form} action={action} className="ep-hero__photo-form">
      <input type="hidden" name="id" value={studentId} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="ep-btn ep-btn--ghost ep-btn--sm" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="ep-sr-only"
        onChange={() => form.current?.requestSubmit()}
      />
    </form>
  );
}
