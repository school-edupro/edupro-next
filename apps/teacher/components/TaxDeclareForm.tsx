'use client';
import { useState } from 'react';

export interface TaxLabel {
  code: string;
  label: string;
  appliesTo: string;
  cap: string | null;
}

/**
 * A declaration (docs/design/86, phase D): a section and its amount, or — for HRA — the rent of each month of the
 * year, the city and the landlord (the landlord's PAN above ₹1 lakh a year); proofs as PDFs or photos.
 */
export function DeclareForm({
  fy,
  labels,
  action,
  idp,
  staff,
}: {
  fy: string;
  labels: TaxLabel[];
  action: (fd: FormData) => Promise<void>;
  idp: string;
  /** payroll staff declaring for an employee without a sign-in */
  staff?: Array<{ id: string; code: string; name: string }>;
}) {
  const [code, setCode] = useState(labels[0]?.code ?? '');
  const y = Number(fy.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, k) => {
    const m = ((k + 3) % 12) + 1;
    return `${String(k < 9 ? y : y + 1)}-${String(m).padStart(2, '0')}`;
  });
  const label = labels.find((l) => l.code === code);
  return (
    <form action={action} className="ep-form-section__body">
      {staff ? (
        <label className="ep-field" htmlFor={`${idp}-emp`}>
          <span className="ep-field__label">Employee</span>
          <select
            id={`${idp}-emp`}
            name="employeeId"
            className="ep-select"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Choose…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="ep-field" htmlFor={`${idp}-sec`}>
        <span className="ep-field__label">Section</span>
        <select
          id={`${idp}-sec`}
          name="lineCode"
          className="ep-select"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          {labels.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
              {l.appliesTo === 'OLD' ? ' (old regime)' : ''}
            </option>
          ))}
        </select>
        {label?.cap ? (
          <span className="ep-field__help">
            Up to ₹{Number(label.cap).toLocaleString('en-IN')} a year counts.
          </span>
        ) : null}
      </label>
      {code === 'HRA_RENT' ? (
        <>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">
              Rent paid each month (₹; leave a month blank if none)
            </legend>
            <div className="ep-form-row" data-columns="4">
              {months.map((m) => (
                <label key={m} className="ep-field" htmlFor={`${idp}-r-${m}`}>
                  <span className="ep-field__label">{m}</span>
                  <input
                    id={`${idp}-r-${m}`}
                    name={`rent.${m}`}
                    className="ep-input"
                    inputMode="decimal"
                    pattern="[0-9,]+(\.[0-9]{1,2})?"
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="ep-form-row" data-columns="2">
            <label className="ep-field" htmlFor={`${idp}-city`}>
              <span className="ep-field__label">City where the house is</span>
              <input
                id={`${idp}-city`}
                name="city"
                className="ep-input"
                required
                minLength={2}
                maxLength={60}
              />
            </label>
            <label className="ep-field" htmlFor={`${idp}-ln`}>
              <span className="ep-field__label">Landlord’s name</span>
              <input
                id={`${idp}-ln`}
                name="landlordName"
                className="ep-input"
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="ep-field" htmlFor={`${idp}-la`}>
              <span className="ep-field__label">Landlord’s address</span>
              <input
                id={`${idp}-la`}
                name="landlordAddress"
                className="ep-input"
                required
                minLength={5}
                maxLength={250}
              />
            </label>
            <label className="ep-field" htmlFor={`${idp}-lr`}>
              <span className="ep-field__label">
                Your relationship with the landlord (None if none)
              </span>
              <input
                id={`${idp}-lr`}
                name="landlordRelation"
                className="ep-input"
                required
                minLength={2}
                maxLength={60}
              />
            </label>
            <label className="ep-field" htmlFor={`${idp}-lp`}>
              <span className="ep-field__label">
                Landlord’s PAN (needed above ₹1,00,000 rent a year)
              </span>
              <input
                id={`${idp}-lp`}
                name="landlordPan"
                className="ep-input"
                pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]"
                maxLength={10}
              />
            </label>
          </div>
        </>
      ) : (
        <label className="ep-field" htmlFor={`${idp}-amt`}>
          <span className="ep-field__label">Amount for the year (₹)</span>
          <input
            id={`${idp}-amt`}
            name="amount"
            className="ep-input"
            required
            inputMode="decimal"
            pattern="[0-9,]+(\.[0-9]{1,2})?"
          />
        </label>
      )}
      <label className="ep-field" htmlFor={`${idp}-proof`}>
        <span className="ep-field__label">
          Proofs (PDF or photo, 10 MB each; can be added later)
        </span>
        <input
          id={`${idp}-proof`}
          name="proofs"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          className="ep-input"
        />
      </label>
      <div className="ep-grid__toolbar">
        <button type="submit" className="ep-btn ep-btn--primary">
          Declare
        </button>
      </div>
    </form>
  );
}
