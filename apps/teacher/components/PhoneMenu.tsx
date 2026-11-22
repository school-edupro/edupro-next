'use client';

import { useRef, type ReactNode } from 'react';

/**
 * The last place of the phone bar when the school arranged the menu (docs/design/90, 94): "Menu" opens the side menu
 * (hidden on phones) as a full-height panel; Escape, the close button or a tap beside it closes it.
 */
export function PhoneMenu({
  label,
  closeLabel,
  icon,
  closeIcon,
  children,
}: {
  label: string;
  closeLabel: string;
  icon: ReactNode;
  closeIcon: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
        style={{
          display: 'grid',
          justifyItems: 'center',
          gap: 'var(--sp-1)',
          padding: 'var(--sp-2) var(--sp-1)',
          // the font first: the shorthand would undo the size (the tab words are captions)
          font: 'inherit',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-caption)',
          background: 'none',
          border: 0,
          cursor: 'pointer',
        }}
      >
        {icon}
        <span>{label}</span>
      </button>
      <dialog
        ref={ref}
        aria-label={label}
        onClick={(e) => {
          // a tap on the backdrop (the dialog itself, outside its panel) closes it
          if (e.target === ref.current) ref.current?.close();
        }}
        style={{
          margin: '0 0 0 auto',
          padding: 0,
          border: 0,
          width: 'min(100vw, 22rem)',
          maxWidth: '100vw',
          height: '100dvh',
          maxHeight: '100dvh',
          background: 'var(--surface-card)',
          color: 'var(--text-body)',
        }}
      >
        <div style={{ padding: 'var(--sp-3) var(--sp-4)', display: 'grid', gap: 'var(--sp-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ color: 'var(--text-heading)' }}>{label}</strong>
            <button
              type="button"
              className="ep-header__icon-btn"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={() => ref.current?.close()}
            >
              {closeIcon}
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
