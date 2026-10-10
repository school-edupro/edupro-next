import { Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { RefundGrid, type RefundableLine } from '@/components/fees/RefundGrid';
import { apiFetch } from '@/lib/api';
import { requestHeadRefund } from '@/lib/fee-request-actions';

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
  const r = await apiFetch<Refundable>(`/payments/receipts/${paymentId}/refundable`);
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
          />
        ) : (
          <p>This receipt is cancelled, bounced or fully refunded; nothing can be refunded.</p>
        )}
      </Card>
      <p className="ep-field__help">
        The refund goes through the levels set under Fee setup → Approval levels and is approved
        from My approvals. After the last approval the money is taken off the receipt, the refund
        voucher gets its number, and it shows under Fees → Refunds.
      </p>
    </>
  );
}
