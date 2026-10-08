import { Badge, Button } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { PrintButton } from '@/components/PrintButton';
import { apiFetch, getMe } from '@/lib/api';
import { cancelDepositSlip } from '@/lib/fee-setup-actions';

interface Slip {
  id: string;
  slipNo: number;
  depositOn: string;
  school: string;
  account: {
    bank: string;
    accountName: string;
    accountNo: string;
    ifsc: string;
    branch: string | null;
  };
  instruments: number;
  total: string;
  totalWords: string;
  remarks: string | null;
  status: 'open' | 'cancelled';
  createdBy: string | null;
  lines: Array<{
    key: string;
    receiptNo: string | null;
    payer: string;
    admissionNo: string | null;
    instrumentNo: string | null;
    instrumentDate: string | null;
    bankName: string | null;
    mode: string;
    amount: string;
  }>;
}

const money = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

/** One deposit slip as it goes to the bank. Print from the button; the menu does not print. */
export default async function DepositSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [slip, me] = await Promise.all([apiFetch<Slip>(`/fees/deposit-slips/${id}`), getMe()]);
  const canManage = me.permissions.includes('fees.deposit_slip.manage');
  return (
    <>
      <Notice params={sp} />
      <div
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <a className="ep-btn ep-btn--ghost" href="/fees/deposit-slips">
          Back to slips
        </a>
        <PrintButton label="Print slip" />
        {canManage && slip.status === 'open' ? (
          <form action={cancelDepositSlip}>
            <input type="hidden" name="id" value={slip.id} />
            <Button type="submit" variant="secondary">
              Cancel slip
            </Button>
          </form>
        ) : null}
      </div>
      <section className="ep-print-sheet" aria-label={`Deposit slip ${slip.slipNo}`}>
        <div className="ep-print-sheet__head">
          <h1 className="ep-h3">{slip.school}</h1>
          <p>
            <strong>Bank deposit slip</strong>{' '}
            {slip.status === 'cancelled' ? <Badge tone="danger">Cancelled</Badge> : null}
          </p>
        </div>
        <div className="ep-print-sheet__meta">
          <div>
            Slip no.: <strong>{slip.slipNo}</strong>
          </div>
          <div>
            Deposit date: <strong>{dmy(slip.depositOn)}</strong>
          </div>
          <div>
            Bank: <strong>{slip.account.bank}</strong>
            {slip.account.branch ? `, ${slip.account.branch}` : ''}
          </div>
          <div>
            Account: <strong>{slip.account.accountName}</strong>
          </div>
          <div>
            Account no.: <strong>{slip.account.accountNo}</strong>
          </div>
          <div>
            IFSC: <strong>{slip.account.ifsc}</strong>
          </div>
        </div>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Cheques and drafts on this slip</caption>
          <thead>
            <tr>
              <th scope="col">Sr.</th>
              <th scope="col">Cheque / DD no.</th>
              <th scope="col">Date</th>
              <th scope="col">Drawn on bank</th>
              <th scope="col">Received from</th>
              <th scope="col">Receipt no.</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {slip.lines.map((l, i) => (
              <tr key={l.key}>
                <td>{i + 1}</td>
                <td>{l.instrumentNo ?? ''}</td>
                <td>{dmy(l.instrumentDate)}</td>
                <td>{l.bankName ?? ''}</td>
                <td>
                  {l.payer}
                  {l.admissionNo ? ` (${l.admissionNo})` : ''}
                </td>
                <td>{l.receiptNo ?? ''}</td>
                <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={6}>
                Total: {slip.lines.length} cheque(s) / draft(s)
              </th>
              <th style={{ textAlign: 'right' }}>{money(slip.total)}</th>
            </tr>
          </tfoot>
        </table>
        <p style={{ marginTop: 'var(--sp-3)' }}>
          Amount in words: <strong>{slip.totalWords}</strong>
        </p>
        {slip.remarks ? <p>Remarks: {slip.remarks}</p> : null}
        <div className="ep-print-sheet__sign">
          <span>Prepared by: {slip.createdBy ?? ''}</span>
          <span>Depositor’s signature</span>
          <span>Bank’s stamp and signature</span>
        </div>
      </section>
    </>
  );
}
