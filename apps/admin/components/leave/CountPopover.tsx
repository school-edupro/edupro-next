'use client';
import { useEffect, useRef, useState } from 'react';
import type { CorrectionsLog } from '@/lib/leave';
import { loadCorrections } from '@/lib/leave-actions';

interface Open {
  emp: string;
  name: string;
  label: string;
  count: string;
  days: string[];
  month: string;
  top: number | undefined;
  bottom: number | undefined;
  left: number;
  from: HTMLElement;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 6 Nov (a half day: 6 Nov ½) */
const short = (d: string) =>
  `${String(Number(d.slice(8, 10)))} ${MON[Number(d.slice(5, 7)) - 1]!}${d.endsWith('½') ? ' ½' : ''}`;
/** under the count (above it when the screen has no room below), centred on it, kept on screen */
const place = (r: DOMRect) => {
  const width = Math.min(window.innerWidth - 16, 320);
  const left = Math.max(
    8,
    Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8),
  );
  const below = window.innerHeight - r.bottom;
  return below >= 260 || below >= r.top
    ? { top: r.bottom + 6, bottom: undefined, left }
    : { top: undefined, bottom: window.innerHeight - r.top + 6, left };
};

/**
 * A count of the register opens its days (as the old register's): "Absent — 1 day", the dates, and the
 * hand corrections made on those days (from the corrections log) or "No manual corrections on these days".
 * One panel for the grid, opened from a count (`[data-cnt]` with the employee, the label, the count and
 * the days); Escape, ×, or a click elsewhere closes it.
 */
export function CountPopover() {
  const [open, setOpen] = useState<Open | null>(null);
  const [log, setLog] = useState<CorrectionsLog['rows'] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef<Open | null>(null);
  current.current = open;
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const b = t?.closest<HTMLElement>('[data-cnt]');
      if (b) {
        e.preventDefault();
        const d = b.dataset;
        setLog(null);
        setOpen({
          emp: d.emp ?? '',
          name: d.name ?? '',
          label: d.label ?? '',
          count: d.count ?? '',
          days: (d.days ?? '').split(',').filter(Boolean),
          month: d.month ?? '',
          ...place(b.getBoundingClientRect()),
          from: b,
        });
        return;
      }
      if (ref.current && t && !ref.current.contains(t)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !current.current) return;
      current.current.from.focus();
      setOpen(null);
    };
    // the panel follows its count when the page or the grid moves; it closes once the count is off screen
    const away = () =>
      setOpen((o) => {
        if (!o) return o;
        const r = o.from.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)
          return null;
        return { ...o, ...place(r) };
      });
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, []);
  // once a count is opened (not again as the panel follows it): focus it, load the corrections of its days
  const opened = open ? `${open.emp}|${open.label}|${open.month}` : null;
  useEffect(() => {
    const o = current.current;
    if (!opened || !o) return;
    ref.current?.focus({ preventScroll: true });
    let live = true;
    void loadCorrections({ month: o.month, people: true, employeeId: o.emp, size: 100 }).then(
      (r) => {
        if (!live) return;
        const on = new Set(o.days.map((d) => d.slice(0, 10)));
        setLog(r.ok ? r.rows.filter((x) => on.has(x.day)) : []);
      },
    );
    return () => {
      live = false;
    };
  }, [opened]);
  if (!open) return null;
  const n = Number(open.count);
  return (
    <div
      ref={ref}
      className="ep-cpop"
      role="dialog"
      aria-label={`${open.name}: ${open.label}, ${open.count} day${n === 1 ? '' : 's'}`}
      tabIndex={-1}
      style={{ top: open.top, bottom: open.bottom, left: open.left }}
    >
      <div className="ep-cpop__head">
        <span>
          <strong>{open.label}</strong> — {open.count} day{n === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="ep-chips__x"
          aria-label="Close"
          onClick={() => {
            open.from.focus();
            setOpen(null);
          }}
        >
          ×
        </button>
      </div>
      <div className="ep-cpop__body">
        <p className="ep-cpop__days">{open.days.map(short).join(', ') || '—'}</p>
        <hr className="ep-cpop__rule" />
        {log === null ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Looking for corrections…
          </p>
        ) : log.length ? (
          <ul className="ep-cpop__log">
            {log.map((x) => (
              <li key={x.id}>
                <strong>{short(x.day)}</strong>{' '}
                {x.changes.map((c) => `${c.what} ${c.from} → ${c.to}`).join(', ')}
                <span className="ep-mr-col__desc">
                  {x.reason ?? '—'} · {x.by ? x.by.code || x.by.name : 'the system'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No manual corrections on these days.
          </p>
        )}
      </div>
    </div>
  );
}
