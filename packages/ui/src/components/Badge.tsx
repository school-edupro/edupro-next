import type { HTMLAttributes } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Status chip. Status colours are used for status only, never for decoration. */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span className={['ep-badge', `ep-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  );
}

/** Maps the platform's row status enum to a badge tone. */
export function toneForStatus(status: string): BadgeTone {
  switch (status) {
    case 'active':
    case 'success':
    case 'approved':
      return 'success';
    case 'pending':
    case 'planned':
      return 'warning';
    case 'inactive':
    case 'rejected':
    case 'failed':
      return 'danger';
    case 'locked':
    case 'closed':
      return 'info';
    default:
      return 'neutral';
  }
}
