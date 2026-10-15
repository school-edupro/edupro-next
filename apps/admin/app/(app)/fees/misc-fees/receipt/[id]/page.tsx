import { PrintButton } from '@/components/PrintButton';
import { ReceiptCopy, type Receipt } from '@/components/fees/ReceiptCopy';
import { rupees } from '@/components/fees/sheets';
import { apiFetch } from '@/lib/api';

/** A misc fee receipt as it prints: school copy and parent copy on one A4 sheet. */
export default async function MiscReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const r = await apiFetch<Receipt>(`/fees/misc-fees/receipts/${id}/receipt-view`);
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
            Receipt {r.receiptNo} made: ₹{rupees(r.amount)}.
          </span>
        ) : null}
        <PrintButton label="Print receipt" />
        <a
          className="ep-btn ep-btn--ghost"
          href={`/fees/misc-fees/collect?studentId=${r.student.id}`}
        >
          Back to the pupil
        </a>
        <a className="ep-btn ep-btn--ghost" href="/fees/misc-fees/collect">
          Next pupil
        </a>
      </div>
      <ReceiptCopy r={r} label="School copy" />
      <hr className="ep-receipt__cut" />
      <ReceiptCopy r={r} label="Parent copy" />
    </>
  );
}
