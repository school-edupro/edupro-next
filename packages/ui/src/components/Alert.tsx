import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}

/** Inline alert with status background. Danger alerts announce immediately; others politely. */
export function Alert({ tone = 'info', title, children, action }: AlertProps) {
  return (
    <div className={`ep-alert ep-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div style={{ flex: 1 }}>
        {title ? (
          <strong style={{ display: 'block', marginBottom: 'var(--sp-1)' }}>{title}</strong>
        ) : null}
        {children}
      </div>
      {action}
    </div>
  );
}
