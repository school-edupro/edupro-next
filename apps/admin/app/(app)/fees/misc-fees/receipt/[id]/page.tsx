import { Fragment } from 'react';
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
      {/* the two-panel layout is wide: each copy prints on an A4 landscape page; the classic one stays portrait */}
      {r.layout === 'classic' ? null : (
        <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      )}
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
      {/* the copies the school prints (Fee setup -> Receipt numbers) */}
      {(r.copies?.length ? r.copies : ['Parent copy', 'School copy']).map((label, i) => (
        <Fragment key={label}>
          {i > 0 ? <hr className="ep-receipt__cut" /> : null}
          <ReceiptCopy r={r} label={label} />
        </Fragment>
      ))}
    </>
  );
}
