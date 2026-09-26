import type { ReactNode } from 'react';

export interface RadioOption {
  value: string;
  label: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  legend: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  inline?: boolean;
  required?: boolean;
  error?: string;
}

export function RadioGroup({ name, legend, options, value, defaultValue, onChange, inline = false, required, error }: RadioGroupProps) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset className="ep-radio-group" data-inline={inline ? 'true' : undefined} aria-describedby={errorId} aria-invalid={error ? 'true' : undefined}>
      <legend className="ep-field__label" data-required={required ? 'true' : undefined}>
        {legend}
      </legend>
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        return (
          <label key={o.value} className="ep-radio" htmlFor={id}>
            <input
              id={id}
              type="radio"
              className="ep-radio__input"
              name={name}
              value={o.value}
              disabled={o.disabled}
              required={required}
              checked={value !== undefined ? value === o.value : undefined}
              defaultChecked={value === undefined && defaultValue === o.value ? true : undefined}
              onChange={onChange ? () => onChange(o.value) : undefined}
            />
            <span className="ep-radio__dot" aria-hidden="true" />
            <span className="ep-check__text">
              {o.label}
              {o.help ? <span className="ep-field__help">{o.help}</span> : null}
            </span>
          </label>
        );
      })}
      {error ? (
        <div className="ep-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </fieldset>
  );
}
