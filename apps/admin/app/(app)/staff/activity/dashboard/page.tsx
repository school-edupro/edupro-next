import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { BarChart, ProgressRows, type ChartTone } from '@/components/charts/Charts';
import { ActivityNav } from '@/components/staff/ActivityNav';
import { apiFetch, getMe } from '@/lib/api';

interface Person {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  working: number;
  submitted: number;
  missed: number;
  leave: number;
  halfLeave: number;
  late: number;
  returned: number;
  minutes: number;
  percent: number;
}
interface Dashboard {
  from: string;
  to: string;
  kpis: {
    employees: number;
    percent: number;
    todaySubmitted: number;
    todayMissing: number;
    todayLeave: number;
    leaveDays: number;
    halfLeaveDays: number;
    late: number;
    returned: number;
    hours: number;
  };
  byDepartment: Array<{ label: string; people: number; percent: number }>;
  byCategory: Array<{ label: string; hours: number }>;
  trend: Array<{ date: string; submitted: number; late: number }>;
  defaulters: Person[];
  missingToday: Array<{ name: string; department: string; state: string }>;
  onLeaveToday: Array<{
    name: string;
    department: string;
    kind: 'full' | 'half';
    type: string | null;
  }>;
  leaveByEmployee: Array<{ name: string; department: string; full: number; half: number }>;
}
const tone = (p: number): ChartTone => (p >= 90 ? 'success' : p >= 60 ? 'warning' : 'danger');
const hm = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * The activity log's dashboard and reports: how many submit, who does not, where the time goes, and the
 * submission table by employee with Excel and PDF.
 */
