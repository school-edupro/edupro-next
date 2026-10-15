import { PrintButton } from '@/components/PrintButton';
import { ReceiptCopy, type Receipt } from '@/components/fees/ReceiptCopy';
import { rupees } from '@/components/fees/sheets';
import { apiFetch } from '@/lib/api';

/** One fee receipt as it prints: school copy and parent copy on one A4 sheet. */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  const { paymentId } = await params;
  const sp = await searchParams;
  const r = await apiFetch<Receipt>(`/fees/payments/${paymentId}/receipt-view`);
  return (
    <>
      {/* the school's receipt layout is wide: each copy prints on an A4 landscape page */}
      <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      <div
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {sp.posted ? (
          <span className="ep-alert ep-alert--success" role="status">
            Receipt {r.receiptNo} posted: ₹{rupees(r.amount)}.
          </span>
        ) : null}
        <PrintButton label="Print receipt" />
        <a className="ep-btn ep-btn--secondary" href={`/api/fees/receipt-file?id=${paymentId}`}>
          Download PDF
        </a>
        <a className="ep-btn ep-btn--ghost" href={`/fees/ledger/${r.student.id}?tab=receipts`}>
          Back to the pupil
        </a>
        <a className="ep-btn ep-btn--ghost" href="/fees/cashier">
          Next pupil
        </a>
      </div>
      <ReceiptCopy r={r} label="School copy" />
      <hr className="ep-receipt__cut" />
      <ReceiptCopy r={r} label="Parent copy" />
    </>
  );
}
