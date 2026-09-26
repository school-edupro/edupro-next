'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  width?: 'sm' | 'md' | 'lg';
}

/** Side panel for detail views and forms that keep the list visible. Native <dialog> for focus and Escape. */
export function Drawer({ open, title, onClose, children, footer, side = 'right', width = 'md' }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ep-drawer"
      data-side={side}
      data-width={width}
      aria-labelledby="ep-drawer-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="ep-drawer__panel" onClick={(e) => e.stopPropagation()}>
        <header className="ep-drawer__header">
          <h3 id="ep-drawer-title" className="ep-card__title" style={{ marginBottom: 0 }}>
            {title}
          </h3>
          <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="ep-drawer__content">{children}</div>
        {footer ? <footer className="ep-drawer__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
