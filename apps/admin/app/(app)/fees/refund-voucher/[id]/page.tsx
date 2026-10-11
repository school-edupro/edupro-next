import { Badge, Button } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { discardRefundDraft, sendRefundDraft } from '@/lib/fee-request-actions';
import { PrintButton } from '@/components/PrintButton';
import { dmy, rupees } from '@/components/fees/sheets';
import { apiFetch } from '@/lib/api';

interface Voucher {
  school: { name: string; address: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  year: string;
  voucherNo: string | null;
  refundId: string;
  paymentId: string | null;
  status: 'draft' | 'requested' | 'approved' | 'rejected' | 'paid' | 'failed';
  paidOn: string | null;
  requestedAt: string;
  amount: string;
  amountWords: string;
  mode: string;
  reference: string | null;
  reason: string;
  feeAction: 'due' | 'cancel';
  kind: 'receipt' | 'opening_advance';
  requestedBy: string | null;
  approvedBy: string | null;
  lines: Array<{ head: string; period: string; amount: string }>;
}
const MODE: Record<string, string> = {
  bank: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  gateway: 'Payment gateway',
};
const STATE: Record<Voucher['status'], [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  draft: ['Draft: not sent for approval', 'neutral'],
  requested: ['Waiting for approval', 'warning'],
  approved: ['Approved, payment in progress', 'warning'],
  paid: ['Refunded', 'success'],
  rejected: ['Rejected', 'danger'],
  failed: ['The gateway refund failed', 'danger'],
};

/** The refund voucher as it prints: what was given back head by head, how, and who approved it. */
export default async function RefundVoucherPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const isDraft = (v: Voucher) => v.status === 'draft';
  const v = await apiFetch<Voucher>(`/payments/refunds/${id}/voucher`);
  const [label, tone] = STATE[v.status];
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
        <PrintButton label={isDraft(v) ? 'Print provisional refund bill' : 'Print voucher'} />
        {isDraft(v) ? (
          <>
            <form action={sendRefundDraft}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit">Send for approval</Button>
            </form>
            {v.paymentId ? (
              <a className="ep-btn ep-btn--secondary" href={`/fees/refund/${v.paymentId}`}>
                Change the draft
              </a>
            ) : null}
            <form action={discardRefundDraft}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="ghost">
                Discard the draft
              </Button>
            </form>
          </>
        ) : null}
        <a className="ep-btn ep-btn--secondary" href={`/api/fees/refund-file?id=${id}`}>
          Download PDF
        </a>
        <a className="ep-btn ep-btn--ghost" href="/fees/refunds">
          All refunds
        </a>
        <a className="ep-btn ep-btn--ghost" href={`/fees/ledger/${v.student.id}?tab=receipts`}>
          The pupil
        </a>
      </div>
      <div className="ep-noprint">
        <Notice params={sp} />
        {isDraft(v) ? (
          <p className="ep-alert ep-alert--info" role="status">
            This is a draft. Print it for the parent; nothing has been sent or changed on the
            receipt. After the parent has agreed, press “Send for approval”.
          </p>
        ) : null}
      </div>
      <section className="ep-print-sheet ep-receipt" aria-label="Refund voucher">
        <div className="ep-print-sheet__head">
          <h2 className="ep-h3">{v.school.name}</h2>
          {v.school.address ? <p className="ep-field__help">{v.school.address}</p> : null}
          <p>
            <strong>{isDraft(v) ? 'Provisional refund bill' : 'Refund voucher'}</strong>{' '}
            <Badge tone={tone}>{label}</Badge>
          </p>
        </div>
        <div className="ep-print-sheet__meta">
          <div>
            Voucher no.:{' '}
            <strong>
              {v.voucherNo ??
                (v.status === 'requested' || v.status === 'draft' ? 'given on approval' : '—')}
            </strong>
          </div>
          <div>
            Date: <strong>{dmy(v.paidOn ?? v.requestedAt)}</strong>
          </div>
          <div>
            Student: <strong>{v.student.name}</strong>
          </div>
          <div>
            Admission no.: <strong>{v.student.admissionNo}</strong>
          </div>
          <div>
            Class: <strong>{v.student.section ?? '—'}</strong>
          </div>
          <div>
            Father / guardian: <strong>{v.student.guardian ?? '—'}</strong>
          </div>
          <div>
            Session: <strong>{v.year}</strong>
          </div>
          <div>
            Refunded fee:{' '}
            <strong>
              {v.kind === 'opening_advance'
                ? 'advance from last year'
                : v.feeAction === 'cancel'
                  ? 'cancelled (not asked again)'
                  : 'stays due'}
            </strong>
          </div>
        </div>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">What is refunded</caption>
          <thead>
            <tr>
              <th scope="col">Particulars</th>
              <th scope="col">Period / receipt</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.head}</td>
                <td>{l.period}</td>
                <td style={{ textAlign: 'right' }}>{rupees(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total refunded
              </th>
              <th style={{ textAlign: 'right' }}>{rupees(v.amount)}</th>
            </tr>
          </tfoot>
        </table>
        <p style={{ marginTop: 'var(--sp-2)' }}>
          Rupees <strong>{v.amountWords}</strong> only.
        </p>
        <p>
          Refunded by <strong>{MODE[v.mode] ?? v.mode}</strong>
          {v.reference ? ` · Ref. ${v.reference}` : ''}
        </p>
        <p>Reason: {v.reason}</p>
        <div className="ep-print-sheet__sign">
          <span>Prepared by: {v.requestedBy ?? ''}</span>
          <span>Approved by: {v.approvedBy ?? ''}</span>
          <span>Receiver’s signature</span>
        </div>
      </section>
    </>
  );
}
