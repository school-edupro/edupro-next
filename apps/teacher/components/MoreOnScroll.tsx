'use client';
import { useEffect, useRef } from 'react';

/**
 * The foot of a list that loads as it scrolls: when it comes into view the next page loads by itself; the button
 * does the same for a keyboard or a screen reader, and says when everything is shown.
 */
export function MoreOnScroll({
  more,
  busy,
  failed,
  onMore,
  labels,
}: {
  more: boolean;
  busy: boolean;
  failed: boolean;
  onMore: () => void;
  labels: { more: string; loading: string; failed: string; end: string };
}) {
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = foot.current;
    if (!el || !more || busy || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onMore();
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, busy, failed, onMore]);
  return (
    <div ref={foot} className="fp-msg__pager" aria-live="polite">
      {busy ? (
        <span className="ep-field__help">{labels.loading}</span>
      ) : failed ? (
        <>
          <span className="ep-field__help">{labels.failed}</span>{' '}
          <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={onMore}>
            {labels.more}
          </button>
        </>
      ) : more ? (
        <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={onMore}>
          {labels.more}
        </button>
      ) : (
        <span className="ep-field__help">{labels.end}</span>
      )}
    </div>
  );
}
