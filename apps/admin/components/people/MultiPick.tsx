'use client';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * A drop-down that takes several values (the lists' quick filters): the button says All, the one value,
 * or how many; the panel has a search box (from 8 options) and a tick per option.
 */
export function MultiPick({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const labelId = `${id}-label`;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        document.getElementById(id)?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, id]);

  // a value from a saved view that is no longer offered stays visible (and can be unticked)
  const all = [...value.filter((v) => !options.includes(v)), ...options];
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((o) => o.toLowerCase().includes(needle)) : all;
  const summary =
    value.length === 0
      ? 'All'
      : value.length === 1
        ? value[0]!
        : value.length === 2
          ? value.join(', ')
          : `${String(value.length)} chosen`;
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);

  return (
    <div className="ep-field ep-mp" ref={box} style={{ margin: 0 }}>
      <span className="ep-field__label" id={labelId}>
        {label}
      </span>
      <button
        id={id}
        type="button"
        className="ep-select ep-mp__button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-labelledby={`${labelId} ${id}`}
        title={value.length > 2 ? value.join(', ') : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ep-mp__summary">{summary}</span>
      </button>
      {open ? (
        <div className="ep-mp__panel" id={panelId} role="group" aria-labelledby={labelId}>
          {all.length >= 8 ? (
            <input
              className="ep-input ep-mp__search"
              type="search"
              aria-label={`Search ${label}`}
              placeholder="Type to search"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
          <div className="ep-mp__list">
            {shown.map((o) => (
              <label key={o} className="ep-check ep-mp__option">
                <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}
              </label>
            ))}
            {!shown.length ? <p className="ep-mp__empty">Nothing matches</p> : null}
          </div>
          <div className="ep-mp__foot">
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => onChange([])}
              disabled={!value.length}
            >
              All
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
