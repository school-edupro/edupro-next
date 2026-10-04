'use client';
import { useState, useTransition } from 'react';
import { saveClinicMaster, saveClinicMedicine, saveClinicSettings } from '@/lib/clinic-actions';
import {
  MASTER_LABEL,
  medName,
  type ClinicMaster,
  type ClinicSetup,
  type Medicine,
} from '@/lib/clinic';

type Kind = ClinicMaster['kind'];
const KINDS: Kind[] = ['clinic', 'doctor', 'nurse', 'disease'];
const blankMaster = (kind: Kind) => ({
  id: null as string | null,
  kind,
  name: '',
  qualification: '',
  regNo: '',
  mobile: '',
  employeeId: '',
  note: '',
  active: true,
  sortOrder: 0,
});
const blankMed = () => ({
  id: null as string | null,
  name: '',
  form: 'Tablet',
  strength: '',
  unit: 'tablet',
  lowStockAt: 10,
  active: true,
});
const FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Ointment',
  'Drops',
  'Spray',
  'Injection',
  'Dressing',
  'Other',
];

/**
 * Clinic set-up: the clinics, doctors, nurses and diseases the visit form picks from, the medicines (with
 * the low-stock mark), which fields the health check-up form shows, and the note printed on the card.
 */
export function ClinicSetupForm({ initial }: { initial: ClinicSetup }) {
  const [setup, setSetup] = useState(initial);
  const [tab, setTab] = useState<Kind | 'medicine' | 'form'>('doctor');
  const [m, setM] = useState(blankMaster('doctor'));
  const [med, setMed] = useState(blankMed());
  const [hidden, setHidden] = useState<string[]>(initial.settings.checkupHidden);
  const [days, setDays] = useState(initial.settings.expiryAlertDays);
  const [note, setNote] = useState(initial.settings.cardNote ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const open = (t: typeof tab) => {
    setTab(t);
    setMsg(null);
    if (KINDS.includes(t as Kind)) setM(blankMaster(t as Kind));
  };
  const saveMaster = () =>
    start(async () => {
      setMsg(null);
      if (m.name.trim().length < 2) return setMsg({ ok: false, text: 'Give the name.' });
      const r = await saveClinicMaster(m.id, {
        kind: m.kind,
        name: m.name,
        qualification: m.qualification,
        regNo: m.regNo,
        mobile: m.mobile,
        employeeId: m.employeeId,
        note: m.note,
        active: m.active,
        sortOrder: m.sortOrder,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setSetup(r.data);
      setM(blankMaster(m.kind));
      setMsg({ ok: true, text: 'Saved.' });
    });
  const saveMed = () =>
    start(async () => {
      setMsg(null);
      if (med.name.trim().length < 2) return setMsg({ ok: false, text: 'Give the medicine name.' });
      const r = await saveClinicMedicine(med.id, {
        name: med.name,
        form: med.form,
        strength: med.strength,
        unit: med.unit,
        lowStockAt: med.lowStockAt,
        active: med.active,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setSetup(r.data);
      setMed(blankMed());
      setMsg({ ok: true, text: 'Saved.' });
    });
  const saveForm = () =>
    start(async () => {
      setMsg(null);
      const r = await saveClinicSettings({
        checkupHidden: hidden,
        expiryAlertDays: days,
        cardNote: note,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setSetup(r.data);
      setMsg({ ok: true, text: 'Saved.' });
    });
  const status = msg ? (
    <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
      {msg.text}
    </span>
  ) : null;
  const person = tab === 'doctor' || tab === 'nurse';
  const rows = setup.masters.filter((x) => x.kind === tab);

  return (
    <div className="ep-hd__form">
      <nav className="ep-tabs-links" aria-label="Set-up sections">
        {(
          [
            ...KINDS.map((k) => [k, MASTER_LABEL[k][0]] as const),
            ['medicine', 'Medicines'] as const,
            ['form', 'Check-up form and card'] as const,
          ] as Array<readonly [Kind | 'medicine' | 'form', string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`ep-btn ep-btn--sm ${tab === k ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
            aria-pressed={tab === k}
            onClick={() => open(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      {KINDS.includes(tab as Kind) ? (
        <section className="ep-card" aria-label={MASTER_LABEL[tab as Kind][0]}>
          <h2 className="ep-cdash__h3" style={{ marginTop: 0 }}>
            {MASTER_LABEL[tab as Kind][0]}
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="List">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{MASTER_LABEL[tab as Kind][0]}</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  {person ? <th scope="col">Qualification · registration</th> : null}
                  {person ? <th scope="col">Mobile</th> : null}
                  <th scope="col">Used</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={person ? 6 : 4}>Nothing here yet. Add the first one below.</td>
                  </tr>
                ) : null}
                {rows.map((x) => (
                  <tr key={x.id}>
                    <th scope="row">
                      {x.name}
                      {x.employee ? <div className="ep-field__help">{x.employee}</div> : null}
                    </th>
                    {person ? (
                      <td>{[x.qualification, x.regNo].filter(Boolean).join(' · ') || '—'}</td>
                    ) : null}
                    {person ? <td>{x.mobile ?? '—'}</td> : null}
                    <td>{x.used}</td>
                    <td>{x.active ? 'In use' : 'Not in use'}</td>
                    <td>
                      <button
                        type="button"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        aria-label={`Edit ${x.name}`}
                        onClick={() =>
                          setM({
                            id: x.id,
                            kind: x.kind,
                            name: x.name,
                            qualification: x.qualification ?? '',
                            regNo: x.regNo ?? '',
                            mobile: x.mobile ?? '',
                            employeeId: x.employeeId ?? '',
                            note: x.note ?? '',
                            active: x.active,
                            sortOrder: x.sortOrder,
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
          <h3 className="ep-cdash__h3">
            {m.id ? `Edit ${m.name}` : `Add a ${MASTER_LABEL[tab as Kind][1].toLowerCase()}`}
          </h3>
          <div className="ep-hd__row">
            <label className="ep-field" htmlFor="cm-name">
              <span className="ep-field__label">Name</span>
              <input
                id="cm-name"
                className="ep-input"
                maxLength={120}
                value={m.name}
                onChange={(e) => setM({ ...m, name: e.target.value })}
              />
            </label>
            {person ? (
              <>
                <label className="ep-field" htmlFor="cm-qual">
                  <span className="ep-field__label">Qualification</span>
                  <input
                    id="cm-qual"
                    className="ep-input"
                    maxLength={120}
                    value={m.qualification}
                    onChange={(e) => setM({ ...m, qualification: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor="cm-reg">
                  <span className="ep-field__label">Registration no.</span>
                  <input
                    id="cm-reg"
                    className="ep-input"
                    maxLength={60}
                    value={m.regNo}
                    onChange={(e) => setM({ ...m, regNo: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor="cm-mob">
                  <span className="ep-field__label">Mobile</span>
                  <input
                    id="cm-mob"
                    className="ep-input"
                    inputMode="numeric"
                    maxLength={10}
                    value={m.mobile}
                    onChange={(e) => setM({ ...m, mobile: e.target.value.replace(/\D/g, '') })}
                  />
                </label>
                <label className="ep-field" htmlFor="cm-emp">
                  <span className="ep-field__label">Employee record (if on the staff)</span>
                  <select
                    id="cm-emp"
                    className="ep-select"
                    value={m.employeeId}
                    onChange={(e) => setM({ ...m, employeeId: e.target.value })}
                  >
                    <option value="">Not an employee / visiting</option>
                    {setup.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="ep-check" htmlFor="cm-active">
              <input
                id="cm-active"
                type="checkbox"
                checked={m.active}
                onChange={(e) => setM({ ...m, active: e.target.checked })}
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
              onClick={saveMaster}
              disabled={busy}
            >
              {m.id ? 'Save' : 'Add'}
            </button>
            {m.id ? (
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                onClick={() => setM(blankMaster(tab as Kind))}
              >
                Cancel
              </button>
            ) : null}
            {status}
          </div>
        </section>
      ) : null}

      {tab === 'medicine' ? (
        <section className="ep-card" aria-label="Medicines">
          <h2 className="ep-cdash__h3" style={{ marginTop: 0 }}>
            Medicines
          </h2>
          <p className="ep-field__help">
            Stock is received under Clinic → Medicine stock. A medicine at or under its low-stock
            mark shows on the dashboard.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Medicines">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Medicines</caption>
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Form</th>
                  <th scope="col">Counted in</th>
                  <th scope="col">In stock</th>
                  <th scope="col">Low-stock mark</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {setup.medicines.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No medicines yet. Add the first one below.</td>
                  </tr>
                ) : null}
                {setup.medicines.map((x: Medicine) => (
                  <tr key={x.id}>
                    <th scope="row">{medName(x)}</th>
                    <td>{x.form}</td>
                    <td>{x.unit}</td>
                    <td>{x.stock}</td>
                    <td>{x.lowStockAt}</td>
                    <td>{x.active ? 'In use' : 'Not in use'}</td>
                    <td>
                      <button
                        type="button"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        aria-label={`Edit ${medName(x)}`}
                        onClick={() =>
                          setMed({
                            id: x.id,
                            name: x.name,
                            form: x.form,
                            strength: x.strength ?? '',
                            unit: x.unit,
                            lowStockAt: x.lowStockAt,
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
          <h3 className="ep-cdash__h3">{med.id ? `Edit ${med.name}` : 'Add a medicine'}</h3>
          <div className="ep-hd__row">
            <label className="ep-field" htmlFor="md-name">
              <span className="ep-field__label">Name</span>
              <input
                id="md-name"
                className="ep-input"
                maxLength={120}
                value={med.name}
                onChange={(e) => setMed({ ...med, name: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor="md-form">
              <span className="ep-field__label">Form</span>
              <select
                id="md-form"
                className="ep-select"
                value={med.form}
                onChange={(e) => setMed({ ...med, form: e.target.value })}
              >
                {[...new Set([...FORMS, med.form])].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="md-strength">
              <span className="ep-field__label">Strength (500 mg, 5 ml)</span>
              <input
                id="md-strength"
                className="ep-input"
                maxLength={40}
                value={med.strength}
                onChange={(e) => setMed({ ...med, strength: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor="md-unit">
              <span className="ep-field__label">Counted in (tablet, ml, piece)</span>
              <input
                id="md-unit"
                className="ep-input"
                maxLength={20}
                value={med.unit}
                onChange={(e) => setMed({ ...med, unit: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor="md-low">
              <span className="ep-field__label">Low-stock mark</span>
              <input
                id="md-low"
                type="number"
                className="ep-input"
                min={0}
                max={100000}
                value={med.lowStockAt}
                onChange={(e) =>
                  setMed({ ...med, lowStockAt: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <label className="ep-check" htmlFor="md-active">
              <input
                id="md-active"
                type="checkbox"
                checked={med.active}
                onChange={(e) => setMed({ ...med, active: e.target.checked })}
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
              onClick={saveMed}
              disabled={busy}
            >
              {med.id ? 'Save' : 'Add'}
            </button>
            {med.id ? (
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                onClick={() => setMed(blankMed())}
              >
                Cancel
              </button>
            ) : null}
            {status}
          </div>
        </section>
      ) : null}

      {tab === 'form' ? (
        <section className="ep-card" aria-label="Check-up form and card">
          <h2 className="ep-cdash__h3" style={{ marginTop: 0 }}>
            Health check-up form
          </h2>
          <p className="ep-field__help">
            Untick what the school does not examine: it leaves the form, the health card and the
            Excel. BMI is worked out from height and weight.
          </p>
          {[...new Set(setup.fields.map((f) => f.group))].map((g) => (
            <fieldset key={g} className="ep-slots">
              <legend className="ep-field__label">{g}</legend>
              <div className="ep-slots__grid">
                {setup.fields
                  .filter((f) => f.group === g)
                  .map((f) => (
                    <label key={f.key} className="ep-slots__slot">
                      <input
                        type="checkbox"
                        checked={!hidden.includes(f.key)}
                        onChange={(e) =>
                          setHidden(
                            e.target.checked
                              ? hidden.filter((k) => k !== f.key)
                              : [...hidden, f.key],
                          )
                        }
                      />
                      <span>{f.label}</span>
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
            {status}
          </div>
        </section>
      ) : null}
    </div>
  );
}
