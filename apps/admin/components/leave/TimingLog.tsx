import type { TimingLogPage } from '@/lib/leave';

const ACTION: Record<string, string> = {
  added: 'Added',
  changed: 'Changed',
  ended: 'Ended',
  removed: 'Removed',
};
const show = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? String(v) : String(v);

/** The timing change log: who changed which timing, when, what (old → new) and from when it applies. */
export function TimingLog({ log, first }: { log: TimingLogPage; first: number }) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Timing change log">
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">Timing change log</caption>
        <thead>
          <tr>
            <th scope="col">S.No</th>
            <th scope="col">When / by</th>
            <th scope="col">Timing</th>
            <th scope="col">What</th>
            <th scope="col">Effective</th>
            <th scope="col">Changes</th>
          </tr>
        </thead>
        <tbody>
          {log.rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="ep-field__help">
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
                <span className="ep-mr-col__desc">
                  {r.kind === 'special' ? 'Special timing' : 'Department timing'}
                </span>
              </td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td>
                {r.from_date ? r.from_date.split('-').reverse().join('-') : 'From the start'}
                {r.to_date ? ` to ${r.to_date.split('-').reverse().join('-')}` : ''}
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
