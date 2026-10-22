import { Badge } from './Badge';
import type { FeeReceipt } from './FeeReceiptSheet';

const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

/** The classic receipt (one column, particulars by period), kept as a layout the school may choose. */
export function FeeReceiptClassic({ r, label }: { r: FeeReceipt; label: string }) {
  const staff = r.student.kind === 'employee';
  const outsider = r.student.kind === 'other';
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
          {outsider ? 'Received from' : staff ? 'Staff member' : 'Student'}:{' '}
          <strong>{r.student.name}</strong>
        </div>
        {outsider ? (
          <div>
            Mobile: <strong>{r.mobiles ?? '—'}</strong>
          </div>
        ) : (
          <>
            <div>
              {staff ? 'Employee code' : 'Admission no.'}: <strong>{r.student.admissionNo}</strong>
            </div>
            <div>
              {staff ? 'Designation' : 'Class'}: <strong>{r.student.section ?? '—'}</strong>
            </div>
          </>
        )}
        {staff || outsider ? null : (
          <div>
            Father / guardian: <strong>{r.student.guardian ?? '—'}</strong>
          </div>
        )}
        <div>
          Session: <strong>{r.year}</strong>
        </div>
        <div>
          Fee type:{' '}
          <strong>
            {r.feeType === 'hostel' ? 'Hostel' : r.feeType === 'misc' ? 'Misc' : 'Regular'}
          </strong>
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
