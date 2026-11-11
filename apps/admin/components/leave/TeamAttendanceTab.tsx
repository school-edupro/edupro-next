import { ListBar, Pages } from '@/components/leave/ListBar';
import { TeamAttendanceGrid } from '@/components/leave/TeamAttendanceGrid';
import { dmy, type TeamAttendance, type TeamEmployee } from '@/lib/leave';

const NOBODY =
  'Nobody reports to you this year (the reporting manager on each employee’s posting).';

/**
 * Reporties Attendance (My leave → Reporties Attendance): Employee, From and To. All employees: a column a
 * day (up to 31 days); one employee: their days one by one (up to 92), as the old screen — S.No., Date,
 * Day, Attendance, In, Out, Remark. A page at a time; all of it as Excel or PDF.
 */
export function TeamAttendanceTab({
  a,
  employees,
  f,
  link,
  problem,
}: {
  a: TeamAttendance | null;
  /** for the filter when the range was refused (no answer to take them from) */
  employees: TeamEmployee[];
  f: { employeeId: string; from: string; to: string; size: string };
  link: (page: number, size?: string) => string;
  /** why the range was refused (more than 31 days for all, 92 for one) */
  problem: string | null;
}) {
  const list = a?.employees ?? employees;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/team-attendance-file?${new URLSearchParams({
      format,
      from: f.from,
      to: f.to,
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    }).toString()}`;
  return (
    <section aria-label="Reporties attendance">
      <form method="get" action="/leave" className="ep-card ep-myleave__filter" aria-label="Filter">
        <input type="hidden" name="tab" value="team-attendance" />
        <input type="hidden" name="size" value={f.size} />
        <label className="ep-field" htmlFor="ta-emp">
          <span className="ep-field__label">Employee</span>
          <select id="ta-emp" name="employeeId" className="ep-select" defaultValue={f.employeeId}>
            <option value="">All employees</option>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.code})
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="ta-from">
          <span className="ep-field__label">From Date</span>
          <input
            id="ta-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={f.from}
            required
          />
        </label>
        <label className="ep-field" htmlFor="ta-to">
          <span className="ep-field__label">To Date</span>
          <input
            id="ta-to"
            name="to"
            type="date"
            className="ep-input"
            defaultValue={f.to}
            required
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Search
        </button>
        <p className="ep-field__help" style={{ flexBasis: '100%', margin: 0 }}>
          All employees: a column a day, up to 31 days. One employee: their days one by one, up to
          92 days.
        </p>
      </form>
      {problem ? (
        <p className="ep-alert ep-alert--warning" role="alert">
          <span>{problem}</span>
        </p>
      ) : !a ? null : !a.team ? (
        <p className="ep-alert ep-alert--info" role="status">
          <span>{NOBODY}</span>
        </p>
      ) : a.mode === 'grid' ? (
        <>
          <p className="ep-field__help">
            {dmy(a.from)} to {dmy(a.to)}: P present, HD half day, A absent, WO weekly off, H
            holiday, the leave’s code; L late, F a punch missing, m set by hand. Click a day to see
            its punches.
          </p>
          <ListBar
            page={a.page}
            size={a.size}
            total={a.total}
            href={(p) => link(p)}
            sizeHref={(s) => link(1, s)}
            noun="staff"
            files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
          />
          <TeamAttendanceGrid d={a} />
          <Pages page={a.page} size={a.size} total={a.total} href={(p) => link(p)} noun="staff" />
        </>
      ) : (
        <>
          <h2 className="ep-card__title">
            {a.employee.name} ({a.employee.code}) · {dmy(a.from)} to {dmy(a.to)}
          </h2>
          <ul className="ep-chips" aria-label={`${a.employee.name}: the days added up`}>
            {Object.entries(a.totals).map(([k, v]) => (
              <li key={k} className="ep-chip">
                {k === 'late' ? 'Late' : k === 'missing' ? 'Punch missing' : k} <strong>{v}</strong>
              </li>
            ))}
          </ul>
          <ListBar
            page={a.page}
            size={a.size}
            total={a.total}
            href={(p) => link(p)}
            sizeHref={(s) => link(1, s)}
            noun="days"
            files={{ xlsx: file('xlsx'), pdf: file('pdf') }}
          />
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${a.employee.name}: attendance`}
          >
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">S.No.</th>
                  <th scope="col">Date</th>
                  <th scope="col">Day</th>
                  <th scope="col">Attendance</th>
                  <th scope="col">In Time</th>
                  <th scope="col">Out Time</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Hours
                  </th>
                  <th scope="col">Remark</th>
                </tr>
              </thead>
              <tbody>
                {a.days.map((d, i) => (
                  <tr key={d.day}>
                    <td>{(a.page - 1) * a.size + i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a href={`/leave/attendance/day?emp=${a.employee.id}&day=${d.day}`}>
                        {dmy(d.day)}
                      </a>
                    </td>
                    <td>{d.weekday}</td>
                    <td>
                      {d.code && d.code !== '·' ? <strong>{d.code}</strong> : null} {d.words ?? ''}
                      {d.manual ? <span className="ep-mr-col__desc">set by hand</span> : null}
                      {d.missing ? <span className="ep-mr-col__desc">a punch missing</span> : null}
                    </td>
                    <td>{d.in ?? ''}</td>
                    <td>{d.out ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{d.worked ?? ''}</td>
                    <td>
                      {d.lateEarly ? <span className="ep-mr-col__desc">{d.lateEarly}</span> : null}
                      {d.remark ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pages page={a.page} size={a.size} total={a.total} href={(p) => link(p)} noun="days" />
        </>
      )}
    </section>
  );
}
