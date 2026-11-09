import { Badge, Card, PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { LEAVE_STATUS, leaveDates, type LeaveRequest } from '@/lib/leave';

type Row = LeaveRequest & { what: 'leave' | 'cancellation'; since: string };

/** Colleagues' leave and cancellations waiting at my level (docs/design/85), oldest first. */
export default async function LeaveApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'decided' ? 'decided' : 'waiting';
  const d = await bff.api.fetch<{ rows: Row[] }>(`/leave/approvals?view=${view}`);
  return (
    <>
      <PageHeader
        kicker="Leave"
        title="Leave to approve"
        description="Colleagues’ leave, and cancellations of their leave, waiting at your level. Open one to decide it."
      />
      <nav className="ep-tabs" aria-label="Which leave">
        <a
          className="ep-tabs__tab"
          href="/leave-approvals"
          aria-current={view === 'waiting' ? 'page' : undefined}
        >
          Waiting
        </a>
        <a
          className="ep-tabs__tab"
          href="/leave-approvals?view=decided"
          aria-current={view === 'decided' ? 'page' : undefined}
        >
          Decided by me
        </a>
      </nav>
      <Card>
        {d.rows.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.rows.map((r) => (
              <li
                key={`${r.id}-${r.what}`}
                style={{
                  padding: 'var(--sp-2) 0',
                  borderBottom: '1px solid var(--border-default)',
                }}
              >
                <a href={`/my-leave/${r.id}`}>
                  <strong>
                    {r.employee.name} · {r.number}
                  </strong>
                </a>{' '}
                {view === 'decided' ? (
                  <Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>
                ) : r.what === 'cancellation' ? (
                  <Badge tone="warning">Cancellation</Badge>
                ) : null}
                <div className="ep-field__help" style={{ margin: 0 }}>
                  {r.leaveType.code} · {leaveDates(r)} · {r.days} day{r.days === 1 ? '' : 's'} ·{' '}
                  {r.reason.slice(0, 80)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {view === 'waiting' ? 'Nothing waits for you.' : 'You have not decided any leave yet.'}
          </p>
        )}
      </Card>
    </>
  );
}
