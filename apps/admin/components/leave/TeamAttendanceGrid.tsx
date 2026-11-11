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

/** A month of my team's days: each day's code with its marks, the totals; a day opens its detail. */
export function TeamAttendanceGrid({ d }: { d: AttendanceRegister }) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My team’s attendance">
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
  );
}
