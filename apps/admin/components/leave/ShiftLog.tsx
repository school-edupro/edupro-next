import type { ShiftLogPage } from '@/lib/leave';

const ACTION: Record<string, string> = {
  added: 'Posted',
  changed: 'Changed',
  ended: 'Ended',
  removed: 'Removed',
};
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const day = (d: string) => d.split('-').reverse().join('-');

/** The shift posting change log: who posted or changed which shift for whom, when, and for which days. */
export function ShiftLog({ log, first }: { log: ShiftLogPage; first: number }) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Shift change log">
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">Shift posting change log</caption>
        <thead>
          <tr>
            <th scope="col">S.No</th>
            <th scope="col">When / by</th>
            <th scope="col">Employee</th>
            <th scope="col">Shift</th>
            <th scope="col">What</th>
            <th scope="col">Days</th>
            <th scope="col">Changes</th>
          </tr>
        </thead>
        <tbody>
          {log.rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="ep-field__help">
                No change matches these filters.
              </td>
            </tr>
          ) : null}
          {log.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{first + i}</td>
              <td>
                {r.at}
                <span className="ep-mr-col__desc">{r.by ?? 'System'}</span>
              </td>
              <td>
                <strong>{r.subject}</strong>
                {r.department ? <span className="ep-mr-col__desc">{r.department}</span> : null}
              </td>
              <td>{r.shift}</td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td>
                {r.from_date
                  ? r.to_date === r.from_date
                    ? `${day(r.from_date)} only`
                    : `${day(r.from_date)} to ${r.to_date ? day(r.to_date) : 'until changed'}`
                  : ''}
              </td>
              <td>
                <ul className="ep-approvers">
                  {r.changes.map((x, j) => (
                    <li key={j}>
                      <span className="ep-field__help">{x.field}:</span>{' '}
                      {r.action === 'added' ? (
                        show(x.new)
                      ) : (
                        <>
                          <s>{show(x.old)}</s> → <strong>{show(x.new)}</strong>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
