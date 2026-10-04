import { Badge } from '@edupro/ui';
import { when } from '@/lib/appointments';
import { APPROVAL_LABEL, APPROVAL_TONE, type GatePassDetail } from '@/lib/gate-passes';

/** The approval matrix of one pass: every level, who holds it, what they decided and when. */
export function ApprovalTrail({ pass }: { pass: GatePassDetail }) {
  return (
    <>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {pass.approvalMode === 'any'
          ? `Any ${String(pass.approvalNeed)} of these approve.`
          : 'One after another, in this order.'}
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Approval levels">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Approval levels of {pass.number}</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Who</th>
              <th scope="col">Status</th>
              <th scope="col">Decided by</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {pass.approvals.map((a) => (
              <tr key={a.seq}>
                <td>
                  {a.seq}. {a.label}
                </td>
                <td>{a.approvers ?? '—'}</td>
                <td>
                  <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</Badge>
                </td>
                <td>
                  {a.actedBy ?? '—'}
                  {a.actedAt ? <div className="ep-field__help">{when(a.actedAt)}</div> : null}
                </td>
                <td>{a.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
