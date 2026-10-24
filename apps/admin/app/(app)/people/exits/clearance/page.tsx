import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { apiFetch, getMe } from '@/lib/api';
import { dmy, type BoardExit } from '@/lib/exits';

const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * The no-dues board (docs/design/38, part 6): every accepted exit with its departments, cleared or
 * waiting, the dues noted and what the library shows; open an exit to clear.
 */
export default async function ClearanceBoardPage() {
  const me = await getMe();
  if (!me.permissions.includes('people.exit.view')) notFound();
  const { data } = await apiFetch<{ data: BoardExit[] }>('/people/exits/clearance');
  const waiting = data.filter((x) => x.pending > 0).length;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations', href: '/people/exits' },
          { label: 'No-dues clearance' },
        ]}
      />
      <PageHeader
        kicker="Employee exit"
        title="No-dues clearance"
        description="Accepted exits and their departments: each clears or notes dues with an amount, recovered in the full and final statement."
      />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{data.length}</span>
          <span className="ep-kpi__label">Accepted exits</span>
        </div>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{waiting}</span>
          <span className="ep-kpi__label">Waiting for a department</span>
        </div>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{data.length - waiting}</span>
          <span className="ep-kpi__label">Cleared by all</span>
        </div>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{rs(data.reduce((s, x) => s + x.dues, 0))}</span>
          <span className="ep-kpi__label">Dues noted</span>
        </div>
      </div>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="No-dues board (scrolls sideways)"
      >
        <table className="ep-table">
          <caption className="ep-sr-only">No-dues clearance of accepted exits</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Last working day</th>
              <th scope="col">Departments</th>
              <th scope="col">Dues</th>
            </tr>
          </thead>
          <tbody>
            {data.map((x) => (
              <tr key={x.id}>
                <td>
                  <a href={`/people/exits/${x.id}`}>
                    <strong>{x.employee.name}</strong>
                  </a>
                  <div className="ep-field__help">
                    {[x.employee.code, x.exitType, x.employee.department]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td>{dmy(x.lastDay)}</td>
                <td>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                    {x.clearances.map((r) => (
                      <span
                        key={r.department}
                        className={`ep-badge ep-badge--${r.status === 'cleared' ? 'success' : r.check?.due ? 'warning' : 'neutral'}`}
                        title={r.check?.detail ?? undefined}
                      >
                        {r.name}: {r.status === 'cleared' ? 'cleared' : 'waiting'}
                      </span>
                    ))}
                  </span>
                </td>
                <td>{x.dues ? rs(x.dues) : '—'}</td>
              </tr>
            ))}
            {!data.length ? (
              <tr>
                <td colSpan={4}>No accepted exit waits for clearance.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
