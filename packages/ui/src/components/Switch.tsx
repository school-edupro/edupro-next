'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: ReactNode;
}

/** Accessible toggle: a button with role="switch" so screen readers announce on and off. */
export function Switch({ id, label, checked, onChange, help, disabled, className, ...rest }: SwitchProps) {
  return (
    <div className={['ep-switch', className ?? ''].filter(Boolean).join(' ')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={help ? `${id}-help` : undefined}
        className="ep-switch__track"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        {...rest}
      >
        <span className="ep-switch__thumb" aria-hidden="true" />
      </button>
      <label htmlFor={id} className="ep-check__text">
        {label}
        {help ? (
          <span className="ep-field__help" id={`${id}-help`}>
            {help}
          </span>
        ) : null}
      </label>
    </div>
  );
}
