import { Badge } from '@edupro/ui';
import { apiFetch } from '@/lib/api';
import type { FeeProfileChange } from '@/lib/types';

const TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const;
const LABEL = {
  pending: 'Waiting for approval',
  approved: 'Approved and applied',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const;

/**
 * The fee change requests of one pupil (discount, fee group, hostel, optional heads): what was asked,
 * who it waits with, and how the last ones ended. Shown to whoever may raise such a request, so a
 * saved request is visible until it is approved and applied.
 */
export async function StudentFeeRequests({ studentId }: { studentId: string }) {
  const rows = await apiFetch<{ data: FeeProfileChange[] }>(
    `/fees/profile-changes?studentId=${studentId}`,
  )
    .then((r) => r.data.slice(0, 6))
    .catch(() => [] as FeeProfileChange[]);
  if (rows.length === 0) return null;
  const waiting = rows.filter((r) => r.status === 'pending').length;
  return (
    <section aria-labelledby="fee-requests-title" style={{ marginTop: 'var(--sp-4)' }}>
      <h3 className="ep-card__title" id="fee-requests-title">
        Fee change requests
      </h3>
      {waiting > 0 ? (
        <p className="ep-field__help">
          A request changes the fee only after it is approved. Until then the fee above stays as it
          was, and a second request for this pupil cannot be sent.
        </p>
      ) : null}
      <div className="ep-table-wrap">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Fee change requests of this pupil</caption>
          <thead>
            <tr>
              <th scope="col">Asked on</th>
              <th scope="col">Change asked</th>
              <th scope="col">Reason</th>
              <th scope="col">Asked by</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.requestedAt).toLocaleString('en-IN')}</td>
                <td>{r.summary ?? 'Fee change'}</td>
                <td>{r.reason}</td>
                <td>{r.requestedBy ?? '—'}</td>
                <td>
                  <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  {r.status === 'pending' && r.waitingWith ? (
                    <div className="ep-field__help">with {r.waitingWith}</div>
                  ) : null}
                  {r.status !== 'pending' && (r.decidedBy || r.decisionNote) ? (
                    <div className="ep-field__help">
                      {r.decidedBy ? `by ${r.decidedBy}` : ''}
                      {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
