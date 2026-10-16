import { WaiverGrid } from '@/components/fees/WaiverGrid';
import {
  requestAdvanceRefund,
  requestFeeWaivers,
  requestPaidChargeToFee,
  requestWaiverUndo,
} from '@/lib/fee-request-actions';
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

interface PendingAdj {
  id: string;
  kind: 'waiver' | 'reversal' | 'bounce';
  demandId: string | null;
  demandLabel: string | null;
  paymentId: string | null;
  amount: string;
  reason: string;
  waitingWith?: string | null;
}
interface GivenWaiver {
  id: string;
  batchId: string | null;
  demandLabel: string | null;
  amount: string;
  reason: string;
  decidedBy: string | null;
  undoStatus: 'pending' | 'approved' | 'rejected' | null;
  undoneAt: string | null;
  undoWaitingWith: string | null;
}
interface PendingReq {
  id: string;
  kind: 'late_fee' | 'transfer' | 'date_change' | 'late_fee_to_fee' | 'bounce_to_fee';
  paymentId: string | null;
  periodId: string | null;
  demandId: string | null;
  period: string | null;
  amount: string | null;
  reason: string;
  waitingWith?: string | null;
}
interface PendingRefund {
  id: string;
  paymentId: string | null;
  status: string;
  amount: string;
  waitingWith?: string | null;
}

