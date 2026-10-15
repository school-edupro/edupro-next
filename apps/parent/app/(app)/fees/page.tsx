import { FileLinks } from '@/components/FileLinks';
import {
  Badge,
  Button,
  Card,
  FeeBillSheet,
  InstalmentBillSheet,
  PageHeader,
  type FeeBillView,
  type InstalmentBill,
} from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { PayPanel, type PayGateway, type PayRow, type PayWords } from '@/components/PayPanel';
import { PrintButton } from '@/components/PrintButton';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';

interface Instalment {
  dueOn: string;
  label: string;
  net: string;
  paid: string;
  balance: string;
  status: 'paid' | 'overdue' | 'due' | 'upcoming';
  lateFee: { amount: string; posted: string; outstanding: string };
  /** false: the class keeps this instalment off online payment */
  feePay?: boolean;
  /** school fee or hostel fee: each is shown and paid on its own */
  ledger?: string;
}
interface Payment {
  id: string;
  receiptNo: string | null;
  receivedOn: string;
  amount: string;
  lateFee: string;
  refunded: string;
  mode: string;
  status: string;
  settled: boolean;
  clearedOn: string | null;
  ledger?: string;
}
interface Child {
  student: { id: string; name: string; admissionNo: string; section: string | null };
  year: { code: string; status: string };
  fee?: {
    feeGroup: string;
    payPlan: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
    hosteller: boolean;
    hostelFrom?: string | null;
    hostelTo?: string | null;
    hostelPayPlan?: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
    transport: string | null;
    discounts: string[];
    optionalHeads: string[];
  };
  instalments: Instalment[];
  totals: { balance: string; lateFeeOutstanding: string; payable: string };
  payments: Payment[];
  payableNow: string;
  payableSchool?: string;
  payableHostel?: string;
  hidden: number;
}
interface Intent {
  id: string;
  txnId: string;
  amount: string;
  status: string;
  provider: string;
  entityId: string | null;
  createdAt: string;
}
interface MiscChild {
  student: { id: string; name: string };
  lines: Array<{
    id: string;
    title: string;
    mandatory: boolean;
    seats: number | null;
    seatsTaken: number;
    remark: string | null;
    amount: string;
    paid: string;
    balance: string;
    lastDate: string;
    status: string;
    blocked: string | null;
  }>;
}
type Bill = FeeBillView & InstalmentBill & { layout: 'annual' | 'instalment' };

const PAY_PLAN = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
} as const;
const TABS = ['school', 'hostel', 'other', 'receipts', 'bill'] as const;
type Tab = (typeof TABS)[number];

const money = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('-');
const monthOf = (v: string) =>
  new Date(`${v.slice(0, 10)}T00:00:00Z`).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const payWords = (lang: Lang): PayWords => ({
  instalment: t(lang, 'Instalments'),
  dueOn: t(lang, 'Due on'),
  fee: t(lang, 'Fee'),
  paid: t(lang, 'Paid'),
  toPay: t(lang, 'To pay'),
  lateFee: t(lang, 'Late fee'),
  status: t(lang, 'Status'),
  statuses: {
    paid: t(lang, 'Paid'),
    overdue: t(lang, 'Overdue'),
    due: t(lang, 'Due'),
    upcoming: t(lang, 'Upcoming'),
  },
  counter: t(lang, 'Paid at the school fee counter only.'),
  oldestFirst: t(
    lang,
    'Tick the instalments to pay. They are paid the oldest first, so a tick takes the earlier ones with it.',
  ),
  payThrough: t(lang, 'Pay through'),
  charge: t(lang, 'Convenience charge'),
  noCharge: t(lang, 'No convenience charge'),
  total: t(lang, 'Total to pay'),
  pay: t(lang, 'Pay'),
  nothingTicked: t(lang, 'Tick an instalment to pay'),
  noGateway: t(
    lang,
    'Online payment is not open for this fee yet. Please pay at the school fee counter.',
  ),
  selectRow: t(lang, 'Pay'),
});

