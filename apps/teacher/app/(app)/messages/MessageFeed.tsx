'use client';
import { useCallback, useState } from 'react';
import { loadInbox } from '@/lib/feed-actions';
import { MessageItem, type InboxItem } from './MessageItem';
import { MoreOnScroll } from '@/components/MoreOnScroll';

/** My messages, the latest 10 first; 10 more load as I scroll down. */
export function MessageFeed({
  first,
  more: firstMore,
  labels,
  foot,
}: {
  first: InboxItem[];
  more: boolean;
  labels: { unread: string; open: string; attachment: string; status: Record<string, string> };
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
    void loadInbox(page + 1).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as InboxItem[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items]);
  return (
    <>
      <div className="fp-msg__list">
        {items.map((m) => (
          <MessageItem key={m.id} item={m} labels={labels} />
        ))}
      </div>
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
