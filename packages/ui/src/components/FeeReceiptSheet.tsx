import { FeeReceiptClassic } from './FeeReceiptClassic';
const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

export interface FeeReceipt {
  school: { name: string; address: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
    /** a staff member paying (a misc fee, 0216): the code and designation instead of the pupil's */
    kind?: 'student' | 'employee';
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
  /** The school's receipt layout (Oct 2026): letterhead and the pupil's particulars. */
  letterhead?: {
    phone: string | null;
    email: string | null;
    website: string | null;
    logoFileId: string | null;
    affiliation: string | null;
  };
  parents?: string | null;
  mobiles?: string | null;
  address?: string | null;
  /** category / bus route / bus stop / bus slab */
  transport?: string;
  /** The instalments paid as the pay plan names them (Q1, H2, Annual, the months). */
  instalment?: string | null;
  bounceCharge?: string;
  /** The school's receipt layout (Fee setup -> Receipt numbers): two-panel or classic. */
  layout?: 'two_panel' | 'classic';
  /** The copies printed, e.g. Parent copy, School copy, Office copy. */
  copies?: string[];
}

const FEE: Record<string, string> = { hostel: 'Hostel Fee', misc: 'Misc Fee' };
const spaced = (t: string) => t.toUpperCase();
const title = (w: string) => w.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/**
 * One copy of a fee, hostel or misc receipt in the school's layout: the school, the pupil and how it was
 * paid on the left; the instalment, the heads paid, late fee, bounce charge and the amount in words on the
 * right.
 */
export function FeeReceiptSheet({
  r,
  label,
  logoSrc,
}: {
  r: FeeReceipt;
  label: string;
  /** Where the app serves the school's logo, if it can. */
  logoSrc?: string | null;
}) {
  const staff = r.student.kind === 'employee';
  if (r.layout === 'classic') return <FeeReceiptClassic r={r} label={label} />;
  const cancelled = r.status === 'reversed' || r.status === 'bounced';
  const fee = FEE[r.feeType] ?? 'Fee';
  // the heads paid, one line each (the instalment is named in the heading)
  const heads = [
    ...r.lines.reduce(
      (m, l) => m.set(l.head, (m.get(l.head) ?? 0) + Number(l.amount)),
      new Map<string, number>(),
    ),
  ];
  if (Number(r.advance) > 0) heads.push(['Advance (kept for the next dues)', Number(r.advance)]);
  const paidHeads = heads.reduce((a, [, v]) => a + v, 0);
  const lh = r.letterhead;
  const cheque = r.modeKind === 'cheque' || r.modeKind === 'dd';
  return (
    <section className="ep-print-sheet ep-receipt" aria-label={`${fee} receipt, ${label}`}>
      <div className="ep-rcpt">
        <div className="ep-rcpt__panel">
          <header className="ep-rcpt__head">
            <div>
              {logoSrc ? (
                <img className="ep-rcpt__logo" src={logoSrc} alt={`${r.school.name} logo`} />
              ) : null}
            </div>
            <div>
              <p className="ep-rcpt__school">{r.school.name}</p>
              {r.school.address ? (
                <p className="ep-rcpt__line">
                  <strong>{r.school.address}</strong>
                </p>
              ) : null}
              {lh?.phone ? <p className="ep-rcpt__line">Contact No: {lh.phone}</p> : null}
              {lh?.affiliation ? <p className="ep-rcpt__line">{lh.affiliation}</p> : null}
              {lh?.website || lh?.email ? (
                <p className="ep-rcpt__line">
                  {[lh.website, lh.email].filter(Boolean).join(' || ')}
                </p>
              ) : null}
            </div>
            <div className="ep-rcpt__line">{label}</div>
          </header>
          <p className="ep-rcpt__band ep-rcpt__spaced">
            {spaced(`${fee} Receipt`)}
            {cancelled ? (
              <span className="ep-rcpt__void">
                {r.status === 'bounced' ? 'CHEQUE BOUNCED' : 'CANCELLED'}
              </span>
            ) : null}
          </p>
          <dl className="ep-rcpt__rows">
            {staff ? null : (
              <>
                <dt>Parent’s Name</dt>
                <dd>{r.parents ?? r.student.guardian ?? '—'}</dd>
              </>
            )}
            <dt>Name</dt>
            <dd>{r.student.name}</dd>
            <dt>{staff ? 'Emp Code' : 'Adm No'}</dt>
            <dd>{r.student.admissionNo}</dd>
            <dt>{staff ? 'Designation' : 'Class'}</dt>
            <dd>{r.student.section ?? '—'}</dd>
            <dt>Mobile No</dt>
            <dd>{r.mobiles ?? '—'}</dd>
            <dt>Address</dt>
            <dd>{r.address ?? '—'}</dd>
            {staff ? null : (
              <>
                <dt>Student Category/Bus Route/Bus Stop/Bus Slab</dt>
                <dd>{r.transport ?? ''}</dd>
              </>
            )}
          </dl>
          <p className="ep-rcpt__band">Pay Mode Information</p>
          <dl className="ep-rcpt__rows" style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
            <dt>Pay Mode</dt>
            <dd>{r.mode.toUpperCase()}</dd>
            <dt>Date</dt>
            <dd className="ep-rcpt__num">{dmy(r.instrumentDate ?? r.receivedOn)}</dd>
            <dt>Bank</dt>
            <dd>{r.bankName ?? ''}</dd>
            <dt>Txn/Cheque No</dt>
            <dd className="ep-rcpt__num">{r.instrumentNo ?? r.reference ?? ''}</dd>
          </dl>
          <div className="ep-rcpt__total">
            <span>Total</span>
            <span>{rupees(r.amount)}</span>
          </div>
          <div className="ep-rcpt__stamp" aria-hidden="true" />
          <p className="ep-rcpt__foot">
            * This is computer generated {fee.toLowerCase()} receipt.
            <br />
            No Signature/Stamp required
          </p>
        </div>

        <div className="ep-rcpt__panel">
          <p className="ep-rcpt__band" style={{ fontWeight: 'var(--fw-regular)' }}>
            {fee} Receipt{r.feeType === 'misc' ? '' : ' Instalment'}
            {r.instalment ? (
              <>
                {' '}
                - <strong>{r.instalment}</strong>
              </>
            ) : null}{' '}
            Session <strong>{r.year}</strong>
          </p>
          <p
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--sp-2) var(--sp-4)',
              margin: 0,
              padding: 'var(--sp-4) var(--sp-3)',
            }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>
              Receipt Date: <strong>{dmy(r.receivedOn)}</strong>
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              Receipt No <strong>{r.receiptNo ?? '—'}</strong>
            </span>
          </p>
          <table className="ep-rcpt__table">
            <caption className="ep-sr-only">What the receipt paid</caption>
            <thead>
              <tr>
                <th scope="col">SR.NO</th>
                <th scope="col">Description</th>
                <th scope="col" className="ep-rcpt__num">
                  Paid
                </th>
              </tr>
            </thead>
            <tbody>
              {heads.map(([head, amount], i) => (
                <tr key={head}>
                  <td>{i + 1}</td>
                  <td>{head.toUpperCase()}</td>
                  <td className="ep-rcpt__num">{rupees(amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="ep-rcpt__shade">
                <th scope="row" colSpan={2} style={{ textAlign: 'center' }}>
                  Total
                </th>
                <th className="ep-rcpt__num">{rupees(paidHeads)}</th>
              </tr>
              <tr>
                <td colSpan={2}>Late Fee : {rupees(r.lateFee)}</td>
                <td className="ep-rcpt__num">Bounce Charge : {rupees(r.bounceCharge ?? 0)}</td>
              </tr>
              <tr>
                <td colSpan={2}>Amount Received</td>
                <td className="ep-rcpt__num">{rupees(r.amount)}</td>
              </tr>
              <tr>
                <td>In Word:</td>
                <td colSpan={2}>Rupees {title(r.amountWords)} Only</td>
              </tr>
              <tr>
                <td colSpan={3}>
                  {title(r.mode.toLowerCase())} {fee} Paid
                  {cheque ? ' (subject to realisation of the cheque / draft)' : ''}
                  {r.depositAccount ? ` · into ${r.depositAccount}` : ''}
                </td>
              </tr>
              {Number(r.refunded) > 0 ? (
                <tr>
                  <td colSpan={2}>Refunded since</td>
                  <td className="ep-rcpt__num">{rupees(r.refunded)}</td>
                </tr>
              ) : null}
              {r.remarks ? (
                <tr>
                  <td colSpan={3}>Remarks: {r.remarks}</td>
                </tr>
              ) : null}
            </tfoot>
          </table>
          <p className="ep-rcpt__note">
            <strong>Note: -</strong> For any queries, kindly call at :{' '}
            {lh?.phone ?? 'the school office'}
            {lh?.email ? (
              <>
                {' '}
                or drop an email at{' '}
                <a href={`mailto:${lh.email}`} style={{ textDecoration: 'underline' }}>
                  {lh.email}
                </a>
              </>
            ) : null}
            {r.receivedBy ? (
              <span className="ep-field__help" style={{ display: 'block' }}>
                Received by {r.receivedBy}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
