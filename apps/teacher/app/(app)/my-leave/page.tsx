import { Badge, Card, PageHeader } from '@edupro/ui';
import { LeaveApplyForm } from '@/components/LeaveApplyForm';
import { bff } from '@/lib/bff';
import { LEAVE_STATUS, dmy, leaveDates, type MyLeave } from '@/lib/leave';
import { applyMyLeave } from './actions';

/** My leave in the staff app (docs/design/85): balances, applying, my leave, what waits for me. */
export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; ok?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const d = await bff.api.fetch<MyLeave>(`/leave/mine?page=${String(page)}&size=25`);
  const pages = Math.max(1, Math.ceil(d.total / d.size));
  return (
    <>
      <PageHeader
        kicker="Leave"
        title="My leave"
        description="Your balances this month, applying for leave, and your leave. A leave waits with your approvers until the last one decides; its days are held meanwhile."
      />
      {d.waiting ? (
        <p className="ep-alert ep-alert--info" role="status">
          {d.waiting} leave {d.waiting === 1 ? 'request waits' : 'requests wait'} for your approval:{' '}
          <a href="/leave-approvals" style={{ textDecoration: 'underline' }}>
            open them
          </a>
          .
        </p>
      ) : null}
      {!d.employee ? (
        <Card>
          <p>Your sign-in is not linked to an employee record, so you have no leave of your own.</p>
        </Card>
      ) : (
        <>
          {d.balances.length ? (
            <div className="ep-dash-kpis">
              {d.balances.map((b) => (
                <div key={b.typeId} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                  <div className="ep-field__label">
                    {b.name} ({b.code})
                  </div>
                  <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>{b.available}</div>
                  <div className="ep-field__help">
                    days left{b.held ? ` · ${String(b.held)} held this month` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {d.can.apply ? (
            <Card>
              <h2 className="ep-card__title">Apply for leave</h2>
              <LeaveApplyForm
                types={d.types}
                balances={d.balances.map((b) => ({ typeId: b.typeId, available: b.available }))}
                apply={applyMyLeave}
                detailPath="/my-leave/"
              />
            </Card>
          ) : null}
          <Card>
            <h2 className="ep-card__title">My leave</h2>
            {d.rows.length ? (
              <ul className="ep-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {d.rows.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      padding: 'var(--sp-2) 0',
                      borderBottom: '1px solid var(--border-default)',
                    }}
                  >
                    <a href={`/my-leave/${r.id}`}>
                      <strong>{r.number}</strong>
                    </a>{' '}
                    <Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>
                    <div className="ep-field__help" style={{ margin: 0 }}>
                      {r.leaveType.name} ({r.leaveType.code}) · {leaveDates(r)} · {r.days} day
                      {r.days === 1 ? '' : 's'} · applied {dmy(r.appliedAt.slice(0, 10))}
                      {r.status === 'pending' && r.waitingWith ? ` · with ${r.waitingWith}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No leave yet.</p>
            )}
            {pages > 1 ? (
              <nav aria-label="Pages of my leave" className="ep-field__help">
                Page {page} of {pages} ·{' '}
                {page > 1 ? <a href={`/my-leave?page=${String(page - 1)}`}>Previous</a> : null}{' '}
                {page < pages ? <a href={`/my-leave?page=${String(page + 1)}`}>Next</a> : null}
              </nav>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
