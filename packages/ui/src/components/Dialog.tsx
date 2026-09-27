'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Primary action; for irreversible actions state the consequence in the body and use variant "danger". */
  primary?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'accent' | 'danger';
    loading?: boolean;
  };
  secondaryLabel?: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Native <dialog> for focus trapping and Escape handling; overlay shadow token; 250 ms fade. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  primary,
  secondaryLabel = 'Cancel',
  size = 'md',
}: DialogProps) {
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
      className="ep-dialog"
      data-size={size}
      aria-labelledby="ep-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
    >
      <div className="ep-dialog__body" onClick={(e) => e.stopPropagation()}>
        <h3 id="ep-dialog-title" className="ep-card__title">
          {title}
        </h3>
        <div className="ep-dialog__content">{children}</div>
        <div className="ep-dialog__actions">
          <Button variant="secondary" onClick={onClose}>
            {secondaryLabel}
          </Button>
          {primary ? (
            <Button
              variant={primary.variant ?? 'primary'}
              onClick={primary.onClick}
              loading={primary.loading}
            >
              {primary.label}
            </Button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
