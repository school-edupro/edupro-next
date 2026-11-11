'use client';
import { useEffect, useRef, useState } from 'react';

interface Cell {
  emp: string;
  name: string;
  day: string;
  type: string;
  code: string;
  in: string;
  out: string;
}
const TYPES: Array<[string, string]> = [
  ['', 'As the punches make it'],
  ['P', 'P — Present'],
  ['HD', 'HD — Half day'],
  ['A', 'A — Absent'],
  ['WO', 'WO — Weekly off'],
  ['H', 'H — Holiday'],
  ['HOLD', 'HOLD — Salary hold'],
];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/**
 * The register's quick edit (as the old register's): one dialog for the whole grid, opened from a day
 * (`[data-qe]` with the employee, day, stored type, IN and OUT): the status, IN, OUT and the reason; a
 * weekly off or holiday made absent must be confirmed. Saving corrects the day by hand (m); "Full day
 * detail" opens the day's page with its punches and history.
 */
export function DayQuickEdit({
  action,
  back,
}: {
  action: (fd: FormData) => Promise<void>;
  back: string;
}) {
  const [cell, setCell] = useState<Cell | null>(null);
  const [type, setType] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-qe]');
      if (!b) return;
      e.preventDefault();
      const d = b.dataset;
      setCell({
        emp: d.emp ?? '',
        name: d.name ?? '',
        day: d.day ?? '',
        type: d.type ?? '',
        code: d.code ?? '',
        in: d.in ?? '',
        out: d.out ?? '',
      });
      setType(TYPES.some(([k]) => k && k === d.type) ? (d.type ?? '') : '');
    };
    document.addEventListener('click', open);
    return () => document.removeEventListener('click', open);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (cell && el && !el.open) el.showModal();
  }, [cell]);
  if (!cell) return null;
  const offToAbsent = (cell.type === 'WO' || cell.type === 'H') && type === 'A';
  const id = 'qe';
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      aria-labelledby={`${id}-title`}
      onClose={() => setCell(null)}
    >
      <div className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id={`${id}-title`} className="ep-card__title">
            {cell.name} · {dmy(cell.day)}
          </h3>
          <button
            type="button"
            className="ep-chips__x"
            aria-label="Close"
            onClick={() => ref.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="ep-dialog__content ep-weekoff__content">
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Now: <strong>{cell.code || 'not worked out'}</strong>
            {cell.in || cell.out ? ` · IN ${cell.in || '—'} · OUT ${cell.out || '—'}` : ''}. Saving
            sets the day by hand (m): the punches no longer change it.
          </p>
          <form action={action} className="ep-form-section__body">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="employeeId" value={cell.emp} />
            <input type="hidden" name="day" value={cell.day} />
            <label className="ep-field" htmlFor={`${id}-type`}>
              <span className="ep-field__label">Status</span>
              <select
                id={`${id}-type`}
                name="dayType"
                className="ep-select"
                data-native
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPES.map(([k, words]) => (
                  <option key={k} value={k}>
                    {words}
                  </option>
                ))}
              </select>
            </label>
            <div className="ep-form-row">
              <label className="ep-field" htmlFor={`${id}-in`}>
                <span className="ep-field__label">In Time</span>
                <input
                  id={`${id}-in`}
                  name="in"
                  type="time"
                  className="ep-input"
                  defaultValue={cell.in}
                />
              </label>
              <label className="ep-field" htmlFor={`${id}-out`}>
                <span className="ep-field__label">Out Time</span>
                <input
                  id={`${id}-out`}
                  name="out"
                  type="time"
                  className="ep-input"
                  defaultValue={cell.out}
                />
              </label>
            </div>
            <label className="ep-field" htmlFor={`${id}-why`}>
              <span className="ep-field__label">Reason</span>
              <textarea
                id={`${id}-why`}
                name="reason"
                className="ep-input"
                rows={2}
                minLength={3}
                maxLength={300}
                required
              />
            </label>
            {offToAbsent ? (
              <label className="ep-check" htmlFor={`${id}-off`}>
                <input id={`${id}-off`} type="checkbox" name="confirmOff" value="1" required />
                <span>
                  Yes — this {cell.type === 'WO' ? 'weekly off' : 'holiday'} becomes absent (loss of
                  pay once the month is locked)
                </span>
              </label>
            ) : null}
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Save
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => ref.current?.close()}
              >
                Cancel
              </button>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/leave/attendance/day?emp=${cell.emp}&day=${cell.day}`}
              >
                Full day detail
              </a>
            </div>
          </form>
        </div>
      </div>
    </dialog>
  );
}
