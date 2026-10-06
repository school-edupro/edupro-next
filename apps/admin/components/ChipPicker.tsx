'use client';
import { useId, useState } from 'react';

export interface ChipOption {
  value: string;
  label: string;
}

/**
 * Pick several from a list: type to search, choose, and each choice becomes a chip that can be removed.
 * The chosen values also go out as hidden fields under `name` when the picker sits in a form.
 */
export function ChipPicker({
  label,
  options,
  value,
  onChange,
  name,
  placeholder = 'Type to search, then pick',
  help,
  required,
}: {
  label: string;
  options: ChipOption[];
  value: string[];
  onChange: (next: string[]) => void;
  name?: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const left = options.filter((o) => !value.includes(o.value));
  const typed = (text: string) => {
    const hit = left.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
    if (hit) {
      onChange([...value, hit.value]);
      setQ('');
    } else setQ(text);
  };
  return (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor={`${id}-q`}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {value.length ? (
        <ul className="ep-chips" aria-label={`${label}: chosen`}>
          {value.map((v) => {
            const text = options.find((o) => o.value === v)?.label ?? v;
            return (
              <li key={v}>
                {text}
                <button
                  type="button"
                  className="ep-chips__x"
                  aria-label={`Remove ${text}`}
                  onClick={() => onChange(value.filter((x) => x !== v))}
                >
                  ×
                </button>
                {name ? <input type="hidden" name={name} value={v} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="ep-chips__add">
        <input
          id={`${id}-q`}
          className="ep-input"
          type="search"
          list={`${id}-list`}
          value={q}
          placeholder={left.length ? placeholder : 'All are chosen'}
          autoComplete="off"
          onChange={(e) => typed(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            // Enter takes the only match of what is typed
            const hits = left.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
            if (q.trim() && hits.length === 1) typed(hits[0]!.label);
          }}
        />
        <datalist id={`${id}-list`}>
          {left.map((o) => (
            <option key={o.value} value={o.label} />
          ))}
        </datalist>
        {left.length > 1 ? (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => onChange(options.map((o) => o.value))}
          >
            All
          </button>
        ) : null}
        {value.length > 1 ? (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        ) : null}
      </div>
      {help ? <span className="ep-field__help">{help}</span> : null}
    </div>
  );
}

/** One from a list, type-to-search: shows the label, gives back the value ('' until a label matches). */
export function SearchPick({
  label,
  options,
  value,
  onChange,
  required,
  placeholder = 'Type to search, then pick',
}: {
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(options.find((o) => o.value === value)?.label ?? '');
  return (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor={`${id}-q`}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={`${id}-q`}
        className="ep-input"
        type="search"
        list={`${id}-list`}
        value={value ? (options.find((o) => o.value === value)?.label ?? text) : text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            options.find((o) => o.label.toLowerCase() === e.target.value.trim().toLowerCase())
              ?.value ?? '',
          );
        }}
      />
      <datalist id={`${id}-list`}>
        {options.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
    </div>
  );
}

/** A file picked on the page, as base64 for a JSON upload. */
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
