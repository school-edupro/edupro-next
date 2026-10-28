'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  SLIP_FIELDS,
  type DrawSettings,
  type DrawSettingsView,
  type SlipField,
} from '@/lib/admission-draw';
import { clearDrawSettings, saveDrawSettings } from '@/lib/admission-draw-actions';

/** An ISO time as a datetime-local value in India time, and back. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

/**
 * The draw slip's settings (docs/design/60, 62): the heading (with {merit}, {class}, {category},
 * {session}), the details shown, the draw's date and venue, the footer note, slips per A4 page and the
 * logo; saved for the whole session, or as the class's own.
 */
export function DrawSettingsForm({
  cycleId,
  classId,
  className,
  view,
  canEdit,
}: {
  cycleId: string;
  classId: string;
  className: string;
  view: DrawSettingsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState<DrawSettings>(view.settings);
  const [at, setAt] = useState(toLocal(view.settings.drawAt));
  const [scope, setScope] = useState<'session' | 'class'>(
    view.from === 'class' ? 'class' : 'session',
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const tick = (f: SlipField, on: boolean) =>
    setS((cur) => ({
      ...cur,
      fields: SLIP_FIELDS.map(([k]) => k).filter((k) => (k === f ? on : cur.fields.includes(k))),
    }));
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveDrawSettings(
        { cycleId, ...(scope === 'class' ? { classId } : {}) },
        {
          ...s,
          drawAt: at ? `${at}:00+05:30` : null,
          venue: s.venue || null,
          footer: s.footer || null,
        },
      );
      setMsg(
        r.ok
          ? {
              tone: 'success',
              text:
                scope === 'class'
                  ? `Saved as ${className}'s own.`
                  : 'Saved for every class of the session.',
            }
          : { tone: 'danger', text: r.error },
      );
      if (r.ok) router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <p className="ep-field__help" style={{ margin: 0 }}>
        {view.from === 'class'
          ? `${className} has its own settings.`
          : view.from === 'session'
            ? `${className} uses the session's settings.`
            : 'No settings saved yet: the slips use the usual ones below.'}
      </p>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Save for</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <label className="ep-check">
            <input
              type="radio"
              className="ep-check__input"
              name="draw-scope"
              checked={scope === 'session'}
              disabled={!canEdit}
              onChange={() => setScope('session')}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">Every class of the session</span>
          </label>
          <label className="ep-check">
            <input
              type="radio"
              className="ep-check__input"
              name="draw-scope"
              checked={scope === 'class'}
              disabled={!canEdit}
              onChange={() => setScope('class')}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{className} only</span>
          </label>
        </div>
      </fieldset>
      <label className="ep-field">
        <span className="ep-field__label">Heading</span>
        <input
          className="ep-input"
          maxLength={160}
          value={s.heading}
          disabled={!canEdit}
          onChange={(e) => setS({ ...s, heading: e.target.value })}
        />
        <span className="ep-field__help">
          {'{merit}'} (the merit total), {'{class}'}, {'{category}'} and {'{session}'} are filled in
          on each slip.
        </span>
      </label>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Details on the slip</legend>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))',
            gap: 'var(--sp-2)',
          }}
        >
          {SLIP_FIELDS.map(([k, label]) => (
            <label key={k} className="ep-check">
              <input
                type="checkbox"
                className="ep-check__input"
                checked={s.fields.includes(k)}
                disabled={!canEdit}
                onChange={(e) => tick(k, e.target.checked)}
              />
              <span className="ep-check__box" aria-hidden="true" />
              <span className="ep-check__text">{label}</span>
            </label>
          ))}
        </div>
        <span className="ep-field__help">
          Every slip also carries the registration no. as a barcode, to scan the drawn slips.
        </span>
      </fieldset>
      <div className="ep-lead-filter" style={{ margin: 0 }}>
        <label className="ep-field">
          <span className="ep-field__label">Draw on (India time)</span>
          <input
            className="ep-input"
            type="datetime-local"
            value={at}
            disabled={!canEdit}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <label className="ep-field" style={{ minWidth: '16rem' }}>
          <span className="ep-field__label">Venue</span>
          <input
            className="ep-input"
            maxLength={160}
            value={s.venue ?? ''}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, venue: e.target.value })}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Slips per A4 page</span>
          <select
            className="ep-select"
            value={s.perPage}
            disabled={!canEdit}
            onChange={(e) =>
              setS({ ...s, perPage: Number(e.target.value) as DrawSettings['perPage'] })
            }
          >
            {[2, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Footer note</span>
        <textarea
          className="ep-input"
          rows={2}
          maxLength={300}
          value={s.footer ?? ''}
          disabled={!canEdit}
          onChange={(e) => setS({ ...s, footer: e.target.value })}
        />
      </label>
      <label className="ep-check">
        <input
          type="checkbox"
          className="ep-check__input"
          checked={s.showLogo}
          disabled={!canEdit}
          onChange={(e) => setS({ ...s, showLogo: e.target.checked })}
        />
        <span className="ep-check__box" aria-hidden="true" />
        <span className="ep-check__text">The school&apos;s logo on each slip</span>
      </label>
      {canEdit ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !s.heading.trim()}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save the settings'}
          </button>
          {view.from === 'class' ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await clearDrawSettings({ cycleId, classId });
                  if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
                  setS(r.data.settings);
                  setAt(toLocal(r.data.settings.drawAt));
                  setScope('session');
                  setMsg({
                    tone: 'success',
                    text: `${className} now uses the session's settings.`,
                  });
                  router.refresh();
                })
              }
            >
              Use the session&apos;s settings for {className}
            </button>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ margin: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
