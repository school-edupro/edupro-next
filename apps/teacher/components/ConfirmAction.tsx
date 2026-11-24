'use client';
import { Button, Dialog, type ButtonVariant } from '@edupro/ui';
import { useRef, useState, type ReactNode } from 'react';

/**
 * A button that asks before it acts, as the admin website's: a dialog states the consequence, asks for a reason
 * when one is needed (sent as `reason`, at least 3 letters unless optional), and only then submits the server
 * action with the hidden fields. The words come from the page (English or Hindi).
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  children,
  confirmLabel,
  variant = 'secondary',
  confirmVariant = 'primary',
  reason,
  cancelLabel = 'Cancel',
  needReason = 'Give a reason of at least 3 characters.',
}: {
  action: (fd: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  confirmVariant?: 'primary' | 'accent' | 'danger';
  reason?: { label: string; placeholder?: string; optional?: boolean };
  cancelLabel?: string;
  needReason?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = `reason-${Object.values(fields).join('-')}`;
  return (
    <form ref={form} action={action} style={{ display: 'inline' }}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {reason ? <input type="hidden" name="reason" value={text} /> : null}
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Dialog
          open
          size="sm"
          title={title}
          secondaryLabel={cancelLabel}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          primary={{
            label: confirmLabel,
            variant: confirmVariant,
            loading: busy,
            onClick: () => {
              if (reason && !reason.optional && text.trim().length < 3) {
                setError(needReason);
                return;
              }
              setBusy(true);
              form.current?.requestSubmit();
            },
          }}
        >
          <div className="ep-prose">{children}</div>
          {reason ? (
            <label className="ep-field" htmlFor={reasonId} style={{ marginTop: 'var(--sp-3)' }}>
              <span className="ep-field__label">
                {reason.label}
                {reason.optional ? null : <span aria-hidden="true"> *</span>}
              </span>
              <textarea
                id={reasonId}
                className="ep-input"
                rows={3}
                maxLength={500}
                placeholder={reason.placeholder}
                value={text}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${reasonId}-err` : undefined}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
              />
              {error ? (
                <span id={`${reasonId}-err`} className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
            </label>
          ) : null}
        </Dialog>
      ) : null}
    </form>
  );
}
