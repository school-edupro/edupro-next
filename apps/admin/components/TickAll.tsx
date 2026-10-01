'use client';

/** Ticks or clears every checkbox with this name in the same form. */
export function TickAll({ name, label }: { name: string; label: string }) {
  return (
    <label className="ep-roles__tick">
      <input
        type="checkbox"
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          for (const box of form.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${name}"]`,
          ))
            box.checked = e.currentTarget.checked;
        }}
      />{' '}
      {label}
    </label>
  );
}
