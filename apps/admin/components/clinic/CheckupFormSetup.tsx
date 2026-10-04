'use client';
import { useState, useTransition } from 'react';
import { saveCheckupField, saveClinicSettings } from '@/lib/clinic-actions';
import type { CheckupField, ClinicSetup } from '@/lib/clinic';

const blank = (section = '') => ({
  id: null as string | null,
  label: '',
  section,
  newSection: '',
  kind: 'text' as CheckupField['kind'],
  unit: '',
  options: '',
  sortOrder: 0,
  active: true,
});
const KIND: Record<CheckupField['kind'], string> = {
  text: 'Short text',
  number: 'Number',
  choice: 'Choice list',
};

/**
 * The health check-up form: which built-in fields the school uses, and the school's own sections and
 * fields (short text, a number with a unit, or a choice list). A field shows on the form, the health card
 * (PDF and parent portal) and the Excel. Also the note at the foot of the card and the expiry warning.
 */
export function CheckupFormSetup({ initial }: { initial: ClinicSetup }) {
  const [setup, setSetup] = useState(initial);
  const [hidden, setHidden] = useState<string[]>(initial.settings.checkupHidden);
  const [days, setDays] = useState(initial.settings.expiryAlertDays);
  const [note, setNote] = useState(initial.settings.cardNote ?? '');
  const sections = [...new Set(setup.fields.map((f) => f.group))];
  const [f, setF] = useState(blank(sections[0] ?? 'General'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; where: 'form' | 'field' } | null>(
    null,
  );
  const [busy, start] = useTransition();

  const saveForm = () =>
    start(async () => {
      setMsg(null);
      const r = await saveClinicSettings({
        checkupHidden: hidden,
        expiryAlertDays: days,
        cardNote: note,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error, where: 'form' });
      setSetup(r.data);
      setMsg({ ok: true, text: 'Saved.', where: 'form' });
    });
  const saveField = () =>
    start(async () => {
      setMsg(null);
      const section = f.section === '__new' ? f.newSection.trim() : f.section;
      const options = f.options
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (f.label.trim().length < 2)
        return setMsg({ ok: false, text: 'Give the field a name.', where: 'field' });
      if (section.length < 2)
        return setMsg({ ok: false, text: 'Give the new section a name.', where: 'field' });
      if (f.kind === 'choice' && options.length < 2)
        return setMsg({
          ok: false,
          text: 'Give at least two choices, separated by commas.',
          where: 'field',
        });
      const r = await saveCheckupField(f.id, {
        label: f.label,
        section,
        kind: f.kind,
        unit: f.unit,
        options,
        sortOrder: f.sortOrder,
        active: f.active,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error, where: 'field' });
      setSetup(r.data);
      setF(blank(section));
      setMsg({ ok: true, text: 'Saved. The field is on the check-up form now.', where: 'field' });
    });
  const status = (where: 'form' | 'field') =>
    msg && msg.where === where ? (
      <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
        {msg.text}
      </span>
    ) : null;
  const custom = setup.fields.filter((x) => x.custom);

  return (
    <div className="ep-hd__form">
      <section className="ep-card" aria-labelledby="cf-own">
        <h2 id="cf-own" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Your own sections and fields
        </h2>
        <p className="ep-field__help">
          Add a field to an existing section, or start a new section (for example “Orthopaedic”). It
          then shows on the check-up form, the health card and the Excel.
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Added fields">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Fields the school added to the check-up form</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Field</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {custom.length === 0 ? (
                <tr>
                  <td colSpan={5}>No added fields yet.</td>
                </tr>
              ) : null}
              {custom.map((x) => (
                <tr key={x.key}>
                  <td>{x.group}</td>
                  <th scope="row">{x.label}</th>
                  <td>
                    {KIND[x.kind]}
                    {x.unit ? ` (${x.unit})` : ''}
                    {x.options.length ? (
                      <div className="ep-field__help">{x.options.join(', ')}</div>
                    ) : null}
                  </td>
                  <td>{x.active ? 'In use' : 'Not in use'}</td>
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      aria-label={`Edit ${x.label}`}
                      onClick={() =>
                        setF({
                          id: x.id,
                          label: x.label,
                          section: x.group,
                          newSection: '',
                          kind: x.kind,
                          unit: x.unit ?? '',
                          options: x.options.join(', '),
                          sortOrder: x.sortOrder,
                          active: x.active,
                        })
                      }
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="ep-cdash__h3">{f.id ? `Edit ${f.label}` : 'Add a field'}</h3>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="nf-section">
            <span className="ep-field__label">Section</span>
            <select
              id="nf-section"
              className="ep-select"
              value={sections.includes(f.section) ? f.section : '__new'}
              onChange={(e) => setF({ ...f, section: e.target.value })}
            >
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__new">A new section…</option>
            </select>
          </label>
          {f.section === '__new' || !sections.includes(f.section) ? (
            <label className="ep-field" htmlFor="nf-new">
              <span className="ep-field__label">Name of the new section</span>
              <input
                id="nf-new"
                className="ep-input"
                maxLength={40}
                value={f.section === '__new' ? f.newSection : f.section}
                onChange={(e) => setF({ ...f, section: '__new', newSection: e.target.value })}
              />
            </label>
          ) : null}
          <label className="ep-field" htmlFor="nf-label">
            <span className="ep-field__label">Field name</span>
            <input
              id="nf-label"
              className="ep-input"
              maxLength={60}
              value={f.label}
              onChange={(e) => setF({ ...f, label: e.target.value })}
            />
          </label>
          <label className="ep-field" htmlFor="nf-kind">
            <span className="ep-field__label">Kind of answer</span>
            <select
              id="nf-kind"
              className="ep-select"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as CheckupField['kind'] })}
            >
              <option value="text">Short text (Normal, 6/6…)</option>
              <option value="number">Number with a unit</option>
              <option value="choice">Choice list</option>
            </select>
          </label>
          {f.kind === 'number' ? (
            <label className="ep-field" htmlFor="nf-unit">
              <span className="ep-field__label">Unit (cm, kg, per minute)</span>
              <input
                id="nf-unit"
                className="ep-input"
                maxLength={20}
                value={f.unit}
                onChange={(e) => setF({ ...f, unit: e.target.value })}
              />
            </label>
          ) : null}
          {f.kind === 'choice' ? (
            <label className="ep-field" htmlFor="nf-options">
              <span className="ep-field__label">Choices, separated by commas</span>
              <input
                id="nf-options"
                className="ep-input"
                maxLength={400}
                placeholder="Normal, Needs attention"
                value={f.options}
                onChange={(e) => setF({ ...f, options: e.target.value })}
              />
            </label>
          ) : null}
          <label className="ep-check" htmlFor="nf-active">
            <input
              id="nf-active"
              type="checkbox"
              checked={f.active}
              onChange={(e) => setF({ ...f, active: e.target.checked })}
            />{' '}
            In use
          </label>
        </div>
        <div
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={saveField}
            disabled={busy}
          >
            {f.id ? 'Save the field' : 'Add the field'}
          </button>
          {f.id ? (
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              onClick={() => setF(blank(sections[0]))}
            >
              Cancel
            </button>
          ) : null}
          {status('field')}
        </div>
      </section>

      <section className="ep-card" aria-labelledby="cf-built">
        <h2 id="cf-built" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Built-in fields
        </h2>
        <p className="ep-field__help">
          Untick what the school does not examine: it leaves the form, the health card and the
          Excel. BMI is worked out from height and weight.
        </p>
        {[...new Set(setup.fields.filter((x) => !x.custom).map((x) => x.group))].map((g) => (
          <fieldset key={g} className="ep-slots">
            <legend className="ep-field__label">{g}</legend>
            <div className="ep-slots__grid">
              {setup.fields
                .filter((x) => x.group === g && !x.custom)
                .map((x) => (
                  <label key={x.key} className="ep-slots__slot">
                    <input
                      type="checkbox"
                      checked={!hidden.includes(x.key)}
                      onChange={(e) =>
                        setHidden(
                          e.target.checked ? hidden.filter((k) => k !== x.key) : [...hidden, x.key],
                        )
                      }
                    />
                    <span>{x.label}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
        <label className="ep-field" htmlFor="cf-note">
          <span className="ep-field__label">Note printed at the foot of the health card</span>
          <textarea
            id="cf-note"
            className="ep-input"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="cf-days">
          <span className="ep-field__label">
            Warn this many days before a medicine batch expires
          </span>
          <input
            id="cf-days"
            type="number"
            className="ep-input"
            min={7}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.min(365, Math.max(7, Number(e.target.value) || 60)))}
          />
        </label>
        <div
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={saveForm}
            disabled={busy}
          >
            Save
          </button>
          {status('form')}
        </div>
      </section>
    </div>
  );
}
