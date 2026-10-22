import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { LibraryScopeNote } from '@/components/library/LibraryScopeNote';
import { apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/library-books';
import { cancelReservation } from '@/lib/library-reservations-actions';

type Status = 'open' | 'ready' | 'waiting' | 'ended';
type Row = {
  id: string;
  status: string;
  borrowerKind: string;
  borrower: string;
  ref: string;
  placedOn: string;
  readyUntil: string | null;
  endReason: string | null;
  endedOn: string | null;
  endedBy: string | null;
  titleId: string;
  title: string;
  author: string | null;
  accessionNo: string | null;
  library: string | null;
  place: number | null;
};
type List = { status: Status; counts: { waiting: number; ready: number }; rows: Row[] };

const TABS: Array<[Status, string]> = [
  ['open', 'Open'],
  ['ready', 'Kept for collection'],
  ['waiting', 'Waiting'],
  ['ended', 'Ended (60 days)'],
];
const ENDED = {
  collected: ['Collected', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  lapsed: ['Not collected', 'warning'],
} as const;

/**
 * Reservations (docs/design/36-library.md, "Library round 3", part 4): pupils and staff reserve a book
 * in the portal when every copy is out; a copy that comes back is kept for the first in line for the
 * hold days (the desk says so on return) and goes to the next if not collected. The library sees the
 * copies to keep aside, the queue, and the ended ones, and may cancel one with a reason.
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.loan.circulate')) notFound();
  const status: Status = TABS.some(([v]) => v === sp.status) ? (sp.status as Status) : 'open';
  const search = (sp.q ?? '').trim().slice(0, 80);
  const qs = (x: Record<string, string>) => new URLSearchParams(x).toString();
  const list = await apiFetch<List>(
    `/library/reservations?${qs({ status, ...(search ? { q: search } : {}) })}`,
  );
  const here = `/library/reservations?${qs({ ...(status !== 'open' ? { status } : {}), ...(search ? { q: search } : {}) })}`;
  const count = (v: Status) =>
    v === 'open'
      ? list.counts.ready + list.counts.waiting
      : v === 'ready'
        ? list.counts.ready
        : v === 'waiting'
          ? list.counts.waiting
          : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Circulation', href: '/library/circulation' },
          { label: 'Reservations' },
        ]}
      />
      <PageHeader
        kicker="Library"
        title="Reservations"
        description="Books reserved in the portals when every copy is out. A copy that comes back is kept for the first in line; keep it aside until the day shown. Issue it to them at the desk and the reservation is collected."
      />
      <Notice params={sp} />
      <LibraryScopeNote />
      <section className="ep-card" aria-labelledby="lr-h">
        <nav
          className="ep-tabs"
          aria-label="Reservations by state"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <div className="ep-tabs__list">
            {TABS.map(([v, label]) => {
              const n = count(v);
              return (
                <a
                  key={v}
                  className="ep-tabs__tab"
                  href={`/library/reservations?${qs({ ...(v !== 'open' ? { status: v } : {}), ...(search ? { q: search } : {}) })}`}
                  aria-current={status === v ? 'page' : undefined}
                >
                  {label}
                  {n === null ? '' : ` · ${String(n)}`}
                </a>
              );
            })}
          </div>
        </nav>
        <form method="get" className="ep-dlog__filters" role="search">
          {status !== 'open' ? <input type="hidden" name="status" value={status} /> : null}
          <label className="ep-field ep-dlog__search" htmlFor="lr-q" style={{ margin: 0 }}>
            <span className="ep-field__label">Book or borrower</span>
            <input
              id="lr-q"
              name="q"
              className="ep-input"
              defaultValue={search}
              placeholder="Title, name, admission no. or staff code"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Search
          </button>
          {search ? (
            <a
              className="ep-btn ep-btn--ghost"
              href={`/library/reservations${status !== 'open' ? `?status=${status}` : ''}`}
            >
              Clear
            </a>
          ) : null}
        </form>
        <h2 id="lr-h" className="ep-card__title" style={{ marginTop: 'var(--sp-3)' }}>
          {TABS.find(([v]) => v === status)![1]} · {list.rows.length}
        </h2>
        {list.rows.length === 0 ? (
          <p className="ep-field__help">
            {status === 'ended' ? 'None ended in the last 60 days.' : 'No reservation here.'}
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Reservations (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">Reserved by</th>
                  <th scope="col">Placed on</th>
                  <th scope="col">State</th>
                  {status === 'ended' ? null : <th scope="col">Action</th>}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((x) => {
                  const open = x.status === 'waiting' || x.status === 'ready';
                  const ended = ENDED[x.status as keyof typeof ENDED];
                  return (
                    <tr key={x.id}>
                      <td>
                        <a href={`/library/books/${x.titleId}`}>{x.title}</a>
                        {x.author ? <div className="ep-field__help">{x.author}</div> : null}
                      </td>
                      <td>
                        {x.borrower}
                        <div className="ep-field__help">
                          {x.borrowerKind === 'student' ? 'Pupil' : 'Staff'} · {x.ref}
                        </div>
                      </td>
                      <td>{dmy(x.placedOn)}</td>
                      <td>
                        {x.status === 'ready' ? (
                          <>
                            <Badge tone="warning">Keep aside</Badge>
                            <div className="ep-field__help">
                              {x.accessionNo}
                              {x.library ? ` at ${x.library}` : ''} · until {dmy(x.readyUntil)}
                            </div>
                          </>
                        ) : x.status === 'waiting' ? (
                          <>
                            <Badge tone="info">Waiting</Badge>
                            <div className="ep-field__help">No. {x.place ?? '–'} in line</div>
                          </>
                        ) : ended ? (
                          <>
                            <Badge tone={ended[1]}>{ended[0]}</Badge>
                            <div className="ep-field__help">
                              {dmy(x.endedOn)}
                              {x.endReason ? ` · ${x.endReason}` : ''}
                              {x.endedBy && x.status === 'cancelled' ? ` · ${x.endedBy}` : ''}
                            </div>
                          </>
                        ) : (
                          x.status
                        )}
                      </td>
                      {status === 'ended' ? null : (
                        <td>
                          {open ? (
                            <ConfirmAction
                              action={cancelReservation}
                              fields={{ id: x.id, back: here }}
                              label="Cancel"
                              title={`Cancel ${x.borrower}’s reservation of ${x.title}?`}
                              confirmLabel="Cancel the reservation"
                              confirmVariant="danger"
                              reason={{ label: 'Reason (they see it in the portal)' }}
                            >
                              {x.status === 'ready'
                                ? `${x.accessionNo ?? 'The copy'} kept for them goes to the next in line, or back to the shelf.`
                                : 'They leave the queue.'}
                            </ConfirmAction>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
