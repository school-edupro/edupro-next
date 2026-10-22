import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { ReceiptCopy, type Receipt } from '@/components/fees/ReceiptCopy';
import { ApiError, apiFetch, getMe } from '@/lib/api';

/** The misc receipt of a book sale to someone outside, as it prints (the school's copies, like any receipt). */
export default async function SaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me.permissions.includes('library.stock.verify') || !/^\d{1,18}$/.test(id)) notFound();
  let r: Receipt;
  try {
    r = await apiFetch<Receipt>(`/library/sales/orders/${id}/receipt`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
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
        <PrintButton label="Print receipt" />
        <a className="ep-btn ep-btn--ghost" href={`/library/sales/${id}`}>
          Back to the sale
        </a>
      </div>
      {(r.copies?.length ? r.copies : ['Payer copy', 'School copy']).map((label, i) => (
        <Fragment key={label}>
          {i > 0 ? <hr className="ep-receipt__cut" /> : null}
          <ReceiptCopy r={r} label={label} />
        </Fragment>
      ))}
    </>
  );
}
