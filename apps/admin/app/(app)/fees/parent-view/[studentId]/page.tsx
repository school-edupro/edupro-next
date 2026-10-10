import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import type { FeeLedger } from '@/lib/types';

const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const PAY_PLAN = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
} as const;
const tone = (s: string) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';
const PAID: Record<string, { ok: boolean; text: string }> = {
  '1': { ok: true, text: 'Payment received. The receipt is posted and listed below.' },
  '0': { ok: false, text: 'The payment was not completed.' },
  failed: { ok: false, text: 'The gateway reported the payment as failed. Nothing was charged.' },
  error: { ok: false, text: 'The gateway could not be reached. Try again.' },
};

/** The ledger rows the family sees, with the class's Show / Fee pay flags. */
type Row = FeeLedger['instalments'][number] & { show?: boolean; feePay?: boolean };

/**
 * Parent's view for the accounts desk: exactly what the family sees on the parent portal for this
 * pupil (the instalments the school has opened, what is payable, the receipts), with "Pay online" so
 * a parent who cannot pay from home pays at the counter by card, UPI or net banking.
 */
export default async function ParentViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ paid?: string; error?: string; detail?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const [me, ledger] = await Promise.all([
    getMe(),
    apiFetch<FeeLedger>(`/fees/students/${studentId}/ledger`),
  ]);
  const canPay = me.permissions.includes('payments.intent.create');
  const rows = (ledger.instalments as Row[]).filter((i) => i.visible);
  const hidden = ledger.instalments.length - rows.length;
  // whole instalments, the oldest first: each choice is everything due up to that instalment
  const choices: Array<{ label: string; amount: string }> = [];
  let sum = 0;
  for (const i of rows) {
    if (i.feePay === false) continue;
    const due = Number(i.balance) + Number(i.lateFee.outstanding);
    if (due <= 0) continue;
    sum += due;
    choices.push({ label: i.label, amount: sum.toFixed(2) });
  }
  const payableNow = sum;
  const result = sp.paid ? (PAID[sp.paid] ?? PAID['0']!) : null;
  const yearOpen = ledger.year.status === 'active';
  return (
    <>
      <PageHeader
        kicker="Fees · Parent’s view"
        title={`${ledger.student.name}${ledger.student.section ? ` · ${ledger.student.section}` : ''} · ${ledger.year.code}`}
        description="What the family sees on the parent portal for this pupil. Use it to explain the dues to a parent, or to take an online payment at the counter for a parent who cannot pay from home."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/fees/ledger/${studentId}`}>
              Back to the ledger
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/bills?studentId=${studentId}`}
            >
              Fee bill
            </a>
          </span>
        }
      />
      {result ? (
        <p
          className={`ep-alert ep-alert--${result.ok ? 'success' : 'danger'}`}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.text}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'The payment could not be started.'}
        </p>
      ) : null}
      <Card>
        <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Badge tone="info">Pay plan: {PAY_PLAN[ledger.fee.payPlan]}</Badge>
          <Badge tone="neutral">Fee group: {ledger.fee.feeGroup.replace(/_/g, ' ')}</Badge>
          {ledger.fee.hosteller ? <Badge tone="neutral">Hosteller</Badge> : null}
          {ledger.fee.transport ? (
            <Badge tone="neutral">Transport: {ledger.fee.transport}</Badge>
          ) : null}
          {ledger.fee.discounts.length > 0 ? (
            <Badge tone="success">Discount: {ledger.fee.discounts.join(', ')}</Badge>
          ) : null}
          {ledger.fee.optionalHeads.length > 0 ? (
            <Badge tone="neutral">Optional: {ledger.fee.optionalHeads.join(', ')}</Badge>
          ) : null}
        </p>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
            gap: 'var(--sp-3)',
            margin: 'var(--sp-3) 0',
          }}
        >
          {(
            [
              ['Payable now', money(payableNow)],
              ['Balance of the year', money(ledger.totals.balance)],
              ['Late fee', money(ledger.totals.lateFeeOutstanding)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
              <dt className="ep-kicker">{k}</dt>
              <dd style={{ margin: 0 }}>
                <strong>{v}</strong>
              </dd>
            </div>
          ))}
        </dl>
        {rows.length === 0 ? (
          <p>No instalment is open to the family yet.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Instalments the family sees</caption>
              <thead>
                <tr>
                  <th scope="col">Instalment</th>
                  <th scope="col">Due on</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Balance
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Late fee
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={`${i.dueOn}-${i.ledger}`}>
                    <td>
                      {i.label}
                      {i.ledger === 'hostel' ? ' (hostel)' : ''}
                      {i.feePay === false ? (
                        <div className="ep-field__help">not open for online payment</div>
                      ) : null}
                    </td>
                    <td>{dmy(i.dueOn)}</td>
                    <td style={{ textAlign: 'right' }}>{money(i.net)}</td>
                    <td style={{ textAlign: 'right' }}>{money(i.balance)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(i.lateFee.outstanding) > 0 ? money(i.lateFee.outstanding) : '—'}
                    </td>
                    <td>
                      <Badge tone={tone(i.status)}>{i.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hidden > 0 ? (
          <p className="ep-field__help">
            {hidden} later instalment(s) are not shown to the family yet (class calendar: start date
            and Show).
          </p>
        ) : null}
      </Card>

      <Card title="Pay online for the parent" style={{ marginTop: 'var(--sp-4)' }}>
        {!canPay ? (
          <p>You do not have the right to start an online payment.</p>
        ) : !yearOpen ? (
          <p>Payments are taken for the current session only.</p>
        ) : choices.length === 0 ? (
          <p>Nothing is payable online now.</p>
        ) : (
          <form
            method="post"
            action={`/fees/parent-view/${studentId}/pay`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              gap: 'var(--sp-3)',
              alignItems: 'end',
            }}
          >
            <label className="ep-field" htmlFor="pvAmount">
              <span className="ep-field__label">Pay up to</span>
              <select
                className="ep-select"
                id="pvAmount"
                name="amount"
                defaultValue={choices[choices.length - 1]!.amount}
              >
                {choices.map((o) => (
                  <option key={o.amount} value={o.amount}>
                    {o.label} · {money(o.amount)}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">Whole instalments, the oldest first.</span>
            </label>
            <label className="ep-field" htmlFor="pvName">
              <span className="ep-field__label">Payer’s name *</span>
              <input
                className="ep-input"
                id="pvName"
                name="payerName"
                required
                maxLength={120}
                defaultValue={ledger.student.father ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="pvMobile">
              <span className="ep-field__label">Payer’s mobile *</span>
              <input
                className="ep-input"
                id="pvMobile"
                name="payerMobile"
                required
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                title="Ten digits"
              />
            </label>
            <label className="ep-field" htmlFor="pvEmail">
              <span className="ep-field__label">Payer’s email *</span>
              <input className="ep-input" id="pvEmail" name="payerEmail" type="email" required />
            </label>
            <div>
              <Button type="submit">Pay online</Button>
            </div>
            <p className="ep-field__help" style={{ gridColumn: '1 / -1' }}>
              The payment gateway opens on this screen; the parent pays by card, UPI or net banking.
              On success the receipt is posted by itself, as for a payment from the parent portal.
              For cash, cheque or a bank transfer use Take payment on the ledger.
            </p>
          </form>
        )}
      </Card>

      <Card title="Receipts" style={{ marginTop: 'var(--sp-4)' }}>
        {ledger.payments.length === 0 ? (
          <p>No receipt yet.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Receipts of this pupil</caption>
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Date</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col">Mode</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.receiptNo ?? '—'}
                      {p.status !== 'posted' ? <small> · {p.status}</small> : null}
                    </td>
                    <td>{dmy(p.receivedOn)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {money(p.amount)}
                      {Number(p.lateFee) > 0 ? (
                        <div className="ep-field__help">late fee {money(p.lateFee)}</div>
                      ) : null}
                    </td>
                    <td>{p.mode}</td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/fees/receipt/${p.id}`}
                      >
                        View
                      </a>{' '}
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/api/fees/receipt-file?id=${p.id}`}
                      >
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
