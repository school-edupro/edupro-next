'use client';
import { useState, useTransition } from 'react';
import { verifySibling } from '@/lib/actions';
import type { ProfileValues } from '@/lib/profile';

type Found = Extract<Awaited<ReturnType<typeof verifySibling>>, { ok: true }>['sibling'];

/**
 * Top of the Sibling tab: type the sibling's admission number and verify it. The system shows who it
 * is (name, class, parents) and fills the name and class from that record; saving checks it again.
 */
export function SiblingVerify({
  studentId,
  values,
  disabled,
  set,
}: {
  studentId: string;
  values: ProfileValues;
  disabled?: boolean;
  set: (patch: ProfileValues) => void;
}) {
  const [no, setNo] = useState(String(values.sibling_admission_no ?? ''));
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const verify = () =>
    start(async () => {
      setError(null);
      setFound(null);
      const r = await verifySibling(no, studentId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setFound(r.sibling);
      set({
        sibling_in_school: 'Yes',
        sibling_admission_no: r.sibling.admissionNo,
        sibling_name: r.sibling.name,
        sibling_class_section: r.sibling.classSection,
      });
    });
  return (
    <fieldset className="ep-roles">
      <legend>Verify a sibling</legend>
      <div className="ep-roles__row">
        <label className="ep-field" htmlFor="sib-no" style={{ margin: 0 }}>
          <span className="ep-field__label">Sibling&rsquo;s admission no</span>
          <input
            id="sib-no"
            className="ep-input"
            value={no}
            maxLength={40}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => setNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                verify();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={disabled || pending || !no.trim()}
          onClick={verify}
        >
          {pending ? 'Checking…' : 'Verify'}
        </button>
      </div>
      <div aria-live="polite">
        {error ? (
          <p className="ep-field__error" role="alert">
            {error}
          </p>
        ) : null}
        {found ? (
          <p className="ep-alert ep-alert--success" style={{ margin: 0 }}>
            <strong>{found.name}</strong> · {found.admissionNo}
            {found.classSection ? ` · ${found.classSection}` : ''}
            {found.father ? ` · Father ${found.father}` : ''}
            {found.mother ? ` · Mother ${found.mother}` : ''}
            {found.status !== 'active' ? ` · ${found.status}` : ''}. Name and class are filled
            below; save to keep them.
          </p>
        ) : null}
      </div>
      <p className="ep-field__help">
        Saving checks the admission number again and takes the name and class from that student.
      </p>
    </fieldset>
  );
}
