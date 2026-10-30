/**
 * Excel and PDF of a registry list (packages/db masters), made at once. A screen that owns a list (exam
 * set-up) offers its export here instead of sending people to the general grid.
 */
export function MasterExport({ master, label }: { master: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={`/api/masters/${master}/export?format=xlsx`}
        download
        aria-label={`${label}: Excel`}
      >
        Excel
      </a>
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={`/api/masters/${master}/export?format=pdf`}
        download
        aria-label={`${label}: PDF`}
      >
        PDF
      </a>
    </span>
  );
}
