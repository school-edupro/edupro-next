import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { FNF_STATUS, REASONS, dmy, monthLabel } from '@/components/payroll/people/PeopleTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { computeSettlement, settlementStep } from '@/lib/payroll-people-actions';

interface Settlement {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  designation: string | null;
  joinedOn: string | null;
  exitId: string | null;
  lastDay: string;
  reason: string;
  fixedTerm: boolean;
  noticeDaysShort: string;
  status: string;
  basis: string | null;
  gratuity: string;
  gratuityTaxFree: string;
  gratuityForfeited: string;
  forfeitReason: string | null;
  encashDays: string;
  encashAmount: string;
  encashTaxFree: string;
  encashAdjustReason: string | null;
  noticeAmount: string;
  loans: string;
  otherPayable: string;
  otherRecovery: string;
  net: string;
  payMonth: string | null;
  duesLetterNo: string | null;
  statementStatus: string | null;
  computedByName: string | null;
  approvedByName: string | null;
  cancelReason: string | null;
  detail: {
    basisMonth?: string;
    averageMonthly?: string;
    service?: { years: number; months: number; days: number };
    gratuity?: { eligible: boolean; years: number; why?: string; capped?: boolean };
    leave?: {
      byType: Array<{ code: string; name: string; balance: number; counted: number }>;
      fromBalance: number;
      days: number;
      adjusted: boolean;
    };
    notice?: { days: number };
    loans?: Array<{ id: string; type: string; balance: string }>;
    clearanceDues?: string;
    nominees?: Array<{ name: string; relation: string | null; share: string; amount: string }>;
    collected?: string;
  };
}
type Can = Record<'compute' | 'forfeit' | 'approve' | 'stage' | 'cancel' | 'collect', boolean>;

/**
 * A leaver's settlement (docs/design/86, phase E): the figures first, the working (gratuity, leave, notice, what is
 * owed) open, the rest folded; worked out by a maker, approved by another checker, paid through the month's run or
 * left as dues with a letter; its statement prints from here.
 */
