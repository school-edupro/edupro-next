'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * "Select all on this page" for a list of checkboxes named `name` in the same form, with how many are
 * ticked. Half-ticked when only some are; the count tells the Remind button whom it will reach.
 */
export function TickAll({ name, label }: { name: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const boxes = () =>
      Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`));
    const sync = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      setCount(n);
      setTotal(all.length);
      if (ref.current) {
        ref.current.checked = n > 0 && n === all.length;
        ref.current.indeterminate = n > 0 && n < all.length;
      }
    };
    sync();
    form.addEventListener('change', sync);
    return () => form.removeEventListener('change', sync);
  }, [name]);

  return (
    <label className="ep-check" style={{ margin: 0 }}>
      <input
        ref={ref}
        type="checkbox"
        className="ep-check__input"
        aria-describedby={`${name}-ticked`}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          for (const b of form.querySelectorAll<HTMLInputElement>(
            `input[type=checkbox][name="${name}"]`,
          ))
            b.checked = e.currentTarget.checked;
          form.dispatchEvent(new Event('change', { bubbles: true }));
        }}
      />
      <span className="ep-check__box" aria-hidden="true" />
      <span className="ep-check__text">
        {label}{' '}
        <span id={`${name}-ticked`} className="ep-field__help" aria-live="polite">
          ({count} of {total} ticked)
        </span>
      </span>
    </label>
  );
}
