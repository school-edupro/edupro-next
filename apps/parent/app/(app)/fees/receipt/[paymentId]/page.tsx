import { FeeReceiptSheet, type FeeReceipt } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { PrintButton } from '@/components/PrintButton';
import { bff } from '@/lib/bff';

/**
 * One of the family's own receipts, shown at once and printable (or saved as PDF from the print
 * dialog). It does not wait for a file to be made.
 */
export default async function MyReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  if (!/^\d+$/.test(paymentId)) redirect('/fees');
  let r: FeeReceipt;
  try {
    r = await bff.api.fetch<FeeReceipt>(`/fees/mine/receipts/${paymentId}/view`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect('/login?error=session-expired');
      redirect(`/fees?error=${encodeURIComponent(error.problem.type)}`);
    }
    throw error;
  }
  return (
    <>
      <div
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <PrintButton label="Print receipt" />
        <a className="ep-btn ep-btn--secondary" href={`/fees/receipt/${paymentId}/pdf`}>
          Download PDF
        </a>
        <a className="ep-btn ep-btn--ghost" href={`/fees?student=${r.student.id}`}>
          Back to fees
        </a>
      </div>
      {/* the school's receipt layout is wide: it prints on an A4 landscape page */}
      {r.layout === 'classic' ? null : (
        <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      )}
      <FeeReceiptSheet r={r} label="Parent copy" />
    </>
  );
}
