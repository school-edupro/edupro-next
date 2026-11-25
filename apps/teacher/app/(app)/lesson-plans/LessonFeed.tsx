'use client';
import { LESSON_HEAD, LessonRow, type LessonListRow } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadLessons } from '@/lib/feed-actions';

const detailHref = (id: string) => `/lesson-plans/${id}`;

/** The lesson report's lessons, as the admin's table: the latest 10 first; 10 more rows load as I scroll down. */
export function LessonFeed({
  first,
  more: firstMore,
  filters,
  foot,
}: {
  first: LessonListRow[];
  more: boolean;
  /** the report's filters, as the next pages ask for them too */
  filters: Record<string, string>;
  foot: { more: string; loading: string; failed: string; end: string };
}) {
  const [items, setItems] = useState(first);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(firstMore);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const next = useCallback(() => {
    if (busy || !more) return;
    setBusy(true);
    setFailed(false);
    void loadLessons(page + 1, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as LessonListRow[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, filters]);
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Lessons">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Lessons uploaded for approval</caption>
          <thead>
            <tr>
              {LESSON_HEAD.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <LessonRow key={r.id} r={r} n={i + 1} detailHref={detailHref} />
            ))}
          </tbody>
        </table>
      </div>
      <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
    </>
  );
}
