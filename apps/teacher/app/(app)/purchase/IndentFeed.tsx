'use client';
import { Badge } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadIndents } from '@/lib/feed-actions';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  inr,
  type IndentRoute,
  type IndentRow,
  type IndentStatus,
} from '@/lib/purchase';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '—';

/** The table's words, in the person's language (made on the server). */
export interface IndentWords {
  caption: string;
  indent: string;
  department: string;
  raisedBy: string;
  neededBy: string;
  estimate: string;
  status: string;
  statusLabel: Record<IndentStatus, string>;
  routeLabel: Record<IndentRoute, string>;
  draft: string;
  urgent: string;
  line: string;
  lines: string;
  for: string;
  with: string;
  partClosed: string;
  started: string;
  empty: string;
}

/** The indents of a tab, the latest 10 first (urgent ones on top); 10 more rows load as I scroll down. */
export function IndentFeed({
  first,
  more: firstMore,
  filters,
  rates,
  words,
  foot,
}: {
  first: IndentRow[];
  more: boolean;
  filters: Record<string, string>;
  /** the estimate shows to those who see rates */
  rates: boolean;
  words: IndentWords;
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
    void loadIndents(page + 1, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as IndentRow[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, filters]);
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={words.caption}>
        <table className="ep-table">
          <caption className="ep-sr-only">{words.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{words.indent}</th>
              <th scope="col">{words.department}</th>
              <th scope="col">{words.raisedBy}</th>
              <th scope="col">{words.neededBy}</th>
              {rates ? (
                <th scope="col" style={{ textAlign: 'right' }}>
                  {words.estimate}
                </th>
              ) : null}
              <th scope="col">{words.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/${x.id}`}>{x.number ?? words.draft}</a>
                    {x.priority === 'urgent' ? (
                      <>
                        {' '}
                        <Badge tone="danger">{words.urgent}</Badge>
                      </>
                    ) : null}
                    <span className="ep-mr-col__desc">
                      {x.purpose.length > 80 ? `${x.purpose.slice(0, 80)}…` : x.purpose} · {x.lines}{' '}
                      {x.lines === 1 ? words.line : words.lines}
                    </span>
                  </td>
                  <td>{x.department}</td>
                  <td>
                    {x.raisedBy}
                    {x.onBehalf ? (
                      <span className="ep-mr-col__desc">
                        {words.for} {x.onBehalf}
                      </span>
                    ) : null}
                  </td>
                  <td>{x.requiredBy ? when(`${x.requiredBy}T00:00:00+05:30`) : '—'}</td>
                  {rates ? (
                    <td style={{ textAlign: 'right' }}>
                      {x.estimate === null ? '—' : inr(x.estimate)}
                    </td>
                  ) : null}
                  <td>
                    <Badge tone={INDENT_STATUS[x.status].tone}>{words.statusLabel[x.status]}</Badge>
                    <span className="ep-mr-col__desc">
                      {x.status === 'submitted' && x.waitingWith
                        ? `${words.with} ${x.waitingWith}`
                        : x.status === 'approved' && x.route
                          ? `${words.routeLabel[x.route] ?? INDENT_ROUTE[x.route]}${x.partClosed ? ` · ${words.partClosed}` : ''}`
                          : x.decidedAt
                            ? when(x.decidedAt)
                            : x.submittedAt
                              ? when(x.submittedAt)
                              : `${words.started} ${when(x.createdAt)}`}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={rates ? 6 : 5}>{words.empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
