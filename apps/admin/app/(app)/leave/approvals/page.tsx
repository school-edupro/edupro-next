import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { LEAVE_STATUS, dmy, leaveDates, type LeaveRequest } from '@/lib/leave';

type Row = LeaveRequest & { what: 'leave' | 'cancellation'; since: string };

/** Leave waiting for my decision (docs/design/85): leave and cancellations at my level, oldest first. */
export default async function LeaveApprovalsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'decided' ? 'decided' : 'waiting';
  const d = await apiFetch<{ rows: Row[] }>(`/leave/approvals?view=${view}`);
  const days = (since: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
  return (
    <>
      <Breadcrumbs items={[{ label: 'My leave', href: '/leave' }, { label: 'Waiting for me' }]} />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave waiting for me"
        description="Leave and cancellations of leave at your level, oldest first. Open one to approve it, or say why it is not approved."
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
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Leave">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Leave</th>
              <th scope="col">Employee</th>
              <th scope="col">Dates</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Days
              </th>
              <th scope="col">{view === 'waiting' ? 'Waiting' : 'Now'}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={`${r.id}-${r.what}`}>
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
                  <td>
                    {view === 'waiting' ? (
                      <>
                        {days(r.since)} day{days(r.since) === 1 ? '' : 's'}
                        {days(r.since) >= 3 ? (
                          <span className="ep-mr-col__desc">
                            <Badge tone="danger">3 days or more</Badge>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Badge tone={LEAVE_STATUS[r.status].tone}>
                          {LEAVE_STATUS[r.status].label}
                        </Badge>
                        <span className="ep-mr-col__desc">
                          you acted {dmy(r.since.slice(0, 10))}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {view === 'waiting'
                    ? 'Nothing waits for you.'
                    : 'You have not decided any leave yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
