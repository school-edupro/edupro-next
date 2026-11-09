import { Badge, Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts/Charts';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type LeaveDashboard } from '@/lib/leave';

const KIND: Record<string, string> = {
  leave: 'Leave',
  cancellation: 'Cancellation',
  correction: 'Correction',
};

/**
 * The leave & attendance dashboard (docs/design/85, phase D): today's and the month's figures first, then
 * today by department, who is on leave and late today and what waits longest, then two small charts.
 */
export default async function LeaveDashboardPage() {
  const me = await getMe();
  if (
    !me.permissions.includes('leave.report.view') &&
    !me.permissions.includes('leave.office.manage')
  )
    notFound();
  let d: LeaveDashboard;
  try {
    d = await apiFetch<LeaveDashboard>('/leave-reports/dashboard');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = d.figures;
  const days = (since: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
  const office = me.permissions.includes('leave.office.manage');
  return (
    <div className="ep-dash-compact">
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance dashboard' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave & attendance dashboard"
        description={`Today, ${dmy(d.today)}, and ${d.monthWords}. Staff in the "Not required" list are left out.`}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/reports">
            Reports
          </a>
        }
      />
      <div className="ep-dash-kpis">
        <KpiTile label="Staff" value={String(f.staff)} />
        <KpiTile label="In today (punched)" value={String(f.punched)} />
        <KpiTile label="On leave today" value={String(f.onLeave)} />
        <KpiTile
          label="Not in yet"
          value={String(f.notIn)}
          hint="No punch, no leave, a working day"
        />
        <KpiTile label="Late today" value={String(f.late)} />
        <KpiTile label="Weekly off or holiday" value={String(f.off)} />
        <KpiTile
          label={`Attendance · ${d.monthWords}`}
          value={f.attendance === null ? '—' : `${String(f.attendance)}%`}
        />
        <KpiTile label="Late marks this month" value={String(f.lateMarks)} />
        <KpiTile label="Missing punches this month" value={String(f.missing)} />
        <KpiTile label="Loss-of-pay days this month" value={String(f.lopDays)} />
        <KpiTile label="Leave waiting for approval" value={String(f.waiting)} />
        <KpiTile label="Corrections waiting" value={String(f.corrections)} />
      </div>
      {office && !d.lastMonth.locked ? (
        <p className="ep-alert ep-alert--info" role="status">
          {d.lastMonth.words} is not locked for payroll yet:{' '}
          <a href={`/leave/attendance?month=${d.lastMonth.month}`}>open its attendance register</a>{' '}
          to lock it once payroll is final.
        </p>
      ) : null}
      <Card title="Today by department">
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Today by department">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Department</th>
                {['Staff', 'In', 'On leave', 'Not in yet', 'Late', 'Off'].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: 'right' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.departments.length ? (
                d.departments.map((r) => (
                  <tr key={r.department}>
                    <th scope="row">{r.department}</th>
                    {[r.staff, r.punched, r.onLeave, r.notIn, r.late, r.off].map((v, i) => (
                      <td key={i} style={{ textAlign: 'right' }}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No staff.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="ep-chart__grid2">
        <Card title="On leave today">
          {d.onLeave.length ? (
            <ul className="ep-list">
              {d.onLeave.map((r) => (
                <li key={`${r.id}-${r.code}`}>
                  {r.name} ({r.code}) · <a href={`/leave/requests/${r.id}`}>{r.type}</a>
                  {r.half ? ' ½' : ''} · {dmy(r.from_date)}
                  {r.to_date !== r.from_date ? ` to ${dmy(r.to_date)}` : ''}
                  {r.department ? <span className="ep-mr-col__desc">{r.department}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nobody is on leave today.</p>
          )}
        </Card>
        <Card title="Late today">
          {d.lateToday.length ? (
            <ul className="ep-list">
              {d.lateToday.map((r) => (
                <li key={r.id}>
                  <a href={`/leave/attendance/day?emp=${r.id}&day=${d.today}`}>{r.name}</a> (
                  {r.code}) · IN {r.at} · {r.minutes} min late
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nobody is late today (so far).</p>
          )}
        </Card>
      </div>
      <Card title="Waiting longest">
        {d.waiting.length ? (
          <ul className="ep-list">
            {d.waiting.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <Badge tone="neutral">{KIND[r.kind] ?? r.kind}</Badge>{' '}
                <a href={r.href}>{r.label}</a> · {r.name} · waiting {days(r.since)} day
                {days(r.since) === 1 ? '' : 's'}
                {days(r.since) >= 3 ? (
                  <>
                    {' '}
                    <Badge tone="danger">3 days or more</Badge>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">Nothing waits.</p>
        )}
      </Card>
      <div className="ep-chart__grid2">
        <Card title={`Attendance by day · ${d.monthWords}`}>
          {d.byDay.some((x) => x.percent !== null) ? (
            <BarChart
              title={`Attendance % by day, ${d.monthWords}`}
              series={[{ label: 'Present %', tone: 'navy' }]}
              data={d.byDay.map((x) => ({ label: x.day.slice(8, 10), values: [x.percent ?? 0] }))}
              valueLabel={(v) => `${String(v[0])}%`}
            />
          ) : (
            <p className="ep-field__help">No working day worked out this month yet.</p>
          )}
        </Card>
        <Card title="Leave taken this year by type">
          {d.byType.length ? (
            <BarChart
              title={`Approved leave days from ${dmy(d.fyFrom)} by type`}
              series={[{ label: 'Days', tone: 'cyan' }]}
              data={d.byType.map((x) => ({ label: x.code, values: [x.days] }))}
            />
          ) : (
            <p className="ep-field__help">No leave taken this year yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
