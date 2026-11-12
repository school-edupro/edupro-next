'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Tick every row of the list (the `employeeIds` boxes in the same form) and say how many are ticked;
 * half-ticked when some are.
 */
export function TickAll({ form }: { form: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [n, setN] = useState(0);
  const boxes = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>(`#${form} input[name="employeeIds"]`));
  useEffect(() => {
    const f = document.getElementById(form);
    const count = () => {
      const all = boxes();
      const on = all.filter((b) => b.checked).length;
      setN(on);
      if (ref.current) {
        ref.current.checked = !!all.length && on === all.length;
        ref.current.indeterminate = on > 0 && on < all.length;
      }
    };
    f?.addEventListener('change', count);
    count();
    return () => f?.removeEventListener('change', count);
  }, [form]);
  return (
    <>
      <label className="ep-check" htmlFor={`${form}-all`}>
        <input
          ref={ref}
          id={`${form}-all`}
          type="checkbox"
          onChange={(e) => {
            for (const b of boxes()) b.checked = e.target.checked;
            setN(e.target.checked ? boxes().length : 0);
          }}
        />
        <span>Tick all on this page</span>
      </label>
      <span className="ep-field__help" role="status" style={{ margin: 0 }}>
        {n} ticked
      </span>
    </>
  );
}
