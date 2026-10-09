import {
  Badge,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  KpiTile,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import {
  PostReceiptForm,
  type CounterMode,
  type SchoolAccount,
} from '@/components/fees/PostReceiptForm';
import {
  postCashierReceipt,
  regenerateStudentDemand,
  requestAdjustment,
  requestRefund,
  revokeLateFeeOverride,
  setLateFeeOverride,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type {
  FeeDemandSummary,
  FeeLedger,
  FeeLedgerInstalment,
  FeeLedgerPayment,
} from '@/lib/types';

const TABS = [
  ['pay', 'Take payment'],
  ['dues', 'Dues'],
  ['receipts', 'Receipts'],
  ['latefee', 'Late fee'],
  ['more', 'Bill tools'],
] as const;
type Tab = (typeof TABS)[number][0];

const money = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const toneFor = (s: FeeLedgerInstalment['status']) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';
const STATUS: Record<FeeLedgerInstalment['status'], string> = {
  paid: 'Paid',
  overdue: 'Overdue',
  due: 'Due',
  upcoming: 'Upcoming',
};
const RECEIPT: Record<string, [string, 'success' | 'danger' | 'warning' | 'neutral']> = {
  posted: ['Good', 'success'],
  partly_refunded: ['Partly refunded', 'warning'],
  refunded: ['Refunded', 'neutral'],
  bounced: ['Cheque bounced', 'danger'],
  reversed: ['Cancelled', 'danger'],
};

/** One pupil's fees: take a payment, see the dues and receipts, cancel or bounce a receipt, late fee. */
export default async function FeeLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    asOf?: string;
    tab?: string;
  }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  const ledger = await apiFetch<FeeLedger>(
    `/fees/students/${studentId}/ledger${sp.asOf ? `?asOf=${sp.asOf}` : ''}`,
  );
  const yearOpen = ledger.year.status === 'active';
  const canPost = can('fees.receipt.post') && yearOpen;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : canPost ? 'pay' : 'dues';
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [modes, options, demandRows] = await Promise.all([
    tab === 'pay' && canPost
      ? apiFetch<{ data: Array<CounterMode & { atCounter: boolean }> }>('/fees/payment-modes')
          .then((r) => r.data.filter((m) => m.atCounter))
          .catch(() => [])
      : Promise.resolve([]),
    tab === 'pay' && canPost
      ? apiFetch<{ banks: string[]; accounts: SchoolAccount[] }>('/fees/cashier/options').catch(
          () => ({ banks: [], accounts: [] }),
        )
      : Promise.resolve({ banks: [] as string[], accounts: [] as SchoolAccount[] }),
    tab === 'dues' && can('fees.adjustment.request')
      ? apiFetch<FeeDemandSummary>(`/fees/students/${studentId}/demands`)
          .then((d) => d.rows.filter((r) => Number(r.net) - Number(r.paid) > 0))
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const link = (k: Tab) => `/fees/ledger/${studentId}?tab=${k}${sp.asOf ? `&asOf=${sp.asOf}` : ''}`;
  const diff = ledger.lastRun?.diff ?? null;
  const canAsk = can('fees.adjustment.request') && yearOpen;
  return (
    <>
      <div className="ep-noprint" style={{ marginBottom: 'var(--sp-3)' }}>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/fees/cashier">
          ← Find another pupil
        </a>
      </div>
      <Card>
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <div className="ep-kicker">Fees · Session {ledger.year.code}</div>
            <h1 className="ep-h2">{ledger.student.name}</h1>
            <p>
              Admission no. <strong>{ledger.student.admissionNo}</strong> · Class{' '}
              <strong>{ledger.student.section ?? '—'}</strong> · Father / guardian{' '}
              <strong>{ledger.student.father ?? '—'}</strong>
            </p>
            {!yearOpen ? <Badge tone="warning">This session is {ledger.year.status}</Badge> : null}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/bills?studentId=${studentId}`}
            >
              Fee bill
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/bills?studentId=${studentId}&view=parent`}
            >
              Parent’s view
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/tax-certificate/${studentId}`}
            >
              Tax certificate
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/fees/fnf/${studentId}`}>
              Provisional bill (withdrawal)
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/people/students/${studentId}?tab=fees`}
            >
              Fee profile
            </a>
          </div>
        </div>
      </Card>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))',
          margin: 'var(--sp-4) 0',
        }}
      >
        <KpiTile
          label="Payable today"
          value={money(ledger.totals.payable)}
          hint={`As on ${dmy(ledger.asOf)}`}
        />
        <KpiTile label="Fee balance" value={money(ledger.totals.balance)} />
        <KpiTile label="Late fee to collect" value={money(ledger.totals.lateFeeOutstanding)} />
        <KpiTile label="Paid this year" value={money(ledger.totals.paid)} />
        <KpiTile label="Fee of the year" value={money(ledger.totals.net)} />
      </div>
      <Notice params={sp} />
      <nav
        aria-label="Pupil fees"
        className="ep-tabs-links ep-tabs__list--wrap"
        style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
      >
        {TABS.filter(([k]) => k !== 'pay' || canPost).map(([k, label]) => (
          <a key={k} href={link(k)} aria-current={k === tab ? 'page' : undefined}>
            {label}
            {k === 'receipts' ? ` (${ledger.payments.length})` : ''}
          </a>
        ))}
      </nav>

      {tab === 'pay' && canPost ? (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Card title="Post receipt">
            <PostReceiptForm
              action={postCashierReceipt}
              studentId={studentId}
              modes={modes}
              banks={options.banks}
              accounts={options.accounts}
              payable={ledger.totals.payable}
              today={today}
              hasHostel={ledger.instalments.some((i) => i.ledger === 'hostel')}
              canSkipLateFee={can('fees.late_fee.manage')}
            />
          </Card>
          <Card title="What is due">
            <Dues instalments={ledger.instalments.filter((i) => i.status !== 'paid')} />
          </Card>
        </div>
      ) : null}

      {tab === 'dues' ? (
        <Card title="Instalments of the year">
          <form
            method="get"
            className="ep-noprint"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <input type="hidden" name="tab" value="dues" />
            <InputField
              id="asOf"
              name="asOf"
              label="Late fee as on"
              type="date"
              defaultValue={ledger.asOf}
            />
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          <Dues instalments={ledger.instalments} />
          {canAsk && demandRows.length > 0 ? (
            <form action={requestAdjustment} style={{ marginTop: 'var(--sp-5)' }}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="kind" value="waiver" />
              <h3 className="ep-h4">Ask to waive a fee</h3>
              <FormRow columns={3}>
                <SelectField
                  id="waiverDemand"
                  name="demandId"
                  label="Fee line"
                  options={demandRows.map((r) => ({
                    value: r.id,
                    label: `${r.periodName} · ${r.headName} · ₹${(Number(r.net) - Number(r.paid)).toFixed(2)}`,
                  }))}
                />
                <InputField
                  id="waiverAmount"
                  name="amount"
                  label="Amount to waive (₹)"
                  type="number"
                  min={1}
                  step="0.01"
                  required
                />
                <InputField
                  id="waiverReason"
                  name="reason"
                  label="Reason"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </FormRow>
              <p className="ep-field__help">
                Goes to the school admin under Fees → Adjustments. A bounce charge is waived the
                same way: choose its line.
              </p>
              <FormActions>
                <Button type="submit" variant="secondary">
                  Send waiver for approval
                </Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      ) : null}

      {tab === 'receipts' ? (
        <Card title="Receipts of the year">
          {ledger.payments.length === 0 ? (
            <p className="ep-field__help">No receipt yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {ledger.payments.map((p) => (
                <ReceiptRow
                  key={p.id}
                  p={p}
                  studentId={studentId}
                  canAsk={canAsk}
                  canRefund={can('fees.refund.request') && yearOpen}
                />
              ))}
            </div>
          )}
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
            Cancelling a receipt, a bounced cheque and a refund are asked here with a reason and
            approved by the school admin (Fees → Adjustments, Fees → Refunds). A receipt is never
            deleted: it stays in the list marked Cancelled or Cheque bounced.
          </p>
        </Card>
      ) : null}

      {tab === 'latefee' ? (
        <Card title="Late fee of this pupil">
          <p className="ep-field__help">
            Late fee follows the class calendar (
            {ledger.lateFeeMode === 'slab' ? 'by slabs' : 'per day'}). A fixed amount for one
            instalment of this pupil replaces it (0 waives it).
          </p>
          {ledger.overrides.length === 0 ? (
            <p>No late fee has been fixed for this pupil.</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Late fee fixed for this pupil</caption>
                <thead>
                  <tr>
                    <th scope="col">Instalment month</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Late fee fixed
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col">By</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.overrides.map((o) => (
                    <tr key={o.id}>
                      <td>{o.periodName}</td>
                      <td style={{ textAlign: 'right' }}>{money(o.amount)}</td>
                      <td>{o.reason}</td>
                      <td>{o.createdBy ?? '—'}</td>
                      <td>
                        {can('fees.late_fee.manage') && yearOpen ? (
                          <form action={revokeLateFeeOverride}>
                            <input type="hidden" name="studentId" value={studentId} />
                            <input type="hidden" name="overrideId" value={o.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              Remove
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {can('fees.adjustment.approve') && yearOpen ? (
            <form action={setLateFeeOverride} style={{ marginTop: 'var(--sp-4)' }}>
              <input type="hidden" name="studentId" value={studentId} />
              <h3 className="ep-h4">Fix the late fee now (school admin)</h3>
              <FormRow columns={3}>
                <SelectField
                  id="ovPeriod"
                  name="periodId"
                  label="Instalment"
                  options={ledger.instalments
                    .filter((i) => i.lateFee.periodId)
                    .map((i) => ({
                      value: i.lateFee.periodId!,
                      label: `${i.label}${i.ledger === 'hostel' ? ' (hostel)' : ''} · now ${money(i.lateFee.amount)}`,
                    }))}
                />
                <InputField
                  id="ovAmount"
                  name="amount"
                  label="Late fee to charge (₹, 0 = waive)"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  required
                />
                <InputField
                  id="ovReason"
                  name="reason"
                  label="Reason"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  Fix late fee
                </Button>
              </FormActions>
            </form>
          ) : (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/requests?tab=new">
                Ask for a late-fee waiver
              </a>
            </p>
          )}
        </Card>
      ) : null}

      {tab === 'more' ? (
        <Card title="Bill tools">
          <p className="ep-field__help">
            The pupil’s bill is made from the class fee structure, the fee profile (group,
            discounts, transport, hostel) and the class calendar. Make it again after any of these
            change; lines already paid are kept as they are.
          </p>
          {can('fees.demand.generate') && yearOpen ? (
            <form action={regenerateStudentDemand}>
              <input type="hidden" name="studentId" value={studentId} />
              <Button type="submit" variant="secondary">
                Make the bill again
              </Button>
            </form>
          ) : null}
          {ledger.lastRun ? (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              Last made on{' '}
              {new Date(ledger.lastRun.ranAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {ledger.lastRun.ranBy ? ` by ${ledger.lastRun.ranBy}` : ''}: {ledger.lastRun.rows}{' '}
              line(s), total {money(ledger.lastRun.total)}.
              {diff
                ? ` Against the bill before: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed (${money(diff.totalBefore)} → ${money(diff.totalAfter)}).`
                : ''}
            </p>
          ) : (
            <p style={{ marginTop: 'var(--sp-3)' }}>No bill has been made for this pupil yet.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}

function Dues({ instalments }: { instalments: FeeLedgerInstalment[] }) {
  if (instalments.length === 0) return <p>Nothing is due.</p>;
  return (
    <div className="ep-table-wrap">
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">Instalments</caption>
        <thead>
          <tr>
            <th scope="col">Instalment</th>
            <th scope="col">Last date</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Fee
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Paid
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Balance
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Late fee to collect
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {instalments.map((i) => (
            <tr key={`${i.dueOn}-${i.ledger}`}>
              <th scope="row">
                {i.label}
                {i.ledger === 'hostel' ? ' (hostel)' : ''}
              </th>
              <td>{dmy(i.dueOn)}</td>
              <td style={{ textAlign: 'right' }}>{money(i.net)}</td>
              <td style={{ textAlign: 'right' }}>{money(i.paid)}</td>
              <td style={{ textAlign: 'right' }}>
                <strong>{money(i.balance)}</strong>
              </td>
              <td style={{ textAlign: 'right' }}>
                {Number(i.lateFee.outstanding) > 0 ? money(i.lateFee.outstanding) : '—'}
                {Number(i.lateFee.amount) > 0 ? (
                  <div className="ep-field__help">
                    {i.lateFee.mode === 'daywise'
                      ? `per day · ${i.lateFee.days} days`
                      : i.lateFee.mode === 'override'
                        ? 'fixed for this pupil'
                        : 'slab'}
                  </div>
                ) : null}
              </td>
              <td>
                <Badge tone={toneFor(i.status)}>{STATUS[i.status]}</Badge>
                {!i.visible && i.status !== 'paid' ? (
                  <div className="ep-field__help">not shown to parents</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptRow({
  p,
  studentId,
  canAsk,
  canRefund,
}: {
  p: FeeLedgerPayment;
  studentId: string;
  canAsk: boolean;
  canRefund: boolean;
}) {
  const [label, tone] = RECEIPT[p.status] ?? [p.status, 'neutral'];
  const good = p.status === 'posted';
  const cheque = p.modeKind === 'cheque' || p.modeKind === 'dd';
  const refundable = Number(p.amount) - Number(p.refunded);
  return (
    <div className="ep-card" style={{ padding: 'var(--sp-3)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div>
          <strong>{p.receiptNo ?? '—'}</strong> · {dmy(p.receivedOn)} ·{' '}
          <strong>{money(p.amount)}</strong> <Badge tone={tone}>{label}</Badge>
          <div className="ep-field__help">
            {p.mode}
            {p.instrumentNo ? ` no. ${p.instrumentNo}` : ''}
            {p.bankName ? `, ${p.bankName}` : ''}
            {p.reference ? ` · Ref. ${p.reference}` : ''}
            {p.depositAccount ? ` · into ${p.depositAccount}` : ''}
            {Number(p.lateFee) > 0 ? ` · late fee ${money(p.lateFee)}` : ''}
            {Number(p.unallocated) > 0 && p.status !== 'reversed' && p.status !== 'bounced'
              ? ` · advance ${money(p.unallocated)}`
              : ''}
            {Number(p.refunded) > 0 ? ` · refunded ${money(p.refunded)}` : ''}
            {p.receivedBy ? ` · by ${p.receivedBy}` : ''}
          </div>
        </div>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/fees/receipt/${p.id}`}>
          Print receipt
        </a>
      </div>
      {good && (canAsk || canRefund) ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            flexWrap: 'wrap',
            marginTop: 'var(--sp-3)',
          }}
        >
          {canAsk ? (
            <details>
              <summary>Cancel this receipt</summary>
              <form action={requestAdjustment} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="paymentId" value={p.id} />
                <input type="hidden" name="kind" value="reversal" />
                <label className="ep-field">
                  <span className="ep-field__label">Why is it cancelled? *</span>
                  <input
                    className="ep-input"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Send cancellation for approval
                </Button>
              </form>
            </details>
          ) : null}
          {canAsk && cheque ? (
            <details>
              <summary>Cheque bounced</summary>
              <form action={requestAdjustment} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="paymentId" value={p.id} />
                <input type="hidden" name="kind" value="bounce" />
                <label className="ep-field">
                  <span className="ep-field__label">Bank’s reason *</span>
                  <input
                    className="ep-input"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="Funds insufficient"
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Bounce charge (₹)</span>
                  <input className="ep-input" name="charge" type="number" min={0} step="0.01" />
                  <span className="ep-field__help">Empty = the charge of the class calendar.</span>
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Send bounce for approval
                </Button>
              </form>
            </details>
          ) : null}
          {canRefund && refundable > 0 ? (
            <details>
              <summary>Refund</summary>
              <form action={requestRefund} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="paymentId" value={p.id} />
                <label className="ep-field">
                  <span className="ep-field__label">Amount to refund (₹) *</span>
                  <input
                    className="ep-input"
                    name="amount"
                    type="number"
                    min={1}
                    max={refundable}
                    step="0.01"
                    required
                  />
                  <span className="ep-field__help">Up to {money(refundable)}.</span>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Pay back by</span>
                  <select className="ep-select" name="mode" defaultValue="bank">
                    <option value="bank">Bank transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Reason *</span>
                  <input
                    className="ep-input"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Send refund for approval
                </Button>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
