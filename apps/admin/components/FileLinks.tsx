/**
 * A stored file or export: the main link opens it in a new tab (PDFs and images show in the browser),
 * Download saves a copy. `href` is an admin route that accepts `?save=1`.
 */
export function FileLinks({ href, label }: { href: string; label: string }) {
  const save = `${href}${href.includes('?') ? '&' : '?'}save=1`;
  return (
    <span className="ep-filelinks">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
      <a href={save} className="ep-filelinks__save" aria-label={`Download ${label}`}>
        Download
      </a>
    </span>
  );
}
