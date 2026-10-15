import { FileLinks } from '@/components/FileLinks';
import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
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
}
interface Child {
  student: { id: string; name: string; admissionNo: string; section: string | null };
  year: { code: string; status: string };
  fee?: {
    feeGroup: string;
    studentType: 'new' | 'old';
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
  refunds: Array<{ id: string; amount: string; status: string; reason: string }>;
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

interface GatewayOption {
  id: string;
  provider: string;
  label: string;
  chargePercent: string;
  chargeFlat: string;
}

/** What a gateway adds on top of the fee, in words ("₹5 + 1.5%"), or nothing when the school bears it. */
const chargeText = (g: GatewayOption) => {
  const pct = Number(g.chargePercent);
  const flat = Number(g.chargeFlat);
  const parts = [flat > 0 ? `₹${flat.toFixed(2)}` : '', pct > 0 ? `${pct}%` : ''].filter(Boolean);
  return parts.join(' + ');
};

/** The gateway choice of a Pay form: radio buttons when the fee has several, else the one gateway's charge. */
function GatewayPick({
  options,
  lang,
  name,
}: {
  options: GatewayOption[];
  lang: Lang;
  name: string;
}) {
  if (options.length === 0) return null;
  if (options.length === 1) {
    const c = chargeText(options[0]!);
    return (
      <>
        <input type="hidden" name="gatewayId" value={options[0]!.id} />
        {c ? (
          <span className="ep-field__help">
            {t(lang, 'Convenience charge')}: {c}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ep-field__label">{t(lang, 'Pay through')}</legend>
      {options.map((g, i) => (
        <label key={g.id} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <input
            type="radio"
            name="gatewayId"
            value={g.id}
            defaultChecked={i === 0}
            aria-describedby={name}
          />
          {g.label}
          {chargeText(g) ? (
            <span className="ep-field__help">
              ({t(lang, 'Convenience charge')} {chargeText(g)})
            </span>
          ) : null}
        </label>
      ))}
    </fieldset>
  );
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

const PAY_PLAN = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
} as const;

/**
 * What the parent may pay online: whole instalments of the child's pay plan, the oldest first. Each
 * choice is everything due up to and including that instalment (fee left + late fee).
 */
function payChoices(c: Child, ledger: string): Array<{ label: string; amount: string }> {
  const out: Array<{ label: string; amount: string }> = [];
  let sum = 0;
  const own = ledger === 'hostel' ? c.payableHostel : c.payableSchool;
  const all = own ?? c.payableNow;
  for (const i of c.instalments.filter((x) => (x.ledger ?? 'school') === ledger)) {
    if (i.feePay === false) continue;
    const due = Number(i.balance) + Number(i.lateFee.outstanding);
    if (due <= 0) continue;
    sum += due;
    out.push({ label: i.label, amount: sum.toFixed(2) });
  }
  // the ledger's own figure is always offered, so nothing payable is left out by rounding
  if (Number(all) > 0 && !out.some((o) => o.amount === Number(all).toFixed(2)))
    out.push({ label: 'All', amount: Number(all).toFixed(2) });
  return out;
}

const monthOf = (v: string) =>
  new Date(`${v.slice(0, 10)}T00:00:00Z`).toLocaleString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const tone = (s: Instalment['status']) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';

/** Sprint 13: dues, receipts and online payment for the family's children. */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    paid?: string;
    error?: string;
    detail?: string;
    student?: string;
    export?: string;
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
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
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
  const shown = children.filter((c) => !kid || c.student.id === kid.id);
  // misc fees the school has announced for the children (a trip, an activity): paid at the counter
  const misc = await bff.api
    .fetch<{ children: MiscChild[] }>('/fees/misc-fees/mine')
    .then((r) => r.children.filter((c) => !kid || c.student.id === kid.id))
    .catch(() => [] as MiscChild[]);
  // Sprint 16: the Pay button follows the permission, not whether the intents call answered
  const canPay = permissions.includes('payments.family.pay');
  // the gateways the school takes each fee through (Fee setup -> Payment gateways), with their charge
  const gatewaysOf = async (ledger: string) =>
    canPay
      ? bff.api
          .fetch<{ data: GatewayOption[] }>(`/payments/gateways/options?ledger=${ledger}`)
          .then((r) => r.data)
          .catch(() => [] as GatewayOption[])
      : [];
  const [gwSchool, gwHostel, gwMisc] = await Promise.all([
    gatewaysOf('school'),
    gatewaysOf('hostel'),
    gatewaysOf('misc'),
  ]);
  // Sprint 14: a queued receipt PDF; the worker renders it and the link appears when ready
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{
          export: { id: string; status: string; title: string };
          download: { url: string; saveUrl?: string } | null;
        }>(`/fees/mine/exports/${sp.export}`)
        .catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Fees')}
        title={t(lang, 'Dues and receipts')}
        description={t(
          lang,
          'Instalments the school has opened, what is payable today, and every receipt of this session.',
        )}
        actions={
          <>
            {(kid ?? children[0]?.student) ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/fees/tax-certificate?student=${(kid ?? children[0]!.student).id}`}
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
          {t(lang, 'Payment received. The receipt is listed below.')}
        </div>
      ) : sp.paid ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'The payment did not go through. Nothing has been charged; you can try again.')}
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
              <a
                href={`/fees?student=${encodeURIComponent(sp.student ?? '')}&export=${exportStatus.export.id}`}
              >
                {t(lang, 'Refresh')}
              </a>
            </>
          )}
        </div>
      ) : null}
      {shown.length === 0 ? <Card>{t(lang, 'No fee demand has been raised yet.')}</Card> : null}
      {shown.map((c) => (
        <Card
          key={c.student.id}
          title={`${c.student.name}${c.student.section ? ` · ${c.student.section}` : ''} · ${c.year.code}`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {c.fee ? (
            <p style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Badge tone="info">
                {t(lang, 'Pay plan')}: {t(lang, PAY_PLAN[c.fee.payPlan])}
              </Badge>
              <Badge tone="neutral">
                {t(lang, 'Fee group')}: {c.fee.feeGroup.replace(/_/g, ' ')}
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
              {c.fee.optionalHeads.length > 0 ? (
                <Badge tone="neutral">
                  {t(lang, 'Optional')}: {c.fee.optionalHeads.join(', ')}
                </Badge>
              ) : null}
            </p>
          ) : null}
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-2)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              marginBottom: 'var(--sp-3)',
            }}
          >
            {(
              [
                [t(lang, 'Payable now'), c.payableNow],
                [t(lang, 'Balance'), c.totals.balance],
                [t(lang, 'Late fee'), c.totals.lateFeeOutstanding],
              ] as const
            ).map(([label, v]) => (
              <div
                key={label}
                className="ep-card ep-card--elevated"
                style={{ padding: 'var(--sp-3)' }}
              >
                <div className="ep-kicker">{label}</div>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 'var(--fs-h3)',
                    fontWeight: 600,
                  }}
                >
                  ₹{v}
                </div>
              </div>
            ))}
          </div>
          {(() => {
            // school fee and hostel fee are shown and paid on their own
            const split = c.instalments.some((x) => x.ledger === 'hostel');
            const stay =
              c.fee?.hostelFrom || c.fee?.hostelTo
                ? `${c.fee.hostelFrom ? monthOf(c.fee.hostelFrom) : t(lang, 'session start')} – ${c.fee.hostelTo ? monthOf(c.fee.hostelTo) : t(lang, 'session end')}`
                : null;
            return (split ? (['school', 'hostel'] as const) : (['school'] as const)).map(
              (ledger) => {
                const rows = c.instalments.filter((x) => (x.ledger ?? 'school') === ledger);
                const title = ledger === 'hostel' ? 'Hostel fee' : 'School fee';
                const payable =
                  (ledger === 'hostel'
                    ? c.payableHostel
                    : split
                      ? c.payableSchool
                      : c.payableNow) ?? c.payableNow;
                return (
                  <section key={ledger} style={{ marginBottom: 'var(--sp-4)' }}>
                    {split ? (
                      <h4
                        style={{
                          fontFamily: 'var(--font-heading)',
                          margin: 'var(--sp-3) 0 var(--sp-2)',
                        }}
                      >
                        {t(lang, title)} · ₹{payable} {t(lang, 'to pay')}
                        {ledger === 'hostel' && stay ? (
                          <small className="ep-field__help">
                            {' '}
                            · {t(lang, 'In the hostel')}: {stay}
                          </small>
                        ) : null}
                      </h4>
                    ) : null}
                    <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th>{t(lang, 'Instalment')}</th>
                          <th>{t(lang, 'Due on')}</th>
                          <th style={{ textAlign: 'right' }}>{t(lang, 'Amount')}</th>
                          <th style={{ textAlign: 'right' }}>{t(lang, 'Balance')}</th>
                          <th style={{ textAlign: 'right' }}>{t(lang, 'Late fee')}</th>
                          <th>{t(lang, 'Status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((x) => (
                          <tr key={`${ledger}-${x.dueOn}`}>
                            <td>{x.label}</td>
                            <td>{x.dueOn}</td>
                            <td style={{ textAlign: 'right' }}>₹{x.net}</td>
                            <td style={{ textAlign: 'right' }}>₹{x.balance}</td>
                            <td style={{ textAlign: 'right' }}>
                              {Number(x.lateFee.outstanding) > 0
                                ? `₹${x.lateFee.outstanding}`
                                : '—'}
                            </td>
                            <td>
                              <Badge tone={tone(x.status)}>
                                {t(
                                  lang,
                                  x.status === 'paid'
                                    ? 'Paid'
                                    : x.status === 'overdue'
                                      ? 'Overdue'
                                      : x.status === 'due'
                                        ? 'Due'
                                        : 'Upcoming',
                                )}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {c.year.status === 'active' && Number(payable) > 0 && canPay ? (
                      <form
                        method="post"
                        action="/fees/pay"
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-2)',
                          alignItems: 'flex-end',
                          marginTop: 'var(--sp-3)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <input type="hidden" name="studentId" value={c.student.id} />
                        <input type="hidden" name="ledger" value={ledger} />
                        <label className="ep-field" style={{ margin: 0 }}>
                          <span className="ep-field__label">{t(lang, 'Pay up to')}</span>
                          <select
                            className="ep-select"
                            name="amount"
                            defaultValue={Number(payable).toFixed(2)}
                            required
                            aria-label={`${t(lang, 'Pay up to')} · ${t(lang, title)}`}
                          >
                            {payChoices(c, ledger).map((o) => (
                              <option key={o.amount} value={o.amount}>
                                {o.label} · ₹{o.amount}
                              </option>
                            ))}
                          </select>
                          <span className="ep-field__help">
                            {t(lang, 'Whole instalments, the oldest first.')}
                          </span>
                        </label>
                        <GatewayPick
                          options={ledger === 'hostel' ? gwHostel : gwSchool}
                          lang={lang}
                          name={`pay-${c.student.id}-${ledger}`}
                        />
                        <Button type="submit">
                          {split ? `${t(lang, 'Pay')} ${t(lang, title)}` : t(lang, 'Pay online')}
                        </Button>
                      </form>
                    ) : null}
                  </section>
                );
              },
            );
          })()}
          {c.hidden > 0 ? (
            <p className="ep-field__help">
              {t(lang, 'Later instalments appear when the school opens them.')}
            </p>
          ) : null}
          <h4 style={{ fontFamily: 'var(--font-heading)', margin: 'var(--sp-4) 0 var(--sp-2)' }}>
            {t(lang, 'Receipts')}
          </h4>
          {c.payments.length === 0 ? (
            <p className="ep-field__help">{t(lang, 'No receipts yet.')}</p>
          ) : (
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{t(lang, 'Receipt')}</th>
                  <th>{t(lang, 'Date')}</th>
                  <th style={{ textAlign: 'right' }}>{t(lang, 'Amount')}</th>
                  <th>{t(lang, 'Mode')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.receiptNo ?? '—'}</strong>
                      {p.status !== 'posted' ? (
                        <small>
                          {' '}
                          · {t(lang, 'Refunded')} ₹{p.refunded}
                        </small>
                      ) : null}
                    </td>
                    <td>{p.receivedOn}</td>
                    <td style={{ textAlign: 'right' }}>
                      ₹{p.amount}
                      {Number(p.lateFee) > 0 ? (
                        <small>
                          {' '}
                          ({t(lang, 'Late fee')} ₹{p.lateFee})
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {p.mode.toUpperCase()}
                      {p.status === 'bounced' ? (
                        <small> · {t(lang, 'Bounced')}</small>
                      ) : p.clearedOn ? (
                        <small>
                          {' '}
                          · {t(lang, 'Cleared')} {p.clearedOn}
                        </small>
                      ) : p.settled ? (
                        <small> · {t(lang, 'Settled')}</small>
                      ) : null}
                    </td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/fees/receipt/${p.id}`}
                      >
                        {t(lang, 'View')}
                      </a>{' '}
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/fees/receipt/${p.id}/pdf`}
                      >
                        {t(lang, 'Download PDF')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
      {misc.map((m) => (
        <Card key={`misc-${m.student.id}`} title={`${t(lang, 'Other fees')} · ${m.student.name}`}>
          <p className="ep-field__help">
            {t(
              lang,
              gwMisc.length && canPay
                ? 'Fees announced by the school for a trip, an activity or a form. Pay online in full, or at the school fee counter.'
                : 'Fees announced by the school for a trip, an activity or a form. They are paid at the school fee counter.',
            )}
          </p>
          <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">{t(lang, 'Fee')}</th>
                <th scope="col">{t(lang, 'Last date')}</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  {t(lang, 'Amount')}
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  {t(lang, 'Paid')}
                </th>
                <th scope="col">{t(lang, 'Status')}</th>
                {gwMisc.length && canPay ? (
                  <th scope="col">
                    <span className="ep-sr-only">{t(lang, 'Pay online')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {m.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.title}
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {t(lang, l.mandatory ? 'Mandatory' : 'Optional')}
                      {l.seats === null
                        ? ''
                        : ` · ${t(lang, 'Seats')} ${String(l.seatsTaken)}/${String(l.seats)}`}
                      {l.remark ? ` · ${l.remark}` : ''}
                    </span>
                  </td>
                  <td>{l.lastDate.split('-').reverse().join('-')}</td>
                  <td style={{ textAlign: 'right' }}>₹{l.amount}</td>
                  <td style={{ textAlign: 'right' }}>₹{l.paid}</td>
                  <td>
                    <Badge
                      tone={l.status === 'paid' ? 'success' : l.blocked ? 'neutral' : 'warning'}
                    >
                      {l.status === 'paid'
                        ? t(lang, 'Paid')
                        : l.blocked
                          ? t(lang, l.blocked)
                          : `${t(lang, 'To pay')} ₹${l.balance}`}
                    </Badge>
                  </td>
                  {gwMisc.length && canPay ? (
                    <td>
                      {l.status !== 'paid' && !l.blocked && Number(l.balance) > 0 ? (
                        <form
                          method="post"
                          action="/fees/pay-misc"
                          style={{ display: 'grid', gap: 'var(--sp-1)' }}
                        >
                          <input type="hidden" name="lineId" value={l.id} />
                          <input type="hidden" name="studentId" value={m.student.id} />
                          <GatewayPick options={gwMisc} lang={lang} name={`misc-${l.id}`} />
                          <Button type="submit" size="sm">
                            {t(lang, 'Pay online')} ₹{l.balance}
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {intents.length ? (
        <Card title={t(lang, 'Online payments')}>
          <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>{t(lang, 'Date')}</th>
                <th>{t(lang, 'Transaction')}</th>
                <th style={{ textAlign: 'right' }}>{t(lang, 'Amount')}</th>
                <th>{t(lang, 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {intents.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.createdAt).toLocaleString('en-IN')}</td>
                  <td>
                    <code>{i.txnId}</code>
                  </td>
                  <td style={{ textAlign: 'right' }}>₹{i.amount}</td>
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
    </main>
  );
}
