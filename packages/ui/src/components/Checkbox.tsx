import type { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: ReactNode;
  help?: ReactNode;
}

export function Checkbox({ id, label, help, className, ...rest }: CheckboxProps) {
  return (
    <label className={['ep-check', className ?? ''].filter(Boolean).join(' ')} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="ep-check__input"
        aria-describedby={help ? `${id}-help` : undefined}
        {...rest}
      />
      <span className="ep-check__box" aria-hidden="true" />
      <span className="ep-check__text">
        {label}
        {help ? (
          <span className="ep-field__help" id={`${id}-help`}>
            {help}
          </span>
        ) : null}
      </span>
    </label>
  );
}
