import { Badge } from '@edupro/ui';
import {
  PHASE_LABEL,
  PHASE_TONE,
  monthLabel,
  rideLines,
  rupees,
  whoLine,
  type TransportPeriod,
} from '@/lib/transport-desk';

/**
 * Student transport history: one row per stretch of months a pupil rode (or will ride), with the
 * service, the stoppages, the slab and charge, the request that made it and the one that ended it.
 */
export function PeriodTable({
  periods,
  caption,
  withStudent = false,
}: {
  periods: TransportPeriod[];
  caption: string;
  withStudent?: boolean;
}) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          <tr>
            {withStudent ? <th scope="col">Student</th> : null}
            <th scope="col">Months</th>
            <th scope="col">Service and stoppage</th>
            <th scope="col">Vehicle</th>
            <th scope="col">Slab</th>
            <th scope="col" className="ep-num">
              Monthly
            </th>
            <th scope="col">Approved</th>
            <th scope="col">Ended by</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id}>
              {withStudent ? (
                <td>
                  <a href={`/transport/history?when=all&studentId=${p.studentId}`}>{p.student}</a>
                  <div className="ep-field__help">{whoLine(p)}</div>
                </td>
              ) : null}
              <td>
                {monthLabel(p.fromMonth)} – {monthLabel(p.toMonth)}
              </td>
              <td>
                {p.serviceLabel}
                {rideLines(p).map((l) => (
                  <div key={l} className="ep-field__help">
                    {l}
                  </div>
                ))}
              </td>
              <td>{p.vehicle ?? '—'}</td>
              <td>{p.slab ?? '—'}</td>
              <td className="ep-num">{rupees(p.monthlyAmount)}</td>
              <td>
                {p.requestId ? (
                  <a href={`/transport/requests/${p.requestId}`}>{p.requestNo}</a>
                ) : (
                  'Mapped earlier'
                )}
                <div className="ep-field__help">
                  {[
                    p.source === 'office' ? 'Transport office' : p.source ? 'Family' : null,
                    p.approvedBy,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </td>
              <td>{p.endedBy ?? '—'}</td>
              <td>
                <Badge tone={PHASE_TONE[p.phase] ?? 'neutral'}>
                  {PHASE_LABEL[p.phase] ?? p.phase}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
