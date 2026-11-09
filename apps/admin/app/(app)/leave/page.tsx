import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { LEAVE_STATUS, dmy, leaveDates, type MyLeave } from '@/lib/leave';
import { applyLeave } from '@/lib/leave-actions';

/**
 * My leave (docs/design/85, phase B): my balances, applying (with the school's questions — the sandwich,
 * the paid part + loss of pay), my leave a page at a time, and what waits for my approval.
 */
export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  let d: MyLeave;
  try {
    d = await apiFetch<MyLeave>(`/leave/mine?page=${String(page)}&size=${size}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const office = me.permissions.includes('leave.office.manage');
  // a report given to me on its own (docs/design/85, phase D) — those with the reports right have the menu
  const reports = me.permissions.includes('leave.report.view')
    ? 0
    : await apiFetch<{ reports: number }>('/leave-reports/mine')
        .then((r) => r.reports)
        .catch(() => 0);
  const link = (p: number) => `/leave?size=${size}${p > 1 ? `&page=${String(p)}` : ''}`;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Employee management', href: '/people/employees' }, { label: 'My leave' }]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="My leave"
        description="Your balances this month, applying for leave, and your leave. A leave waits with your approvers until the last one decides; the days are held from your balance meanwhile."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/approvals">
              Waiting for me{d.waiting ? ` (${String(d.waiting)})` : ''}
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/attendance/approvals">
              Attendance corrections waiting
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/attendance/mine">
              My attendance
            </a>
            {reports ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/reports">
                Reports
              </a>
            ) : null}
            {office ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/register">
                Leave register
              </a>
            ) : null}
            {office ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/attendance">
                Attendance register
              </a>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />
      {!d.employee ? (
        <p className="ep-alert ep-alert--info" role="status">
          Your sign-in is not linked to an employee record, so you have no leave of your own.
          {d.waiting ? ' Leave waiting for your approval is under Waiting for me.' : ''}
        </p>
      ) : (
        <>
          {d.balances.length ? (
            <div className="ep-dash-kpis">
              {d.balances.map((b) => (
                <KpiTile
                  key={b.typeId}
                  label={`${b.name} (${b.code})`}
                  value={String(b.available)}
                  hint={
                    b.held ? `days left · ${String(b.held)} held by leave this month` : 'days left'
                  }
                />
              ))}
            </div>
          ) : null}
          {d.can.apply ? (
            <section className="ep-card" aria-labelledby="ml-apply">
              <h2 id="ml-apply" className="ep-card__title">
                Apply for leave
              </h2>
              <LeaveApplyForm
                types={d.types}
                balances={d.balances.map((b) => ({ typeId: b.typeId, available: b.available }))}
                apply={applyLeave}
              />
            </section>
          ) : null}
          <section
            className="ep-card"
            aria-labelledby="ml-list"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h2 id="ml-list" className="ep-card__title">
              My leave
            </h2>
            <form method="get" action="/leave" className="ep-grid__toolbar">
              <PerPage id="ml-size" value={size} />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Show
              </button>
            </form>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ml-list">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Leave</th>
                    <th scope="col">Dates</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Days
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.length ? (
                    d.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <a href={`/leave/requests/${r.id}`}>{r.number}</a>
                          <span className="ep-mr-col__desc">
                            {r.leaveType.name} ({r.leaveType.code}) · applied{' '}
                            {dmy(r.appliedAt.slice(0, 10))}
                          </span>
                        </td>
                        <td>{leaveDates(r)}</td>
                        <td style={{ textAlign: 'right' }}>{r.days}</td>
                        <td>
                          <Badge tone={LEAVE_STATUS[r.status].tone}>
                            {LEAVE_STATUS[r.status].label}
                          </Badge>
                          {r.status === 'pending' && r.waitingWith ? (
                            <span className="ep-mr-col__desc">with {r.waitingWith}</span>
                          ) : null}
                          {r.cancelStatus === 'pending' ? (
                            <span className="ep-mr-col__desc">cancellation waiting</span>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>No leave yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              page={d.page}
              size={d.size}
              total={d.total}
              href={link}
              noun="leave applications"
            />
          </section>
        </>
      )}
    </>
  );
}
