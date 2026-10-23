const ICON = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  down: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
};
const Svg = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A file as two icons: View opens it in the browser, Download saves it (`?save=1`); no file names. */
export function ViewDownload({ href, what }: { href: string; what: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
      <a
        className="ep-btn ep-btn--ghost ep-btn--sm"
        href={href}
        target="_blank"
        rel="noopener"
        aria-label={`View ${what}`}
        title="View"
      >
        <Svg d={ICON.eye} />
      </a>
      <a
        className="ep-btn ep-btn--ghost ep-btn--sm"
        href={`${href}?save=1`}
        aria-label={`Download ${what}`}
        title="Download"
      >
        <Svg d={ICON.down} />
      </a>
    </span>
  );
}
