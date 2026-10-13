import { Badge } from '@edupro/ui';
import { miscApprove, miscReject } from '@/lib/misc-fee-actions';

export interface MiscRequest {
  id: string;
  miscFeeId: string | null;
  feeTitle: string | null;
  receiptNo: string | null;
  kind: string;
  payload: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  workflowInstanceId: string | null;
  waitingWith: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  voucherNo: string | null;
  student: string | null;
  admissionNo: string | null;
}
export const MISC_KIND: Record<string, string> = {
  announce: 'Announce the fee',
  extend: 'Extend the last date',
  pupil_change: 'Change a pupil',
  add_pupils: 'Add pupils',
  close: 'Close the fee',
  receipt_cancel: 'Cancel a receipt',
  receipt_bounce: 'Cheque bounced',
  receipt_refund: 'Refund',
};
const dmy = (v: unknown) =>
  typeof v === 'string' && v ? v.slice(0, 10).split('-').reverse().join('-') : '';
const what = (r: MiscRequest) => {
  const p = r.payload;
  if (r.kind === 'announce') return `${String(p.pupils ?? '')} pupil(s), ₹${String(p.total ?? '')}`;
  if (r.kind === 'extend') return `${dmy(p.from)} to ${dmy(p.lastDate)}`;
  if (r.kind === 'pupil_change')
    return [
      p.amount !== undefined && p.amount !== null
        ? `amount ₹${String(p.fromAmount)} to ₹${String(p.amount)}`
        : '',
      p.lastDate ? `last date ${dmy(p.fromDate)} to ${dmy(p.lastDate)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  if (r.kind === 'add_pupils')
    return `${String(Array.isArray(p.pupils) ? p.pupils.length : 0)} pupil(s)`;
  if (r.kind.startsWith('receipt_')) return `${r.receiptNo ?? ''} · ₹${String(p.amount ?? '')}`;
  return '';
};

/** The requests about misc fees, with the decision where the school has no approval level in force. */
export function MiscRequests({
  rows,
  canDecide,
  back,
  showFee = true,
}: {
  rows: MiscRequest[];
  canDecide: boolean;
  back: string;
  showFee?: boolean;
}) {
  if (rows.length === 0) return <p className="ep-field__help">No request.</p>;
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Misc fee requests">
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">Misc fee requests</caption>
        <thead>
          <tr>
            <th scope="col">Asked on</th>
            <th scope="col">Request</th>
            {showFee ? <th scope="col">Fee</th> : null}
            <th scope="col">Pupil</th>
            <th scope="col">What</th>
            <th scope="col">Reason</th>
            <th scope="col">Asked by</th>
            <th scope="col">Status</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dmy(r.requestedAt)}</td>
              <td>{MISC_KIND[r.kind] ?? r.kind}</td>
              {showFee ? (
                <td>
                  {r.miscFeeId ? <a href={`/fees/misc-fees/${r.miscFeeId}`}>{r.feeTitle}</a> : '—'}
                </td>
              ) : null}
              <td>{r.student ? `${r.student} · ${r.admissionNo ?? ''}` : '—'}</td>
              <td>{what(r)}</td>
              <td>{r.reason}</td>
              <td>{r.requestedBy ?? '—'}</td>
              <td>
                <Badge
                  tone={
                    r.status === 'approved'
                      ? 'success'
                      : r.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {r.status === 'pending'
                    ? 'Waiting'
                    : r.status === 'approved'
                      ? 'Approved'
                      : 'Rejected'}
                </Badge>
                {r.voucherNo ? ` Voucher ${r.voucherNo}` : ''}
              </td>
              <td>
                {r.status !== 'pending' ? (
                  `${r.decidedBy ?? ''}${r.decisionNote ? ` · ${r.decisionNote}` : ''}`
                ) : r.workflowInstanceId ? (
                  <>
                    {r.waitingWith ?? 'With the approver'} ·{' '}
                    <a href="/workflow/inbox" style={{ textDecoration: 'underline' }}>
                      My approvals
                    </a>
                  </>
                ) : canDecide ? (
                  <form style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="back" value={back} />
                    <input
                      name="note"
                      className="ep-input"
                      maxLength={300}
                      placeholder="Note"
                      aria-label={`Note on request ${r.id}`}
                    />
                    <button
                      type="submit"
                      formAction={miscApprove}
                      className="ep-btn ep-btn--primary ep-btn--sm"
                    >
                      Approve
                    </button>
                    <button
                      type="submit"
                      formAction={miscReject}
                      className="ep-btn ep-btn--danger ep-btn--sm"
                    >
                      Reject
                    </button>
                  </form>
                ) : (
                  'Waiting for a decision'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
