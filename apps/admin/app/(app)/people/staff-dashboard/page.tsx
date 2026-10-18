import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart, DonutChart } from '@/components/charts/Charts';
import { CountTable } from '@/components/CountTable';
import { apiFetch, getMe } from '@/lib/api';
import { TONES, type StaffDashboard } from '@/lib/people-dashboard';

const ACR: Array<[string, string]> = [
  ['self', 'Self-appraisal'],
  ['review', 'With the levels'],
  ['disclosed', 'Shown to the employee'],
  ['represented', 'Objection'],
  ['closed', 'Final'],
];

/**
 * Employee dashboard (docs/design/33-people-dashboards.md): strength, movement in the year, today, and the
 * records and HR (documents, logins, profile changes, ACR). Figures first, then tables, then small charts.
 */
export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.employee.view')) notFound();
  const dept = (sp.department ?? '').trim();
  const [d, all] = await Promise.all([
    apiFetch<StaffDashboard>(
      `/people/dashboard/staff${dept ? `?department=${encodeURIComponent(dept)}` : ''}`,
    ),
    dept ? apiFetch<StaffDashboard>('/people/dashboard/staff') : Promise.resolve(null),
  ]);
  const s = d.strength;
  const t = d.today;
  const h = d.health;
  const departments = (all ?? d).strength.department
    .map((x) => x.key)
    .filter((x) => x !== 'Not given');

  return (
    <div className="ep-dash-compact">
      <PageHeader
        kicker="Employee management"
        title="Employee dashboard"
        description={`Active staff${dept ? ` of ${dept}` : ''}${d.year ? `, academic year ${d.year.code}` : ''}: strength, movement, today, and the records.`}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/people/employees">
            Employees list
          </a>
        }
      />
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="ed-dept" style={{ margin: 0 }}>
          <span className="ep-field__label">Department</span>
          <select id="ed-dept" name="department" className="ep-select" defaultValue={dept}>
            <option value="">All departments</option>
            {departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>

      <h2 className="ep-card__title">Strength</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Active staff" value={s.total} />
        {s.side.slice(0, 2).map((x) => (
          <KpiTile key={x.key} label={x.key} value={x.n} />
        ))}
        <KpiTile label="No staff login" value={h.noLogin} />
      </div>

      <h2 className="ep-card__title">Movement this year</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Joined / left"
          value={`${String(d.movement.joined)} / ${String(d.movement.left)}`}
        />
        <KpiTile
          label="Transfers"
          value={d.movement.transfersRecorded}
          hint={`${String(d.movement.transferredIn)} in, ${String(d.movement.transferredOut)} out of the school`}
        />
        <KpiTile label="Probation ending in 30 days" value={d.movement.probationEnding30} />
        <KpiTile label="Reaching 60 in 12 months" value={d.movement.retiring12Months} />
      </div>

      <h2 className="ep-card__title">Today</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Punched in" value={t.punchedIn} hint={`of ${String(s.total)}`} />
        <KpiTile label="Late" value={t.late} hint={`after ${t.lateAfter}`} />
        <KpiTile label="Activity logs submitted" value={t.activityLogs} />
        <KpiTile label="Birthdays and anniversaries" value={t.people.length} />
      </div>

      <h2 className="ep-card__title">Records and HR</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Profile complete (average)"
          value={h.averageCompleteness === null ? '—' : `${String(h.averageCompleteness)}%`}
          hint={`${String(h.below80)} below 80%`}
        />
        <KpiTile
          label="Required documents missing"
          value={h.documentsMissing}
          hint="staff with one or more"
        />
        <KpiTile label="Documents expiring in 30 days" value={h.documentsExpiring30} />
        <a
          className="ep-card ep-card--elevated ep-staff-kpi"
          href="/people/staff-profile-approvals"
        >
          <span className="ep-kpi__value">{h.pendingChanges}</span>
          <span className="ep-kpi__label">Profile changes to approve</span>
        </a>
      </div>

      <div className="ep-chart__grid2">
        <Card title={dept ? 'Designations' : 'By department'}>
          <CountTable
            caption={dept ? 'Staff by designation' : 'Staff by department'}
            rows={dept ? s.designation : s.department}
            total={s.total}
          />
          <BarChart
            title={dept ? 'Staff by designation' : 'Staff by department'}
            data={(dept ? s.designation : s.department)
              .slice(0, 12)
              .map((x) => ({ label: x.key, values: [x.n] }))}
            series={[{ label: 'Staff', tone: 'navy' }]}
          />
        </Card>
        <Card title="Who they are">
          <div className="ep-grid-2">
            <div>
              <h3 className="ep-field__label">Employee type</h3>
              <CountTable caption="Staff by employee type" rows={s.type} total={s.total} />
            </div>
            <div>
              <h3 className="ep-field__label">Gender</h3>
              <CountTable caption="Staff by gender" rows={s.gender} total={s.total} />
            </div>
          </div>
          <DonutChart
            title="Teaching and non-teaching"
            centre={String(s.total)}
            parts={s.side.map((x, i) => ({
              label: x.key,
              value: x.n,
              tone: TONES[i % TONES.length]!,
            }))}
          />
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Birthdays and work anniversaries today">
          {t.people.length ? (
            <ul className="ep-acr-events">
              {t.people.map((p) => (
                <li key={`${p.kind}-${p.id}`}>
                  <a href={`/people/employees/${p.id}`}>{p.name}</a>
                  {p.designation ? ` · ${p.designation}` : ''} ·{' '}
                  {p.kind === 'birthday'
                    ? `birthday (${String(p.years)})`
                    : `${String(p.years)} years with the school`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">None today.</p>
          )}
        </Card>
        <Card title={h.acr?.cycle ? `ACR · ${h.acr.cycle}` : 'ACR'}>
          {h.acr ? (
            <>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">ACRs by status</caption>
                <tbody>
                  {ACR.map(([k, label]) => (
                    <tr key={k}>
                      <td>
                        <strong>{label}</strong>
                      </td>
                      <td>{h.acr!.byStatus[k] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/acr">
                Employee ACR
              </a>
            </>
          ) : (
            <p className="ep-field__help">No ACR cycle yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
