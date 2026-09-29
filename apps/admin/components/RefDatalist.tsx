'use client';
import { useId, useMemo, useState } from 'react';

export interface DatalistOption {
  value: string;
  /** shown after the value in the suggestion (a name next to a code) */
  label?: string | null;
  /** the parent's value when this list depends on another field */
  parent?: string | null;
}

/**
 * A typeahead input backed by a datalist. When `parent` is given, a second (non-submitted) input
 * narrows the options to those whose `parent` matches what was typed there: country → state,
 * state → city. The submitted value is the option's value (a code), which the API resolves to an id.
 */
export function RefDatalist({
  id,
  name,
  label,
  required,
  defaultValue,
  options,
  help,
  pattern,
  maxLength,
  parent,
  onValue,
}: {
  id: string;
  name?: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  options: DatalistOption[];
  help?: string;
  pattern?: string;
  maxLength?: number;
  parent?: { label: string; options: DatalistOption[]; defaultValue?: string };
  onValue?: (value: string) => void;
}) {
  const listId = useId();
  const parentListId = useId();
  const initialParent =
    parent?.defaultValue ??
    (defaultValue ? (options.find((o) => o.value === defaultValue)?.parent ?? '') : '');
  const [parentValue, setParentValue] = useState(initialParent ?? '');
  const [value, setValue] = useState(defaultValue ?? '');
  const visible = useMemo(
    () => (parent && parentValue ? options.filter((o) => o.parent === parentValue) : options),
    [options, parent, parentValue],
  );
  const filtered = parent && parentValue && !options.some((o) => o.parent === parentValue);
  return (
    <>
      {parent ? (
        <label className="ep-field" htmlFor={`${id}-parent`}>
          <span className="ep-field__label">{parent.label}</span>
          <input
            id={`${id}-parent`}
            className="ep-input"
            list={parentListId}
            autoComplete="off"
            value={parentValue}
            onChange={(e) => {
              setParentValue(e.target.value);
              setValue('');
              onValue?.('');
            }}
          />
          <datalist id={parentListId}>
            {parent.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label ?? ''}
              </option>
            ))}
          </datalist>
          <span className="ep-field__help">Narrows the list below; not saved.</span>
        </label>
      ) : null}
      <label className="ep-field" htmlFor={id}>
        <span className="ep-field__label">
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </span>
        <input
          id={id}
          name={name}
          className="ep-input"
          list={listId}
          autoComplete="off"
          required={required}
          value={value}
          pattern={pattern}
          maxLength={maxLength}
          onChange={(e) => {
            setValue(e.target.value);
            onValue?.(e.target.value);
          }}
        />
        <datalist id={listId}>
          {visible.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label ?? ''}
            </option>
          ))}
        </datalist>
        {help || filtered ? (
          <span className="ep-field__help">
            {filtered ? 'No entries under that parent yet.' : help}
          </span>
        ) : null}
      </label>
    </>
  );
}
