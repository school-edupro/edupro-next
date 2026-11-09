'use client';
import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { SCOPE_LABEL, type LeaveScope } from '@/lib/leave';

/**
 * Who a rule is for: all staff, or the departments / designations / employee types / employees picked
 * (posted as `scope` and `scopeValues`).
 */
export function ScopePicker({
  id,
  scopes,
  staff,
  initialScope = 'all',
  initialValues = [],
}: {
  id: string;
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  staff: Array<{ code: string; name: string }>;
  initialScope?: LeaveScope;
  initialValues?: string[];
}) {
  const [scope, setScope] = useState<LeaveScope>(initialScope);
  const [values, setValues] = useState<string[]>(initialValues);
  const names = new Map(staff.map((s) => [s.code, s.name]));
  const options =
    scope === 'all'
      ? []
      : scopes[scope].map((v) => ({
          value: v,
          label: scope === 'employee' ? `${names.get(v) ?? v} (${v})` : v,
        }));
  return (
    <>
      <label className="ep-field" htmlFor={`${id}-scope`}>
        <span className="ep-field__label">For</span>
        <select
          id={`${id}-scope`}
          name="scope"
          className="ep-select"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as LeaveScope);
            setValues([]);
          }}
        >
          {(Object.keys(SCOPE_LABEL) as LeaveScope[]).map((k) => (
            <option key={k} value={k}>
              {SCOPE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {scope === 'all' ? null : (
        <ChipPicker
          name="scopeValues"
          label={`Which ${SCOPE_LABEL[scope].toLowerCase()}`}
          options={options}
          value={values}
          onChange={setValues}
          help="Type to find; pick one or more."
        />
      )}
    </>
  );
}
