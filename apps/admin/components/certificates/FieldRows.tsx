'use client';
import { useState } from 'react';
import type { CertificateFieldSpec } from '@/lib/certificates';

type Row = {
  key: string;
  label: string;
  kind: CertificateFieldSpec['kind'];
  required: boolean;
  options: string;
  hint: string;
};
const toRow = (f: CertificateFieldSpec): Row => ({
  key: f.key,
  label: f.label,
  kind: f.kind,
  required: !!f.required,
  options: (f.options ?? []).join(', '),
  hint: f.hint ?? '',
});

/**
 * The school's own fields of a certificate type (docs/design/87, phase B): each a key (used in the template as
 * {{fields.key}}), a label, a kind (text, date, number, a list of choices), required or not and a hint. Posted as one
 * JSON value (`fieldsJson`) with the type's form.
 */
export function FieldRows({ initial }: { initial: CertificateFieldSpec[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const json = JSON.stringify(
    rows
      .filter((r) => r.key.trim() && r.label.trim())
      .map((r) => ({
        key: r.key.trim(),
        label: r.label.trim(),
        kind: r.kind,
        ...(r.required ? { required: true } : {}),
        ...(r.kind === 'list'
          ? {
              options: r.options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean),
            }
          : {}),
        ...(r.hint.trim() ? { hint: r.hint.trim() } : {}),
      })),
  );
  return (
    <div className="ep-fieldrows">
      <input type="hidden" name="fieldsJson" value={json} />
      {rows.length === 0 ? (
        <p className="ep-field__help">No fields of the school's own yet.</p>
      ) : null}
      {rows.map((r, i) => (
        <fieldset key={i} className="ep-fieldrows__row">
          <legend className="ep-field__label">Field {i + 1}</legend>
          <label className="ep-field" htmlFor={`fk${i}`}>
            <span className="ep-field__label">Key (in the template: fields.key)</span>
            <input
              id={`fk${i}`}
              className="ep-input"
              value={r.key}
              onChange={(e) => set(i, { key: e.target.value.replace(/[^a-zA-Z]/g, '') })}
              maxLength={30}
              pattern="[a-z][a-zA-Z]{1,29}"
              required
            />
          </label>
          <label className="ep-field" htmlFor={`fl${i}`}>
            <span className="ep-field__label">Label</span>
            <input
              id={`fl${i}`}
              className="ep-input"
              value={r.label}
              onChange={(e) => set(i, { label: e.target.value })}
              maxLength={120}
              required
            />
          </label>
          <label className="ep-field" htmlFor={`fkind${i}`}>
            <span className="ep-field__label">Kind</span>
            <select
              id={`fkind${i}`}
              className="ep-input"
              value={r.kind}
              onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })}
            >
              <option value="text">Text</option>
              <option value="date">Date</option>
              <option value="number">Whole number</option>
              <option value="list">A list of choices</option>
            </select>
          </label>
          {r.kind === 'list' ? (
            <label className="ep-field" htmlFor={`fo${i}`}>
              <span className="ep-field__label">Choices (separated by commas)</span>
              <input
                id={`fo${i}`}
                className="ep-input"
                value={r.options}
                onChange={(e) => set(i, { options: e.target.value })}
                required
              />
            </label>
          ) : null}
          <label className="ep-field" htmlFor={`fh${i}`}>
            <span className="ep-field__label">Hint (optional)</span>
            <input
              id={`fh${i}`}
              className="ep-input"
              value={r.hint}
              onChange={(e) => set(i, { hint: e.target.value })}
              maxLength={160}
            />
          </label>
          <label className="ep-check" htmlFor={`fr${i}`}>
            <input
              id={`fr${i}`}
              type="checkbox"
              className="ep-check__input"
              checked={r.required}
              onChange={(e) => set(i, { required: e.target.checked })}
            />
            <span className="ep-check__box" />
            Required
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
          >
            Remove field {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        onClick={() =>
          setRows((x) => [
            ...x,
            { key: '', label: '', kind: 'text', required: false, options: '', hint: '' },
          ])
        }
      >
        Add a field
      </button>
    </div>
  );
}
