/** Records a page on long lists (stores of thousands of items, the asset register). */
export const PAGE_SIZES = ['25', '50', '100'] as const;

/** The page size asked for, else 50. */
export const pageSizeOf = (v: string | undefined) =>
  PAGE_SIZES.includes(v as (typeof PAGE_SIZES)[number]) ? v! : '50';

/** Page n of m, with First / Previous / Next / Last keeping the filters (`href` builds each link). */
export function Pager({
  page,
  size,
  total,
  href,
  noun,
}: {
  page: number;
  size: number;
  total: number;
  href: (page: number) => string;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = total.toLocaleString('en-IN');
  if (total <= size)
    return (
      <p className="ep-field__help">
        {n} {noun}
      </p>
    );
  return (
    <nav aria-label={`Pages of ${noun}`} className="ep-field__help">
      {n} {noun} · page {page} of {pages} · {page > 1 ? <a href={href(1)}>First</a> : null}{' '}
      {page > 1 ? <a href={href(page - 1)}>Previous</a> : null}{' '}
      {page < pages ? <a href={href(page + 1)}>Next</a> : null}{' '}
      {page < pages ? <a href={href(pages)}>Last</a> : null}
    </nav>
  );
}

/** Records per page: 25, 50 or 100 (a select named `size` inside the filter form). */
export function PerPage({ id, value }: { id: string; value: string }) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">Per page</span>
      <select id={id} name="size" className="ep-select" defaultValue={value}>
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
