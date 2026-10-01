'use client';
import { useEffect, useState, useTransition } from 'react';
import { ProfileField } from './ProfileField';
import type { ProfileCatalogue, ProfileValues, QuickAddResult } from '@/lib/profile';

/**
 * Quick student add: the thirteen fields the ERP needs to run fees, attendance and SMS on day one,
 * plus the section. After a save the form stays, keeps the section, suggests the next admission and
 * roll numbers, and links to the new profile to complete the rest.
 */
export function QuickAddStudent({
  catalogue,
  sections,
  initialSectionId,
  initialNumbers,
  add,
  next,
}: {
  catalogue: ProfileCatalogue;
  sections: Array<{ value: string; label: string }>;
  initialSectionId: string;
  initialNumbers: { admissionNo: string | null; rollNo: number | null };
  add: (input: {
    classSectionId: string;
    rollNo?: number;
    values: ProfileValues;
  }) => Promise<QuickAddResult>;
  next: (classSectionId: string) => Promise<{ admissionNo: string | null; rollNo: number | null }>;
}) {
  const fields = catalogue.quickAdd
    .map((k) => catalogue.fields.find((f) => f.key === k))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    // on this form every quick-add field except the names is required
    .map((f) => ({
      ...f,
      required: !['last_name', 'father_name', 'mother_name'].includes(f.key),
      help: f.key === 'father_name' ? "Father's or mother's name is required" : f.help,
    }));
  const today = new Date().toISOString().slice(0, 10);
  const blank = (admissionNo: string | null): ProfileValues => ({
    admission_no: admissionNo,
    admitted_on: today,
    ews: 'No',
    boarding: 'Day Scholar',
  });
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [roll, setRoll] = useState<string>(
    initialNumbers.rollNo ? String(initialNumbers.rollNo) : '',
  );
  const [values, setValues] = useState<ProfileValues>(blank(initialNumbers.admissionNo));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Extract<QuickAddResult, { ok: true }>[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!sectionId) return;
    let live = true;
    void next(sectionId).then((n) => {
      if (live) setRoll(n.rollNo ? String(n.rollNo) : '');
    });
    return () => {
      live = false;
    };
  }, [sectionId, next]);

  const onChange = (key: string, v: string | null) => {
    setValues((p) => ({ ...p, [key]: v }));
    setErrors((p) => {
      if (!p[key]) return p;
      const n = { ...p };
      delete n[key];
      return n;
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const rollNo = roll ? Number(roll) : undefined;
    start(async () => {
      const r = await add({
        classSectionId: sectionId,
        rollNo: Number.isInteger(rollNo) ? rollNo : undefined,
        values,
      });
      if (r.ok) {
        setDone((d) => [r, ...d].slice(0, 5));
        setErrors({});
        setFailure(null);
        const n = await next(sectionId);
        setValues(blank(n.admissionNo));
        setRoll(n.rollNo ? String(n.rollNo) : '');
        setTimeout(() => document.getElementById('pf-first_name')?.focus(), 30);
      } else {
        setErrors(r.errors);
        setFailure(r.detail);
        const first = Object.keys(r.errors)[0];
        if (first)
          document
            .getElementById(first === 'classSectionId' ? 'qa-section' : `pf-${first}`)
            ?.focus();
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      {done.length ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {done.map((d) => (
            <div key={d.id}>
              Added <strong>{d.name}</strong> ({d.admissionNo}), profile {d.completeness}% complete
              · <a href={`/people/students/${d.id}`}>Open</a> ·{' '}
              <a href={`/people/students/${d.id}/profile`}>Complete the profile</a>
            </div>
          ))}
        </div>
      ) : null}
      {failure ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {failure}
        </div>
      ) : null}
      <div className="ep-profile__grid">
        <div className="ep-field">
          <label className="ep-field__label" htmlFor="qa-section">
            Class and section<span aria-hidden="true"> *</span>
          </label>
          <select
            id="qa-section"
            className="ep-input"
            value={sectionId}
            required
            aria-invalid={errors.classSectionId ? true : undefined}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">Choose…</option>
            {sections.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {errors.classSectionId ? (
            <span className="ep-field__error" role="alert">
              {errors.classSectionId}
            </span>
          ) : null}
        </div>
        <div className="ep-field">
          <label className="ep-field__label" htmlFor="qa-roll">
            Roll no
          </label>
          <input
            id="qa-roll"
            className="ep-input"
            inputMode="numeric"
            value={roll}
            maxLength={3}
            onChange={(e) => setRoll(e.target.value.replace(/\D/g, ''))}
          />
          <span className="ep-field__help">
            Next free roll number is filled in; change it if needed.
          </span>
        </div>
        {fields.map((f) => (
          <ProfileField
            key={f.key}
            field={f}
            values={values}
            geography={catalogue.geography}
            error={errors[f.key]}
            onChange={onChange}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          justifyContent: 'flex-end',
          marginTop: 'var(--sp-4)',
        }}
      >
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save and add next'}
        </button>
      </div>
    </form>
  );
}
