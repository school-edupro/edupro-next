'use client';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** The next page as the server drew it, and whether more come. */
export type FeedPage = { ok: true; node: ReactNode; more: boolean } | { ok: false };

/** Where the pages go: rows in a table's body (its caption and heads), or items in a list; else one after another. */
export type FeedWrap =
  | { kind: 'table'; caption: string; label: string; head: string[] }
  | { kind: 'list'; className: string };

/**
 * A list that loads as it scrolls: the first page as the page drew it, then the next one (drawn on the server, the
 * same cards) each time the foot comes into view; a Show more button does the same for a keyboard or a screen
 * reader, and the foot says when everything is shown.
 */
export function MoreFeed({
  first,
  more: firstMore,
  load,
  labels,
  wrap,
}: {
  first: ReactNode;
  more: boolean;
  /** the next page (2, 3, …): a server action bound to the list's filters */
  load: (page: number) => Promise<FeedPage>;
  labels: { more: string; loading: string; failed: string; end: string };
  wrap?: FeedWrap;
}) {
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [more, setMore] = useState(firstMore);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const next = useCallback(() => {
    if (busy || !more) return;
    setBusy(true);
    setFailed(false);
    void load(pages.length + 2).then(
      (r) => {
        setBusy(false);
        if (!r.ok) return setFailed(true);
        setPages((p) => [...p, r.node]);
        setMore(r.more);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  }, [busy, more, load, pages.length]);
  useEffect(() => {
    const el = foot.current;
    if (!el || !more || busy || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) next();
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, busy, failed, next]);
  const body = (
    <>
      {first}
      {pages.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
  return (
    <>
      {wrap?.kind === 'table' ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={wrap.label}>
          <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
            <caption className="ep-sr-only">{wrap.caption}</caption>
            <thead>
              <tr>
                {wrap.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      ) : wrap?.kind === 'list' ? (
        <ul className={wrap.className}>{body}</ul>
      ) : (
        body
      )}
      <div ref={foot} className="fp-msg__pager" aria-live="polite">
        {busy ? (
          <span className="ep-field__help">{labels.loading}</span>
        ) : failed ? (
          <>
            <span className="ep-field__help">{labels.failed}</span>{' '}
            <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={next}>
              {labels.more}
            </button>
          </>
        ) : more ? (
          <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={next}>
            {labels.more}
          </button>
        ) : (
          <span className="ep-field__help">{labels.end}</span>
        )}
      </div>
    </>
  );
}
