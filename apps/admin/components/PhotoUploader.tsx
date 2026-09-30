'use client';
import { useRef } from 'react';

/** Pick a photo and it uploads straight away (the form posts on change). */
export function PhotoUploader({
  action,
  studentId,
  label,
}: {
  action: (fd: FormData) => void | Promise<void>;
  studentId: string;
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="ep-hero__photo-form">
      <input type="hidden" name="id" value={studentId} />
      <input type="hidden" name="kind" value="photo" />
      <input type="hidden" name="tab" value="overview" />
      <label className="ep-btn ep-btn--ghost ep-btn--sm" htmlFor="photo-file">
        {label}
      </label>
      <input
        id="photo-file"
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="ep-sr-only"
        onChange={() => form.current?.requestSubmit()}
      />
    </form>
  );
}
