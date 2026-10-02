'use client';
import { useState } from 'react';

/**
 * A ticked list with a filter box (sections, classes, routes, groups, houses...). Long lists filter as
 * you type; "all shown" ticks or clears what the filter shows.
 */
export function CheckList({
  id,
  legend,
  options,
  value,
  onChange,
  empty = 'Nothing to choose from.',
}: {
  id: string;
  legend: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  value: string[];
  onChange: (v: string[]) => void;
  empty?: string;
}) {
  const [q, setQ] = useState('');
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const set = new Set(value);
  const allShown = shown.length > 0 && shown.every((o) => set.has(o.value));
  return (
    <fieldset className="ep-cl">
      <legend className="ep-field__label">
        {legend}
        {value.length ? <span className="ep-cl__count"> · {value.length} chosen</span> : null}
      </legend>
      {options.length > 8 ? (
        <div className="ep-cl__tools">
          <input
            id={`${id}-q`}
            type="search"
            className="ep-input ep-cl__filter"
            placeholder="Filter…"
            aria-label={`Filter ${legend}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              const next = new Set(value);
              for (const o of shown) {
                if (allShown) next.delete(o.value);
                else next.add(o.value);
              }
              onChange([...next]);
            }}
          >
            {allShown ? 'Clear shown' : 'Tick all shown'}
          </button>
        </div>
      ) : null}
      {options.length ? (
        <ul className="ep-cl__list">
          {shown.map((o) => (
            <li key={o.value}>
              <label className="ep-roles__tick" htmlFor={`${id}-${o.value}`}>
                <input
                  id={`${id}-${o.value}`}
                  type="checkbox"
                  checked={set.has(o.value)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value),
                    )
                  }
                />{' '}
                {o.label}
                {o.hint ? <span className="ep-field__help"> · {o.hint}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ep-field__help">{empty}</p>
      )}
    </fieldset>
  );
}
