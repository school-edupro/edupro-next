import { PAGE_SIZES } from '@/components/Pager';

/**
 * Over a My leave list, as the old screens: Records per page (25 / 50 / 100, a link each so it changes at
 * once), "Showing 1 – 50 of 584 results", the Excel and PDF of everything the filters match, and the pages.
 */
export function ListBar({
  page,
  size,
  total,
  href,
  sizeHref,
  noun,
  files,
}: {
  page: number;
  size: number;
  total: number;
  /** a page of the list, filters kept */
  href: (page: number) => string;
  /** page 1 at another size, filters kept */
  sizeHref: (size: string) => string;
  /** what the rows are, for screen readers: leave applications, days, staff */
  noun: string;
  files?: { xlsx: string; pdf: string } | null;
}) {
  const first = total ? (page - 1) * size + 1 : 0;
  const last = Math.min(total, page * size);
  const n = (x: number) => x.toLocaleString('en-IN');
  const id = `${noun.replace(/\W+/g, '-')}-size`;
  return (
    <>
      <div className="ep-listbar">
        <div className="ep-listbar__sizes">
          <span id={id}>Records per page:</span>
          <ul className="ep-pages" aria-labelledby={id} style={{ margin: 0 }}>
            {PAGE_SIZES.map((s) => (
              <li key={s}>
                <a
                  href={sizeHref(s)}
                  aria-current={String(size) === s ? 'true' : undefined}
                  aria-label={`${s} ${noun} a page`}
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="ep-listbar__end">
          <p className="ep-listbar__count" aria-live="polite">
            Showing {n(first)} – {n(last)} of {n(total)} results
          </p>
          {files && total ? (
            <>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={files.xlsx} download>
                Excel
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={files.pdf} download>
                PDF
              </a>
            </>
          ) : null}
        </div>
      </div>
      <Pages page={page} size={size} total={total} href={href} noun={noun} />
    </>
  );
}

/** Previous 1 2 3 … 12 Next: the first, the last, and the pages around this one. */
export function Pages({
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
  if (pages <= 1) return null;
  const show = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...show].sort((a, b) => a - b);
  const items: Array<number | 'gap'> = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1]! > 1) items.push('gap');
    items.push(p);
  });
  return (
    <nav aria-label={`Pages of ${noun}`}>
      <ul className="ep-pages">
        {page > 1 ? (
          <li>
            <a href={href(page - 1)}>Previous</a>
          </li>
        ) : null}
        {items.map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${String(i)}`}>
              <span aria-hidden="true">…</span>
            </li>
          ) : (
            <li key={p}>
              <a
                href={href(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${String(p)}`}
              >
                {p}
              </a>
            </li>
          ),
        )}
        {page < pages ? (
          <li>
            <a href={href(page + 1)}>Next</a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
