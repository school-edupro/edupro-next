'use client';
import { Badge, Card } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadTickets } from '@/lib/feed-actions';

type Status = 'open' | 'in_progress' | 'answered' | 'closed';
export interface Ticket {
  id: string;
  raisedByUserId: string;
  number: string;
  desk: 'parent' | 'staff' | 'provider' | 'hostel';
  head: string;
  studentName: string | null;
  section: string | null;
  raisedBy: string | null;
  subject: string;
  status: Status;
  level: number;
  dueAt: string | null;
  overdue: boolean;
  assignedTo: string | null;
  assignedRoleName: string | null;
  openedAt: string;
}
const TONE: Record<Status, 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  in_progress: 'info',
  answered: 'success',
  closed: 'neutral',
};

/** The words of a ticket card, in the person's language (made on the server). */
export interface TicketWords {
  desk: Record<Ticket['desk'], string>;
  status: Record<Status, string>;
  level: string;
  pastDue: string;
  with: string;
}

/** Queries to answer or my requests, the latest 10 first; 10 more load as I scroll down. */
export function TicketFeed({
  first,
  more: firstMore,
  tab,
  closed,
  words,
  foot,
}: {
  first: Ticket[];
  more: boolean;
  tab: 'answer' | 'mine';
  closed: boolean;
  words: TicketWords;
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
    void loadTickets(page + 1, tab, closed).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as Ticket[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, tab, closed]);
  return (
    <>
      {items.map((q) => (
        <a key={q.id} href={`/queries/t/${q.id}`} style={{ textDecoration: 'none' }}>
          <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="ep-hdt__title">{q.subject}</div>
                <div className="ep-kicker">
                  {q.number} · {words.desk[q.desk]} · {q.head}
                  {q.studentName ? ` · ${q.studentName}${q.section ? ` (${q.section})` : ''}` : ''}
                  {tab === 'answer' && q.raisedBy ? ` · ${q.raisedBy}` : ''}
                  {tab === 'mine'
                    ? ` · ${words.with} ${q.assignedTo ?? q.assignedRoleName ?? '—'}`
                    : ''}
                </div>
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  gap: 'var(--sp-1)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {q.level > 1 ? (
                  <Badge tone="danger">
                    {words.level} {q.level}
                  </Badge>
                ) : null}
                {q.overdue ? <Badge tone="danger">{words.pastDue}</Badge> : null}
                <Badge tone={TONE[q.status]}>{words.status[q.status]}</Badge>
              </span>
            </div>
          </Card>
        </a>
      ))}
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
