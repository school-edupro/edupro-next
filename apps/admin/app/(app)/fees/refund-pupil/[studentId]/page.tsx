import { Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RefundGrid, type RefundableLine } from '@/components/fees/RefundGrid';
import { apiFetch } from '@/lib/api';
import { requestPupilRefund, savePupilRefundDraft } from '@/lib/fee-request-actions';

interface PupilRefundable {
  studentId: string;
  studentName: string;
  admissionNo: string;
  receipts: Array<{
    paymentId: string;
    receiptNo: string | null;
    receivedOn: string;
    mode: string;
    amount: string;
    refunded: string;
    waiting: boolean;
  }>;
  lines: RefundableLine[];
  advance: string;
  lateFee: string;
  draft: {
    id: string;
    amount: string;
    receipts: number;
    lines: Array<{ part: string; demandId?: string; amount: string }>;
    feeAction: string;
    mode: string;
    reference: string | null;
    reason: string;
  } | null;
}
const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');

/**
 * One refund for a pupil over every receipt of the year, chosen by fee head and month. The system
 * takes it from the receipts (newest first); it is one request, one approval and one voucher.
 */
export default async function PupilRefundPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; after?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const r = await apiFetch<PupilRefundable>(`/payments/refunds/student/${studentId}/refundable`);
  const usable = r.receipts.filter((x) => !x.waiting);
  const waiting = r.receipts.filter((x) => x.waiting);
  // opened from the provisional bill: the fee paid for the months after the chosen month is filled in
  const after = /^\d{1,2}$/.test(sp.after ?? '') ? Number(sp.after) : null;
  const ahead = after === null ? [] : r.lines.filter((l) => l.sequence > after);
  const prefill =
    !r.draft && after !== null && (ahead.length > 0 || Number(r.advance) > 0)
      ? {
          lines: [
            ...ahead.map((l) => ({ part: 'fee', demandId: l.demandId, amount: l.paid })),
            ...(Number(r.advance) > 0 ? [{ part: 'advance', amount: r.advance }] : []),
          ],
          feeAction: 'cancel',
          mode: 'bank',
          reference: null,
          reason: '',
        }
      : null;
  return (
    <>
      <PageHeader
        kicker="Fees · Refund"
        title={`Refund for ${r.studentName}`}
        description={`${r.admissionNo} · one refund over ${String(usable.length)} receipt${usable.length === 1 ? '' : 's'} of this session: one approval, one voucher`}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/fees/ledger/${r.studentId}?tab=receipts`}
          >
            Back to the pupil
          </a>
        }
      />
      <Notice params={sp} />
      {r.draft ? (
        <p className="ep-alert ep-alert--info" role="status">
          A draft of {money(r.draft.amount)} over {r.draft.receipts} receipt
          {r.draft.receipts === 1 ? '' : 's'} is saved and is not sent yet. The boxes below show it.{' '}
          <a href={`/fees/refund-voucher/${r.draft.id}`}>
            Open the provisional refund bill (print, send or discard)
          </a>
        </p>
      ) : null}
      {prefill ? (
        <p className="ep-alert ep-alert--info" role="status">
          Opened from the provisional bill: the fee paid for the months after the chosen month
          {Number(r.advance) > 0 ? ' and the advance' : ''} is filled in, with “the fee is
          cancelled”. Change any box before you save. Nothing is saved yet.
        </p>
      ) : null}
      {after !== null ? (
        <p>
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/fees/fnf/${r.studentId}?lastSeq=${String(after)}`}
          >
            Back to the provisional bill
          </a>
        </p>
      ) : null}
      {waiting.length > 0 ? (
        <p className="ep-alert ep-alert--warning" role="status">
          Left out, because a refund on it is already waiting for approval:{' '}
          {waiting.map((x) => x.receiptNo ?? x.paymentId).join(', ')}.
        </p>
      ) : null}
      <Card title="Receipts counted">
        {usable.length > 0 ? (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Receipts of the session this refund can use</caption>
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Date</th>
                  <th scope="col">Mode</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Already refunded
                  </th>
                </tr>
              </thead>
              <tbody>
                {usable.map((x) => (
                  <tr key={x.paymentId}>
                    <td>{x.receiptNo ?? x.paymentId}</td>
                    <td>{dmy(x.receivedOn)}</td>
                    <td>{x.mode}</td>
                    <td style={{ textAlign: 'right' }}>{money(x.amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(x.refunded) > 0 ? money(x.refunded) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No receipt of this session can be refunded.</p>
        )}
      </Card>
      {usable.length > 0 ? (
        <Card title="What to give back">
          <RefundGrid
            pupil
            paymentId=""
            studentId={r.studentId}
            lines={r.lines}
            advance={r.advance}
            lateFee={r.lateFee}
            gateway={false}
            action={requestPupilRefund}
            draftAction={savePupilRefundDraft}
            draft={r.draft ?? prefill}
          />
        </Card>
      ) : null}
      <p className="ep-field__help">
        Each box shows what was paid on that fee over all the receipts above. The amount you type is
        taken from the newest receipt first. “Save as draft and print” keeps it unsent, so the
        provisional refund bill can be printed for the parent. Once sent, it goes through Fee setup
        → Approval levels as one request; after the last approval the money is taken off the
        receipts and one refund voucher number is given for the whole refund.
      </p>
    </>
  );
}
