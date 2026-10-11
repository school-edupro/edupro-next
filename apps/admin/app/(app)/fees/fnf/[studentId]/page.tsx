import { Button, SelectField } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { PupilMeta, SheetHead, dmy, rupees } from '@/components/fees/sheets';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { resettleWithdrawalFees } from '@/lib/fee-request-actions';
import type { FeePeriod } from '@/lib/types';

interface Fnf {
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
  lastMonth: { sequence: number; name: string };
  dues: Array<{ head: string; period: string; balance: string }>;
  lateFee: string;
  paidAhead: Array<{ head: string; period: string; paid: string }>;
  refundable: Array<{ head: string; paid: string }>;
  advance: string;
  notCharged: string;
  leftOn: string | null;
  receipts: Array<{
    id: string;
    receiptNo: string | null;
    receivedOn: string;
    amount: string;
    refunded: string;
  }>;
  refunds: Array<{
    id: string;
    voucherNo: string | null;
    status: string;
    amount: string;
    reason: string;
    byWithdrawal: boolean;
  }>;
  refundsWaiting: string;
  refundsPaid: string;
  totals: {
    payable: string;
    refundable: string;
    net: string;
    netWords: string;
    direction: 'pay' | 'refund' | 'nil';
  };
}

/** The provisional bill of a pupil who is leaving: what is payable and what comes back. Nothing is posted. */
export default async function FnfPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ lastSeq?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const [me, bill, periods, withdrawals] = await Promise.all([
    getMe(),
    apiFetch<Fnf>(`/fees/students/${studentId}/fnf${sp.lastSeq ? `?lastSeq=${sp.lastSeq}` : ''}`),
    apiFetch<{ data: FeePeriod[] }>('/fees/periods').then((r) => r.data),
    apiFetch<
      { data: Array<{ id: string; status: string }> } | Array<{ id: string; status: string }>
    >(`/people/students/${studentId}/withdrawals`)
      .then((r) => (Array.isArray(r) ? r : r.data))
      .catch(() => [] as Array<{ id: string; status: string }>),
  ]);
  const canRefund = me.permissions.includes('fees.refund.request');
  const completed = withdrawals.find((w) => w.status === 'completed');
  const open = withdrawals.find((w) => w.status === 'requested' || w.status === 'cleared');
  // the refund of the withdrawal: not sent yet, waiting for approval, or done
  const waiting = bill.refunds.some((r) => r.byWithdrawal && r.status === 'requested');
  const sentBefore = bill.refunds.some((r) => r.byWithdrawal);
  const REFUND_STATE: Record<string, string> = {
    draft: 'draft, not sent yet',
    requested: 'waiting for approval',
    approved: 'approved, payment in progress',
    paid: 'refunded',
    failed: 'gateway refund failed',
  };
  const t = bill.totals;
  return (
    <>
      <form
        method="get"
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <a className="ep-btn ep-btn--ghost" href={`/fees/ledger/${studentId}`}>
          Back to ledger
        </a>
        <SelectField
          id="lastSeq"
          name="lastSeq"
          label="Charge fee up to"
          defaultValue={String(bill.lastMonth.sequence)}
          options={periods.map((p) => ({ value: String(p.sequence), label: p.name }))}
        />
        <Button type="submit" variant="secondary">
          Work out
        </Button>
        <PrintButton label="Print provisional bill" />
      </form>
      <div className="ep-noprint">
        <Notice params={sp} />
        <section className="ep-card" style={{ marginBottom: 'var(--sp-4)' }}>
          <h2 className="ep-card__title">Steps</h2>
          <ol
            style={{ margin: 0, paddingLeft: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-2)' }}
          >
            <li>
              <strong>Print this provisional bill</strong> and give it to the parent. Nothing is
              sent for approval by printing.
            </li>
            <li>
              <strong>After the parent has agreed</strong>, send the refund for approval. It goes
              through Fee setup → Approval levels; on the last approval the refund voucher is made.
            </li>
          </ol>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            {!completed ? (
              <p className="ep-field__help">
                {open
                  ? 'The withdrawal is not completed yet (departments are still clearing). The bill can be printed now; the refund can be sent once the withdrawal is completed.'
                  : 'The pupil has no completed withdrawal, so there is no withdrawal refund to send. A refund by fee head can still be raised below.'}
              </p>
            ) : !canRefund ? (
              <p className="ep-field__help">You do not have the right to raise a refund.</p>
            ) : waiting ? (
              <form action={resettleWithdrawalFees}>
                <input type="hidden" name="id" value={completed.id} />
                <input type="hidden" name="studentId" value={studentId} />
                <p>
                  <strong>Sent: ₹{rupees(bill.refundsWaiting)} is waiting for approval.</strong>
                </p>
                <Button type="submit" variant="secondary" size="sm">
                  Withdraw it and send it again
                </Button>
                <span className="ep-field__help">
                  {' '}
                  Use this if the figures changed after it was sent.
                </span>
              </form>
            ) : t.direction === 'refund' ? (
              <form action={resettleWithdrawalFees}>
                <input type="hidden" name="id" value={completed.id} />
                <input type="hidden" name="studentId" value={studentId} />
                <Button type="submit">Send the refund of ₹{rupees(t.net)} for approval</Button>
                <span className="ep-field__help">
                  {' '}
                  Fee paid for the months after {bill.lastMonth.name}, and any advance.
                </span>
              </form>
            ) : (
              <p className="ep-field__help">
                {sentBefore
                  ? 'The refund of this withdrawal has been dealt with; nothing more is refundable by the rule.'
                  : t.direction === 'pay'
                    ? 'The parent has to pay; there is nothing to refund.'
                    : 'Nothing is refundable by the rule. A refund the school grants on top can be raised by fee head below.'}
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="ep-print-sheet" aria-label="Provisional bill for withdrawal">
        <SheetHead school={bill.school} title="Provisional bill for withdrawal (full and final)" />
        <PupilMeta
          student={bill.student}
          extra={[
            ['Session', bill.year],
            ['Fee charged up to', bill.lastMonth.name],
            ['Bill date', dmy(bill.billDate)],
          ]}
        />
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Payable by the parent</caption>
          <thead>
            <tr>
              <th scope="col">A. Payable by the parent</th>
              <th scope="col">Month</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.dues.map((d, i) => (
              <tr key={i}>
                <td>{d.head}</td>
                <td>{d.period}</td>
                <td style={{ textAlign: 'right' }}>{rupees(d.balance)}</td>
              </tr>
            ))}
            {Number(bill.lateFee) > 0 ? (
              <tr>
                <td>Late fee</td>
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(bill.lateFee)}</td>
              </tr>
            ) : null}
            {bill.dues.length === 0 && Number(bill.lateFee) === 0 ? (
              <tr>
                <td colSpan={3}>Nothing is due.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total payable (A)
              </th>
              <th style={{ textAlign: 'right' }}>{rupees(t.payable)}</th>
            </tr>
          </tfoot>
        </table>
        <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-4)' }}>
          <caption className="ep-sr-only">Refundable by the school</caption>
          <thead>
            <tr>
              <th scope="col">B. Refundable by the school</th>
              <th scope="col">Month</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.paidAhead.map((d, i) => (
              <tr key={`a${i}`}>
                <td>{d.head} (paid in advance)</td>
                <td>{d.period}</td>
                <td style={{ textAlign: 'right' }}>{rupees(d.paid)}</td>
              </tr>
            ))}
            {Number(bill.advance) > 0 ? (
              <tr>
                <td>Excess paid (advance)</td>
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(bill.advance)}</td>
              </tr>
            ) : null}
            {Number(t.refundable) === 0 ? (
              <tr>
                <td colSpan={3}>Nothing is refundable.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total refundable (B)
              </th>
              <th style={{ textAlign: 'right' }}>{rupees(t.refundable)}</th>
            </tr>
          </tfoot>
        </table>
        <p style={{ marginTop: 'var(--sp-4)' }}>
          <strong>
            {t.direction === 'pay'
              ? `Net payable by the parent: ₹${rupees(t.net)}`
              : t.direction === 'refund'
                ? `Net refundable by the school: ₹${rupees(t.net)}`
                : 'Nothing is payable or refundable.'}
          </strong>
          {t.direction !== 'nil' ? ` (${t.netWords})` : ''}
        </p>
        {Number(bill.refundsPaid) > 0 || Number(bill.refundsWaiting) > 0 ? (
          <p>
            Refunds of this session: paid ₹{rupees(bill.refundsPaid)}
            {Number(bill.refundsWaiting) > 0
              ? ` · waiting for approval ₹${rupees(bill.refundsWaiting)}`
              : ''}
            . The refundable amount above is what is still to come back after the refunds paid.
          </p>
        ) : null}
        <p>
          <strong>
            {waiting
              ? 'Refund sent for approval.'
              : Number(bill.refundsPaid) > 0 && t.direction !== 'refund'
                ? 'Refund settled.'
                : t.direction === 'refund'
                  ? 'Refund not yet sent for approval.'
                  : ''}
          </strong>
        </p>
        <p className="ep-field__help">
          Provisional: fee of the months after {bill.lastMonth.name} (₹{rupees(bill.notCharged)}) is
          not charged. The final amount is settled by a receipt or a refund in the accounts office
          and may change with the date of settlement.
        </p>
        <div className="ep-print-sheet__sign">
          <span>Parent’s signature</span>
          <span>Accounts officer</span>
          <span>Principal</span>
        </div>
      </section>
      <section className="ep-noprint ep-card" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 className="ep-card__title">Refunds for this pupil</h2>
        {bill.refunds.length === 0 ? (
          <p>No refund has been raised.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Refunds raised for this pupil</caption>
              <thead>
                <tr>
                  <th scope="col">Voucher</th>
                  <th scope="col">Reason</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount (₹)
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {bill.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/fees/refund-voucher/${r.id}`}>{r.voucherNo ?? 'Open'}</a>
                    </td>
                    <td>
                      {r.reason}
                      {r.byWithdrawal ? (
                        <div className="ep-field__help">raised by the withdrawal</div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(r.amount)}</td>
                    <td>{REFUND_STATE[r.status] ?? r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="ep-h4" style={{ marginTop: 'var(--sp-4)' }}>
          Refund more, by fee head
        </h3>
        <p className="ep-field__help">
          For a refund the school grants beyond the rule (for example April and May tuition on the
          principal’s word), or a deposit. Open the receipt, type the amounts head by head, choose
          “the fee is cancelled”, and send; it goes through Fee setup → Approval levels.
        </p>
        {!canRefund ? (
          <p>You do not have the right to raise a refund.</p>
        ) : bill.receipts.length === 0 ? (
          <p>The pupil has no receipt to refund from.</p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {bill.receipts.map((p) => (
              <li key={p.id}>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/fees/refund/${p.id}`}>
                  Refund from {p.receiptNo ?? `receipt ${p.id}`}
                </a>{' '}
                {dmy(p.receivedOn)} · ₹{rupees(p.amount)}
                {Number(p.refunded) > 0 ? ` · already refunded ₹${rupees(p.refunded)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
