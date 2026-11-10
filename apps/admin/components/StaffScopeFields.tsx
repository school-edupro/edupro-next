'use client';
import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';

const KIND_LABEL: Record<string, string> = {
  all: 'All staff',
  department: 'Department',
  designation: 'Designation',
  employee_type: 'Employee type',
  employee: 'Employee',
};
const PLURAL: Record<string, string> = {
  department: 'departments',
  designation: 'designations',
  employee_type: 'employee types',
  employee: 'employees',
};

/**
 * A masters form's "For which staff" select and the staff it names: pick the kind, then one or more
 * departments / designations / employee types / employees from a type-to-search list. Posts both as the
 * generic form does (`f:<scope>`, and `f:<values>` comma-separated).
 */
export function StaffScopeFields({
  id,
  scopeName,
  scopeLabel,
  scopeOptions,
  scopeRequired,
  valuesName,
  valuesLabel,
  initialScope,
  initialValues,
  options,
}: {
  id: string;
  scopeName: string;
  scopeLabel: string;
  scopeOptions: string[];
  scopeRequired?: boolean;
  valuesName: string;
  valuesLabel: string;
  initialScope: string;
  initialValues: string;
  /** every pickable value; `parent` is its kind (department …), `label` the shown name when it differs */
  options: Array<{ value: string; parent: string | null; label: string | null }>;
}) {
  const [scope, setScope] = useState(scopeOptions.includes(initialScope) ? initialScope : '');
  const [values, setValues] = useState<string[]>(
    initialValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
  const list = options
    .filter((o) => o.parent === scope)
    .map((o) => ({
      value: o.value,
      label: scope === 'employee' && o.label ? `${o.label} (${o.value})` : (o.label ?? o.value),
    }));
  // a value kept on the row that is no longer in the lists still shows (and stays) as a chip
  for (const v of values)
    if (!list.some((o) => o.value.toLowerCase() === v.toLowerCase()))
      list.push({ value: v, label: v });
  const named = scope !== '' && scope !== 'all';
  return (
    <>
      <label className="ep-field" htmlFor={`${id}-scope`}>
        <span className="ep-field__label">
          {scopeLabel}
          {scopeRequired ? <span aria-hidden="true"> *</span> : null}
        </span>
        <select
          id={`${id}-scope`}
          name={scopeName}
          className="ep-select"
          value={scope}
          required={scopeRequired}
          onChange={(e) => {
            setScope(e.target.value);
            setValues([]);
          }}
        >
          {scopeRequired ? null : <option value="">—</option>}
          {scopeOptions.map((o) => (
            <option key={o} value={o}>
              {KIND_LABEL[o] ?? o}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name={valuesName} value={named ? values.join(',') : ''} />
      {named ? (
        // the list takes two columns of the form: chips and the search box need the room
        <div style={{ gridColumn: 'span 2' }}>
          <ChipPicker
            label={`${valuesLabel} · ${PLURAL[scope] ?? scope}`}
            required
            options={list}
            value={values}
            onChange={setValues}
            help="Type to find; pick one or more."
          />
        </div>
      ) : (
        <div className="ep-field">
          <span className="ep-field__label">{valuesLabel}</span>
          <span className="ep-field__help">
            {scope === 'all' ? 'Every member of staff.' : `Choose ${scopeLabel} first.`}
          </span>
        </div>
      )}
    </>
  );
}
