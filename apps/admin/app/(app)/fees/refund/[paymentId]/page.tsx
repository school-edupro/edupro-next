import { Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RefundGrid, type RefundableLine } from '@/components/fees/RefundGrid';
import { apiFetch } from '@/lib/api';
import { requestHeadRefund, saveHeadRefundDraft } from '@/lib/fee-request-actions';

interface Refundable {
  paymentId: string;
  receiptNo: string | null;
  studentId: string;
  studentName: string;
  admissionNo: string;
  receivedOn: string;
  mode: string;
  status: string;
  amount: string;
  refunded: string;
  lateFee: string;
  advance: string;
  gateway: boolean;
  lines: RefundableLine[];
}
interface Draft {
  id: string;
  amount: string;
  lines: Array<{ part: string; demandId?: string; amount: string }>;
  feeAction: string;
  mode: string;
  reference: string | null;
  reason: string;
}
const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Refund of one receipt, by fee head: goes through Fee setup → Approval levels, then a voucher. */
export default async function RefundPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { paymentId } = await params;
  const sp = await searchParams;
  const [r, draft] = await Promise.all([
    apiFetch<Refundable>(`/payments/receipts/${paymentId}/refundable`),
    apiFetch<{ draft: Draft | null }>(`/payments/receipts/${paymentId}/refund-draft`)
      .then((x) => x.draft)
      .catch(() => null),
  ]);
  const open = ['posted', 'partly_refunded'].includes(r.status);
  return (
    <>
      <PageHeader
        kicker="Fees · Refund"
        title={`Refund from receipt ${r.receiptNo ?? ''}`}
        description={`${r.studentName} · ${r.admissionNo} · received ${r.receivedOn.split('-').reverse().join('-')} by ${r.mode} · ${money(r.amount)}${Number(r.refunded) > 0 ? ` · already refunded ${money(r.refunded)}` : ''}`}
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
      {draft ? (
        <p className="ep-alert ep-alert--info" role="status">
          A draft of ₹{Number(draft.amount).toLocaleString('en-IN')} is saved for this receipt and
          is not sent yet. The boxes below show it.{' '}
          <a href={`/fees/refund-voucher/${draft.id}`}>
            Open the provisional refund bill (print, send or discard)
          </a>
        </p>
      ) : null}
      <Card title="What to give back">
        {open ? (
          <RefundGrid
            paymentId={r.paymentId}
            studentId={r.studentId}
            lines={r.lines}
            advance={r.advance}
            lateFee={r.lateFee}
            gateway={r.gateway}
            action={requestHeadRefund}
            draftAction={saveHeadRefundDraft}
            draft={draft}
          />
        ) : (
          <p>This receipt is cancelled, bounced or fully refunded; nothing can be refunded.</p>
        )}
      </Card>
      <p className="ep-field__help">
        “Save as draft and print” keeps it unsent, so the provisional refund bill can be printed for
        the parent first. Once sent, the refund goes through the levels set under Fee setup →
        Approval levels and is approved from My approvals. After the last approval the money is
        taken off the receipt, the refund voucher gets its number, and it shows under Fees →
        Refunds.
      </p>
    </>
  );
}
