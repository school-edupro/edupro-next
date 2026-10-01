/**
 * A ready PDF on the portal: the main link opens it in a new tab, Download saves a copy (the signed
 * `saveUrl` from the API; older responses without it fall back to the same link).
 */
export function FileLinks({
  url,
  saveUrl,
  label,
  saveLabel = 'Download',
}: {
  url: string;
  saveUrl?: string | null;
  label: string;
  saveLabel?: string;
}) {
  return (
    <span className="ep-filelinks">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
      <a href={saveUrl ?? url} className="ep-filelinks__save" download>
        {saveLabel}
      </a>
    </span>
  );
}
