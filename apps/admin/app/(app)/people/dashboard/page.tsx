import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart, DonutChart, ProgressRows } from '@/components/charts/Charts';
import { CountTable } from '@/components/CountTable';
import { apiFetch, getMe } from '@/lib/api';
import { TONES, type StudentDashboard } from '@/lib/people-dashboard';

/**
 * Student dashboard (docs/design/33-people-dashboards.md): strength, movement in the year, today, and the
 * health of the records. Figures first, then tables, then small charts.
 */
export default async function StudentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.student.view')) notFound();
  const cls = sp.class && /^\d{1,18}$/.test(sp.class) ? sp.class : '';
  const [d, all] = await Promise.all([
    apiFetch<StudentDashboard | null>(`/people/dashboard/students${cls ? `?class=${cls}` : ''}`),
    cls ? apiFetch<StudentDashboard | null>('/people/dashboard/students') : Promise.resolve(null),
  ]);
  if (!d)
    return (
      <PageHeader kicker="People" title="Student dashboard" description="No working year is set." />
    );
  const s = d.strength;
  const t = d.today;
  const h = d.health;
  const classes = (all ?? d).strength.byClass;
  const marked = t.present + t.absent + t.leave;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div className="ep-dash-compact">
      <PageHeader
        kicker="People"
        title="Student dashboard"
        description={`Academic year ${d.year.code}: active students${cls ? ' of the class chosen' : ''}, movement in the year, today, and the records.`}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/people/students">
            Students list
          </a>
        }
      />
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="sd-class" style={{ margin: 0 }}>
          <span className="ep-field__label">Class</span>
          <select id="sd-class" name="class" className="ep-select" defaultValue={cls}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.name}
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
        <KpiTile label="Active students" value={s.total} />
        <KpiTile label="New this year" value={s.newThisYear} hint={`${String(s.old)} continuing`} />
        <KpiTile
          label="Boys / girls"
          value={`${String(s.byClass.reduce((n, c) => n + c.boys, 0))} / ${String(s.byClass.reduce((n, c) => n + c.girls, 0))}`}
        />
        <KpiTile label="EWS / DG" value={s.ews} />
      </div>

      <h2 className="ep-card__title">Movement this year</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Admitted this year"
          value={d.movement.admittedYear}
          hint={`${String(d.movement.admittedMonth)} this month`}
        />
        <KpiTile label="Withdrawn" value={d.movement.withdrawn} />
        <KpiTile label="TCs issued" value={d.movement.tcsIssued} />
        <KpiTile
          label="Transfers in / out"
          value={`${String(d.movement.transferredIn)} / ${String(d.movement.transferredOut)}`}
          hint="Between schools of the group"
        />
      </div>

      <h2 className="ep-card__title">Today</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Sections marked"
          value={`${String(t.sectionsMarked)} / ${String(t.sections)}`}
        />
        <KpiTile
          label="Present"
          value={t.present}
          hint={marked ? `${String(pct(t.present, marked))}% of those marked` : 'Not marked yet'}
        />
        <KpiTile label="Absent" value={t.absent} />
        <KpiTile label="Birthdays today" value={t.birthdays.length} />
      </div>

      <h2 className="ep-card__title">Records</h2>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Profile complete (average)"
          value={h.averageCompleteness === null ? '—' : `${String(h.averageCompleteness)}%`}
          hint={`${String(h.below80)} below 80%`}
        />
        <KpiTile label="No photo" value={h.noPhoto} />
        <KpiTile label="No Aadhaar number" value={h.noAadhaar} />
        <a className="ep-card ep-card--elevated ep-staff-kpi" href="/people/profile-approvals">
          <span className="ep-kpi__value">{h.pendingChanges}</span>
          <span className="ep-kpi__label">Profile changes to approve</span>
        </a>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Strength by class">
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Students by class</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Sections</th>
                  <th scope="col">Students</th>
                  <th scope="col">Boys</th>
                  <th scope="col">Girls</th>
                </tr>
              </thead>
              <tbody>
                {s.byClass.map((c) => (
                  <tr key={c.classId}>
                    <td>
                      <strong>
                        <a href={`?class=${c.classId}`}>{c.name}</a>
                      </strong>
                    </td>
                    <td>{c.sections}</td>
                    <td>{c.students}</td>
                    <td>{c.boys}</td>
                    <td>{c.girls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BarChart
            title="Boys and girls by class"
            stacked
            data={s.byClass.map((c) => ({
              label: c.name.replace(/^Class /, ''),
              values: [c.boys, c.girls],
            }))}
            series={[
              { label: 'Boys', tone: 'navy' },
              { label: 'Girls', tone: 'cyan' },
            ]}
          />
        </Card>
        <Card title="Who they are">
          <div className="ep-grid-2">
            <div>
              <h3 className="ep-field__label">Category</h3>
              <CountTable caption="Students by category" rows={s.category} total={s.total} />
            </div>
            <div>
              <h3 className="ep-field__label">Day scholar / hosteller</h3>
              <CountTable caption="Students by boarding" rows={s.boarding} total={s.total} />
            </div>
          </div>
          <DonutChart
            title="Students by category"
            centre={String(s.total)}
            parts={s.category
              .slice(0, 7)
              .map((c, i) => ({ label: c.key, value: c.n, tone: TONES[i % TONES.length]! }))}
          />
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="Attendance today">
          {marked ? (
            <ProgressRows
              label="Marked today"
              rows={[
                {
                  name: 'Present',
                  value: t.present,
                  of: marked,
                  text: `${String(pct(t.present, marked))}%`,
                  tone: 'success',
                },
                {
                  name: 'Absent',
                  value: t.absent,
                  of: marked,
                  text: `${String(pct(t.absent, marked))}%`,
                  tone: 'danger',
                },
                {
                  name: 'Short leave',
                  value: t.leave,
                  of: marked,
                  text: `${String(pct(t.leave, marked))}%`,
                  tone: 'warning',
                },
              ]}
            />
          ) : (
            <p className="ep-field__help">No attendance marked yet today.</p>
          )}
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/attendance">
            Attendance
          </a>
        </Card>
        <Card title="Birthdays today">
          {t.birthdays.length ? (
            <ul className="ep-acr-events">
              {t.birthdays.map((b) => (
                <li key={b.id}>
                  <a href={`/people/students/${b.id}`}>{b.name}</a> · {b.section} · {b.age} years
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No birthday today.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
