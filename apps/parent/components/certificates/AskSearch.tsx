'use client';
import { useState } from 'react';

/** Type to narrow the list of certificates to ask for (the items carry `data-name`). */
export function AskSearch({
  listId,
  label,
  none,
}: {
  listId: string;
  label: string;
  none: string;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const filter = (q: string) => {
    const list = document.getElementById(listId);
    if (!list) return;
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const li of Array.from(list.querySelectorAll<HTMLElement>('li[data-name]'))) {
      const hit = words.every((w) => (li.dataset.name ?? '').includes(w));
      li.hidden = !hit;
      if (hit) n += 1;
    }
    setShown(words.length ? n : null);
  };
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <label className="ep-field" htmlFor={`${listId}-q`}>
        <span className="ep-field__label">{label}</span>
        <input
          id={`${listId}-q`}
          type="search"
          className="ep-input"
          autoComplete="off"
          onChange={(e) => filter(e.target.value)}
        />
      </label>
      <p className="ep-field__help" role="status" aria-live="polite" style={{ margin: 0 }}>
        {shown === 0 ? none : ''}
      </p>
    </div>
  );
}
