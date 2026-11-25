'use client';
import {
  MY_LEAVE_HEAD,
  MyLeaveRow,
  TEAM_LEAVE_HEAD,
  TeamLeaveRow,
  type LeaveAct,
  type LeavePaths,
} from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadStaffLeave } from '@/lib/feed-actions';
import type { MyLeave, TeamLeave } from '@/lib/leave';

/** where the staff website's leave links go (as the page's own paths) */
const PATHS: LeavePaths = {
  base: '/my-leave',
  request: (id) => `/my-leave/${id}`,
  day: (emp, day) => `/my-team/${emp}?month=${day.slice(0, 7)}`,
};

type Row = MyLeave['rows'][number] | TeamLeave['rows'][number];

/**
 * My leave, or my reporties' leave, as the admin's table (the same rows and actions): the latest 10 first, 10 more
 * rows load as I scroll down. The filters are the page's; changing them starts again from the newest.
 */
export function LeaveFeed({
  which,
  first,
  more: firstMore,
  filters,
  back,
  empty,
  actions,
  foot,
}: {
  which: 'mine' | 'team';
  first: Row[];
  more: boolean;
  /** the tab's filters, as the next pages ask for them too */
  filters: Record<string, string>;
  /** where an action comes back to */
  back: string;
  empty: string;
  actions: { withdraw: LeaveAct; askCancel: LeaveAct; decide: LeaveAct; decideCancel: LeaveAct };
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
    void loadStaffLeave(page + 1, which, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as Row[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, which, filters]);
  const head = which === 'mine' ? MY_LEAVE_HEAD : TEAM_LEAVE_HEAD;
  return (
    <>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={which === 'mine' ? 'My leave list' : 'Reporties leave list'}
      >
        <table className="ep-table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((r, i) =>
                which === 'mine' ? (
                  <MyLeaveRow
                    key={r.id}
                    r={r as MyLeave['rows'][number]}
                    n={i + 1}
                    back={back}
                    paths={PATHS}
                    actions={actions}
                  />
                ) : (
                  <TeamLeaveRow
                    key={r.id}
                    r={r as TeamLeave['rows'][number]}
                    n={i + 1}
                    back={back}
                    paths={PATHS}
                    actions={actions}
                  />
                ),
              )
            ) : (
              <tr>
                <td colSpan={head.length}>{empty}</td>
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