export default async function SettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  let d: { settlement: Settlement; can: Can };
  try {
    d = await apiFetch<{ settlement: Settlement; can: Can }>(`/payroll/settlements/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const s = d.settlement;
  const w = s.detail;
  const net = Number(s.net);
  const worked = !['DRAFT', 'CANCELLED'].includes(s.status);
  const sv = w.service;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll' },
          { label: 'Pay changes and leavers', href: '/payroll/people?tab=settlements' },
          { label: s.name },
        ]}
      />
      <PageHeader
        kicker="Settlement"
        title={`${s.name} · ${s.code}`}
        description={`${REASONS[s.reason] ?? s.reason} · last working day ${dmy(s.lastDay)}${
          s.joinedOn ? ` · joined ${dmy(s.joinedOn)}` : ''
        }`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Status" value={FNF_STATUS[s.status]?.[0] ?? s.status} />
        <KpiTile label="Gratuity" value={`₹${money(s.gratuity)}`} />
        <KpiTile label="Leave encashment" value={`₹${money(s.encashAmount)}`} />
        <KpiTile
          label="Recoveries"
          value={`₹${money(String(Number(s.noticeAmount) + Number(s.loans) + Number(s.otherRecovery)))}`}
        />
        <KpiTile
          label={net < 0 ? 'Due from them' : 'Net payable'}
          value={`₹${money(String(Math.abs(net)))}`}
        />
        <KpiTile
          label="Service"
          value={sv ? `${String(sv.years)} y ${String(sv.months)} m` : '—'}
          hint={s.basis ? `on ₹${money(s.basis)} a month` : undefined}
        />
      </div>
      {s.status === 'CANCELLED' ? (
        <p className="ep-alert ep-alert--warning" role="status">
          Cancelled{s.cancelReason ? `: ${s.cancelReason}` : ''}.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="fs-next">
        <h2 id="fs-next" className="ep-card__title">
          What next
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {
            {
              DRAFT:
                'Work it out: the leave balance, the notice short and the loans are read now; type anything else owed either way.',
              COMPUTED: `Worked out by ${s.computedByName ?? '—'}. Another payroll checker approves it.`,
              APPROVED: `Approved by ${s.approvedByName ?? '—'}. Send it to be paid: the items go in the month’s run (or the employee is asked for the dues).`,
              STAGED: s.payMonth
                ? `In ${monthLabel(s.payMonth)}’s pay. If that month’s regular run is already locked, make the full-and-final run.`
                : 'Waiting for its run.',
              DUES: `Rs. ${money(String(Math.abs(net)))} is due from the employee (letter ${s.duesLetterNo ?? ''}). Record it when collected.`,
              SETTLED: w.collected
                ? `Settled: the dues collected (${w.collected}).`
                : 'Settled: paid by its run.',
              CANCELLED: 'Cancelled: the exit statement’s lines are its own again.',
            }[s.status]
          }
        </p>
        <div className="ep-grid__toolbar">
          {d.can.approve ? (
            <form action={settlementStep.bind(null, id, 'approve', undefined)}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Approve
              </button>
            </form>
          ) : null}
          {d.can.stage ? (
            <form action={settlementStep.bind(null, id, 'stage', undefined)}>
              <button type="submit" className="ep-btn ep-btn--primary">
                {net < 0 ? 'Note the dues and make the letter' : 'Send to be paid'}
              </button>
            </form>
          ) : null}
          {s.status === 'STAGED' && me.permissions.includes('payroll.run.manage') ? (
            <form action={settlementStep.bind(null, id, 'run', undefined)}>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Make the full-and-final run
              </button>
            </form>
          ) : null}
          {d.can.collect ? (
            <DialogButton id="fs-coll" label="Dues collected" title="The dues collected">
              <form
                action={settlementStep.bind(null, id, 'collected')}
                className="ep-form-section__body"
              >
                <label className="ep-field" htmlFor="fs-ref">
                  <span className="ep-field__label">Receipt or reference</span>
                  <input
                    id="fs-ref"
                    name="reference"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={120}
                  />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Record
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
          {d.can.cancel ? (
            <DialogButton
              id="fs-cancel"
              label="Cancel"
              title="Cancel the settlement"
              className="ep-btn ep-btn--ghost"
            >
              <form
                action={settlementStep.bind(null, id, 'cancel')}
                className="ep-form-section__body"
              >
                <label className="ep-field" htmlFor="fs-cr">
                  <span className="ep-field__label">Why</span>
                  <textarea
                    id="fs-cr"
                    name="reason"
                    className="ep-input"
                    rows={3}
                    required
                    minLength={10}
                    maxLength={300}
                  />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Cancel it
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
        </div>
        {worked ? (
          <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
            <span className="ep-field__help">Statement</span>
            <FileLinks
              href={`/api/payroll/pay-file?kind=fnf&id=${id}`}
              label={`the settlement of ${s.name}`}
            />
            {s.duesLetterNo ? (
              <>
                <span className="ep-field__help">Dues letter {s.duesLetterNo}</span>
                <FileLinks
                  href={`/api/payroll/pay-file?kind=dues&id=${id}`}
                  label={`dues letter ${s.duesLetterNo}`}
                />
              </>
            ) : null}
            {s.exitId ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/people/exits/${s.exitId}`}>
                The exit and its statement
              </a>
            ) : null}
          </div>
        ) : null}
      </section>
      {worked ? (
        <section className="ep-card" aria-labelledby="fs-work">
          <h2 id="fs-work" className="ep-card__title">
            The working
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="fs-work">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">How</th>
                  <th scope="col">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Gratuity</td>
                  <td>
                    {w.gratuity?.eligible === false
                      ? (w.gratuity.why ?? 'Not due')
                      : `${String(w.gratuity?.years ?? 0)} year(s) × 15/26 of ₹${money(s.basis)}${w.gratuity?.capped ? ', capped' : ''}`}
                    {Number(s.gratuityForfeited) > 0 ? (
                      <div className="ep-field__help">
                        ₹{money(s.gratuityForfeited)} forfeited: {s.forfeitReason}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {money(s.gratuity)}
                    <div className="ep-field__help">tax-free {money(s.gratuityTaxFree)}</div>
                  </td>
                </tr>
                <tr>
                  <td>Leave encashment</td>
                  <td>
                    {Number(s.encashDays).toString()} day(s) at ₹{money(s.basis)} ÷ 30
                    {s.encashAdjustReason ? (
                      <div className="ep-field__help">
                        Changed from the balance: {s.encashAdjustReason}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {money(s.encashAmount)}
                    <div className="ep-field__help">tax-free {money(s.encashTaxFree)}</div>
                  </td>
                </tr>
                <tr>
                  <td>Other payable</td>
                  <td />
                  <td>{money(s.otherPayable)}</td>
                </tr>
                <tr>
                  <td>Notice period shortfall</td>
                  <td>{w.notice?.days ? `${String(w.notice.days)} day(s) short` : 'Served'}</td>
                  <td>− {money(s.noticeAmount)}</td>
                </tr>
                <tr>
                  <td>Loans and advances</td>
                  <td>
                    {(w.loans ?? []).map((l) => `${l.type} ₹${money(l.balance)}`).join(', ') ||
                      'None'}
                  </td>
                  <td>− {money(s.loans)}</td>
                </tr>
                <tr>
                  <td>Other recovery</td>
                  <td>
                    {Number(w.clearanceDues ?? 0) > 0
                      ? `incl. ₹${money(w.clearanceDues)} no-dues clearance`
                      : ''}
                  </td>
                  <td>− {money(s.otherRecovery)}</td>
                </tr>
                <tr>
                  <th scope="row">{net < 0 ? 'Due from the employee' : 'Net payable'}</th>
                  <td />
                  <td>
                    <strong>{money(String(Math.abs(net)))}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {d.can.compute ? (
        <FoldCard
          id="fs-compute"
          title={worked ? 'Work it out again' : 'Work it out'}
          hint="The leave balance, the notice short and the loans are read now"
          open={!worked}
        >
          <form action={computeSettlement.bind(null, id)} className="ep-form-section__body">
            <div className="ep-form-row" data-columns="2">
              <label className="ep-field" htmlFor="fs-days">
                <span className="ep-field__label">Leave days to encash</span>
                <input
                  id="fs-days"
                  name="encashDays"
                  className="ep-input"
                  inputMode="decimal"
                  placeholder={w.leave ? String(w.leave.fromBalance) : 'from the balance'}
                />
                <span className="ep-field__help">
                  Empty: the balance on the last day, by the policy’s maximum.
                </span>
              </label>
              <label className="ep-field" htmlFor="fs-dr">
                <span className="ep-field__label">Why the days differ</span>
                <input id="fs-dr" name="encashReason" className="ep-input" maxLength={300} />
              </label>
              <label className="ep-field" htmlFor="fs-op">
                <span className="ep-field__label">Other payable (₹)</span>
                <input
                  id="fs-op"
                  name="otherPayable"
                  className="ep-input"
                  inputMode="decimal"
                  pattern="[0-9,]+(\.[0-9]{1,2})?"
                />
              </label>
              <label className="ep-field" htmlFor="fs-or">
                <span className="ep-field__label">Other recovery (₹)</span>
                <input
                  id="fs-or"
                  name="otherRecovery"
                  className="ep-input"
                  inputMode="decimal"
                  pattern="[0-9,]+(\.[0-9]{1,2})?"
                />
                <span className="ep-field__help">
                  The no-dues clearance’s dues are added by themselves.
                </span>
              </label>
              <label className="ep-field" htmlFor="fs-ft">
                <span className="ep-field__label">
                  <input id="fs-ft" name="fixedTerm" type="checkbox" defaultChecked={s.fixedTerm} />{' '}
                  A fixed-term employee (gratuity after one year)
                </span>
              </label>
              {d.can.forfeit && ['DISMISSAL', 'TERMINATION'].includes(s.reason) ? (
                <>
                  <label className="ep-field" htmlFor="fs-ff">
                    <span className="ep-field__label">Gratuity forfeited (₹)</span>
                    <input
                      id="fs-ff"
                      name="forfeit"
                      className="ep-input"
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                  <label className="ep-field" htmlFor="fs-fr">
                    <span className="ep-field__label">Why it is forfeited</span>
                    <input
                      id="fs-fr"
                      name="forfeitReason"
                      className="ep-input"
                      minLength={10}
                      maxLength={300}
                    />
                  </label>
                </>
              ) : null}
            </div>
            <div className="ep-grid__toolbar">
              <button type="submit" className="ep-btn ep-btn--primary">
                Work it out
              </button>
            </div>
          </form>
        </FoldCard>
      ) : null}
      {w.leave ? (
        <FoldCard
          id="fs-leave"
          title="Leave balance on the last day"
          hint="The types the policy encashes on exit"
        >
          <ul className="ep-list">
            {w.leave.byType.map((t) => (
              <li key={t.code}>
                {t.name}: {t.balance} day(s), {t.counted} counted
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
      {w.nominees?.length ? (
        <FoldCard id="fs-nom" title="Gratuity to the nominees" hint="By their recorded shares" open>
          <ul className="ep-list">
            {w.nominees.map((n) => (
              <li key={n.name}>
                {n.name}
                {n.relation ? ` (${n.relation})` : ''}: {Number(n.share).toString()} % · ₹
                {money(n.amount)}
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
      {s.statementStatus ? (
        <p className="ep-field__help">
          The exit statement is <Badge tone="neutral">{s.statementStatus}</Badge>: payroll’s lines
          there follow this working while it is a draft.
        </p>
      ) : null}
    </>
  );
}
