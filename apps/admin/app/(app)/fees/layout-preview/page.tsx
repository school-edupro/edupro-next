import { PrintButton } from '@/components/PrintButton';
import { FeeBillSheet, type FeeBillView } from '@/components/fees/FeeBillSheet';
import { InstalmentBillSheet } from '@/components/fees/InstalmentBillSheet';
import { ReceiptCopy, type Receipt } from '@/components/fees/ReceiptCopy';
import { apiFetch } from '@/lib/api';

const NAMES: Record<string, string> = {
  annual: 'School annual bill',
  instalment: 'Instalment bill',
  two_panel: 'Two-panel receipt',
  classic: 'Classic receipt',
};

/**
 * Fee setup -> Receipt numbers, layouts -> Preview: the school's latest receipt, or that pupil's bill, in
 * the layout chosen to look at (not saved; the setting decides what is printed).
 */
export default async function LayoutPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; layout?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === 'bill' ? 'bill' : 'receipt';
  const layout =
    kind === 'bill'
      ? sp.layout === 'instalment'
        ? 'instalment'
        : 'annual'
      : sp.layout === 'classic'
        ? 'classic'
        : 'two_panel';
  const sample = await apiFetch<{ paymentId: string | null; studentId: string | null }>(
    '/fees/layout-sample',
  ).catch(() => ({ paymentId: null, studentId: null }));
  const head = (
    <div
      className="ep-noprint"
      style={{
        display: 'flex',
        gap: 'var(--sp-3)',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 'var(--sp-4)',
      }}
    >
      <a className="ep-btn ep-btn--ghost" href="/fees/masters">
        ← Back to layouts
      </a>
      <strong>Preview: {NAMES[layout]}</strong>
      <span className="ep-field__help">
        The school’s latest {kind === 'bill' ? 'pupil’s bill' : 'receipt'}, shown in this layout.
        Nothing is saved here.
      </span>
      <PrintButton label="Print preview" />
    </div>
  );
  if (!sample.paymentId || !sample.studentId)
    return (
      <>
        {head}
        <p className="ep-alert ep-alert--info" role="status">
          There is no fee receipt yet: the preview shows once the first receipt is made.
        </p>
      </>
    );
  if (kind === 'receipt') {
    const r = await apiFetch<Receipt>(`/fees/payments/${sample.paymentId}/receipt-view`);
    const shown = { ...r, layout: layout as Receipt['layout'] };
    return (
      <>
        {head}
        {layout === 'classic' ? null : (
          <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
        )}
        <ReceiptCopy r={shown} label="Parent copy" />
      </>
    );
  }
  const b = await apiFetch<FeeBillView>(`/fees/students/${sample.studentId}/bill?upTo=9999-12-31`);
  return (
    <>
      {head}
      {layout === 'instalment' ? (
        b.instalments.length > 0 ? (
          <InstalmentBillSheet b={b as never} />
        ) : (
          <p className="ep-field__help">
            This pupil owes nothing: the instalment bill lists only what is payable.
          </p>
        )
      ) : (
        <FeeBillSheet b={b} />
      )}
    </>
  );
}
