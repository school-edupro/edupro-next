'use client';
import { Badge, Card } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { ackNotice, loadNotices } from '@/lib/feed-actions';
import { MoreOnScroll } from '@/components/MoreOnScroll';

export interface NoticeView {
  id: string;
  kind: 'notice' | 'circular' | 'office_order';
  title: string;
  body: string;
  bodyFormat: 'text' | 'html';
  publishFrom: string;
  publishedBy: string | null;
  isPinned: boolean;
  ackRequired: boolean;
  ackedByMe: boolean;
  files: Array<{ id: string; name: string | null }>;
}

const day = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The notices, circulars and office orders for me, as the office orders' cards: pinned first, the latest 10, then 10
 * more as I scroll; the text, the attachments and, when the school asks, Acknowledge (it updates in place).
 */
export function NoticeFeed({
  first,
  more: firstMore,
  kind,
  words,
  foot,
}: {
  first: NoticeView[];
  more: boolean;
  /** office orders only (Office orders' first tab); none: every notice for me */
  kind?: 'office_order';
  words: {
    kinds: Record<string, string>;
    pinned: string;
    attachments: string;
    acknowledge: string;
    acknowledged: string;
    failed: string;
  };
  foot: { more: string; loading: string; failed: string; end: string };
}) {
  const [items, setItems] = useState(first);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(firstMore);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const next = useCallback(() => {
    if (busy || !more) return;
    setBusy(true);
    setFailed(false);
    void loadNotices(page + 1, kind).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as NoticeView[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, kind]);
  const ack = (id: string) => {
    setAcking(id);
    setAckError(null);
    void ackNotice(id).then((r) => {
      setAcking(null);
      if (!r.ok) return setAckError(id);
      setItems(items.map((x) => (x.id === id ? { ...x, ackedByMe: true } : x)));
    });
  };
  return (
    <>
      {items.map((n) => (
        <Card
          key={n.id}
          title={n.title}
          style={{ marginBottom: 'var(--sp-3)' }}
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
              {n.isPinned ? <Badge tone="warning">{words.pinned}</Badge> : null}
              <Badge tone={n.kind === 'office_order' ? 'info' : 'neutral'}>
                {words.kinds[n.kind] ?? n.kind}
              </Badge>
            </span>
          }
        >
          <p className="ep-kicker" style={{ marginTop: 0 }}>
            {day(n.publishFrom)}
            {n.publishedBy ? ` · ${n.publishedBy}` : ''}
          </p>
          {n.bodyFormat === 'html' ? (
            <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: n.body }} />
          ) : (
            <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
          )}
          {n.files.length ? (
            <p>
              <span className="ep-kicker">{words.attachments}</span>{' '}
              {n.files.map((f, i) => (
                <FileLinks
                  key={f.id}
                  url={`/api/doc-file/notice/${n.id}/${f.id}`}
                  saveUrl={`/api/doc-file/notice/${n.id}/${f.id}?save=1`}
                  label={`${words.attachments} ${String(i + 1)} · ${n.title}`}
                />
              ))}
            </p>
          ) : null}
          {n.ackRequired ? (
            n.ackedByMe ? (
              <Badge tone="success">{words.acknowledged}</Badge>
            ) : (
              <>
                <button
                  type="button"
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  disabled={acking === n.id}
                  onClick={() => ack(n.id)}
                >
                  {words.acknowledge}
                </button>
                {ackError === n.id ? (
                  <span
                    className="ep-field__error"
                    role="alert"
                    style={{ marginLeft: 'var(--sp-2)' }}
                  >
                    {words.failed}
                  </span>
                ) : null}
              </>
            )
          ) : null}
        </Card>
      ))}
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