export default async function ActivityDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; department?: string; employeeId?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const q = new URLSearchParams();
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) q.set(k, sp[k]!);
  if (sp.department) q.set('department', sp.department.slice(0, 120));
  const filters = q.toString();
  const [d, people, day] = await Promise.all([
    apiFetch<Dashboard>(`/staff/activity/dashboard?${filters}`),
    apiFetch<{ data: Person[] }>(`/staff/activity/compliance?${filters}`).then((r) => r.data),
    apiFetch<{ departments: string[] }>('/staff/activity/day'),
  ]);
  const k = d.kpis;
  const maxHours = Math.max(1, ...d.byCategory.map((c) => c.hours));
  return (
    <>
      <PageHeader
        kicker="Staff · Daily activity log"
        title="Dashboard and reports"
        description={`From ${d.from} to ${d.to}. Working days leave out Sundays and staff holidays.`}
      />
      <ActivityNav current="/staff/activity/dashboard" permissions={me.permissions} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <InputField id="ad-from" name="from" label="From" type="date" defaultValue={d.from} />
          <InputField id="ad-to" name="to" label="To" type="date" defaultValue={d.to} />
          <SelectField
            id="ad-dept"
            name="department"
            label="Department"
            defaultValue={sp.department ?? ''}
            options={[
              { value: '', label: 'All departments' },
              ...day.departments.map((x) => ({ value: x, label: x })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <div className="ep-cdash__kpis">
        {(
          [
            [
              'Submitted on time and late',
              `${String(k.percent)}%`,
              `of the working days of ${String(k.employees)} employee(s)`,
            ],
            [
              'Today',
              `${String(k.todaySubmitted)} / ${String(k.todaySubmitted + k.todayMissing)}`,
              `${String(k.todayMissing)} have not submitted yet`,
            ],
            ['Submitted late', String(k.late), `${String(k.returned)} sent back`],
            [
              'On leave',
              String(k.leaveDays),
              `full days · ${String(k.halfLeaveDays)} half days · ${String(k.todayLeave)} today`,
            ],
            ['Time logged', `${String(k.hours)} h`, 'in submitted logs'],
          ] as Array<[string, string, string]>
        ).map(([title, value, note]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <span className="ep-cdash__num">{value}</span>
            </div>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {note}
            </p>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          margin: 'var(--sp-4) 0',
        }}
      >
        <Card title="Logs submitted, last working days">
          <BarChart
            title="Logs submitted on each of the last working days; the late ones beside"
            data={d.trend.map((t) => ({ label: t.date.slice(5), values: [t.submitted, t.late] }))}
            series={[
              { label: 'Submitted', tone: 'navy' },
              { label: 'Of these, late', tone: 'warning' },
            ]}
          />
        </Card>
        <Card title="Submission by department">
          <ProgressRows
            label="Share of working days submitted, by department"
            rows={d.byDepartment.map((g) => ({
              name: `${g.label} (${String(g.people)})`,
              value: g.percent,
              of: 100,
              text: `${String(g.percent)}%`,
              tone: tone(g.percent),
            }))}
          />
        </Card>
        <Card
          title="Where the time goes"
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/api/staff/activity-report?report=category&format=xlsx&${filters}`}
              >
                Excel
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/api/staff/activity-report?report=category&format=pdf&${filters}`}
              >
                PDF
              </a>
            </span>
          }
        >
          {d.byCategory.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No submitted log in these dates yet.
            </p>
          ) : (
            <ProgressRows
              label="Hours logged by category"
              rows={d.byCategory.map((c) => ({
                name: c.label,
                value: c.hours,
                of: maxHours,
                text: `${String(c.hours)} h`,
                tone: 'cyan',
              }))}
            />
          )}
        </Card>
        <Card title="Not submitted today">
          {d.missingToday.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Everyone has submitted today.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {d.missingToday.map((m, i) => (
                <li key={String(i)}>
                  {m.name} <span className="ep-kicker">{m.department}</span>{' '}
                  {m.state === 'draft' ? <Badge tone="neutral">Draft</Badge> : null}
                  {m.state === 'returned' ? <Badge tone="warning">Sent back</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginBottom: 0 }}>
            <a href="/staff/activity/review?state=missing" style={{ textDecoration: 'underline' }}>
              Open today’s list
            </a>
          </p>
        </Card>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card title="On leave today">
          {d.onLeaveToday.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nobody is marked on leave today.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {d.onLeaveToday.map((m, i) => (
                <li key={String(i)}>
                  {m.name} <span className="ep-kicker">{m.department}</span>{' '}
                  <Badge tone="info">
                    {m.kind === 'full' ? 'Full day' : 'Half day'}
                    {m.type ? ` · ${m.type}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Leave in these dates, by employee">
          {d.leaveByEmployee.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No leave is marked in these dates.
            </p>
          ) : (
            <ProgressRows
              label="Days of leave by employee"
              rows={d.leaveByEmployee.map((p) => ({
                name: `${p.name} (${p.department})`,
                value: p.full + p.half / 2,
                of: Math.max(1, ...d.leaveByEmployee.map((x) => x.full + x.half / 2)),
                text: `${String(p.full)} full${p.half ? ` + ${String(p.half)} half` : ''}`,
                tone: 'info',
              }))}
            />
          )}
        </Card>
      </div>
      <Card title="Submission by employee" id="report">
        <p style={{ marginTop: 0, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/api/staff/activity-report?report=compliance&format=xlsx&${filters}`}
          >
            Excel
          </a>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/api/staff/activity-report?report=compliance&format=pdf&${filters}`}
          >
            PDF
          </a>
        </p>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Submission by employee"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Activity log submission by employee</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Department</th>
                <th scope="col" className="ep-num">
                  Working days
                </th>
                <th scope="col" className="ep-num">
                  Submitted
                </th>
                <th scope="col" className="ep-num">
                  On leave
                </th>
                <th scope="col" className="ep-num">
                  Not filled
                </th>
                <th scope="col" className="ep-num">
                  Late
                </th>
                <th scope="col" className="ep-num">
                  Submitted %
                </th>
                <th scope="col">Time logged</th>
                <th scope="col">Day by day</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.employeeId}>
                  <th scope="row">
                    {p.name} <span className="ep-kicker">{p.employeeCode}</span>
                  </th>
                  <td>{p.department}</td>
                  <td className="ep-num">{p.working}</td>
                  <td className="ep-num">{p.submitted}</td>
                  <td className="ep-num">
                    {p.leave}
                    {p.halfLeave ? ` + ${String(p.halfLeave)} half` : ''}
                  </td>
                  <td className="ep-num">
                    {p.missed ? <Badge tone="danger">{p.missed}</Badge> : '0'}
                  </td>
                  <td className="ep-num">{p.late}</td>
                  <td className="ep-num">{p.percent}%</td>
                  <td>{p.minutes ? hm(p.minutes) : '–'}</td>
                  <td>
                    <a
                      href={`/api/staff/activity-report?report=employee&format=pdf&employeeId=${p.employeeId}&${filters}`}
                      style={{ textDecoration: 'underline' }}
                      aria-label={`Day by day log of ${p.name}, PDF`}
                    >
                      PDF
                    </a>{' '}
                    ·{' '}
                    <a
                      href={`/api/staff/activity-report?report=employee&format=xlsx&employeeId=${p.employeeId}&${filters}`}
                      style={{ textDecoration: 'underline' }}
                      aria-label={`Day by day log of ${p.name}, Excel`}
                    >
                      Excel
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
