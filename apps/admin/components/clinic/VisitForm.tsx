'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createClinicVisit, findClinicPeople } from '@/lib/clinic-actions';
import { OUTCOMES, medName, type ClinicOptions, type Outcome } from '@/lib/clinic';

interface Person {
  id: string;
  name: string;
  code: string | null;
  detail: string | null;
  bloodGroup: string | null;
  visits90: number;
}
interface Given {
  medicineId: string;
  qty: number;
  dosage: string;
}

/**
 * A clinic visit: find the pupil (admission number or name) or the member of staff, note the complaint
 * and the vitals, what the doctor found and did, the medicines given (they come out of stock) and how the
 * visit ends. Parents are told when a medicine is given, the child is sent home or referred.
 */
export function VisitForm({ options, today }: { options: ClinicOptions; today: string }) {
  const router = useRouter();
  const [audience, setAudience] = useState<'student' | 'staff'>('student');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Person[] | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [f, setF] = useState({
    onDate: today,
    timeIn: '',
    timeOut: '',
    clinicId: '',
    doctorId: '',
    nurseId: '',
    complaint: '',
    temperatureC: '',
    pulse: '',
    bp: '',
    spo2: '',
    weightKg: '',
    diagnosis: '',
    treatment: '',
    prescription: '',
    remark: '',
    outcome: 'back_to_class' as Outcome,
    referredTo: '',
  });
  const [diseases, setDiseases] = useState<string[]>([]);
  const [given, setGiven] = useState<Given[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const of = (kind: string) => options.masters.filter((m) => m.kind === kind);

  const find = () =>
    start(async () => {
      setMsg(null);
      if (search.trim().length < 2) return setMsg('Type at least two letters or the number.');
      const r = await findClinicPeople(audience, search.trim());
      if (!r.ok) return setMsg(r.error);
      setHits(r.data.data);
    });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!person) return setMsg('Find and select the pupil or the member of staff first.');
    if (f.outcome === 'referred' && !f.referredTo.trim())
      return setMsg('Say where the person is referred to.');
    if (given.some((g) => !g.medicineId))
      return setMsg('Choose the medicine on each row, or remove it.');
    start(async () => {
      const r = await createClinicVisit({
        audience,
        ...(audience === 'student' ? { studentId: person.id } : { employeeId: person.id }),
        ...f,
        diseaseIds: diseases,
        medicines: given.map((g) => ({ medicineId: g.medicineId, qty: g.qty, dosage: g.dosage })),
      });
      if (!r.ok) return setMsg(r.error);
      router.push(`/engagement/clinic/visits/${r.data.id}?ok=visit`);
      router.refresh();
    });
  };
  const input = (
    key: keyof typeof f,
    label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="ep-field" htmlFor={`vf-${key}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`vf-${key}`}
        className="ep-input"
        value={f[key]}
        onChange={(e) => set(key, e.target.value as never)}
        {...extra}
      />
    </label>
  );
  const select = (key: 'clinicId' | 'doctorId' | 'nurseId', label: string, kind: string) => (
    <label className="ep-field" htmlFor={`vf-${key}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`vf-${key}`}
        className="ep-select"
        value={f[key]}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">Choose</option>
        {of(kind).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={submit} className="ep-hd__form">
      <section className="ep-card" aria-labelledby="vf-who">
        <h2 id="vf-who" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          1. Who came
        </h2>
        {person ? (
          <p className="ep-alert ep-alert--success" role="status">
            <strong>{person.name}</strong>
            {person.code ? ` · ${audience === 'student' ? 'Adm. no.' : 'Code'} ${person.code}` : ''}
            {person.detail ? ` · ${person.detail}` : ''}
            {person.bloodGroup ? ` · blood group ${person.bloodGroup}` : ''}
            {person.visits90
              ? ` · ${String(person.visits90)} visit(s) in the last 90 days`
              : ''}.{' '}
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                setPerson(null);
                setHits(null);
              }}
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <div className="ep-hd__row">
              <label className="ep-field" htmlFor="vf-aud">
                <span className="ep-field__label">Pupil or staff</span>
                <select
                  id="vf-aud"
                  className="ep-select"
                  value={audience}
                  onChange={(e) => {
                    setAudience(e.target.value as 'student' | 'staff');
                    setHits(null);
                  }}
                >
                  <option value="student">Pupil</option>
                  <option value="staff">Member of staff</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="vf-search">
                <span className="ep-field__label">
                  {audience === 'student' ? 'Admission no. or name' : 'Employee code or name'}
                </span>
                <input
                  id="vf-search"
                  type="search"
                  className="ep-input"
                  value={search}
                  maxLength={80}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      find();
                    }
                  }}
                />
              </label>
              <div>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  onClick={find}
                  disabled={busy}
                >
                  Find
                </button>
              </div>
            </div>
            {hits ? (
              hits.length ? (
                <ul className="ep-cdash__list" aria-label="People found">
                  {hits.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        onClick={() => setPerson(p)}
                      >
                        Select
                      </button>{' '}
                      {p.name}
                      <span className="ep-field__help">
                        {' '}
                        · {[p.code, p.detail].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">Nobody matches “{search}”.</p>
              )
            ) : null}
          </>
        )}
      </section>

      <section className="ep-card" aria-labelledby="vf-visit">
        <h2 id="vf-visit" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          2. The visit
        </h2>
        <div className="ep-hd__row">
          {of('clinic').length ? select('clinicId', 'Clinic', 'clinic') : null}
          {select('doctorId', 'Doctor', 'doctor')}
          {select('nurseId', 'Nurse', 'nurse')}
          {input('onDate', 'Date', { type: 'date', max: today, required: true })}
          {input('timeIn', 'Time in (blank = now)', { type: 'time' })}
          {input('timeOut', 'Time out (if already left)', { type: 'time' })}
        </div>
        {input('complaint', 'Complaint (what the person says is wrong) *', {
          required: true,
          minLength: 2,
          maxLength: 300,
        })}
        <fieldset className="ep-slots">
          <legend className="ep-field__label">Disease or complaint type (tick what applies)</legend>
          {of('disease').length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No diseases are set up yet (Clinic → Set-up).
            </p>
          ) : (
            <div className="ep-slots__grid">
              {of('disease').map((d) => (
                <label key={d.id} className="ep-slots__slot">
                  <input
                    type="checkbox"
                    checked={diseases.includes(d.id)}
                    onChange={(e) =>
                      setDiseases(
                        e.target.checked ? [...diseases, d.id] : diseases.filter((x) => x !== d.id),
                      )
                    }
                  />
                  <span>{d.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="ep-hd__row">
          {input('temperatureC', 'Temperature (°C)', {
            type: 'number',
            step: '0.1',
            min: 30,
            max: 45,
          })}
          {input('pulse', 'Pulse (per minute)', { type: 'number', min: 20, max: 250 })}
          {input('bp', 'Blood pressure (110/70)', { pattern: '\\d{2,3}/\\d{2,3}', maxLength: 7 })}
          {input('spo2', 'SpO2 (%)', { type: 'number', min: 50, max: 100 })}
          {input('weightKg', 'Weight (kg)', { type: 'number', step: '0.1', min: 5, max: 250 })}
        </div>
      </section>

      <section className="ep-card" aria-labelledby="vf-treat">
        <h2 id="vf-treat" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          3. Examination and treatment
        </h2>
        {input('diagnosis', 'What the doctor found', { maxLength: 500 })}
        {input('treatment', 'Treatment given', { maxLength: 500 })}
        <fieldset className="ep-slots">
          <legend className="ep-field__label">Medicines given now (taken from the stock)</legend>
          {given.map((g, i) => {
            const m = options.medicines.find((x) => x.id === g.medicineId);
            return (
              <div key={i} className="ep-hd__row">
                <label className="ep-field" htmlFor={`vm-${String(i)}`}>
                  <span className="ep-field__label">Medicine {i + 1}</span>
                  <select
                    id={`vm-${String(i)}`}
                    className="ep-select"
                    value={g.medicineId}
                    onChange={(e) =>
                      setGiven(
                        given.map((x, k) => (k === i ? { ...x, medicineId: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">Choose</option>
                    {options.medicines.map((x) => (
                      <option key={x.id} value={x.id} disabled={x.stock <= 0}>
                        {medName(x)} · {x.form} · {x.stock} {x.unit} in stock
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor={`vq-${String(i)}`}>
                  <span className="ep-field__label">Quantity{m ? ` (${m.unit})` : ''}</span>
                  <input
                    id={`vq-${String(i)}`}
                    type="number"
                    className="ep-input"
                    min={1}
                    max={m ? Math.max(1, m.stock) : 1000}
                    value={g.qty}
                    onChange={(e) =>
                      setGiven(
                        given.map((x, k) =>
                          k === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="ep-field" htmlFor={`vd-${String(i)}`}>
                  <span className="ep-field__label">Dosage</span>
                  <input
                    id={`vd-${String(i)}`}
                    className="ep-input"
                    maxLength={120}
                    placeholder="1 tablet after food"
                    value={g.dosage}
                    onChange={(e) =>
                      setGiven(
                        given.map((x, k) => (k === i ? { ...x, dosage: e.target.value } : x)),
                      )
                    }
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => setGiven(given.filter((_, k) => k !== i))}
                    aria-label={`Remove medicine ${String(i + 1)}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={given.length >= 15}
              onClick={() => setGiven([...given, { medicineId: '', qty: 1, dosage: '' }])}
            >
              Add a medicine
            </button>
          </div>
        </fieldset>
        <label className="ep-field" htmlFor="vf-prescription">
          <span className="ep-field__label">Prescription (to take at home)</span>
          <textarea
            id="vf-prescription"
            className="ep-input"
            rows={3}
            maxLength={1000}
            value={f.prescription}
            onChange={(e) => set('prescription', e.target.value)}
          />
        </label>
        {input('remark', 'Remark or advice', { maxLength: 500 })}
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="vf-outcome">
            <span className="ep-field__label">How the visit ends</span>
            <select
              id="vf-outcome"
              className="ep-select"
              value={f.outcome}
              onChange={(e) => set('outcome', e.target.value as Outcome)}
            >
              {OUTCOMES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {f.outcome === 'referred'
            ? input('referredTo', 'Referred to (doctor or hospital) *', { maxLength: 160 })
            : null}
        </div>
        {audience === 'student' ? (
          <p className="ep-field__help">
            The parents are told (SMS / WhatsApp when the template is ready, and email) when a
            medicine is given, the child is sent home or referred.
          </p>
        ) : null}
      </section>
      {msg ? (
        <p className="ep-field__error" role="alert">
          {msg}
        </p>
      ) : null}
      <div>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={busy}>
          Save the visit
        </button>
      </div>
    </form>
  );
}
