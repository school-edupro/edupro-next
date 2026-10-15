import { PupilMeta, SheetHead, dmy, rupees } from './sheets';

export interface InstalmentBill {
  school: { name: string; address: string };
  year: string;
  billDate: string;
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  instalments: Array<{
    label: string;
    dueOn: string;
    challanOn: string | null;
    ledger: string;
    lines: Array<{ head: string; fee: string; discount: string; paid: string; balance: string }>;
    balance: string;
    lateFee: string;
  }>;
  totals: { fee: string; lateFee: string; payable: string; payableWords: string };
}

/**
 * The instalment-wise fee bill (the earlier layout): what is payable instalment by instalment, head by
 * head, with the late fee. Kept as a layout the school may choose (Fee setup -> Receipt numbers).
 */
export function InstalmentBillSheet({ b }: { b: InstalmentBill }) {
  return (
    <section
      key={b.student.id}
      className="ep-print-sheet"
      aria-label={`Fee bill of ${b.student.name}`}
      style={{ marginTop: 'var(--sp-5)' }}
    >
      <SheetHead school={b.school} title={`Fee bill · Session ${b.year}`} />
      <PupilMeta student={b.student} extra={[['Bill date', dmy(b.billDate)]]} />
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">Fee payable by {b.student.name}</caption>
        <thead>
          <tr>
            <th scope="col">Instalment</th>
            <th scope="col">Last date</th>
            <th scope="col">Particulars</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Fee
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Discount
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Paid
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Payable (₹)
            </th>
          </tr>
        </thead>
        <tbody>
          {b.instalments.flatMap((i) => [
            ...i.lines.map((l, n) => (
              <tr key={`${i.dueOn}-${i.ledger}-${l.head}`}>
                <td>{n === 0 ? `${i.label}${i.ledger === 'hostel' ? ' (hostel)' : ''}` : ''}</td>
                <td>
                  {n === 0 ? dmy(i.dueOn) : ''}
                  {n === 0 && i.challanOn ? (
                    <div className="ep-field__help">Challan: {dmy(i.challanOn)}</div>
                  ) : null}
                </td>
                <td>{l.head}</td>
                <td style={{ textAlign: 'right' }}>{rupees(l.fee)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(l.discount)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(l.paid)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(l.balance)}</td>
              </tr>
            )),
            Number(i.lateFee) > 0 ? (
              <tr key={`${i.dueOn}-${i.ledger}-late`}>
                <td />
                <td />
                <td>Late fee</td>
                <td />
                <td />
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(i.lateFee)}</td>
              </tr>
            ) : null,
          ])}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={6}>
              Total payable
            </th>
            <th style={{ textAlign: 'right' }}>{rupees(b.totals.payable)}</th>
          </tr>
        </tfoot>
      </table>
      <p style={{ marginTop: 'var(--sp-3)' }}>
        Amount in words: <strong>{b.totals.payableWords}</strong>
      </p>
      <p className="ep-field__help">
        Late fee is as on the bill date and may change with the date of payment.
      </p>
      <div className="ep-print-sheet__sign">
        <span>Parent’s signature</span>
        <span>Accounts office</span>
      </div>
    </section>
  );
}
