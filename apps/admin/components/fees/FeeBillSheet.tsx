import { Fragment } from 'react';
import { dmy, rupees } from './sheets';

export interface FeeBillView {
  school: { name: string; address: string };
  letterhead: {
    phone: string | null;
    email: string | null;
    website: string | null;
    logoFileId: string | null;
  };
  billNo: string;
  year: string;
  session: { from: string; to: string };
  billDate: string;
  generatedAt: string;
  ledger: 'all' | 'school' | 'hostel';
  layout?: 'annual' | 'instalment';
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    dob: string | null;
    father: string | null;
    mother: string | null;
    route: string | null;
  };
  heads: Array<{ ledger: string; head: string; optional: boolean; amount: string }>;
  discount: string;
  headsThrough: string | null;
  schedules: Array<{
    ledger: string;
    payPlan: string;
    rows: Array<{
      no: string;
      months: string;
      dueOn: string;
      payable: string;
      paid: string;
      balance: string;
      lateFee: string;
    }>;
  }>;
  receipts: Array<{
    receiptNo: string | null;
    mode: string;
    instrumentNo: string | null;
    receivedOn: string;
    amount: string;
    lateFee: string;
    bounceCharge: string;
    status: string;
    counted: boolean;
    finalAmount: string;
  }>;
  summary: {
    due: string;
    lateFee: string;
    received: string;
    refund: string;
    advance: string;
    balance: string;
    balanceWords: string;
  };
  notes: { bounceCharge: string; lateFeeMode: string; latePerDay: string | null };
  instalments: unknown[];
}

const PLAN: Record<string, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  half_yearly: 'half-yearly',
  yearly: 'yearly',
};
const FEE: Record<string, string> = { school: 'School fee', hostel: 'Hostel fee' };
const STATUS: Record<string, string> = {
  bounced: 'Cheque returned',
  refunded: 'Refunded',
  partly_refunded: 'Part refunded',
};
const words = (w: string) =>
  `${w.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())}${/only$/i.test(w) ? '' : ' Only'}`;
