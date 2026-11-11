'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A button that opens its content in a dialog (Apply Leave, Leave Details on My leave). */
export function DialogButton({
  id,
  label,
  title,
  className = 'ep-btn ep-btn--primary ep-btn--sm',
  open: startOpen = false,
  tip,
  icon,
  children,
}: {
  id: string;
  label: ReactNode;
  title: string;
  className?: string;
  open?: boolean;
  /** a tooltip on the button (an icon-only button names itself with hidden text in `label`) */
  tip?: string;
  /** a small drawing before the dialog's title */
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);
  return (
    <>
      <button type="button" className={className} title={tip} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <dialog
          ref={ref}
          className="ep-dialog ep-weekoff"
          data-size="lg"
          aria-labelledby={`${id}-title`}
          onClose={() => setOpen(false)}
        >
          <div className="ep-dialog__body">
            <div className="ep-weekoff__head">
              <h3
                id={`${id}-title`}
                className="ep-card__title"
                style={
                  icon ? { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' } : undefined
                }
              >
                {icon}
                {title}
              </h3>
              <button
                type="button"
                className="ep-chips__x"
                aria-label="Close"
                onClick={() => ref.current?.close()}
              >
                ×
              </button>
            </div>
            <div className="ep-dialog__content ep-weekoff__content">{children}</div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
