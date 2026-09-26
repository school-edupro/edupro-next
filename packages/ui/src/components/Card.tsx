import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** Shadow instead of border (cards use one or the other, never both). */
  elevated?: boolean;
  actions?: ReactNode;
}

export function Card({ title, elevated = false, actions, className, children, ...rest }: CardProps) {
  return (
    <section className={['ep-card', elevated ? 'ep-card--elevated' : '', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {(title || actions) && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
          {title ? <h3 className="ep-card__title">{title}</h3> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
