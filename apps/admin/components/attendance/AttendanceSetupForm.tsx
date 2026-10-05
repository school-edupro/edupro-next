'use client';
import { useState, useTransition } from 'react';
import { saveAttendanceSetup } from '@/lib/attendance-actions';
import type { AttendanceSetup } from '@/lib/attendance-plus';

type Trip = 'pick' | 'drop';
const WINDOWS: Array<
  [string, 'classFrom' | 'busPickFrom' | 'busDropFrom', 'classTo' | 'busPickTo' | 'busDropTo']
> = [
  ['Class attendance', 'classFrom', 'classTo'],
  ['Bus, morning trip (pick)', 'busPickFrom', 'busPickTo'],
  ['Bus, afternoon trip (drop)', 'busDropFrom', 'busDropTo'],
];

/**
 * Attendance set-up: the time of day in which a teacher may mark (class, bus morning, bus afternoon), how
 * many days back a teacher may still mark, and the teacher of each route for each trip.
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
  const [teachers, setTeachers] = useState(
    setup.routeTeachers.map((t) => ({
      routeId: t.routeId,
      trip: t.trip,
      employeeId: t.employeeId,
    })),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const patch = (n: number, p: Partial<(typeof teachers)[number]>) =>
    setTeachers(teachers.map((t, i) => (i === n ? { ...t, ...p } : t)));
  const save = () =>
    start(async () => {
      setMsg(null);
      if (teachers.some((t) => !t.routeId || !t.employeeId))
        return setMsg({
          ok: false,
          text: 'Choose the route and the teacher on every row, or remove the row.',
        });
      const r = await saveAttendanceSetup({ ...w, routeTeachers: teachers });
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
      <section className="ep-hd__form" aria-label="Route teachers">
        <h3 className="ep-cdash__h3">Teacher of each route (bus attendance)</h3>
        <p className="ep-field__help" style={{ margin: 0 }}>
          Map a teacher to a route for the morning trip, the afternoon trip, or both (two rows). Add
          a second teacher on the same route and trip as a backup. Only they, the transport office
          and admins can mark that route.
        </p>
        {teachers.map((t, n) => (
          <div key={String(n)} className="ep-hd__row">
            <label className="ep-field" htmlFor={`rt-route-${String(n)}`}>
              <span className="ep-field__label">Route</span>
              <select
                id={`rt-route-${String(n)}`}
                className="ep-select"
                value={t.routeId}
                onChange={(e) => patch(n, { routeId: e.target.value })}
              >
                <option value="">Choose</option>
                {setup.routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor={`rt-trip-${String(n)}`}>
              <span className="ep-field__label">Trip</span>
              <select
                id={`rt-trip-${String(n)}`}
                className="ep-select"
                value={t.trip}
                onChange={(e) => patch(n, { trip: e.target.value as Trip })}
              >
                <option value="pick">Morning (pick)</option>
                <option value="drop">Afternoon (drop)</option>
              </select>
            </label>
            <label className="ep-field" htmlFor={`rt-emp-${String(n)}`}>
              <span className="ep-field__label">Teacher</span>
              <select
                id={`rt-emp-${String(n)}`}
                className="ep-select"
                value={t.employeeId}
                onChange={(e) => patch(n, { employeeId: e.target.value })}
              >
                <option value="">Choose</option>
                {setup.staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
              {t.trip === 'pick' &&
              !teachers.some(
                (x) =>
                  x.routeId === t.routeId && x.employeeId === t.employeeId && x.trip === 'drop',
              ) ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() => setTeachers([...teachers, { ...t, trip: 'drop' }])}
                  aria-label={`Add the afternoon trip for row ${String(n + 1)}`}
                >
                  + afternoon
                </button>
              ) : null}
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setTeachers(teachers.filter((_, i) => i !== n))}
                aria-label={`Remove row ${String(n + 1)}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() =>
              setTeachers([...teachers, { routeId: '', trip: 'pick', employeeId: '' }])
            }
          >
            Add a route teacher
          </button>
        </div>
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
