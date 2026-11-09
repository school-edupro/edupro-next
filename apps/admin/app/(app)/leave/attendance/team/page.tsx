import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { apiFetch } from '@/lib/api';
import type { AttendanceRegister } from '@/lib/leave';

const TONE: Record<string, string> = {
  P: 'var(--status-success-text)',
  HD: 'var(--status-warning-text)',
  A: 'var(--status-danger-text)',
  LOP: 'var(--status-danger-text)',
  HOLD: 'var(--status-danger-text)',
  WO: 'var(--text-muted)',
  H: 'var(--text-muted)',
};
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * My team's attendance (docs/design/85, "my reportees' attendance"): the month of the staff whose reporting
 * manager I am — each day's code with its marks and the totals; a day opens its detail.
 */
export default async function TeamAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const size = pageSizeOf(sp.size ?? '25');
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : '';
  const qs = new URLSearchParams({ size, page: String(Math.max(1, Number(sp.page) || 1)) });
  if (month) qs.set('month', month);
  const d = await apiFetch<AttendanceRegister>(`/staff-attendance/team?${qs.toString()}`);
  const link = (page: number) =>
    `/leave/attendance/team?${new URLSearchParams({
      ...(month ? { month } : {}),
      size,
      ...(page > 1 ? { page: String(page) } : {}),
    }).toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'My leave', href: '/leave' }, { label: 'My team’s attendance' }]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={`My team’s attendance · ${d.monthWords}`}
        description="The staff who report to you: each day as the punches made it (P present, HD half day, A absent, WO, H, the leave’s code; L late, M a punch missing, ✎ set by hand). Click a day to see its punches and how it was worked out."
      />
      <form
        method="get"
        action="/leave/attendance/team"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <label className="ep-field" htmlFor="tm-month">
          <span className="ep-field__label">Month</span>
          <input
            id="tm-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={d.month.slice(0, 7)}
          />
        </label>
        <PerPage id="tm-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      {!d.team ? (
        <p className="ep-alert ep-alert--info" role="status">
          Nobody reports to you this year (the reporting manager on each employee’s posting).
        </p>
      ) : (
        <>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="My team’s attendance"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  {d.dates.map((x) => (
                    <th key={x} scope="col" style={{ textAlign: 'center', padding: 'var(--sp-1)' }}>
                      {Number(x.slice(8, 10))}
                      <span className="ep-mr-col__desc">
                        {WEEKDAY[new Date(`${x}T00:00:00Z`).getUTCDay()]}
                      </span>
                    </th>
                  ))}
                  {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'Late', 'Miss'].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'right' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.employee.id}>
                    <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                      {r.employee.name}
                      <span className="ep-mr-col__desc">{r.employee.code}</span>
                    </th>
                    {r.cells.map((c) => (
                      <td
                        key={c.day}
                        style={{ textAlign: 'center', padding: 'var(--sp-1)' }}
                        title={c.title || undefined}
                      >
                        {c.code ? (
                          <a
                            href={`/leave/attendance/day?emp=${r.employee.id}&day=${c.day}`}
                            style={{
                              color: TONE[c.code.replace('½', '')] ?? 'var(--text-primary)',
                              textDecoration: 'none',
                              fontWeight: 600,
                            }}
                            aria-label={`${r.employee.name} ${c.day}: ${c.title || c.code}`}
                          >
                            {c.code}
                            {c.late ? <sup>L</sup> : null}
                            {c.missing ? <sup>M</sup> : null}
                            {c.manual ? <sup>✎</sup> : null}
                          </a>
                        ) : null}
                      </td>
                    ))}
                    {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'late', 'missing'].map((k) => (
                      <td key={k} style={{ textAlign: 'right' }}>
                        {r.totals[k] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={d.page} size={d.size} total={d.total} href={link} noun="staff" />
        </>
      )}
    </>
  );
}
