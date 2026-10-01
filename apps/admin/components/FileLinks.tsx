/**
 * A stored file or export as two icons: View opens it in a new tab (PDFs and images show in the
 * browser) and Download saves a copy. No file name is shown; `label` names the file for screen readers
 * and the tooltip. `href` is an admin route that accepts `?save=1`.
 */
export function FileLinks({ href, label }: { href: string; label: string }) {
  const save = `${href}${href.includes('?') ? '&' : '?'}save=1`;
  return (
    <span className="ep-filelinks">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="ep-filelinks__btn"
        aria-label={`View ${label}`}
        title={`View ${label}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      </a>
      <a
        href={save}
        className="ep-filelinks__btn"
        aria-label={`Download ${label}`}
        title={`Download ${label}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </span>
  );
}
