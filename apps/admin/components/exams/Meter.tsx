/** A progress bar with its words ("18 of 99 marks entered"); full turns it green. */
export function Meter({ done, of, label }: { done: number; of: number; label: string }) {
  const pct = of > 0 ? Math.min(100, Math.round((done / of) * 100)) : 0;
  return (
    <div className="ep-meter">
      <div
        className="ep-meter__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={of}
        aria-valuenow={Math.min(done, of)}
        data-full={of > 0 && done >= of ? 'true' : 'false'}
      >
        <span style={{ width: `${String(pct)}%` }} />
      </div>
      <span className="ep-meter__text">{label}</span>
    </div>
  );
}
