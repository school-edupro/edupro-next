'use client';
import { useRef, useState, useTransition } from 'react';
import { ChipPicker, SearchPick, fileBase64 } from '@/components/ChipPicker';
import {
  addRouteTeachers,
  importRouteTeachers,
  removeRouteTeacher,
  type RouteTeacherResult,
} from '@/lib/attendance-actions';
import type { AttendanceSetup } from '@/lib/attendance-plus';

type Trip = 'both' | 'pick' | 'drop';

/**
 * Bus attendance set-up: who marks each route. Pick the employee, the routes and the trip (both, morning
 * or afternoon) and submit; or fill the Excel format and upload it. The list below shows every teacher
 * with the routes and trips they mark.
 */
export function RouteTeachersPanel({ setup }: { setup: AttendanceSetup }) {
  const [employeeId, setEmployeeId] = useState('');
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [trip, setTrip] = useState<Trip>('both');
  const [formKey, setFormKey] = useState(0);
  const [msg, setMsg] = useState<RouteTeacherResult | null>(null);
  const [busy, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  // one line per teacher and route, with the trips held
  const lines = new Map<
    string,
    {
      employeeId: string;
      routeId: string;
      name: string;
      route: string;
      login: boolean;
      pick: boolean;
      drop: boolean;
    }
  >();
  for (const t of setup.routeTeachers) {
    const key = `${t.employeeId}|${t.routeId}`;
    const line = lines.get(key) ?? {
      employeeId: t.employeeId,
      routeId: t.routeId,
      name: `${t.code ? `${t.code} · ` : ''}${t.name ?? ''}`,
      route: t.route ?? setup.routes.find((r) => r.id === t.routeId)?.name ?? '',
      login: t.login !== false,
      pick: false,
      drop: false,
    };
    line[t.trip] = true;
    lines.set(key, line);
  }
  const submit = () =>
    start(async () => {
      setMsg(null);
      if (!employeeId) return setMsg({ ok: false, error: 'Select the employee from the list.' });
      if (!routeIds.length) return setMsg({ ok: false, error: 'Select at least one route.' });
      const r = await addRouteTeachers({ employeeId, routeIds, trip });
      setMsg(r);
      if (r.ok) {
        setEmployeeId('');
        setRouteIds([]);
        setTrip('both');
        setFormKey(formKey + 1);
      }
    });
  const remove = (employeeId2: string, routeId: string, which: Trip) =>
    start(async () =>
      setMsg(await removeRouteTeacher({ employeeId: employeeId2, routeId, trip: which })),
    );
  const upload = () =>
    start(async () => {
      const f = file.current?.files?.[0];
      if (!f) return setMsg({ ok: false, error: 'Choose the filled Excel file first.' });
      setMsg(await importRouteTeachers(await fileBase64(f)));
      if (file.current) file.current.value = '';
    });
  return (
    <div className="ep-hd__form">
      <p className="ep-field__help" style={{ margin: 0 }}>
        The teacher marks bus attendance for the routes mapped here: the morning trip, the afternoon
        trip or both. A route may have more than one teacher; any of them can mark and the roll
        shows who did. The transport office and admins can mark every route.
      </p>
      <div className="ep-hd__row ep-hd__row--top" key={formKey}>
        <SearchPick
          label="Select employee"
          required
          options={setup.staff.map((s) => ({ value: s.id, label: s.name }))}
          value={employeeId}
          onChange={setEmployeeId}
        />
        <label className="ep-field" htmlFor="rt-trip">
          <span className="ep-field__label">
            Trip <span aria-hidden="true">*</span>
          </span>
          <select
            id="rt-trip"
            className="ep-select"
            value={trip}
            onChange={(e) => setTrip(e.target.value as Trip)}
          >
            <option value="both">Both (morning and afternoon)</option>
            <option value="pick">Morning (pick) only</option>
            <option value="drop">Afternoon (drop) only</option>
          </select>
        </label>
      </div>
      <ChipPicker
        label="Select routes"
        required
        options={setup.routes.map((r) => ({ value: r.id, label: r.name }))}
        value={routeIds}
        onChange={setRouteIds}
      />
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="ep-btn ep-btn--primary" onClick={submit} disabled={busy}>
          Submit
        </button>
        {msg ? (
          <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
            {msg.ok ? msg.text : msg.error}
          </span>
        ) : null}
      </div>
      {msg?.ok && msg.errors?.length ? (
        <ul className="ep-field__error" style={{ margin: 0 }}>
          {msg.errors.slice(0, 30).map((e) => (
            <li key={e.row}>
              Row {e.row}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className="ep-filter-band"
        style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <div>
          <div className="ep-field__label">From Excel</div>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/api/attendance/route-teachers-format"
          >
            Download the format
          </a>
        </div>
        <label className="ep-field" htmlFor="rt-file">
          <span className="ep-field__label">Filled file (.xlsx)</span>
          <input id="rt-file" ref={file} type="file" accept=".xlsx" className="ep-input" />
        </label>
        <button type="button" className="ep-btn ep-btn--secondary" onClick={upload} disabled={busy}>
          Upload
        </button>
        <span className="ep-field__help">
          Employee, Route and Trip are drop-downs in the format. An upload only adds.
        </span>
      </div>
      {lines.size === 0 ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          No teacher is mapped to a route yet.
        </p>
      ) : (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Route teachers">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">The teacher of each route for bus attendance</caption>
            <thead>
              <tr>
                <th scope="col">S.no</th>
                <th scope="col">Employee</th>
                <th scope="col">Route</th>
                <th scope="col">Morning (pick)</th>
                <th scope="col">Afternoon (drop)</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {[...lines.values()].map((l, i) => (
                <tr key={`${l.employeeId}|${l.routeId}`}>
                  <td>{i + 1}</td>
                  <th scope="row">
                    {l.name}
                    {l.login ? '' : ' (no login)'}
                  </th>
                  <td>{l.route}</td>
                  {(['pick', 'drop'] as const).map((t) => (
                    <td key={t}>
                      {l[t] ? (
                        <>
                          Yes{' '}
                          {l.pick && l.drop ? (
                            <button
                              type="button"
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              disabled={busy}
                              onClick={() => remove(l.employeeId, l.routeId, t)}
                              aria-label={`Remove the ${t === 'pick' ? 'morning' : 'afternoon'} trip of ${l.route} from ${l.name}`}
                            >
                              Remove
                            </button>
                          ) : null}
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      disabled={busy}
                      onClick={() => remove(l.employeeId, l.routeId, 'both')}
                      aria-label={`Remove ${l.name} from ${l.route}`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
