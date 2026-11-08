import type { ReactNode } from 'react';
import { Icon } from '@/components/nav-icons';

/**
 * A card that folds (docs/design/83, "As built — the PO page"): the bar shows the title and a one-line
 * hint of what is inside; a click (or Enter / Space on the bar) opens the rest. Closed unless `open`.
 */
export function FoldCard({
  id,
  title,
  hint,
  open = false,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="ep-card ep-fold" open={open}>
      <summary className="ep-fold__summary">
        <span className="ep-fold__head">
          <h2 id={id} className="ep-fold__title">
            {title}
          </h2>
          {hint ? <span className="ep-fold__hint">{hint}</span> : null}
        </span>
        <span className="ep-fold__chevron" aria-hidden="true">
          <Icon name="chevron" size={20} />
        </span>
      </summary>
      <div className="ep-fold__body">{children}</div>
    </details>
  );
}
