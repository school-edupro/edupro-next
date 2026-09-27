import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  leadingIcon?: ReactNode;
  loading?: boolean;
}

/**
 * Rounded-rectangle button (never pill). Primary is navy, accent is cyan, hover darkens one step.
 * All styling lives in app.css through tokens; this component only composes class names.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'ep-btn',
    `ep-btn--${variant}`,
    size === 'sm' ? 'ep-btn--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
}