/** Dues, online payment, receipts and the fee bill of one child (the sibling switch picks the child). */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    paid?: string;
    error?: string;
    detail?: string;
    student?: string;
    export?: string;
    tab?: string;
    bill?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let children: Child[];
  let intents: Intent[];
  let permissions: string[] = [];
  try {
    [children, intents, permissions] = await Promise.all([
      bff.api.fetch<{ children: Child[] }>('/fees/mine').then((r) => r.children),
      bff.api
        .fetch<{ data: Intent[] }>('/payments/intents/mine')
        .then((r) => r.data)
        .catch(() => [] as Intent[]),
      bff.api
        .me()
        .then((m) => m.permissions)
        .catch(() => [] as string[]),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Fees')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const kid = await chosenChild(sp.student);
  const c = children.find((x) => x.student.id === kid?.id) ?? children[0];
  const misc = await bff.api
    .fetch<{ children: MiscChild[] }>('/fees/misc-fees/mine')
    .then((r) => r.children.find((m) => m.student.id === c?.student.id) ?? null)
    .catch(() => null);
  // the Pay button follows the permission, not whether the intents call answered
  const canPay = permissions.includes('payments.family.pay');
  const gatewaysOf = async (ledger: string) =>
    canPay
      ? bff.api
          .fetch<{ data: PayGateway[] }>(`/payments/gateways/options?ledger=${ledger}`)
          .then((r) => r.data)
          .catch(() => [] as PayGateway[])
      : [];
  const hostel = !!c && (c.fee?.hosteller || c.instalments.some((x) => x.ledger === 'hostel'));
  const miscOpen = (misc?.lines ?? []).filter(
    (l) => l.status !== 'paid' && !l.blocked && Number(l.balance) > 0,
  );
  const tabs: Tab[] = TABS.filter((x) => x !== 'hostel' || hostel);
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'school';
  const billLedger =
    sp.bill === 'school' || sp.bill === 'hostel' ? sp.bill : hostel ? 'all' : 'school';
  const [gwSchool, gwHostel, gwMisc, bill] = await Promise.all([
    tab === 'school' ? gatewaysOf('school') : [],
    tab === 'hostel' ? gatewaysOf('hostel') : [],
    tab === 'other' ? gatewaysOf('misc') : [],
    tab === 'bill' && c
      ? bff.api
          .fetch<Bill>(`/fees/mine/bill?studentId=${c.student.id}&ledger=${billLedger}`)
          .catch(() => null)
      : null,
  ]);
  // a queued receipt PDF: the worker renders it and the link appears when ready
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{
          export: { id: string; status: string; title: string };
          download: { url: string; saveUrl?: string } | null;
        }>(`/fees/mine/exports/${sp.export}`)
        .catch(() => null)
    : null;

  const href = (to: Tab, extra = '') =>
    `/fees?student=${encodeURIComponent(c?.student.id ?? '')}&tab=${to}${extra}`;
  const tabLabel: Record<Tab, string> = {
    school: t(lang, 'School fee'),
    hostel: t(lang, 'Hostel fee'),
    other: t(lang, 'Other fees'),
    receipts: t(lang, 'Receipts'),
    bill: t(lang, 'Fee bill'),
  };
  const rowsOf = (ledger: 'school' | 'hostel'): PayRow[] =>
    (c?.instalments ?? [])
      .filter((x) => (x.ledger ?? 'school') === ledger)
      .map((x) => ({
        key: x.dueOn,
        label: x.label,
        dueOn: x.dueOn,
        net: x.net,
        paid: x.paid,
        balance: x.balance,
        lateFee: x.lateFee.outstanding,
        status: x.status,
        online: x.feePay !== false,
      }));
  const dueSchool = c ? (c.payableSchool ?? c.payableNow) : '0';
  const dueHostel = c?.payableHostel ?? '0';
  const dueOther = miscOpen.reduce((a, l) => a + Number(l.balance), 0);
  const active = c?.year.status === 'active';

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <div className="ep-noprint">
        <PageHeader
          kicker={t(lang, 'Fees')}
          title={t(lang, 'Dues and receipts')}
          description={t(
            lang,
            'What is due, pay online, every receipt of this session and the fee bill.',
          )}
          actions={
            <>
              {c ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/fees/tax-certificate?student=${c.student.id}`}
                >
                  {t(lang, 'Tax certificate')}
                </a>
              ) : null}
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
                {t(lang, 'Home')}
              </a>
            </>
          }
        />
        <ChildSwitch lang={lang} back="/fees" current={kid?.id} />
        {sp.paid === '1' ? (
          <div
            className="ep-alert ep-alert--success"
            role="status"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {t(lang, 'Payment received. The receipt is listed below.')}{' '}
            <a href={href('receipts')}>{t(lang, 'Receipts')}</a>
          </div>
        ) : sp.paid ? (
          <div
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {t(
              lang,
              'The payment did not go through. Nothing has been charged; you can try again.',
            )}
          </div>
        ) : null}
        {sp.error ? (
          <div
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {sp.detail || sp.error}
          </div>
        ) : null}
        {exportStatus ? (
          <div
            className="ep-alert ep-alert--info"
            role="status"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {exportStatus.download ? (
              <span className="ep-filecell">
                {t(lang, 'Receipt PDF')}
                <FileLinks
                  url={exportStatus.download.url}
                  saveUrl={exportStatus.download.saveUrl}
                  label={t(lang, 'Receipt PDF')}
                  viewLabel={t(lang, 'View')}
                  saveLabel={t(lang, 'Download')}
                />
              </span>
            ) : (
              <>
                {t(lang, 'The receipt PDF is being prepared.')}{' '}
                <a href={`${href('receipts')}&export=${exportStatus.export.id}`}>
                  {t(lang, 'Refresh')}
                </a>
              </>
            )}
          </div>
        ) : null}
      </div>
      {!c ? (
        <Card>{t(lang, 'No fee demand has been raised yet.')}</Card>
      ) : (
        <>
          <Card
            className="ep-noprint"
            title={`${c.student.name}${c.student.section ? ` · ${c.student.section}` : ''} · ${c.year.code}`}
          >
            {c.fee ? (
              <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', margin: 0 }}>
                <Badge tone="info">
                  {t(lang, 'Pay plan')}: {t(lang, PAY_PLAN[c.fee.payPlan])}
                </Badge>
                {c.fee.hosteller ? <Badge tone="neutral">{t(lang, 'Hosteller')}</Badge> : null}
                {c.fee.transport ? (
                  <Badge tone="neutral">
                    {t(lang, 'Transport')}: {c.fee.transport}
                  </Badge>
                ) : null}
                {c.fee.discounts.length > 0 ? (
                  <Badge tone="success">
                    {t(lang, 'Discount')}: {c.fee.discounts.join(', ')}
                  </Badge>
                ) : null}
              </p>
            ) : null}
            <div className="fp-due">
              <div className="fp-due__tile fp-due__tile--lead">
                <div className="ep-kicker">{t(lang, 'Due now')}</div>
                <div className="fp-due__amt">
                  ₹{money(Number(dueSchool) + Number(dueHostel) + dueOther)}
                </div>
                <span className="ep-field__help">{t(lang, 'Late fee included')}</span>
              </div>
              <a className="fp-due__tile" href={href('school')}>
                <div className="ep-kicker">{t(lang, 'School fee')}</div>
                <div className="fp-due__amt">₹{money(dueSchool)}</div>
              </a>
              {hostel ? (
                <a className="fp-due__tile" href={href('hostel')}>
                  <div className="ep-kicker">{t(lang, 'Hostel fee')}</div>
                  <div className="fp-due__amt">₹{money(dueHostel)}</div>
                </a>
              ) : null}
              {misc?.lines.length ? (
                <a className="fp-due__tile" href={href('other')}>
                  <div className="ep-kicker">{t(lang, 'Other fees')}</div>
                  <div className="fp-due__amt">₹{money(dueOther)}</div>
                </a>
              ) : null}
            </div>
          </Card>
          <nav
            className="ep-tabs-links ep-noprint"
            aria-label={t(lang, 'Fees')}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            {tabs.map((x) => (
              <a key={x} href={href(x)} aria-current={x === tab ? 'page' : undefined}>
                {tabLabel[x]}
              </a>
            ))}
          </nav>

          {tab === 'school' || tab === 'hostel' ? (
            <Card
              title={`${tabLabel[tab]} · ₹${money(tab === 'hostel' ? dueHostel : dueSchool)} ${t(lang, 'to pay')}`}
            >
              {tab === 'hostel' && (c.fee?.hostelFrom || c.fee?.hostelTo) ? (
                <p className="ep-field__help">
                  {t(lang, 'In the hostel')}:{' '}
                  {c.fee.hostelFrom ? monthOf(c.fee.hostelFrom) : t(lang, 'session start')} –{' '}
                  {c.fee.hostelTo ? monthOf(c.fee.hostelTo) : t(lang, 'session end')}
                </p>
              ) : null}
              {rowsOf(tab).length === 0 ? (
                <p className="ep-field__help">{t(lang, 'No fee demand has been raised yet.')}</p>
              ) : (
                <PayPanel
                  key={`${c.student.id}-${tab}`}
                  studentId={c.student.id}
                  ledger={tab}
                  rows={rowsOf(tab)}
                  payable={tab === 'hostel' ? dueHostel : dueSchool}
                  gateways={tab === 'hostel' ? gwHostel : gwSchool}
                  canPay={canPay && active}
                  words={payWords(lang)}
                />
              )}
              {c.hidden > 0 ? (
                <p className="ep-field__help">
                  {t(lang, 'Later instalments appear when the school opens them.')}
                </p>
              ) : null}
            </Card>
          ) : null}

          {tab === 'other' ? (
            <Card title={tabLabel.other}>
              <p className="ep-field__help">
                {t(
                  lang,
                  gwMisc.length && canPay
                    ? 'Fees announced by the school for a trip, an activity or a form. Pay online in full, or at the school fee counter.'
                    : 'Fees announced by the school for a trip, an activity or a form. They are paid at the school fee counter.',
                )}
              </p>
              {!misc?.lines.length ? (
                <p className="ep-field__help">{t(lang, 'No other fees.')}</p>
              ) : (
                <ul className="fp-rcpts">
                  {misc.lines.map((l) => (
                    <li key={l.id}>
                      <span>
                        <strong>{l.title}</strong>
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {t(lang, 'Last date')} {dmy(l.lastDate)} · {t(lang, 'Amount')} ₹
                          {money(l.amount)}
                          {Number(l.paid) > 0 ? ` · ${t(lang, 'Paid')} ₹${money(l.paid)}` : ''}
                          {' · '}
                          {t(lang, l.mandatory ? 'Mandatory' : 'Optional')}
                          {l.seats === null
                            ? ''
                            : ` · ${t(lang, 'Seats')} ${String(l.seatsTaken)}/${String(l.seats)}`}
                          {l.remark ? ` · ${l.remark}` : ''}
                        </span>
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-2)',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Badge
                          tone={l.status === 'paid' ? 'success' : l.blocked ? 'neutral' : 'warning'}
                        >
                          {l.status === 'paid'
                            ? t(lang, 'Paid')
                            : l.blocked
                              ? t(lang, l.blocked)
                              : `${t(lang, 'To pay')} ₹${money(l.balance)}`}
                        </Badge>
                        {gwMisc.length && canPay && miscOpen.includes(l) ? (
                          <form
                            method="post"
                            action="/fees/pay-misc"
                            style={{
                              display: 'flex',
                              gap: 'var(--sp-2)',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <input type="hidden" name="lineId" value={l.id} />
                            <input type="hidden" name="studentId" value={misc.student.id} />
                            {gwMisc.length === 1 ? (
                              <input type="hidden" name="gatewayId" value={gwMisc[0]!.id} />
                            ) : (
                              <select
                                className="ep-select"
                                name="gatewayId"
                                aria-label={`${t(lang, 'Pay through')} · ${l.title}`}
                              >
                                {gwMisc.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <Button type="submit" size="sm">
                              {t(lang, 'Pay online')} ₹{money(l.balance)}
                            </Button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === 'receipts' ? (
            <>
              <Card title={tabLabel.receipts}>
                {c.payments.length === 0 ? (
                  <p className="ep-field__help">{t(lang, 'No receipts yet.')}</p>
                ) : (
                  <ul className="fp-rcpts">
                    {c.payments.map((p) => (
                      <li key={p.id}>
                        <span>
                          <strong>{p.receiptNo ?? '—'}</strong>{' '}
                          <Badge tone={p.ledger === 'hostel' ? 'info' : 'neutral'}>
                            {t(lang, p.ledger === 'hostel' ? 'Hostel fee' : 'School fee')}
                          </Badge>{' '}
                          {p.status === 'bounced' ? (
                            <Badge tone="danger">{t(lang, 'Bounced')}</Badge>
                          ) : p.status !== 'posted' && Number(p.refunded) > 0 ? (
                            <Badge tone="warning">
                              {t(
                                lang,
                                p.status === 'partly_refunded' ? 'Partly refunded' : 'Refunded',
                              )}{' '}
                              ₹{money(p.refunded)}
                            </Badge>
                          ) : p.status !== 'posted' ? (
                            <Badge tone="neutral">{t(lang, 'Cancelled')}</Badge>
                          ) : null}
                          <span className="ep-field__help" style={{ display: 'block' }}>
                            {dmy(p.receivedOn)} · {p.mode.toUpperCase()} · ₹{money(p.amount)}
                            {Number(p.lateFee) > 0
                              ? ` (${t(lang, 'Late fee')} ₹${money(p.lateFee)})`
                              : ''}
                            {p.clearedOn
                              ? ` · ${t(lang, 'Cleared')} ${dmy(p.clearedOn)}`
                              : p.settled
                                ? ` · ${t(lang, 'Settled')}`
                                : ''}
                          </span>
                        </span>
                        <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/fees/receipt/${p.id}`}
                          >
                            {t(lang, 'View')}
                          </a>
                          <a
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            href={`/fees/receipt/${p.id}/pdf`}
                          >
                            {t(lang, 'Download PDF')}
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {intents.length ? (
                <Card title={t(lang, 'Online payments')} style={{ marginTop: 'var(--sp-4)' }}>
                  <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th scope="col">{t(lang, 'Date')}</th>
                        <th scope="col">{t(lang, 'Transaction')}</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          {t(lang, 'Amount')}
                        </th>
                        <th scope="col">{t(lang, 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intents.map((i) => (
                        <tr key={i.id}>
                          <td>{new Date(i.createdAt).toLocaleString('en-IN')}</td>
                          <td>
                            <code>{i.txnId}</code>
                          </td>
                          <td style={{ textAlign: 'right' }}>₹{money(i.amount)}</td>
                          <td>
                            <Badge
                              tone={
                                i.status === 'succeeded'
                                  ? 'success'
                                  : i.status === 'failed'
                                    ? 'danger'
                                    : 'warning'
                              }
                            >
                              {i.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ) : null}
            </>
          ) : null}

          {tab === 'bill' ? (
            <>
              <div
                className="ep-noprint"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginBottom: 'var(--sp-3)',
                }}
              >
                {hostel ? (
                  <nav
                    className="ep-tabs-links"
                    aria-label={t(lang, 'Fee bill')}
                    style={{ margin: 0 }}
                  >
                    {(['all', 'school', 'hostel'] as const).map((l) => (
                      <a
                        key={l}
                        href={href('bill', `&bill=${l}`)}
                        aria-current={l === billLedger ? 'page' : undefined}
                      >
                        {t(lang, l === 'all' ? 'All' : l === 'school' ? 'Regular' : 'Hostel')}
                      </a>
                    ))}
                  </nav>
                ) : null}
                <span style={{ flex: 1 }} />
                <PrintButton label={t(lang, 'Print')} />
                <a
                  className="ep-btn ep-btn--secondary"
                  href={`/fees/bill/pdf?student=${c.student.id}&ledger=${billLedger}`}
                >
                  {t(lang, 'Download PDF')}
                </a>
              </div>
              {!bill ? (
                <Card>{t(lang, 'The fee bill could not be made. Please try again.')}</Card>
              ) : bill.layout === 'instalment' ? (
                <InstalmentBillSheet b={bill} />
              ) : (
                <FeeBillSheet b={bill} />
              )}
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
