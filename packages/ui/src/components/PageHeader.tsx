import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Uppercase cyan overline above the title, usually the module name. */
  kicker: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Page anatomy from the UI guidelines: kicker, h2 title, primary action on the right. */
export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <div className="ep-page-header">
      <div>
        <div className="ep-kicker">{kicker}</div>
        <h2 className="ep-page-title">{title}</h2>
        {description ? (
          <p style={{ marginTop: 'var(--sp-2)', color: 'var(--text-muted)' }}>{description}</p>
        ) : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>{actions}</div> : null}
    </div>
  );
}
