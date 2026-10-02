'use client';
import { useId } from 'react';
import {
  cascadeOf,
  type CatalogueField,
  type ProfileCatalogue,
  type ProfileValues,
} from '@/lib/profile';

const INPUT: Record<
  string,
  { inputMode?: 'numeric' | 'email' | 'tel'; pattern?: string; maxLength?: number; hint?: string }
> = {
  mobile: {
    inputMode: 'tel',
    pattern: '(\\+91)?[ -]?0?[6-9][0-9 -]{9,11}',
    maxLength: 16,
    hint: '10 digits',
  },
  digits12: { inputMode: 'numeric', pattern: '[0-9 -]{12,14}', maxLength: 14, hint: '12 digits' },
  digits11: { inputMode: 'numeric', pattern: '[0-9]{11}', maxLength: 11, hint: '11 digits' },
  pin: { inputMode: 'numeric', pattern: '[1-9][0-9]{5}', maxLength: 6, hint: '6 digits' },
  account: {
    inputMode: 'numeric',
    pattern: '[0-9 -]{9,22}',
    maxLength: 22,
    hint: '9 to 18 digits',
  },
  pan: { pattern: '[A-Za-z]{5}[0-9]{4}[A-Za-z]', maxLength: 10, hint: 'ABCDE1234F' },
  ifsc: { pattern: '[A-Za-z]{4}0[A-Za-z0-9]{6}', maxLength: 11, hint: 'SBIN0001234' },
  year: { inputMode: 'numeric', pattern: '[0-9]{4}', maxLength: 4, hint: 'YYYY' },
  number: { inputMode: 'numeric', maxLength: 14 },
  email: { inputMode: 'email', maxLength: 120 },
};

/** Options for a list field, narrowed by country / state for address cascades. */
function optionsFor(
  f: CatalogueField,
  values: ProfileValues,
  geo: ProfileCatalogue['geography'],
): string[] {
  const c = cascadeOf(f.key);
  if (c && f.key === c.state) {
    const country = String(values[c.country] ?? '');
    const states = geo.states
      .filter((s) => !country || !s.country || s.country === country)
      .map((s) => s.name);
    return states.length ? states : (f.options ?? []);
  }
  if (c && f.key === c.city) {
    const state = String(values[c.state] ?? '');
    return geo.cities.filter((x) => !state || x.state === state).map((x) => x.name);
  }
  return f.options ?? [];
}

/**
 * One catalogue field: a typeahead for lists (and cities), native date input, numeric keyboards for
 * numbers, read-only display for enrolment and computed values, and a replace-only box for masked
 * sensitive numbers.
 */
export function ProfileField({
  field: f,
  values,
  geography,
  error,
  masked,
  disabled,
  onChange,
}: {
  field: CatalogueField;
  values: ProfileValues;
  geography: ProfileCatalogue['geography'];
  error?: string;
  /** Current masked display of a sensitive value, if any. */
  masked?: string | null;
  disabled?: boolean;
  onChange: (key: string, value: string | null) => void;
}) {
  const listId = useId();
  const id = `pf-${f.key}`;
  const raw = values[f.key];
  const value = raw === null || raw === undefined ? '' : String(raw);
  const errId = error ? `${id}-err` : undefined;
  const cascade = cascadeOf(f.key);
  const options =
    f.type === 'list' || (cascade && f.key === cascade.city)
      ? optionsFor(f, values, geography)
      : [];
  const spec = INPUT[f.type] ?? {};
  const help = f.readOnly
    ? f.type === 'auto'
      ? 'Calculated automatically'
      : f.key === 'admission_no'
        ? 'Changed by an administrator with a reason (Admission number panel above)'
        : 'Changes through enrolment (class, section, roll number)'
    : masked
      ? `Stored as ${masked}. Type a new number to replace it.`
      : (f.help ?? spec.hint ?? null);
  return (
    <div className="ep-field" data-key={f.key}>
      <label className="ep-field__label" htmlFor={id}>
        {f.label}
        {f.required ? <span aria-hidden="true"> *</span> : null}
        {f.required ? <span className="ep-sr-only"> (required)</span> : null}
      </label>
      <input
        id={id}
        className="ep-input"
        type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
        value={masked && value === masked ? '' : value}
        placeholder={masked ? masked : undefined}
        readOnly={f.readOnly || disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [errId, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined
        }
        list={options.length ? listId : undefined}
        autoComplete="off"
        inputMode={spec.inputMode}
        maxLength={spec.maxLength ?? 300}
        style={
          f.upper || f.type === 'pan' || f.type === 'ifsc'
            ? { textTransform: 'uppercase' }
            : undefined
        }
        onChange={(e) => {
          const v = e.target.value;
          onChange(f.key, v === '' ? (masked ? masked : null) : v);
          // choosing another country or state empties the dependent choice below it
          if (cascade && f.key === cascade.country) onChange(cascade.state, null);
          if (cascade && (f.key === cascade.country || f.key === cascade.state))
            onChange(cascade.city, null);
        }}
      />
      {options.length ? (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
      {help ? (
        <span id={`${id}-help`} className="ep-field__help">
          {help}
        </span>
      ) : null}
      {masked && !disabled && !f.readOnly ? (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => onChange(f.key, null)}
        >
          Remove stored number
        </button>
      ) : null}
      {error ? (
        <span id={errId} className="ep-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
