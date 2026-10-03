'use client';
import { useState, useTransition } from 'react';
import {
  saveAppointmentHost,
  saveAppointmentSettings,
  type HostInput,
} from '@/lib/appointment-actions';
import {
  ASK_LABEL,
  CHANNEL_LABEL,
  WEEKDAYS,
  hoursLine,
  type AppointmentSettings,
  type AppointmentSetup as Setup,
  type Ask,
  type SetupHost,
} from '@/lib/appointments';

type Draft = HostInput & { id: string | null };

const blank = (): Draft => ({
  id: null,
  name: '',
  kind: 'desk',
  employeeId: null,
  location: '',
  openPublic: true,
  openParent: true,
  slotMinutes: 20,
  capacity: 1,
  sortOrder: 50,
  status: 'active',
  hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: '09:30', ends: '12:30' })),
});
const draftOf = (h: SetupHost): Draft => ({
  id: h.id,
  name: h.name,
  kind: h.kind,
  employeeId: h.employeeId,
  location: h.location ?? '',
  openPublic: h.openPublic,
  openParent: h.openParent,
  slotMinutes: h.slotMinutes,
  capacity: h.capacity,
  sortOrder: h.sortOrder,
  status: h.status === 'active' ? 'active' : 'inactive',
  hours: h.hours.map((x) => ({ ...x })),
});
const KIND = {
  desk: 'A desk or office',
  person: 'A named person',
  class_teacher: 'The child’s class teacher',
};
/** What a finished save says, shown right next to the button that was pressed. */
function Saved({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? (
    <span
      className={`ep-alert ${msg.ok ? 'ep-alert--success' : 'ep-alert--danger'}`}
      role={msg.ok ? 'status' : 'alert'}
    >
      {msg.text}
    </span>
  ) : null;
}

/** A short list the admin builds one entry at a time: type (or pick a date), Add, and remove with ×. */
function ListEditor({
  id,
  label,
  help,
  items,
  onChange,
  type = 'text',
  show = (v) => v,
}: {
  id: string;
  label: string;
  help?: string;
  items: string[];
  onChange: (next: string[]) => void;
  type?: 'text' | 'date';
  show?: (v: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const value = draft.trim();
  const add = () => {
    if (!value || items.includes(value)) return;
    onChange(type === 'date' ? [...items, value].sort() : [...items, value]);
    setDraft('');
  };
  return (
    <fieldset className="ep-slots">
      <legend className="ep-field__label">{label}</legend>
      {items.length ? (
        <ul className="ep-chips">
          {items.map((x) => (
            <li key={x}>
              {show(x)}
              <button
                type="button"
                className="ep-chips__x"
                aria-label={`Remove ${show(x)}`}
                onClick={() => onChange(items.filter((y) => y !== x))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ep-field__help" style={{ margin: 0 }}>
          None yet.
        </p>
      )}
      <div className="ep-chips__add">
        <input
          id={id}
          type={type}
          className="ep-input"
          maxLength={60}
          aria-label={`${label}: new entry`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={!value || items.includes(value)}
          onClick={add}
        >
          Add
        </button>
      </div>
      {help ? <span className="ep-field__help">{help}</span> : null}
    </fieldset>
  );
}
const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
const MESSAGE: Record<string, string> = {
  appointment_otp: 'One-time code',
  appointment_requested: 'Request received',
  appointment_approved: 'Confirmed (with the pass)',
  appointment_rejected: 'Declined',
  appointment_rescheduled: 'New time',
  appointment_cancelled: 'Cancelled',
  appointment_reminder: 'Reminder before the visit',
};

/**
 * Appointment set-up (admin): the booking QR, the rules (notice, how far ahead, what a visitor must give,
 * which messages go out), the people and desks that can be met with their visiting hours and slots, and
 * which message templates are ready.
 */
export function AppointmentSetup({ initial }: { initial: Setup }) {
  const [setup, setSetup] = useState(initial);
  const [s, setS] = useState<AppointmentSettings>(initial.settings);
  const [draft, setDraft] = useState<Draft | null>(null);
  // each save reports next to its own button (a message at the top of a long page is never seen)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hostMsg, setHostMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof AppointmentSettings>(k: K, v: AppointmentSettings[K]) =>
    setS({ ...s, [k]: v });

  const saveSettings = () =>
    start(async () => {
      if (!s.purposes.length || !s.idProofKinds.length)
        return setMsg({ ok: false, text: 'Keep at least one purpose and one ID proof.' });
      const r = await saveAppointmentSettings({
        ...s,
        instructions: s.instructions?.trim() || null,
      });
      if (r.ok) {
        setSetup(r.data);
        setS(r.data.settings);
        setMsg({ ok: true, text: 'Rules saved.' });
      } else setMsg({ ok: false, text: r.error });
    });

  const saveHost = () =>
    start(async () => {
      if (!draft) return;
      const { id, ...host } = draft;
      const r = await saveAppointmentHost(id, { ...host, location: host.location?.trim() || null });
      if (r.ok) {
        setSetup(r.data);
        setDraft(null);
        setHostMsg({ ok: true, text: `${host.name} saved.` });
      } else setHostMsg({ ok: false, text: r.error });
    });

  const num = (
    k: 'minNoticeHours' | 'maxDaysAhead' | 'maxParty' | 'reminderHours' | 'noShowMinutes',
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="ep-field" htmlFor={`as-${k}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`as-${k}`}
        type="number"
        className="ep-input"
        min={min}
        max={max}
        value={s[k]}
        onChange={(e) => set(k, Number(e.target.value))}
      />
    </label>
  );
  const ask = (k: 'askOrganisation' | 'askIdProof' | 'askPhoto', label: string) => (
    <label className="ep-field" htmlFor={`as-${k}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`as-${k}`}
        className="ep-select"
        value={s[k]}
        onChange={(e) => set(k, e.target.value as Ask)}
      >
        {(Object.keys(ASK_LABEL) as Ask[]).map((v) => (
          <option key={v} value={v}>
            {ASK_LABEL[v]}
          </option>
        ))}
      </select>
    </label>
  );
  const tick = (
    k: 'publicEnabled' | 'autoApprove' | 'notifySms' | 'notifyWhatsapp' | 'notifyEmail',
    label: string,
  ) => (
    <label className="ep-check" htmlFor={`as-${k}`}>
      <input
        id={`as-${k}`}
        type="checkbox"
        checked={s[k]}
        onChange={(e) => set(k, e.target.checked)}
      />{' '}
      {label}
    </label>
  );
  const codes = [...new Set(setup.templates.map((t) => t.code))];
  // without a ready SMS or WhatsApp template the one-time code cannot reach an outside visitor
  const otpReady = setup.templates.some((t) => t.code === 'appointment_otp' && t.ready);

  return (
    <div className="ep-hd__form">
      <section className="ep-card" aria-labelledby="as-qr">
        <h2 id="as-qr" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Booking QR code for outside visitors
        </h2>
        {s.publicEnabled && !otpReady ? (
          <p className="ep-alert ep-alert--warning" role="status">
            Outside visitors cannot receive the one-time code yet: add the DLT id to the SMS
            template or the approved name to the WhatsApp template “Appointment: one-time code” (see
            Message templates below).
          </p>
        ) : null}
        <div className="ep-appt__booking">
          <img
            className="ep-appt__qr"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.booking.qr)}`}
            alt="QR code of the booking page"
          />
          <div>
            <p style={{ marginTop: 0 }}>
              Put this code at the gate, the reception and on the website. A visitor scans it,
              confirms the mobile number with a one-time code and picks a free slot.
            </p>
            <p className="ep-field__help">{setup.booking.url}</p>
            <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href="/engagement/appointments/setup/poster"
                target="_blank"
                rel="noreferrer"
              >
                Poster to print
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={setup.booking.url}
                target="_blank"
                rel="noreferrer"
              >
                Open the booking page
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`${setup.booking.url}?kiosk=1`}
                target="_blank"
                rel="noreferrer"
              >
                Open on the school’s tablet (kiosk)
              </a>
            </p>
            <p className="ep-field__help">
              On a visitor’s own phone the page stays signed in for two hours and shows their
              appointments. On the school’s own tablet use the kiosk link: each visitor is signed
              out as soon as the request is sent.
            </p>
          </div>
        </div>
      </section>

      <section className="ep-card" aria-labelledby="as-rules">
        <h2 id="as-rules" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Rules
        </h2>
        <div className="ep-hd__row">
          {tick('publicEnabled', 'Outside visitors may book from the QR code')}
          {tick('autoApprove', 'Confirm a free slot at once (no front-desk decision)')}
        </div>
        <div className="ep-hd__row">
          {num('minNoticeHours', 'Book at least this many hours before', 0, 168)}
          {num('maxDaysAhead', 'Book up to this many days ahead', 1, 90)}
          {num('maxParty', 'Most people in one visit', 1, 20)}
          {num('reminderHours', 'Remind this many hours before (0 = no reminder)', 0, 72)}
          {num('noShowMinutes', 'Mark “did not come” after this many minutes', 10, 600)}
        </div>
        <h3 className="ep-cdash__h3">What an outside visitor gives</h3>
        <p className="ep-field__help">
          The name and the mobile (confirmed by a one-time code) are always taken. Only the kind of
          ID and its last 4 characters are kept, never the full number.
        </p>
        <div className="ep-hd__row">
          {ask('askOrganisation', 'Organisation / coming from')}
          {ask('askIdProof', 'ID proof')}
          {ask('askPhoto', 'Photo')}
        </div>
        <div className="ep-hd__row ep-hd__row--top">
          <ListEditor
            id="as-purposes"
            label="Purposes a visitor chooses from"
            items={s.purposes}
            onChange={(next) => set('purposes', next)}
          />
          <ListEditor
            id="as-idkinds"
            label="ID proofs accepted"
            items={s.idProofKinds}
            onChange={(next) => set('idProofKinds', next)}
          />
          <ListEditor
            id="as-closed"
            label="Days with no appointments"
            type="date"
            show={dateLabel}
            help="School holidays are closed already."
            items={s.closedDates}
            onChange={(next) => set('closedDates', next)}
          />
        </div>
        <label className="ep-field" htmlFor="as-instructions">
          <span className="ep-field__label">
            Instructions shown on the booking page and the pass
          </span>
          <textarea
            id="as-instructions"
            className="ep-input"
            rows={2}
            maxLength={1000}
            value={s.instructions ?? ''}
            onChange={(e) => set('instructions', e.target.value)}
          />
        </label>
        <h3 className="ep-cdash__h3">Messages to the visitor</h3>
        <div className="ep-hd__row">
          {tick('notifySms', 'SMS')}
          {tick('notifyWhatsapp', 'WhatsApp')}
          {tick('notifyEmail', 'Email')}
        </div>
        <div className="ep-save">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={saveSettings}
          >
            Save the rules
          </button>
          <Saved msg={msg} />
        </div>
      </section>

      <section className="ep-card" aria-labelledby="as-hosts">
        <h2 id="as-hosts" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Who can be met, visiting hours and slots
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="People and desks">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">People and desks that take appointments</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Open to</th>
                <th scope="col">Visiting hours</th>
                <th scope="col">Slot</th>
                <th scope="col">Booked</th>
                <th scope="col">
                  <span className="ep-sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {setup.hosts.map((h) => (
                <tr key={h.id}>
                  <td>
                    {h.name}{' '}
                    {h.status === 'active' ? null : (
                      <span className="ep-field__help">(closed)</span>
                    )}
                    <div className="ep-field__help">
                      {h.kind === 'person' ? (h.employeeName ?? 'person') : KIND[h.kind]}
                      {h.location ? ` · ${h.location}` : ''}
                    </div>
                  </td>
                  <td>
                    {[h.openParent ? 'Parents' : null, h.openPublic ? 'Outside visitors' : null]
                      .filter(Boolean)
                      .join(', ') || 'Front desk only'}
                  </td>
                  <td>{hoursLine(h.hours)}</td>
                  <td>
                    {h.slotMinutes} min · {h.capacity} at a time
                  </td>
                  <td>{h.used}</td>
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Edit ${h.name}`}
                      onClick={() => setDraft(draftOf(h))}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft ? null : (
          <div className="ep-save" style={{ marginTop: 'var(--sp-3)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              onClick={() => setDraft(blank())}
            >
              Add a person or desk
            </button>
            <Saved msg={hostMsg} />
          </div>
        )}
        {draft ? (
          <div className="ep-hd__form" style={{ marginTop: 'var(--sp-4)' }}>
            <h3 className="ep-cdash__h3">
              {draft.id ? `Edit ${draft.name}` : 'New person or desk'}
            </h3>
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="ah-name">
                <span className="ep-field__label">Name shown to visitors</span>
                <input
                  id="ah-name"
                  className="ep-input"
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor="ah-kind">
                <span className="ep-field__label">This is</span>
                <select
                  id="ah-kind"
                  className="ep-select"
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      kind: e.target.value as Draft['kind'],
                      openPublic: e.target.value === 'class_teacher' ? false : draft.openPublic,
                    })
                  }
                >
                  {(Object.keys(KIND) as Array<keyof typeof KIND>).map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.kind === 'person' ? (
                <label className="ep-field" htmlFor="ah-emp">
                  <span className="ep-field__label">Employee</span>
                  <select
                    id="ah-emp"
                    className="ep-select"
                    value={draft.employeeId ?? ''}
                    onChange={(e) => setDraft({ ...draft, employeeId: e.target.value || null })}
                  >
                    <option value="">Choose</option>
                    {setup.staff.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="ep-field" htmlFor="ah-loc">
                <span className="ep-field__label">Where (room, office)</span>
                <input
                  id="ah-loc"
                  className="ep-input"
                  maxLength={120}
                  value={draft.location ?? ''}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
              </label>
            </div>
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="ah-slot">
                <span className="ep-field__label">Slot length (minutes)</span>
                <input
                  id="ah-slot"
                  type="number"
                  className="ep-input"
                  min={5}
                  max={240}
                  step={5}
                  value={draft.slotMinutes}
                  onChange={(e) => setDraft({ ...draft, slotMinutes: Number(e.target.value) })}
                />
              </label>
              <label className="ep-field" htmlFor="ah-cap">
                <span className="ep-field__label">Appointments one slot takes</span>
                <input
                  id="ah-cap"
                  type="number"
                  className="ep-input"
                  min={1}
                  max={50}
                  value={draft.capacity}
                  onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
                />
              </label>
              <label className="ep-field" htmlFor="ah-order">
                <span className="ep-field__label">Order in the list</span>
                <input
                  id="ah-order"
                  type="number"
                  className="ep-input"
                  min={0}
                  max={999}
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="ep-hd__row">
              <label className="ep-check" htmlFor="ah-parent">
                <input
                  id="ah-parent"
                  type="checkbox"
                  checked={draft.openParent}
                  onChange={(e) => setDraft({ ...draft, openParent: e.target.checked })}
                />{' '}
                Parents may book in the app
              </label>
              <label className="ep-check" htmlFor="ah-public">
                <input
                  id="ah-public"
                  type="checkbox"
                  checked={draft.openPublic}
                  disabled={draft.kind === 'class_teacher'}
                  onChange={(e) => setDraft({ ...draft, openPublic: e.target.checked })}
                />{' '}
                Outside visitors may book from the QR code
              </label>
              <label className="ep-check" htmlFor="ah-active">
                <input
                  id="ah-active"
                  type="checkbox"
                  checked={draft.status === 'active'}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.checked ? 'active' : 'inactive' })
                  }
                />{' '}
                Taking appointments
              </label>
            </div>
            <fieldset className="ep-slots">
              <legend className="ep-field__label">Visiting hours</legend>
              {draft.hours.map((h, i) => (
                <div key={i} className="ep-appt__hours">
                  <select
                    className="ep-select"
                    aria-label={`Day of visiting time ${String(i + 1)}`}
                    value={h.weekday}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        hours: draft.hours.map((x, j) =>
                          j === i ? { ...x, weekday: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  >
                    {WEEKDAYS.map((d, n) => (
                      <option key={d} value={n + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    className="ep-input"
                    aria-label={`From, visiting time ${String(i + 1)}`}
                    value={h.starts}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        hours: draft.hours.map((x, j) =>
                          j === i ? { ...x, starts: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    type="time"
                    className="ep-input"
                    aria-label={`To, visiting time ${String(i + 1)}`}
                    value={h.ends}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        hours: draft.hours.map((x, j) =>
                          j === i ? { ...x, ends: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove visiting time ${String(i + 1)}`}
                    onClick={() =>
                      setDraft({ ...draft, hours: draft.hours.filter((_, j) => j !== i) })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => {
                    const last = draft.hours[draft.hours.length - 1];
                    setDraft({
                      ...draft,
                      hours: [
                        ...draft.hours,
                        {
                          weekday: last ? (last.weekday % 7) + 1 : 1,
                          starts: last?.starts ?? '09:30',
                          ends: last?.ends ?? '12:30',
                        },
                      ],
                    });
                  }}
                >
                  Add a visiting time
                </button>
                {draft.hours[0] ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({
                          weekday,
                          starts: draft.hours[0]!.starts,
                          ends: draft.hours[0]!.ends,
                        })),
                      })
                    }
                  >
                    Same hours Monday to Saturday
                  </button>
                ) : null}
              </div>
            </fieldset>
            <div className="ep-save">
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending || draft.name.trim().length < 2}
                onClick={saveHost}
              >
                Save
              </button>
              <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setDraft(null)}>
                Close without saving
              </button>
              <Saved msg={hostMsg} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="ep-card" aria-labelledby="as-templates">
        <h2 id="as-templates" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Message templates
        </h2>
        <p className="ep-field__help">
          A message goes out on a channel only when its template is ready: SMS needs the DLT
          template id, WhatsApp the approved template name. Edit the wording and add these under
          Communication → Templates (search “appointment”).
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Message templates">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">
              Which appointment messages are ready per channel
            </caption>
            <thead>
              <tr>
                <th scope="col">Message</th>
                {['sms', 'whatsapp', 'email'].map((ch) => (
                  <th key={ch} scope="col">
                    {CHANNEL_LABEL[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code}>
                  <th scope="row">{MESSAGE[code] ?? code}</th>
                  {['sms', 'whatsapp', 'email'].map((ch) => {
                    const t = setup.templates.find((x) => x.code === code && x.channel === ch);
                    return (
                      <td key={ch}>
                        {!t
                          ? '—'
                          : t.ready
                            ? 'Ready'
                            : t.active
                              ? ch === 'sms'
                                ? 'Needs the DLT id'
                                : 'Needs the approved name'
                              : 'Switched off'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/comms/templates?q=appointment">
            Open the templates
          </a>
        </p>
      </section>
    </div>
  );
}
