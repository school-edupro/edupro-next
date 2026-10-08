'use client';
import { useEffect, useRef } from 'react';

/**
 * "This day is": a working day, or leave (full or half). Choosing a full day of leave empties the
 * activity rows of the same form and switches them off; going back switches them on again.
 */
export function LeaveKindSelect({ name, defaultValue }: { name: string; defaultValue: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  const apply = (full: boolean, clear: boolean) => {
    const form = ref.current?.form;
    if (!form) return;
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-day-row]',
    )) {
      if (full && clear) el.value = '';
      el.disabled = full;
    }
  };
  useEffect(() => {
    // a day already saved as full leave opens with its rows switched off
    apply(ref.current?.value === 'full', false);
  }, []);
  return (
    <select
      ref={ref}
      className="ep-select"
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => apply(e.target.value === 'full', true)}
    >
      <option value="">A working day</option>
      <option value="full">Leave, full day</option>
      <option value="half">Leave, half day</option>
    </select>
  );
}
