import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { LEAVE_STATUS, dmy, type LeaveStatus, type RegApproval } from '@/lib/leave';
import { decideRegularisation } from '@/lib/leave-actions';

/**
 * Attendance corrections waiting for my decision (docs/design/85, phase C): the day, what the employee says
 * it was and why; approve (the day is set, its late mark or missing punch cleared) or say why not.
 */
export default async function RegularisationApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'decided' ? 'decided' : 'waiting';
  const d = await apiFetch<{ rows: RegApproval[] }>(
    `/staff-attendance/regularisations/approvals?view=${view}`,
  );
  const here = `/leave/attendance/approvals${view === 'decided' ? '?view=decided' : ''}`;
  const days = (since: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'My leave', href: '/leave' },
          { label: 'Attendance corrections waiting for me' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Attendance corrections waiting for me"
        description="Days an employee says are wrong — a forgotten punch, a device that missed them — at your level, oldest first. Approving sets the day as asked and clears its late mark or missing punch."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Which corrections">
        <a
          className="ep-tabs__tab"
          href="/leave/attendance/approvals"
          aria-current={view === 'waiting' ? 'page' : undefined}
        >
          Waiting
        </a>
        <a
          className="ep-tabs__tab"
          href="/leave/attendance/approvals?view=decided"
          aria-current={view === 'decided' ? 'page' : undefined}
        >
          Decided by me
        </a>
      </nav>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Corrections">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Employee</th>
              <th scope="col">Asked</th>
              <th scope="col">{view === 'waiting' ? 'Decide' : 'Now'}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/leave/attendance/day?emp=${r.employee_id}&day=${r.day}`}>
                      {dmy(r.day)}
                    </a>
                    {view === 'waiting' ? (
                      <span className="ep-mr-col__desc">
                        waiting {days(r.since)} day{days(r.since) === 1 ? '' : 's'}
                        {days(r.since) >= 3 ? (
                          <>
                            {' '}
                            <Badge tone="danger">3 days or more</Badge>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {r.employee}
                    <span className="ep-mr-col__desc">{r.code}</span>
                  </td>
                  <td>
                    {[
                      r.in_time ? `IN ${r.in_time}` : null,
                      r.out_time ? `OUT ${r.out_time}` : null,
                      r.day_type,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    <span className="ep-mr-col__desc">{r.reason}</span>
                  </td>
                  <td>
                    {view === 'waiting' && r.mayDecide ? (
                      <form
                        action={decideRegularisation.bind(null, r.id)}
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-2)',
                          alignItems: 'flex-end',
                          flexWrap: 'wrap',
                        }}
                      >
                        <input type="hidden" name="back" value={here} />
                        <label className="ep-field" htmlFor={`ra-note-${r.id}`}>
                          <span className="ep-field__label">Remark (needed to not approve)</span>
                          <input
                            id={`ra-note-${r.id}`}
                            name="note"
                            className="ep-input"
                            maxLength={500}
                          />
                        </label>
                        <button
                          type="submit"
                          name="outcome"
                          value="approved"
                          className="ep-btn ep-btn--primary ep-btn--sm"
                        >
                          Approve
                        </button>
                        <button
                          type="submit"
                          name="outcome"
                          value="rejected"
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          Not approve
                        </button>
                      </form>
                    ) : (
                      <>
                        <Badge tone={LEAVE_STATUS[r.status as LeaveStatus]?.tone ?? 'neutral'}>
                          {LEAVE_STATUS[r.status as LeaveStatus]?.label ?? r.status}
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
                <td colSpan={4}>
                  {view === 'waiting'
                    ? 'Nothing waits for you.'
                    : 'You have not decided any correction yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
