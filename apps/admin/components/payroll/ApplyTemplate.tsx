'use client';
import { useState } from 'react';

/** Fills the structure form's amounts from a template (by head code); nothing is saved until the form is. */
export function ApplyTemplate({
  formId,
  templates,
}: {
  formId: string;
  templates: Array<{ id: string; name: string; lines: Record<string, string> }>;
}) {
  const [pick, setPick] = useState(templates[0]?.id ?? '');
  const [said, setSaid] = useState('');
  if (!templates.length) return null;
  const apply = () => {
    const t = templates.find((x) => x.id === pick);
    const form = document.getElementById(formId);
    if (!t || !(form instanceof HTMLFormElement)) return;
    let n = 0;
    for (const [code, amount] of Object.entries(t.lines)) {
      const box = form.querySelector<HTMLInputElement>(`input[data-head="${code}"]`);
      if (box) {
        box.value = amount;
        n += 1;
      }
    }
    setSaid(`${String(n)} amount(s) filled from ${t.name}: check them, then save.`);
  };
  return (
    <div className="ep-grid__toolbar">
      <label className="ep-field" htmlFor="at-pick">
        <span className="ep-field__label">Fill from a template</span>
        <select
          id="at-pick"
          className="ep-select"
          value={pick}
          onChange={(e) => setPick(e.currentTarget.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ep-btn ep-btn--ghost" onClick={apply}>
        Fill
      </button>
      <span role="status" className="ep-field__help">
        {said}
      </span>
    </div>
  );
}