const TABS = [
  ['pay', 'Take payment'],
  ['dues', 'Dues'],
  ['matrix', 'Head and month'],
  ['waive', 'Waive fee'],
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
const PAY_PLAN = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  half_yearly: 'half-yearly',
  yearly: 'yearly',
} as const;

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
    fee?: string;
  }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  const ledger = await apiFetch<FeeLedger>(
    `/fees/students/${studentId}/ledger${sp.asOf ? `?asOf=${sp.asOf}` : ''}`,
  );
  // All fee, Regular (school fee) or Hosteller (hostel fee): every tab shows the fee chosen. A pupil with
  // no hostel fee this session (a day scholar) has no fee choice: everything is school fee.
  const hasHostelFee = ledger.instalments.some((i) => i.ledger === 'hostel');
  const fee: 'all' | 'school' | 'hostel' =
    hasHostelFee && (sp.fee === 'school' || sp.fee === 'hostel') ? sp.fee : 'all';
  const onFee = (l: string) => fee === 'all' || l === fee;
  const inst = ledger.instalments.filter((i) => onFee(i.ledger));
  const pays = ledger.payments.filter((p) => onFee(p.ledger));
  const add = (f: (i: FeeLedgerInstalment) => string) =>
    inst.reduce((a, i) => a + Number(f(i)), 0).toFixed(2);
  const totals =
    fee === 'all'
      ? ledger.totals
      : {
          net: add((i) => i.net),
          paid: add((i) => i.paid),
          balance: add((i) => i.balance),
          lateFeeOutstanding: add((i) => i.lateFee.outstanding),
          payable: (
            Number(add((i) => i.balance)) + Number(add((i) => i.lateFee.outstanding))
          ).toFixed(2),
        };
  const yearOpen = ledger.year.status === 'active';
  const canPost = can('fees.receipt.post') && yearOpen;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : canPost ? 'pay' : 'dues';
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  // what is open on school fee and on hostel fee, each paid on its own
  const openOn = (l: string) =>
    ledger.instalments
      .filter((i) => i.ledger === l)
      .reduce((a, i) => a + Number(i.balance) + Number(i.lateFee.outstanding), 0)
      .toFixed(2);
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
    tab === 'waive' && can('fees.adjustment.request')
      ? apiFetch<FeeDemandSummary>(`/fees/students/${studentId}/demands`)
          .then((d) => d.rows.filter((r) => ['pending', 'partial'].includes(r.status)))
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const allRows =
    tab === 'matrix'
      ? await apiFetch<FeeDemandSummary>(`/fees/students/${studentId}/demands`)
          .then((d) => d.rows)
          .catch(() => [])
      : [];
  // what is already waiting for this pupil: shown on the tab, and the same thing cannot be asked twice
  const wantsPending = tab === 'waive' || tab === 'receipts' || tab === 'latefee';
  const [pendingAdj, pendingReq, openRefunds] = wantsPending
    ? await Promise.all([
        apiFetch<{ data: PendingAdj[] }>(`/fees/adjustments?studentId=${studentId}&status=pending`)
          .then((r) => r.data)
          .catch(() => [] as PendingAdj[]),
        apiFetch<{ data: PendingReq[] }>(`/fees/requests?studentId=${studentId}&status=pending`)
          .then((r) => r.data)
          .catch(() => [] as PendingReq[]),
        apiFetch<{ data: PendingRefund[] }>(`/payments/refunds?studentId=${studentId}&size=200`)
          .then((r) => r.data.filter((x) => ['draft', 'requested', 'approved'].includes(x.status)))
          .catch(() => [] as PendingRefund[]),
      ])
    : [[] as PendingAdj[], [] as PendingReq[], [] as PendingRefund[]];
  const withWho = (w: string | null | undefined) => (w ? ` · with ${w}` : '');
  /** What waits on one receipt, in words. */
  const waitingOn = (paymentId: string): string[] => [
    ...pendingAdj
      .filter((a) => a.paymentId === paymentId)
      .map(
        (a) =>
          `${a.kind === 'bounce' ? 'Cheque bounce' : 'Cancellation'} waiting for approval${withWho(a.waitingWith)}`,
      ),
    ...pendingReq
      .filter((r) => r.paymentId === paymentId)
      .map(
        (r) =>
          `${
            r.kind === 'transfer'
              ? 'Transfer to another pupil'
              : r.kind === 'date_change'
                ? 'Date correction'
                : 'Paid late fee adjusted in fee'
          } waiting for approval${withWho(r.waitingWith)}`,
      ),
    ...openRefunds
      .filter((r) => r.paymentId === paymentId)
      .map((r) =>
        r.status === 'draft'
          ? `Refund draft of ${money(r.amount)} saved, not sent yet`
          : `Refund of ${money(r.amount)} waiting for approval${withWho(r.waitingWith)}`,
      ),
  ];
  const waitingWaivers = pendingAdj.filter((a) => a.kind === 'waiver');
  // waivers already approved for this pupil: they can be taken back through approval
  const givenWaivers =
    tab === 'waive' && can('fees.adjustment.request')
      ? await apiFetch<{ data: GivenWaiver[] }>(
          `/fees/adjustments?studentId=${studentId}&kind=waiver&status=approved`,
        )
          .then((r) => r.data.filter((w) => !w.undoneAt))
          .catch(() => [] as GivenWaiver[])
      : [];
  const waiverGroups = [
    ...givenWaivers
      .reduce((m, w) => {
        const k = w.batchId ?? `one-${w.id}`;
        m.set(k, [...(m.get(k) ?? []), w]);
        return m;
      }, new Map<string, GivenWaiver[]>())
      .values(),
  ];
  // credit carried from last year that is not used yet: it can be refunded without a receipt
  const openingAdvance =
    tab === 'receipts' && can('fees.refund.request')
      ? await apiFetch<{ available: string; open: boolean }>(
          `/payments/refunds/opening-advance/${studentId}`,
        ).catch(() => ({ available: '0', open: false }))
      : { available: '0', open: false };
  // charges already paid, which can be adjusted in fee through approval
  const paidLate =
    tab === 'latefee' ? pays.filter((p) => p.status === 'posted' && Number(p.lateFee) > 0) : [];
  const paidCharges =
    tab === 'latefee' && can('fees.adjustment.request')
      ? await apiFetch<{ data: Array<{ demandId: string; label: string; paid: string }> }>(
          `/fees/requests/paid-charges/${studentId}`,
        )
          .then((r) => r.data)
          .catch(() => [])
      : [];
  const link = (k: Tab, f: string = fee) =>
    `/fees/ledger/${studentId}?tab=${k}${sp.asOf ? `&asOf=${sp.asOf}` : ''}${f !== 'all' ? `&fee=${f}` : ''}`;
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
            <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Badge tone={ledger.student.status === 'active' ? 'success' : 'danger'}>
                {ledger.student.status === 'active' ? 'Active' : ledger.student.status}
              </Badge>
              <Badge tone="neutral">Fee group: {ledger.fee.feeGroup.replace(/_/g, ' ')}</Badge>
              <Badge tone="neutral">
                {ledger.fee.studentType === 'new' ? 'New student' : 'Old student'}
              </Badge>
              <Badge tone="info">Pays {PAY_PLAN[ledger.fee.payPlan]}</Badge>
              <Badge tone="neutral">{ledger.fee.hosteller ? 'Hosteller' : 'Day scholar'}</Badge>
              <Badge tone="neutral">Transport: {ledger.fee.transport ?? 'none'}</Badge>
              <Badge tone="neutral">
                Discount: {ledger.fee.discounts.length ? ledger.fee.discounts.join(', ') : 'none'}
              </Badge>
              <Badge tone="neutral">
                Optional heads:{' '}
                {ledger.fee.optionalHeads.length ? ledger.fee.optionalHeads.join(', ') : 'none'}
              </Badge>
            </p>
            {!yearOpen ? <Badge tone="warning">This session is {ledger.year.status}</Badge> : null}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/fees/bills?studentId=${studentId}${fee !== 'all' ? `&ledger=${fee}` : ''}`}
            >
              Fee bill
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/fees/parent-view/${studentId}`}>
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
          value={money(totals.payable)}
          hint={`As on ${dmy(ledger.asOf)}`}
        />
        <KpiTile label="Fee balance" value={money(totals.balance)} />
        <KpiTile label="Late fee to collect" value={money(totals.lateFeeOutstanding)} />
        <KpiTile label="Paid this year" value={money(totals.paid)} />
        <KpiTile label="Fee of the year" value={money(totals.net)} />
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
            {k === 'receipts' ? ` (${pays.length})` : ''}
          </a>
        ))}
      </nav>
      {hasHostelFee ? (
        <nav
          aria-label="Fee type"
          className="ep-tabs-links ep-noprint"
          style={{ marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}
        >
          {(
            [
              ['all', 'All'],
              ['school', 'Regular (school fee)'],
              ['hostel', 'Hosteller (hostel fee)'],
            ] as const
          ).map(([f, label]) => (
            <a key={f} href={link(tab, f)} aria-current={f === fee ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      ) : ledger.fee.hosteller ? (
        <p className="ep-alert ep-alert--info ep-noprint" role="status">
          A hosteller with no hostel fee lines this session yet: make the fee again after the hostel
          fee is set.
        </p>
      ) : null}

      {tab === 'pay' && canPost ? (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Card title="Post receipt">
            <PostReceiptForm
              action={postCashierReceipt}
              studentId={studentId}
              modes={modes}
              banks={options.banks}
              accounts={options.accounts}
              payable={totals.payable}
              payableByLedger={
                ledger.instalments.some((i) => i.ledger === 'hostel')
                  ? {
                      school: openOn('school'),
                      hostel: openOn('hostel'),
                    }
                  : undefined
              }
              today={today}
              hasHostel={ledger.instalments.some((i) => i.ledger === 'hostel')}
              canSkipLateFee={can('fees.late_fee.manage')}
              defaultLedger={fee === 'all' ? undefined : fee}
            />
          </Card>
          <Card title="What is due">
            <Dues instalments={inst.filter((i) => i.status !== 'paid')} />
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
            {fee !== 'all' ? <input type="hidden" name="fee" value={fee} /> : null}
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
          <Dues instalments={inst} />
          {canAsk ? (
            <p style={{ marginTop: 'var(--sp-4)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={link('waive')}>
                Waive fee (by head and month)
              </a>
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === 'waive' ? (
        <Card title="Waive fee, by head and month">
          {canAsk ? (
            <>
              {waitingWaivers.length > 0 ? (
                <div className="ep-alert ep-alert--info" role="status">
                  <strong>
                    {waitingWaivers.length} fee line{waitingWaivers.length === 1 ? '' : 's'} (
                    {money(waitingWaivers.reduce((a, w) => a + Number(w.amount), 0))}) already wait
                    for approval
                  </strong>
                  {withWho(waitingWaivers[0]!.waitingWith)}. Their boxes are closed until that
                  request is approved or rejected.
                  <ul>
                    {waitingWaivers.map((w) => (
                      <li key={w.id}>
                        {w.demandLabel ?? 'Fee line'}: {money(w.amount)} · {w.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <WaiverGrid
                studentId={studentId}
                lines={demandRows.filter((r) => onFee(r.ledger))}
                action={requestFeeWaivers}
                waiting={waitingWaivers.map((w) => w.demandId ?? '')}
              />
              {waiverGroups.length > 0 ? (
                <section aria-labelledby="given-waivers" style={{ marginTop: 'var(--sp-5)' }}>
                  <h3 className="ep-h4" id="given-waivers">
                    Waivers already given
                  </h3>
                  <p className="ep-field__help">
                    These show on the bill as an amount taken off the fee. A waiver approved by
                    mistake can be taken back: it goes through Fee setup → Approval levels, and on
                    approval the fee is due again.
                  </p>
                  <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                    {waiverGroups.map((g) => {
                      const first = g[0]!;
                      const total = g.reduce((a, w) => a + Number(w.amount), 0);
                      return (
                        <div key={first.id} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                          <strong>
                            {money(total)} on {g.length} fee line{g.length === 1 ? '' : 's'}
                          </strong>{' '}
                          · {first.reason}
                          {first.decidedBy ? ` · approved by ${first.decidedBy}` : ''}
                          <div className="ep-field__help">
                            {g
                              .slice(0, 6)
                              .map((w) => `${w.demandLabel ?? 'Fee line'} ${money(w.amount)}`)
                              .join(' · ')}
                            {g.length > 6 ? ` · +${g.length - 6} more` : ''}
                          </div>
                          {first.undoStatus === 'pending' ? (
                            <p>
                              <Badge tone="warning">Taking back: waiting for approval</Badge>
                              {withWho(first.undoWaitingWith)}
                            </p>
                          ) : (
                            <form
                              action={requestWaiverUndo}
                              style={{
                                display: 'flex',
                                gap: 'var(--sp-2)',
                                alignItems: 'end',
                                flexWrap: 'wrap',
                                marginTop: 'var(--sp-2)',
                              }}
                            >
                              <input type="hidden" name="id" value={first.id} />
                              <input type="hidden" name="studentId" value={studentId} />
                              <label className="ep-field" style={{ margin: 0, flex: '1 1 16rem' }}>
                                <span className="ep-field__label">
                                  Why is it taken back? *
                                  {first.undoStatus === 'rejected'
                                    ? ' (the last request was rejected)'
                                    : ''}
                                </span>
                                <input
                                  className="ep-input"
                                  name="reason"
                                  required
                                  minLength={3}
                                  maxLength={300}
                                />
                              </label>
                              <Button type="submit" variant="secondary" size="sm">
                                Take this waiver back
                              </Button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <p>You do not have the right to ask for a waiver, or the session is closed.</p>
          )}
        </Card>
      ) : null}

      {tab === 'matrix' ? (
        <Card title="Fee head by month">
          <Matrix rows={allRows.filter((r) => onFee(r.ledger))} />
        </Card>
      ) : null}

      {tab === 'receipts' ? (
        <Card title="Receipts of the year">
          {can('fees.refund.request') && yearOpen ? (
            <p>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/fees/refund-pupil/${studentId}`}
              >
                Refund for the pupil (many receipts, one voucher)
              </a>
            </p>
          ) : null}
          {Number(openingAdvance.available) > 0 && can('fees.refund.request') && yearOpen ? (
            <details style={{ marginBottom: 'var(--sp-4)' }}>
              <summary>
                Advance from last year: {money(openingAdvance.available)} · refund it
              </summary>
              {openingAdvance.open ? (
                <p className="ep-field__help">
                  A refund of this advance is already waiting (Fees → Refunds).
                </p>
              ) : (
                <form
                  action={requestAdvanceRefund}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
                    gap: 'var(--sp-3)',
                    alignItems: 'end',
                    marginTop: 'var(--sp-2)',
                  }}
                >
                  <input type="hidden" name="studentId" value={studentId} />
                  <label className="ep-field">
                    <span className="ep-field__label">Amount to refund (₹) *</span>
                    <input
                      className="ep-input"
                      name="amount"
                      type="number"
                      min={1}
                      max={Number(openingAdvance.available)}
                      step="0.01"
                      defaultValue={Number(openingAdvance.available)}
                      required
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Pay back by</span>
                    <select className="ep-select" name="mode" defaultValue="bank">
                      <option value="bank">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="cash">Cash</option>
                    </select>
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Cheque no. / UTR</span>
                    <input className="ep-input" name="reference" maxLength={80} />
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
                  <div>
                    <Button type="submit" variant="secondary" size="sm">
                      Send refund for approval
                    </Button>
                  </div>
                </form>
              )}
            </details>
          ) : null}
          {pays.length === 0 ? (
            <p className="ep-field__help">No receipt yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {pays.map((p) => (
                <ReceiptRow
                  waiting={waitingOn(p.id)}
                  bounceCharge={ledger.bounceCharge}
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
          {pendingReq.filter((r) => r.kind === 'late_fee').length > 0 ? (
            <div className="ep-alert ep-alert--info" role="status">
              <strong>Late-fee requests waiting for approval</strong>
              <ul>
                {pendingReq
                  .filter((r) => r.kind === 'late_fee')
                  .map((r) => (
                    <li key={r.id}>
                      {r.period ?? 'Instalment'}: charge {money(r.amount ?? 0)}
                      {Number(r.amount ?? 0) === 0 ? ' (waive)' : ''} · {r.reason}
                      {withWho(r.waitingWith)}
                    </li>
                  ))}
              </ul>
              A second request for the same instalment is not taken until this is decided.
            </div>
          ) : null}
          {ledger.overrides.filter((o) => onFee(o.ledger)).length === 0 ? (
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
                  {ledger.overrides
                    .filter((o) => onFee(o.ledger))
                    .map((o) => (
                      <tr key={o.id}>
                        <td>
                          {o.periodName}
                          {o.ledger === 'hostel' ? ' (hostel)' : ''}
                        </td>
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
                  options={inst
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
          {canAsk ? (
            <section aria-labelledby="paid-charge-title" style={{ marginTop: 'var(--sp-5)' }}>
              <h3 className="ep-h4" id="paid-charge-title">
                Adjust a paid late fee or bounce charge in fee
              </h3>
              <p className="ep-field__help">
                For a charge the parent has already paid. After approval (Fee setup → Approval
                levels) the amount is taken off the charge and set against the pupil’s oldest unpaid
                fee; what finds no due stays as advance. The receipt keeps its number.
              </p>
              {paidLate.length === 0 && paidCharges.length === 0 ? (
                <p>No late fee or bounce charge has been paid by this pupil.</p>
              ) : (
                <div className="ep-table-wrap">
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Paid late fee and bounce charges</caption>
                    <thead>
                      <tr>
                        <th scope="col">Paid charge</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Paid (₹)
                        </th>
                        <th scope="col">Adjust in fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...paidLate.map((p) => ({
                          key: `l${p.id}`,
                          label: `Late fee on receipt ${p.receiptNo ?? p.id} (${dmy(p.receivedOn)})`,
                          paid: p.lateFee,
                          kind: 'late_fee_to_fee',
                          field: 'receiptNo',
                          value: p.receiptNo ?? '',
                          waiting: pendingReq.find(
                            (r) => r.kind === 'late_fee_to_fee' && r.paymentId === p.id,
                          ),
                        })),
                        ...paidCharges.map((c) => ({
                          key: `b${c.demandId}`,
                          label: `Bounce charge: ${c.label}`,
                          paid: c.paid,
                          kind: 'bounce_to_fee',
                          field: 'demandId',
                          value: c.demandId,
                          waiting: pendingReq.find(
                            (r) => r.kind === 'bounce_to_fee' && r.demandId === c.demandId,
                          ),
                        })),
                      ].map((x) => (
                        <tr key={x.key}>
                          <td>{x.label}</td>
                          <td style={{ textAlign: 'right' }}>{money(x.paid)}</td>
                          <td>
                            {x.waiting ? (
                              <span>
                                <Badge tone="warning">Waiting for approval</Badge>{' '}
                                {money(x.waiting.amount ?? 0)} · {x.waiting.reason}
                                {withWho(x.waiting.waitingWith)}
                              </span>
                            ) : (
                              <form
                                action={requestPaidChargeToFee}
                                style={{
                                  display: 'flex',
                                  gap: 'var(--sp-2)',
                                  flexWrap: 'wrap',
                                  alignItems: 'end',
                                }}
                              >
                                <input type="hidden" name="studentId" value={studentId} />
                                <input type="hidden" name="kind" value={x.kind} />
                                <input type="hidden" name={x.field} value={x.value} />
                                <label className="ep-field" style={{ margin: 0 }}>
                                  <span className="ep-field__label">Amount (₹)</span>
                                  <input
                                    className="ep-input"
                                    name="amount"
                                    type="number"
                                    min={0.01}
                                    max={Number(x.paid)}
                                    step="0.01"
                                    defaultValue={Number(x.paid)}
                                    required
                                  />
                                </label>
                                <label className="ep-field" style={{ margin: 0 }}>
                                  <span className="ep-field__label">Reason</span>
                                  <input
                                    className="ep-input"
                                    name="reason"
                                    required
                                    minLength={3}
                                    maxLength={300}
                                  />
                                </label>
                                <Button type="submit" variant="secondary" size="sm">
                                  Send for approval
                                </Button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
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

/** Heads down, months across: what is charged, with the paid part and the balance under it. */
function Matrix({ rows }: { rows: FeeDemandSummary['rows'] }) {
  const live = rows.filter((r) => ['pending', 'partial', 'paid'].includes(r.status));
  if (live.length === 0) return <p>No bill has been made for this pupil yet.</p>;
  const months = [...new Map(live.map((r) => [r.sequence, r.periodName])).entries()].sort(
    (a, b) => a[0] - b[0],
  );
  const heads = [...new Map(live.map((r) => [r.headId, r.headName])).entries()];
  const cell = new Map(live.map((r) => [`${r.headId}:${r.sequence}`, r]));
  const sum = (list: typeof live, k: 'net' | 'paid' | 'discount') =>
    list.reduce((a, r) => a + Number(r[k]), 0);
  const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (
    <>
      <p className="ep-field__help">
        Each box shows the fee of the month after discount. Under it: what was taken off (“disc.” is
        a discount or an approved waiver), and what is paid. A green box is fully paid; an amber one
        is part paid.
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Fee per head and month</caption>
          <thead>
            <tr>
              <th scope="col">Fee head</th>
              {months.map(([seq, name]) => (
                <th key={seq} scope="col" style={{ textAlign: 'right' }}>
                  {name.split(' ')[0]!.slice(0, 3)}
                </th>
              ))}
              <th scope="col" style={{ textAlign: 'right' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {heads.map(([headId, headName]) => {
              const mine = live.filter((r) => r.headId === headId);
              return (
                <tr key={headId}>
                  <th scope="row">{headName}</th>
                  {months.map(([seq]) => {
                    const r = cell.get(`${headId}:${seq}`);
                    if (!r)
                      return (
                        <td key={seq} style={{ textAlign: 'right' }}>
                          —
                        </td>
                      );
                    const paid = Number(r.paid);
                    const net = Number(r.net);
                    return (
                      <td key={seq} style={{ textAlign: 'right' }}>
                        <strong>{num(net)}</strong>
                        {Number(r.discount) > 0 ? (
                          <div className="ep-field__help">disc. {num(Number(r.discount))}</div>
                        ) : null}
                        {paid > 0 ? (
                          <div>
                            <Badge tone={paid >= net ? 'success' : 'warning'}>
                              paid {num(paid)}
                            </Badge>
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'right' }}>
                    <strong>{num(sum(mine, 'net'))}</strong>
                    <div className="ep-field__help">paid {num(sum(mine, 'paid'))}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {months.map(([seq]) => {
                const col = live.filter((r) => r.sequence === seq);
                return (
                  <th key={seq} style={{ textAlign: 'right' }}>
                    {num(sum(col, 'net'))}
                    <div className="ep-field__help">paid {num(sum(col, 'paid'))}</div>
                  </th>
                );
              })}
              <th style={{ textAlign: 'right' }}>
                {num(sum(live, 'net'))}
                <div className="ep-field__help">
                  paid {num(sum(live, 'paid'))} · balance{' '}
                  {num(sum(live, 'net') - sum(live, 'paid'))}
                </div>
              </th>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Dues({ instalments }: { instalments: FeeLedgerInstalment[] }) {
  if (instalments.length === 0) return <p>Nothing is due.</p>;
  const sum = (list: FeeLedgerInstalment[], f: (i: FeeLedgerInstalment) => number) =>
    list.reduce((a, i) => a + f(i), 0);
  const total = (list: FeeLedgerInstalment[]) => ({
    net: sum(list, (i) => Number(i.net)),
    paid: sum(list, (i) => Number(i.paid)),
    balance: sum(list, (i) => Number(i.balance)),
    late: sum(list, (i) => Number(i.lateFee.outstanding)),
  });
  // what should be paid by now: instalments whose last date has come (due or overdue)
  const now = total(instalments.filter((i) => i.status === 'overdue' || i.status === 'due'));
  const all = total(instalments);
  return (
    <>
      <p style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span>
          Due now, with late fee: <strong>{money(now.balance + now.late)}</strong>
        </span>
        <span className="ep-field__help">
          fee {money(now.balance)} + late fee {money(now.late)}
        </span>
      </p>
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
              <th scope="col" style={{ textAlign: 'right' }}>
                Total to pay
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
                <td style={{ textAlign: 'right' }}>
                  <strong>{money(Number(i.balance) + Number(i.lateFee.outstanding))}</strong>
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
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total of the rows above
              </th>
              <th style={{ textAlign: 'right' }}>{money(all.net)}</th>
              <th style={{ textAlign: 'right' }}>{money(all.paid)}</th>
              <th style={{ textAlign: 'right' }}>{money(all.balance)}</th>
              <th style={{ textAlign: 'right' }}>{money(all.late)}</th>
              <th style={{ textAlign: 'right' }}>{money(all.balance + all.late)}</th>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function ReceiptRow({
  p,
  studentId,
  canAsk,
  canRefund,
  bounceCharge,
  waiting,
}: {
  p: FeeLedgerPayment;
  studentId: string;
  canAsk: boolean;
  canRefund: boolean;
  bounceCharge: string;
  /** Requests already open on this receipt: no new one is taken until they are decided. */
  waiting: string[];
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
      {waiting.length > 0 ? (
        <div className="ep-alert ep-alert--info" role="status" style={{ marginTop: 'var(--sp-3)' }}>
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
            {waiting.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          Nothing else can be asked on this receipt until this is decided (Fees → Refunds,
          Adjustments, or My approvals).
        </div>
      ) : null}
      {waiting.length === 0 && good && (canAsk || canRefund) ? (
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
                  <input
                    className="ep-input"
                    name="charge"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={Number(bounceCharge)}
                    required
                  />
                  <span className="ep-field__help">
                    From Fee setup (the class’s bounce charge, else the school’s). Change it only if
                    the bank charged differently; 0 = no charge.
                  </span>
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Send bounce for approval
                </Button>
              </form>
            </details>
          ) : null}
          {canRefund && refundable > 0 ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/fees/refund/${p.id}`}>
              Refund (by fee head)
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
