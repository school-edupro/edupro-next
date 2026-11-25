'use client';
import { Badge, Card } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadStudentLeaves } from '@/lib/feed-actions';

export interface StudentLeave {
  id: string;
  number: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  leaveTypeLabel: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  long: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  appliedBy: string | null;
  waitingOn: string | null;
  decisionNote: string | null;
}
const TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
export const leaveDays = (l: Pick<StudentLeave, 'fromDate' | 'toDate' | 'days'>) =>
  l.fromDate === l.toDate
    ? `${day(l.fromDate)} · 1 day`
    : `${day(l.fromDate)} to ${day(l.toDate)} · ${String(l.days)} days`;

/** Student leave to approve, or all that came to me: the latest 10 first; 10 more load as I scroll down. */
export function StudentLeaveFeed({
  first,
  more: firstMore,
  tab,
  foot,
}: {
  first: StudentLeave[];
  more: boolean;
  tab: 'inbox' | 'all';
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
    void loadStudentLeaves(page + 1, tab).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as StudentLeave[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, tab]);
  return (
    <>
      {items.map((l) => (
        <Card key={l.id} style={{ marginBottom: 'var(--sp-2)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div>
              <strong>{l.student}</strong>{' '}
              <span className="ep-kicker">{[l.section, l.number].filter(Boolean).join(' · ')}</span>
              <div>
                {l.leaveTypeLabel} · {leaveDays(l)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <Badge tone={TONE[l.status] ?? 'neutral'}>
                {l.status === 'pending' && l.waitingOn ? `Waiting: ${l.waitingOn}` : l.status}
              </Badge>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/leaves?tab=${tab}&open=${l.id}`}
                aria-label={`Open ${l.number} of ${l.student}`}
              >
                Open
              </a>
            </div>
          </div>
        </Card>
      ))}
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
