'use client';

import { useId, useRef } from 'react';

/** "Change photo" under a portal photo: picking a file sends it straight away. */
export function PhotoChange({
  action,
  studentId,
  photoKey,
  label,
  help,
}: {
  action: (fd: FormData) => Promise<void>;
  studentId: string;
  photoKey: string;
  label: string;
  help: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  return (
    <form ref={form} action={action} className="pp-photo-change">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="key" value={photoKey} />
      <label className="ep-btn ep-btn--ghost ep-btn--sm" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="ep-sr-only"
        aria-describedby={`${id}-help`}
        onChange={() => form.current?.requestSubmit()}
      />
      <span id={`${id}-help`} className="ep-sr-only">
        {help}
      </span>
    </form>
  );
}
