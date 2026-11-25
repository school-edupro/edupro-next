'use client';
import { WorkReport, type WorkReportItem } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadWork } from '@/lib/feed-actions';

const fileLinks = (workId: string, fileId: string, n: number) => (
  <FileLinks
    url={`/api/doc-file/work/${workId}/${fileId}`}
    saveUrl={`/api/doc-file/work/${workId}/${fileId}?save=1`}
    label={`Attachment ${String(n)}`}
  />
);

/**
 * What was posted, one list by date: the latest 10 posts first, 10 more as I scroll down; a row a day, class and
 * subject (homework, classwork and assignments side by side, or the kind Show picked).
 */
export function WorkReportFeed({
  first,
  more: firstMore,
  filters,
  mode,
  foot,
}: {
  first: WorkReportItem[];
  more: boolean;
  /** the report's filters (from, to, class, Show), as the next pages ask for them too */
  filters: Record<string, string>;
  mode: 'all' | 'daily' | 'assignment';
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
    void loadWork(page + 1, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as WorkReportItem[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, filters]);
  return (
    <>
      <WorkReport
        items={items}
        mode={mode}
        fileLinks={fileLinks}
        extra={(w) =>
          w.ackRequired ? (
            <a href={`/acknowledgements?type=daily_work&id=${w.id}`}>· {w.ackCount} acknowledged</a>
          ) : null
        }
      />
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
