import { Badge } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { PrintButton } from '@/components/PrintButton';
import { bff } from '@/lib/bff';

const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

interface Receipt {
  school: { name: string; address: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  year: string;
  receiptNo: string | null;
  receivedOn: string;
  amount: string;
  amountWords: string;
  lateFee: string;
  advance: string;
  refunded: string;
  status: string;
  mode: string;
  modeKind: string;
  feeType: string;
  reference: string | null;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  remarks: string | null;
  receivedBy: string | null;
  depositAccount: string | null;
  lines: Array<{ head: string; period: string; amount: string }>;
}

function Copy({ r, label }: { r: Receipt; label: string }) {
  const cancelled = r.status === 'reversed' || r.status === 'bounced';
  return (
    <section className="ep-print-sheet ep-receipt" aria-label={`Fee receipt, ${label}`}>
      <div className="ep-print-sheet__head">
        <h2 className="ep-h3">{r.school.name}</h2>
        {r.school.address ? <p className="ep-field__help">{r.school.address}</p> : null}
        <p>
          <strong>Fee receipt</strong> · {label}{' '}
          {cancelled ? (
            <Badge tone="danger">{r.status === 'bounced' ? 'Cheque bounced' : 'Cancelled'}</Badge>
          ) : null}
        </p>
      </div>
      <div className="ep-print-sheet__meta">
        <div>
          Receipt no.: <strong>{r.receiptNo ?? '—'}</strong>
        </div>
        <div>
          Date: <strong>{dmy(r.receivedOn)}</strong>
        </div>
        <div>
          Student: <strong>{r.student.name}</strong>
        </div>
        <div>
          Admission no.: <strong>{r.student.admissionNo}</strong>
        </div>
        <div>
          Class: <strong>{r.student.section ?? '—'}</strong>
        </div>
        <div>
          Father / guardian: <strong>{r.student.guardian ?? '—'}</strong>
        </div>
        <div>
          Session: <strong>{r.year}</strong>
        </div>
        <div>
          Fee type: <strong>{r.feeType === 'hostel' ? 'Hostel' : 'Regular'}</strong>
        </div>
      </div>
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">What the receipt paid</caption>
        <thead>
          <tr>
            <th scope="col">Particulars</th>
            <th scope="col">Period</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Amount (₹)
            </th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.head}</td>
              <td>{l.period}</td>
              <td style={{ textAlign: 'right' }}>{rupees(l.amount)}</td>
            </tr>
          ))}
          {Number(r.lateFee) > 0 ? (
            <tr>
              <td>Late fee</td>
              <td />
              <td style={{ textAlign: 'right' }}>{rupees(r.lateFee)}</td>
            </tr>
          ) : null}
          {Number(r.advance) > 0 ? (
            <tr>
              <td>Advance (kept for the next dues)</td>
              <td />
              <td style={{ textAlign: 'right' }}>{rupees(r.advance)}</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              Total received
            </th>
            <th style={{ textAlign: 'right' }}>{rupees(r.amount)}</th>
          </tr>
        </tfoot>
      </table>
      <p style={{ marginTop: 'var(--sp-2)' }}>
        Rupees <strong>{r.amountWords}</strong> only.
      </p>
      <p>
        Paid by <strong>{r.mode}</strong>
        {r.instrumentNo ? ` no. ${r.instrumentNo}` : ''}
        {r.instrumentDate ? ` dated ${dmy(r.instrumentDate)}` : ''}
        {r.bankName ? `, ${r.bankName}` : ''}
        {r.reference ? ` · Ref. ${r.reference}` : ''}
        {r.depositAccount ? ` · Into ${r.depositAccount}` : ''}
      </p>
      {r.modeKind === 'cheque' || r.modeKind === 'dd' ? (
        <p className="ep-field__help">Subject to realisation of the cheque / draft.</p>
      ) : null}
      {Number(r.refunded) > 0 ? <p>Refunded since: ₹{rupees(r.refunded)}</p> : null}
      {r.remarks ? <p>Remarks: {r.remarks}</p> : null}
      <div className="ep-print-sheet__sign">
        <span>Received by: {r.receivedBy ?? ''}</span>
        <span>Cashier’s signature</span>
      </div>
    </section>
  );
}

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
  let r: Receipt;
  try {
    r = await bff.api.fetch<Receipt>(`/fees/mine/receipts/${paymentId}/view`);
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
        <PrintButton label="Print or save as PDF" />
        <a className="ep-btn ep-btn--ghost" href={`/fees?student=${r.student.id}`}>
          Back to fees
        </a>
      </div>
      <Copy r={r} label="Parent copy" />
    </>
  );
}
