import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon } from '@/components/nav-icons';
import { ListBar, Pages } from '@/components/leave/ListBar';
import { apiFetch } from '@/lib/api';
import { LEAVE_STATUS, dmy, leaveDates, type LeaveApprovals } from '@/lib/leave';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;

/**
 * Leave waiting for me / decided by me (docs/design/85): leave and cancellations at my approval level,
 * the longest waiting first, and what I decided, newest first — the figures over each (they filter),
 * filters (the leave's dates, employee, department, leave type, leave or cancellation, search; waiting 3
 * days or more; what I decided), records per page, pages, and Excel / PDF of exactly what is filtered.
 */
export default async function LeaveApprovalsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'decided' ? 'decided' : 'waiting';
  const f = {
    from: sp.from && DAY.test(sp.from) ? sp.from : '',
    to: sp.to && DAY.test(sp.to) ? sp.to : '',
    employeeId: sp.employeeId && ID.test(sp.employeeId) ? sp.employeeId : '',
    leaveTypeId: sp.leaveTypeId && ID.test(sp.leaveTypeId) ? sp.leaveTypeId : '',
    department: sp.department?.slice(0, 100) ?? '',
    kind: sp.kind === 'leave' || sp.kind === 'cancellation' ? sp.kind : '',
    overdue: view === 'waiting' && sp.overdue === '1' ? '1' : '',
    outcome:
      view === 'decided' && (sp.outcome === 'approved' || sp.outcome === 'rejected')
        ? sp.outcome
        : '',
    q: sp.q?.slice(0, 80) ?? '',
  };
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const set = Object.entries(f).filter(([, v]) => v);
  const d = await apiFetch<LeaveApprovals>(
    `/leave/approvals?${new URLSearchParams([['view', view], ...set, ['size', size], ['page', String(page)]]).toString()}`,
  );
  /** this list with these filters (and changes: null or '' removes one) */
  const href = (o: Record<string, string | null> = {}) => {
    const p = new URLSearchParams(set);
    if (view === 'decided') p.set('view', 'decided');
    if (size !== '50') p.set('size', size);
    for (const [k, v] of Object.entries(o))
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    const s = p.toString();
    return `/leave/approvals${s ? `?${s}` : ''}`;
  };
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/list-file?${new URLSearchParams([['list', 'approvals'], ['format', format], ['view', view], ...set]).toString()}`;
  const days = (since: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
  type Card = { label: string; n: number; icon: string; to: Record<string, string | null> };
  const cards: Card[] =
    view === 'waiting'
      ? [
          {
            label: 'Waiting for me',
            n: d.figures.n,
            icon: 'clock',
            to: { overdue: null, kind: null },
          },
          { label: '3 days or more', n: d.figures.overdue, icon: 'xCircle', to: { overdue: '1' } },
          {
            label: 'Cancellations asked',
            n: d.figures.cancels,
            icon: 'ban',
            to: { kind: 'cancellation' },
          },
        ]
      : [
          {
            label: 'Decided by me',
            n: d.figures.n,
            icon: 'list',
            to: { outcome: null, kind: null },
          },
          {
            label: 'Approved',
            n: d.figures.approved,
            icon: 'checkCircle',
            to: { outcome: 'approved' },
          },
          {
            label: 'Not approved',
            n: d.figures.rejected,
            icon: 'xCircle',
            to: { outcome: 'rejected' },
          },
          {
            label: 'Cancellations',
            n: d.figures.cancels,
            icon: 'ban',
            to: { kind: 'cancellation' },
          },
        ];
  const on = (to: Record<string, string | null>) =>
    Object.entries(to).every(([k, v]) => (v ?? '') === (f[k as keyof typeof f] ?? ''));
  return (
    <>
      <Breadcrumbs items={[{ label: 'My leave', href: '/leave' }, { label: 'Waiting for me' }]} />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave waiting for me"
        description="Leave and cancellations of leave at your level, the longest waiting first; and what you decided. Open one to approve it, or say why it is not approved."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Which leave">
        <a
          className="ep-tabs__tab"
          href="/leave/approvals"
          aria-current={view === 'waiting' ? 'page' : undefined}
        >
          Waiting
        </a>
        <a
          className="ep-tabs__tab"
          href="/leave/approvals?view=decided"
          aria-current={view === 'decided' ? 'page' : undefined}
        >
          Decided by me
        </a>
      </nav>

      <ul className="ep-regkpis" aria-label="Figures (click one to list only those)">
        {cards.map((c) => (
          <li key={c.label}>
            <a
              className="ep-regkpi"
              href={href({ ...c.to, page: null })}
              aria-current={on(c.to) ? 'true' : undefined}
            >
              <span className="ep-regkpi__ic" aria-hidden="true">
                <Icon name={c.icon as 'clock'} size={18} />
              </span>
              <span>
                <span className="ep-regkpi__label">{c.label}</span>
                <span className="ep-regkpi__num">{c.n}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <form
        method="get"
        action="/leave/approvals"
        className="ep-card ep-pfilter"
        aria-label="Filter"
      >
        {view === 'decided' ? <input type="hidden" name="view" value="decided" /> : null}
        {size !== '50' ? <input type="hidden" name="size" value={size} /> : null}
        <div className="ep-pfilter__row">
          <label className="ep-field" htmlFor="la-q">
            <span className="ep-field__label">Search</span>
            <input
              id="la-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={f.q}
              maxLength={80}
              placeholder="Leave ID, name or code"
            />
          </label>
          <label className="ep-field" htmlFor="la-emp">
            <span className="ep-field__label">Employee</span>
            <select id="la-emp" name="employeeId" className="ep-select" defaultValue={f.employeeId}>
              <option value="">All employees</option>
              {d.lists.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="la-dept">
            <span className="ep-field__label">Department</span>
            <select
              id="la-dept"
              name="department"
              className="ep-select"
              defaultValue={f.department}
            >
              <option value="">All departments</option>
              {d.lists.departments.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="la-type">
            <span className="ep-field__label">Leave Type</span>
            <select
              id="la-type"
              name="leaveTypeId"
              className="ep-select"
              defaultValue={f.leaveTypeId}
            >
              <option value="">All types</option>
              {d.lists.types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="la-kind">
            <span className="ep-field__label">For</span>
            <select id="la-kind" name="kind" className="ep-select" defaultValue={f.kind}>
              <option value="">Leave and cancellations</option>
              <option value="leave">Leave</option>
              <option value="cancellation">Cancellation asked</option>
            </select>
          </label>
          {view === 'waiting' ? (
            <label className="ep-check" htmlFor="la-over" style={{ alignSelf: 'center' }}>
              <input
                id="la-over"
                type="checkbox"
                name="overdue"
                value="1"
                defaultChecked={!!f.overdue}
              />
              <span>Waiting 3 days or more</span>
            </label>
          ) : (
            <label className="ep-field" htmlFor="la-out">
              <span className="ep-field__label">I decided</span>
              <select id="la-out" name="outcome" className="ep-select" defaultValue={f.outcome}>
                <option value="">Approved or not</option>
                <option value="approved">Approved</option>
                <option value="rejected">Not approved</option>
              </select>
            </label>
          )}
          <label className="ep-field" htmlFor="la-from">
            <span className="ep-field__label">From Date</span>
            <input
              id="la-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={f.from}
            />
          </label>
          <label className="ep-field" htmlFor="la-to">
            <span className="ep-field__label">To Date</span>
            <input id="la-to" name="to" type="date" className="ep-input" defaultValue={f.to} />
          </label>
          <div className="ep-pfilter__go">
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Search
            </button>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={view === 'decided' ? '/leave/approvals?view=decided' : '/leave/approvals'}
            >
              Clear
            </a>
          </div>
        </div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          From – To: the leave touching those dates.
        </p>
      </form>

      <ListBar
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p > 1 ? String(p) : null })}
        sizeHref={(s) => href({ size: s === '50' ? null : s, page: null })}
        noun={view === 'waiting' ? 'waiting leave' : 'decided leave'}
        files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
      />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Leave">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Sr.No.</th>
              <th scope="col">Leave</th>
              <th scope="col">Employee</th>
              <th scope="col">Dates</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Days
              </th>
              <th scope="col">{view === 'waiting' ? 'Waiting' : 'I decided'}</th>
              {view === 'decided' ? <th scope="col">Now</th> : null}
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r, i) => (
                <tr key={`${r.id}-${r.what}`}>
                  <td>{(d.page - 1) * d.size + i + 1}</td>
                  <td>
                    <a href={`/leave/requests/${r.id}`}>{r.number}</a>
                    <span className="ep-mr-col__desc">
                      {r.what === 'cancellation' ? 'Cancellation asked · ' : ''}
                      {r.leaveType.name} ({r.leaveType.code})
                    </span>
                  </td>
                  <td>
                    {r.employee.name}
                    <span className="ep-mr-col__desc">
                      {r.employee.code}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                    </span>
                  </td>
                  <td>
                    {leaveDates(r)}
                    <span className="ep-mr-col__desc">{r.reason.slice(0, 80)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.days}</td>
                  {view === 'waiting' ? (
                    <td>
                      {days(r.since)} day{days(r.since) === 1 ? '' : 's'}
                      {days(r.since) >= 3 ? (
                        <span className="ep-mr-col__desc">
                          <Badge tone="danger">3 days or more</Badge>
                        </span>
                      ) : null}
                    </td>
                  ) : (
                    <>
                      <td>
                        <Badge tone={r.decided === 'approved' ? 'success' : 'danger'}>
                          {r.decided === 'approved' ? 'Approved' : 'Not approved'}
                        </Badge>
                        <span className="ep-mr-col__desc">on {dmy(r.since.slice(0, 10))}</span>
                      </td>
                      <td>
                        <Badge tone={LEAVE_STATUS[r.status].tone}>
                          {LEAVE_STATUS[r.status].label}
                        </Badge>
                      </td>
                    </>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={view === 'waiting' ? 6 : 7}>
                  {set.length
                    ? 'Nothing in these filters.'
                    : view === 'waiting'
                      ? 'Nothing waits for you.'
                      : 'You have not decided any leave yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pages
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p > 1 ? String(p) : null })}
        noun={view === 'waiting' ? 'waiting leave' : 'decided leave'}
      />
    </>
  );
}
