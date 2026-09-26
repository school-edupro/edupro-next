import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
}

function FieldShell({ id, label, required, help, error, children }: FieldShellProps) {
  return (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor={id} data-required={required ? 'true' : undefined}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="ep-field__error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : help ? (
        <div className="ep-field__help" id={`${id}-help`}>
          {help}
        </div>
      ) : null}
    </div>
  );
}

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  help?: ReactNode;
  error?: string;
}

export function InputField({ id, label, help, error, required, className, ...rest }: InputFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error}>
      <input
        id={id}
        className={['ep-input', className ?? ''].filter(Boolean).join(' ')}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  help?: ReactNode;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function SelectField({ id, label, help, error, required, options, className, ...rest }: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error}>
      <select
        id={id}
        className={['ep-select', className ?? ''].filter(Boolean).join(' ')}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
