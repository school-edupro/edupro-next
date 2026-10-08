import { Button } from '@edupro/ui';

/**
 * The same four tools on every fee set-up grid: Excel (the file that is also uploaded), PDF, upload of
 * the corrected Excel, and (through `children`) clone to other classes.
 */
export function GridTools({
  fileHref,
  allHref,
  allLabel,
  sample = true,
  upload,
  hidden,
  canManage,
}: {
  /** Address of the Excel file; `&format=pdf` gives the PDF. */
  fileHref: string;
  /** Address of the whole list (every class, or every discount type); `&format=pdf` gives the PDF. */
  allHref?: string;
  allLabel?: string;
  /** The sample format: the same sheet without values. Left out where the Excel itself is the format. */
  sample?: boolean;
  upload: (fd: FormData) => Promise<void>;
  hidden: Array<[name: string, value: string]>;
  canManage: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--sp-3)',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        margin: 'var(--sp-3) 0',
      }}
    >
      <a className="ep-btn ep-btn--ghost ep-btn--sm" href={fileHref}>
        This grid: Excel
      </a>
      <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${fileHref}&format=pdf`}>
        This grid: PDF
      </a>
      {allHref ? (
        <>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={allHref}>
            {allLabel}: Excel
          </a>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${allHref}&format=pdf`}>
            {allLabel}: PDF
          </a>
        </>
      ) : null}
      {sample ? (
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${fileHref}&blank=1`}>
          Download sample format (Excel)
        </a>
      ) : null}
      {canManage ? (
        <form
          action={upload}
          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
        >
          {hidden.map(([n, v]) => (
            <input key={n} type="hidden" name={n} value={v} />
          ))}
          <label className="ep-field">
            <span className="ep-field__label">Upload the filled Excel</span>
            <input className="ep-input" type="file" name="file" accept=".xlsx" required />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Upload Excel
          </Button>
        </form>
      ) : null}
    </div>
  );
}
