'use client';
import { Button, Dialog, type ButtonVariant } from '@edupro/ui';
import { useRef, useState, type ReactNode } from 'react';

/**
 * A button that asks before it acts: it opens a dialog stating the consequence, optionally asks for
 * a reason (sent as `reason`), and only then submits the server action with the hidden fields.
 * Use it for anything that is hard to undo (activate, close, reopen, delete).
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
  choices,
  select,
  when,
  blocked,
}: {
  action: (fd: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  confirmVariant?: 'primary' | 'accent' | 'danger';
  /**
   * When set, a reason of at least 3 characters is required and posted as `reason`; `optional` makes
   * it a free note.
   */
  reason?: { label: string; placeholder?: string; optional?: boolean };
  /** A pick in the dialog (required), posted as `name` (docs/design/83, "As built — a PO line for less"). */
  select?: { name: string; label: string; options: Array<{ value: string; label: string }> };
  /**
   * Ticks in the dialog (docs/design/82), each ticked one posted as `name` = its value; at least one
   * must be ticked. A disabled tick shows why in its label.
   */
  choices?: {
    name: string;
    legend: string;
    items: Array<{ value: string; label: string; checked?: boolean; disabled?: boolean }>;
  };
  /**
   * A date and time in the dialog (docs/design/98: when a reopened area closes), posted as `name` in the
   * browser's `YYYY-MM-DDTHH:mm`; starts at `value`, kept between `min` and `max`.
   */
  when?: { name: string; label: string; value: string; min?: string; max?: string; help?: string };
  /** Nothing can be done now: the dialog says why and offers only Close (docs/design/82). */
  blocked?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');
  const [at, setAt] = useState(when?.value ?? '');
  const [picked, setPicked] = useState<string[]>(
    choices?.items.filter((i) => i.checked && !i.disabled).map((i) => i.value) ?? [],
  );
  const reasonId = `reason-${Object.values(fields).join('-')}`;
  return (
    <form ref={form} action={action} style={{ display: 'inline' }}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {reason ? <input type="hidden" name="reason" value={text} /> : null}
      {select ? <input type="hidden" name={select.name} value={chosen} /> : null}
      {when ? <input type="hidden" name={when.name} value={at} /> : null}
      {choices
        ? picked.map((v) => <input key={v} type="hidden" name={choices.name} value={v} />)
        : null}
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Dialog
          open
          size="sm"
          title={title}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          secondaryLabel={blocked ? 'Close' : undefined}
          primary={
            blocked
              ? undefined
              : {
                  label: confirmLabel,
                  variant: confirmVariant,
                  loading: busy,
                  onClick: () => {
                    if (choices && !picked.length) {
                      setError('Tick at least one.');
                      return;
                    }
                    if (select && !chosen) {
                      setError(`Pick: ${select.label.toLowerCase()}.`);
                      return;
                    }
                    if (
                      when &&
                      (!at || (when.min && at < when.min) || (when.max && at > when.max))
                    ) {
                      setError(`Pick: ${when.label.toLowerCase()} (within the allowed dates).`);
                      return;
                    }
                    if (reason && !reason.optional && text.trim().length < 3) {
                      setError('Give a reason of at least 3 characters.');
                      return;
                    }
                    setBusy(true);
                    form.current?.requestSubmit();
                  },
                }
          }
        >
          <div className="ep-prose">{children}</div>
          {blocked ? (
            <p className="ep-alert ep-alert--warning" style={{ marginTop: 'var(--sp-3)' }}>
              {blocked}
            </p>
          ) : null}
          {choices ? (
            <fieldset
              className="ep-field"
              style={{ marginTop: 'var(--sp-3)', border: 0, padding: 0 }}
              aria-describedby={error && !reason ? `${reasonId}-err` : undefined}
            >
              <legend className="ep-field__label">{choices.legend}</legend>
              {choices.items.map((i) => (
                <label
                  key={i.value}
                  className="ep-roles__tick"
                  htmlFor={`${reasonId}-${i.value}`}
                  style={{ display: 'flex' }}
                >
                  <input
                    id={`${reasonId}-${i.value}`}
                    type="checkbox"
                    disabled={i.disabled}
                    checked={picked.includes(i.value)}
                    onChange={(e) => {
                      setPicked((p) =>
                        e.target.checked ? [...p, i.value] : p.filter((x) => x !== i.value),
                      );
                      setError(null);
                    }}
                  />{' '}
                  {i.label}
                </label>
              ))}
              {error && !reason ? (
                <span id={`${reasonId}-err`} className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
            </fieldset>
          ) : null}
          {select ? (
            <label
              className="ep-field"
              htmlFor={`${reasonId}-pick`}
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <span className="ep-field__label">
                {select.label}
                <span aria-hidden="true"> *</span>
              </span>
              <select
                id={`${reasonId}-pick`}
                className="ep-select"
                value={chosen}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Pick one</option>
                {select.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {error && !reason && !choices ? (
                <span className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
            </label>
          ) : null}
          {when ? (
            <label
              className="ep-field"
              htmlFor={`${reasonId}-when`}
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <span className="ep-field__label">
                {when.label}
                <span aria-hidden="true"> *</span>
              </span>
              <input
                id={`${reasonId}-when`}
                type="datetime-local"
                className="ep-input"
                value={at}
                min={when.min}
                max={when.max}
                aria-describedby={when.help ? `${reasonId}-when-help` : undefined}
                onChange={(e) => {
                  setAt(e.target.value);
                  setError(null);
                }}
              />
              {when.help ? (
                <span id={`${reasonId}-when-help`} className="ep-field__help">
                  {when.help}
                </span>
              ) : null}
              {error && !reason ? (
                <span className="ep-field__error" role="alert">
                  {error}
                </span>
              ) : null}
            </label>
          ) : null}
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
