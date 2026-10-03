/** One star, drawn (not a text glyph) so it scales with the font size and takes the current colour. */
function Star({ off }: { off?: boolean }) {
  return (
    <svg
      className={off ? 'ep-star ep-star--off' : 'ep-star'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.6l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z" />
    </svg>
  );
}

export interface StarsProps {
  /** 0 to `max`; halves are rounded to the nearest whole star. */
  value: number;
  max?: number;
  /** Spoken label; defaults to "4 out of 5 stars". */
  label?: string;
  className?: string;
}

/** A rating shown as stars (never as a bare number); the number is kept for screen readers. */
export function Stars({ value, max = 5, label, className }: StarsProps) {
  const on = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span
      className={['ep-stars', className ?? ''].filter(Boolean).join(' ')}
      role="img"
      aria-label={label ?? `${String(on)} out of ${String(max)} stars`}
    >
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} off={i >= on} />
      ))}
    </span>
  );
}

export interface StarInputProps {
  name: string;
  /** Visible group label (the fieldset legend). */
  label: string;
  /** Prefix for the radio ids, so two pickers can share a page. */
  id?: string;
  defaultValue?: number;
  max?: number;
  required?: boolean;
  /** Spoken name of one choice, e.g. (3) => "3 stars". */
  starLabel?: (n: number) => string;
}

/**
 * A star picker that works without scripts: radio buttons drawn as stars, so it posts with a plain form,
 * follows the arrow keys and reads as "3 stars" to a screen reader.
 */
export function StarInput({
  name,
  label,
  id,
  defaultValue = 5,
  max = 5,
  required,
  starLabel = (n) => `${String(n)} ${n === 1 ? 'star' : 'stars'}`,
}: StarInputProps) {
  const base = id ?? name;
  return (
    <fieldset className="ep-starinput">
      <legend className="ep-field__label">{label}</legend>
      <div className="ep-starinput__row">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <label key={n} className="ep-starinput__star" htmlFor={`${base}-${String(n)}`}>
            <input
              id={`${base}-${String(n)}`}
              className="ep-sr-only"
              type="radio"
              name={name}
              value={n}
              defaultChecked={n === defaultValue}
              required={required}
            />
            <Star />
            <span className="ep-sr-only">{starLabel(n)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
