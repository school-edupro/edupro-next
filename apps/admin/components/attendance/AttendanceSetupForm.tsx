'use client';
import { useState, useTransition } from 'react';
import { saveAttendanceSetup } from '@/lib/attendance-actions';
import type { AttendanceSetup } from '@/lib/attendance-plus';

const WINDOWS: Array<
  [string, 'classFrom' | 'busPickFrom' | 'busDropFrom', 'classTo' | 'busPickTo' | 'busDropTo']
> = [
  ['Class attendance', 'classFrom', 'classTo'],
  ['Bus, morning trip (pick)', 'busPickFrom', 'busPickTo'],
  ['Bus, afternoon trip (drop)', 'busDropFrom', 'busDropTo'],
];

/**
 * Attendance set-up: the time of day in which a teacher may mark (class, bus morning, bus afternoon), how
 * many days back a teacher may still mark.
 */
export function AttendanceSetupForm({ setup }: { setup: AttendanceSetup }) {
  const [w, setW] = useState({
    classFrom: setup.windows.classFrom ?? '',
    classTo: setup.windows.classTo ?? '',
    busPickFrom: setup.windows.busPickFrom ?? '',
    busPickTo: setup.windows.busPickTo ?? '',
    busDropFrom: setup.windows.busDropFrom ?? '',
    busDropTo: setup.windows.busDropTo ?? '',
    backDays: setup.windows.backDays,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveAttendanceSetup(w);
      setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
    });
  return (
    <div className="ep-hd__form">
      <section className="ep-hd__form" aria-label="Marking windows">
        <h3 className="ep-cdash__h3">Marking windows</h3>
        <p className="ep-field__help" style={{ margin: 0 }}>
          A teacher marks today’s attendance between these times. Leave both blank for any time of
          the day. After the window the coordinator or admin marks, or reopens the day for the
          teacher; such entries are flagged “marked late”.
        </p>
        {WINDOWS.map(([label, from, to]) => (
          <div key={from} className="ep-hd__row">
            <label className="ep-field" htmlFor={`aw-${from}`}>
              <span className="ep-field__label">{label}: opens</span>
              <input
                id={`aw-${from}`}
                type="time"
                className="ep-input"
                value={w[from]}
                onChange={(e) => setW({ ...w, [from]: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor={`aw-${to}`}>
              <span className="ep-field__label">{label}: closes</span>
              <input
                id={`aw-${to}`}
                type="time"
                className="ep-input"
                value={w[to]}
                onChange={(e) => setW({ ...w, [to]: e.target.value })}
              />
            </label>
          </div>
        ))}
        <label className="ep-field" htmlFor="aw-back" style={{ maxWidth: '22rem' }}>
          <span className="ep-field__label">
            Days back a teacher may still mark (0 = today only)
          </span>
          <input
            id="aw-back"
            type="number"
            className="ep-input"
            min={0}
            max={7}
            value={w.backDays}
            onChange={(e) =>
              setW({ ...w, backDays: Math.min(7, Math.max(0, Number(e.target.value) || 0)) })
            }
          />
        </label>
      </section>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="ep-btn ep-btn--primary" onClick={save} disabled={busy}>
          Save
        </button>
        {msg ? (
          <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
