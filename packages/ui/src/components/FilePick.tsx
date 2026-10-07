'use client';
import { useState } from 'react';

/**
 * A file field as an upload button that sits under a text box: the icon and "Attach file", then the
 * names of what was chosen. The real input stays in the form (and reachable by keyboard).
 */
export function FilePick({
  name,
  label,
  accept,
  multiple = true,
}: {
  name: string;
  /** What the file is for, read out by screen readers ("Hindi: homework file"). */
  label: string;
  accept?: string;
  multiple?: boolean;
}) {
  const [names, setNames] = useState<string[]>([]);
  return (
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
        <span>{names.length ? 'Change file' : 'Attach file'}</span>
        <input
          className="ep-filepick__input"
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          aria-label={label}
          onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name))}
        />
      </label>
      {names.length ? (
        <span className="ep-filepick__names" aria-live="polite">
          {names.join(', ')}
        </span>
      ) : null}
    </span>
  );
}
