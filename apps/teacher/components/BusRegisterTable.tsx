export interface BusRegister {
  school?: string;
  route: string;
  vehicle?: string | null;
  tripLabel: string;
  trips: Array<'pick' | 'drop'>;
  month: string;
  days: string[];
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string | null;
    section: string | null;
    stop: string | null;
    rides: Array<'pick' | 'drop'>;
    pick: Record<string, string>;
    drop: Record<string, string>;
    presentPick: number;
    presentDrop: number;
    present: number;
    absent: number;
    leave: number;
    gatePass: number;
    other: number;
  }>;
}

/**
 * The bus register of a route for a month: a row per student and, under each date, the morning (M) and
 * the afternoon (A) trip, with the totals at the end.
 */
export function BusRegisterTable({ reg }: { reg: BusRegister }) {
  const both = reg.trips.length === 2;
  const totals = both
    ? ['On bus M', 'On bus A', 'Not on bus', 'Leave', 'Gate pass', 'Other']
    : ['On bus', 'Not on bus', 'Leave', 'Gate pass', 'Other'];
  return (
    <table className="ep-table ep-table--dense">
      <caption className="ep-sr-only">
        Bus attendance register of {reg.route}, {reg.month}
      </caption>
      <thead>
        <tr>
          <th scope="col" rowSpan={both ? 2 : 1}>
            Student
          </th>
          {reg.days.map((d) => (
            <th
              key={d}
              scope={both ? 'colgroup' : 'col'}
              colSpan={both ? 2 : 1}
              style={{ textAlign: 'center' }}
              title={d}
            >
              {d.slice(8)}
            </th>
          ))}
          {totals.map((h) => (
            <th key={h} scope="col" rowSpan={both ? 2 : 1} className="ep-num">
              {h}
            </th>
          ))}
        </tr>
        {both ? (
          <tr>
            {reg.days.flatMap((d) =>
              reg.trips.map((t) => (
                <th key={`${d}-${t}`} scope="col" style={{ textAlign: 'center' }}>
                  <abbr title={t === 'pick' ? 'Morning (pick)' : 'Afternoon (drop)'}>
                    {t === 'pick' ? 'M' : 'A'}
                  </abbr>
                </th>
              )),
            )}
          </tr>
        ) : null}
      </thead>
      <tbody>
        {reg.rows.map((r) => (
          <tr key={r.studentId}>
            <th scope="row">
              {r.name}
              <div className="ep-field__help">
                {[r.section, r.admissionNo, r.stop].filter(Boolean).join(' · ')}
              </div>
            </th>
            {reg.days.flatMap((d) =>
              reg.trips.map((t) => (
                <td key={`${d}-${t}`} style={{ textAlign: 'center' }}>
                  {r.rides.includes(t) ? ((t === 'pick' ? r.pick : r.drop)[d] ?? '–') : ''}
                </td>
              )),
            )}
            {both ? (
              <>
                <td className="ep-num">{r.presentPick}</td>
                <td className="ep-num">{r.presentDrop}</td>
              </>
            ) : (
              <td className="ep-num">{r.present}</td>
            )}
            <td className="ep-num">{r.absent}</td>
            <td className="ep-num">{r.leave}</td>
            <td className="ep-num">{r.gatePass}</td>
            <td className="ep-num">{r.other}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