const stamp = (v: string) => {
  const [d = '', t = ''] = v.split(' ');
  const [y, , dd] = d.split('-');
  const mon = new Date(`${d}T00:00:00Z`).toLocaleString('en-IN', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${dd}-${mon}-${y} ${t}`.trim();
};

/**
 * The annual fee bill as the school prints it: letterhead, the pupil's particulars, the heads of the
 * session with the grand total in words, the instalment schedule of each fee with what is paid and what
 * is left, the receipts, the balance, and the school's notes on payment.
 */
export function FeeBillSheet({ b }: { b: FeeBillView }) {
  const sections: Array<[string | null, FeeBillView['heads']]> = [
    [null, b.heads.filter((h) => h.ledger === 'school' && !h.optional)],
    ['Optional fees', b.heads.filter((h) => h.ledger === 'school' && h.optional)],
    ['Hostel fees', b.heads.filter((h) => h.ledger === 'hostel')],
  ];
  const gross = b.heads.reduce((a, h) => a + Number(h.amount), 0);
  const total = gross - Number(b.discount);
  const title =
    b.ledger === 'hostel'
      ? 'Hostel Fee Bill'
      : b.ledger === 'school'
        ? 'School Fee Bill'
        : 'Annual Fee Bill';
  const through = b.headsThrough ? ` till ${b.headsThrough}` : '';
  const late = b.schedules.some((s) => s.rows.some((r) => Number(r.lateFee) > 0));
  const perDay = Number(b.notes.latePerDay ?? 0);
  return (
    <section
      className="ep-print-sheet"
      aria-label={`Fee bill of ${b.student.name}`}
      style={{ marginTop: 'var(--sp-5)' }}
    >
      <header className="ep-bill__letterhead">
        <div>
          {b.letterhead.logoFileId ? (
            <img
              className="ep-bill__logo"
              src={`/api/files/${b.letterhead.logoFileId}/view`}
              alt={`${b.school.name} logo`}
            />
          ) : null}
        </div>
        <div>
          <p className="ep-bill__school">{b.school.name}</p>
          {b.school.address ? <p className="ep-bill__line">{b.school.address}</p> : null}
          {b.letterhead.phone ? (
            <p className="ep-bill__line">Ph. No: {b.letterhead.phone}</p>
          ) : null}
          {b.letterhead.email ? <p className="ep-bill__line">Email: {b.letterhead.email}</p> : null}
          {b.letterhead.website ? (
            <p className="ep-bill__line">Website: {b.letterhead.website}</p>
          ) : null}
          <h2 className="ep-bill__title">{title}</h2>
          <p className="ep-bill__title">
            Academic Year : {b.session.from} to {b.session.to}
          </p>
        </div>
        <div />
      </header>

      <dl className="ep-bill__meta">
        <dt>Fee Bill No.:</dt>
        <dd>{b.billNo}</dd>
        <dt>Session:</dt>
        <dd>{b.year}</dd>
        <dt>Name of Student:</dt>
        <dd>{b.student.name}</dd>
        <dt>Admission No.:</dt>
        <dd>{b.student.admissionNo}</dd>
        <dt>Class &amp; Section:</dt>
        <dd>{b.student.section ?? '—'}</dd>
        <dt>Date of Birth:</dt>
        <dd>{b.student.dob ? dmy(b.student.dob) : '—'}</dd>
        <dt>Father’s Name:</dt>
        <dd>{b.student.father ?? '—'}</dd>
        <dt>Mother’s Name:</dt>
        <dd>{b.student.mother ?? '—'}</dd>
        <dt>Route/Stop:</dt>
        <dd>{b.student.route ?? '—'}</dd>
        <dt>Generation Date:</dt>
        <dd>{stamp(b.generatedAt)}</dd>
      </dl>

      <table className="ep-bill__table">
        <caption className="ep-sr-only">Fee heads of {b.student.name}</caption>
        <thead>
          <tr>
            <th scope="col">Fee Head</th>
            <th scope="col" className="ep-bill__num">
              Amount (₹)
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map(([name, rows]) =>
            rows.length === 0 ? null : (
              <Fragment key={name ?? 'regular'}>
                {name ? (
                  <tr className="ep-bill__section">
                    <th scope="colgroup" colSpan={2}>
                      {name.toUpperCase()}
                    </th>
                  </tr>
                ) : null}
                {rows.map((h) => (
                  <tr key={`${h.ledger}-${h.head}`}>
                    <td>
                      {h.head}
                      {through}
                    </td>
                    <td className="ep-bill__num">{rupees(h.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ),
          )}
          {Number(b.discount) > 0 ? (
            <tr>
              <td>Less: discount / concession</td>
              <td className="ep-bill__num">−{rupees(b.discount)}</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">GRAND TOTAL</th>
            <th className="ep-bill__num">{rupees(total)}</th>
          </tr>
        </tfoot>
      </table>

      {b.schedules.map((s) => (
        <Fragment key={s.ledger}>
          <p className="ep-bill__caption">
            {FEE[s.ledger] ?? s.ledger} is collected on {PLAN[s.payPlan] ?? s.payPlan} basis as per
            the following schedule:
          </p>
          <table className="ep-bill__table">
            <caption className="ep-sr-only">
              {FEE[s.ledger] ?? s.ledger} instalments of {b.student.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Instalment No.</th>
                <th scope="col">Months</th>
                <th scope="col">Last Date of Payment</th>
                <th scope="col" className="ep-bill__num">
                  Payable Amount
                </th>
                <th scope="col" className="ep-bill__num">
                  Paid Amount
                </th>
                <th scope="col" className="ep-bill__num">
                  Balance Amount
                </th>
                {late ? (
                  <th scope="col" className="ep-bill__num">
                    Late Fee
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={`${s.ledger}-${r.dueOn}`}>
                  <th scope="row">{r.no}</th>
                  <td className="ep-bill__nowrap">{r.months}</td>
                  <td className="ep-bill__nowrap">{dmy(r.dueOn)}</td>
                  <td className="ep-bill__num">{rupees(r.payable)}</td>
                  <td className="ep-bill__num">{rupees(r.paid)}</td>
                  <td className="ep-bill__num">{rupees(r.balance)}</td>
                  {late ? <td className="ep-bill__num">{rupees(r.lateFee)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Fragment>
      ))}

      <h3 className="ep-bill__h">DETAILS OF FEE RECEIVED</h3>
      <table className="ep-bill__table">
        <caption className="ep-sr-only">Fee received from {b.student.name}</caption>
        <thead>
          <tr>
            <th scope="col">S.No</th>
            <th scope="col">Receipt No.</th>
            <th scope="col">Payment Type</th>
            <th scope="col">Transaction / Cheque No</th>
            <th scope="col">Date</th>
            <th scope="col" className="ep-bill__num">
              Amount
            </th>
            <th scope="col" className="ep-bill__num">
              Late Fee
            </th>
            <th scope="col" className="ep-bill__num">
              Bounce Charge
            </th>
            <th scope="col" className="ep-bill__num">
              Final Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {b.receipts.length === 0 ? (
            <tr>
              <td colSpan={9}>No fee received yet this session.</td>
            </tr>
          ) : (
            b.receipts.map((r, n) => (
              <tr key={`${r.receiptNo ?? n}`}>
                <td>{n + 1}</td>
                <td>
                  {r.receiptNo ?? '—'}
                  {STATUS[r.status] ? ` (${STATUS[r.status]})` : ''}
                </td>
                <td>{r.mode.toUpperCase()}</td>
                <td>{r.instrumentNo ?? ''}</td>
                <td className="ep-bill__nowrap">{dmy(r.receivedOn)}</td>
                <td className="ep-bill__num">{rupees(r.amount)}</td>
                <td className="ep-bill__num">{rupees(r.lateFee)}</td>
                <td className="ep-bill__num">{rupees(r.bounceCharge)}</td>
                <td className="ep-bill__num">{rupees(r.finalAmount)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={8}>
              Total Paid Amount
            </th>
            <th className="ep-bill__num">{rupees(b.summary.received)}</th>
          </tr>
        </tfoot>
      </table>

      <table className="ep-bill__table" style={{ marginTop: 'var(--sp-4)' }}>
        <caption className="ep-sr-only">Balance of {b.student.name}</caption>
        <thead>
          <tr>
            <th scope="col">Total Due Amount</th>
            <th scope="col">Total Received Amount</th>
            <th scope="col">Refund / Return</th>
            {Number(b.summary.advance) > 0 ? <th scope="col">Advance / Paid Ahead</th> : null}
            <th scope="col">Balance Payable</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {rupees(b.summary.due)}
              {Number(b.summary.lateFee) > 0 ? (
                <div className="ep-field__help">incl. late fee {rupees(b.summary.lateFee)}</div>
              ) : null}
            </td>
            <td>{rupees(b.summary.received)}</td>
            <td>{rupees(b.summary.refund)}</td>
            {Number(b.summary.advance) > 0 ? <td>{rupees(b.summary.advance)}</td> : null}
            <td>
              <strong>{rupees(b.summary.balance)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ marginTop: 'var(--sp-2)' }}>
        <em>
          <strong>In Words:- {words(b.summary.balanceWords)}</strong>
        </em>
      </p>
      <ul className="ep-bill__notes">
        <li>
          Payment can be made by Credit Card, Debit Card, Net Banking and UPI through the parent
          portal.
        </li>
        {Number(b.notes.bounceCharge) > 0 ? (
          <li>
            A fine of ₹{rupees(b.notes.bounceCharge)} will be charged if a cheque is returned unpaid
            by the banker.
          </li>
        ) : null}
        <li>
          {b.notes.lateFeeMode === 'daywise' && perDay > 0
            ? `If the fee is not paid by the last date, a late payment charge of ₹${rupees(perDay)} a day will be charged.`
            : 'If the fee is not paid by the last date, late fee is charged as per the school’s schedule.'}{' '}
          Late fee is as on the generation date and may change with the date of payment.
        </li>
      </ul>
    </section>
  );
}
