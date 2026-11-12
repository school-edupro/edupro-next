import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthName } from '@/lib/payroll-inputs';
import type { RecordDetail } from '@/lib/payroll-runs';
import { recordAction } from '@/lib/payroll-runs-actions';

const SOURCE: Record<string, string> = {
  structure: 'Salary structure',
  arrear: 'Arrear',
  adhoc: 'One-off',
  recurring: 'Recurring',
  loan: 'Loan',
  engine: 'Worked out',
  rounding: 'Rounding',
};
const v = (x: unknown) => (x === null || x === undefined ? '' : String(x));

/** One employee's pay in a run (legacy record and Trace): every line and where it came from. */
export default async function PayrollRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; recordId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, recordId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(recordId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  let d: RecordDetail;
  try {
    d = await apiFetch<RecordDetail>(`/payroll/runs/${id}/records/${recordId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const r = d.record;
  const earnings = d.lines.filter((l) => l.headType === 'EARNING');
  const deductions = d.lines.filter((l) => l.headType === 'DEDUCTION');
  const t = r.trace;
  const st = d.statutory;
  const tx = d.tax;
  const approvedOn = ['APPROVED', 'LOCKED', 'PAID'].includes(r.runStage);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Pay runs', href: '/payroll/runs' },
          { label: monthName(r.month), href: `/payroll/runs/${id}` },
          { label: r.employeeCode },
        ]}
      />
      <PageHeader
        kicker={`${monthName(r.month)}${r.isTopUp ? ' · top-up (only what was pending)' : ''}`}
        title={`${r.employeeName} (${r.employeeCode})`}
        description={[
          r.designation,
          r.department,
          r.taxRegime ? `${r.taxRegime === 'NEW' ? 'new' : 'old'} tax regime` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Notice params={sp} />
      {r.status === 'FAILED' ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          <div>
            <strong>Could not be worked out.</strong> {r.failureReason}
          </div>
        </div>
      ) : null}
      {r.status === 'HELD' ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>Salary held:</strong> {r.heldReason ?? ''}
          </div>
        </div>
      ) : null}
      {r.status !== 'FAILED' ? (
        <div className="ep-dash-kpis">
          <KpiTile label="Paid days" value={r.isTopUp ? '—' : `${r.paidDays} of ${r.monthDays}`} />
          <KpiTile label="Gross" value={`₹${money(r.grossEarned)}`} />
          <KpiTile label="Deductions" value={`₹${money(r.totalDeductions)}`} />
          <KpiTile label="Net pay" value={`₹${money(r.netPay)}`} />
          <KpiTile label="Loss of pay" value={`₹${money(r.lopAmount)}`} />
          <KpiTile
            label="Income tax"
            value={`₹${money(String(Number(r.itAmount) + Number(r.cessAmount)))}`}
          />
        </div>
      ) : null}
      {r.warnings.length ? (
        <ul>
          {r.warnings.map((w) => (
            <li key={w}>
              <Badge tone="warning">To look at</Badge> {w}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        {d.can.approve ? (
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/payroll/reconcile?employee=${r.employeeId}&month=${r.month}`}
          >
            Reconcile
          </a>
        ) : null}
        {d.can.approve && approvedOn && r.status === 'COMPUTED' ? (
          <DialogButton
            id="rc-hold"
            label="Hold the salary"
            title="Hold the salary"
            className="ep-btn ep-btn--secondary"
          >
            <form
              action={recordAction.bind(null, id, recordId, 'hold')}
              className="ep-form-section__body"
            >
              <p className="ep-field__help">
                Not paid with the bank file until a checker releases it. Nothing is worked out
                again.
              </p>
              <label className="ep-field" htmlFor="rc-hw">
                <span className="ep-field__label">Why</span>
                <input
                  id="rc-hw"
                  name="reason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={200}
                />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Hold
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
        {d.can.approve && approvedOn && r.status === 'HELD' ? (
          <DialogButton
            id="rc-rel"
            label="Release the salary"
            title="Release the salary"
            className="ep-btn ep-btn--primary"
          >
            <form
              action={recordAction.bind(null, id, recordId, 'release')}
              className="ep-form-section__body"
            >
              <label className="ep-field" htmlFor="rc-rw">
                <span className="ep-field__label">Why</span>
                <input
                  id="rc-rw"
                  name="reason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={200}
                />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Release
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
        {d.can.approve &&
        r.status === 'FAILED' &&
        r.failureCode === 'NEGATIVE_NET' &&
        t.shortfall ? (
          <DialogButton
            id="rc-rec"
            label="Recover over the coming months"
            title="Recover the negative net"
            className="ep-btn ep-btn--primary"
          >
            <form
              action={recordAction.bind(null, id, recordId, 'recovery')}
              className="ep-form-section__body"
            >
              <p className="ep-field__help">
                ₹{money(t.shortfall)} more is deducted than earned this month. It becomes a recovery
                from next month, without interest, and this month’s net is nil. Then process the run
                again.
              </p>
              <label className="ep-field" htmlFor="rc-emi">
                <span className="ep-field__label">Recover a month (₹)</span>
                <input
                  id="rc-emi"
                  name="emi"
                  className="ep-input"
                  required
                  inputMode="decimal"
                  defaultValue={t.shortfall}
                />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Set up the recovery
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {r.status !== 'FAILED' ? (
        <div className="ep-setup-sections">
          <section className="ep-card" aria-labelledby="rc-earn">
            <h2 id="rc-earn" className="ep-card__title">
              Earnings
            </h2>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rc-earn">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Head</th>
                    <th scope="col">A month (₹)</th>
                    <th scope="col">This month (₹)</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((l, k) => (
                    <tr key={`${l.code}-${String(k)}`}>
                      <td>
                        {l.name}
                        {l.isTaxable ? null : (
                          <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                            Not taxable
                          </span>
                        )}
                      </td>
                      <td>{money(l.rate)}</td>
                      <td>{money(l.amount)}</td>
                      <td>{SOURCE[l.sourceKind] ?? l.sourceKind}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Gross</th>
                    <td>{money(r.grossFixed)}</td>
                    <td>
                      <strong>{money(r.grossEarned)}</strong>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section className="ep-card" aria-labelledby="rc-ded">
            <h2 id="rc-ded" className="ep-card__title">
              Deductions
            </h2>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rc-ded">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Head</th>
                    <th scope="col">Amount (₹)</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map((l, k) => (
                    <tr key={`${l.code}-${String(k)}`}>
                      <td>{l.name}</td>
                      <td>{money(l.amount)}</td>
                      <td>{SOURCE[l.sourceKind] ?? l.sourceKind}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Total</th>
                    <td>
                      <strong>{money(r.totalDeductions)}</strong>
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Net pay</th>
                    <td>
                      <strong>{money(r.netPay)}</strong>
                    </td>
                    <td className="ep-field__help">{r.netInWords ?? ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
      {st ? (
        <FoldCard
          id="rc-stat"
          title="PF, ESI, NPS and LWF"
          hint={`PF wage ₹${money(v(st.pfWage))}; employer PF ₹${money(String(Number(st.erEps ?? 0) + Number(st.erEpf ?? 0)))}${st.esiCovered ? `; ESI covered` : ''}`}
        >
          <div className="ep-profile__grid">
            {[
              ['PF wage', st.pfWage],
              ['Pension (EPS) wage', st.epsWage],
              ['Employee PF', st.eePf],
              ['Voluntary PF', st.vpf],
              ['Employer pension (EPS)', st.erEps],
              ['Employer PF', st.erEpf],
              ['EDLI', st.edli],
              ['PF admin', st.pfAdmin],
              ['NCP days', st.ncpDays],
              [
                'NPS employee · employer',
                st.npsWage ? `${money(v(st.npsEe))} · ${money(v(st.npsEr))}` : null,
              ],
              [
                'ESI',
                st.esiCovered === null
                  ? null
                  : st.esiCovered
                    ? `${money(v(st.esiEe))} (employer ${money(v(st.esiEr))})`
                    : 'Not covered this period',
              ],
              [
                'LWF employee · employer',
                st.lwfEe ? `${money(v(st.lwfEe))} · ${money(v(st.lwfEr))}` : null,
              ],
            ]
              .filter(([, x]) => x !== null && x !== undefined)
              .map(([k, x]) => (
                <div key={String(k)} className="ep-field">
                  <span className="ep-field__label">{k}</span>
                  <span>
                    {typeof x === 'string' && /^\d+(\.\d+)?$/.test(x) && k !== 'NCP days'
                      ? `₹${money(x)}`
                      : v(x)}
                  </span>
                </div>
              ))}
          </div>
          <p className="ep-field__help">
            The employer’s shares are paid by the school and never print on the payslip.
          </p>
        </FoldCard>
      ) : null}
      {tx ? (
        <FoldCard
          id="rc-tax"
          title="Income tax"
          hint={
            tx.mode === 'TYPED'
              ? 'Typed by hand for this month'
              : tx.mode === 'NONE'
                ? 'Not worked out'
                : `The year’s tax ₹${money(v(tx.annualTax))}; this month ₹${money(v(tx.monthlyTds))}`
          }
        >
          {tx.mode === 'PROJECTION' ? (
            <div className="ep-profile__grid">
              {[
                ['The year’s salary, projected', tx.grossProjection],
                ['Standard deduction', tx.standardDeduction],
                ['Profession tax', tx.ptDeduction],
                ['Taxable income', tx.taxableIncome],
                ['Tax by the slabs', tx.slabTax],
                ['Rebate', tx.rebate],
                ['Surcharge', tx.surcharge],
                ['Cess', tx.cess],
                ['The year’s tax', tx.annualTax],
                ['Deducted before', tx.ytdTds],
                ['This month', tx.monthlyTds],
              ].map(([k, x]) => (
                <div key={String(k)} className="ep-field">
                  <span className="ep-field__label">{k}</span>
                  <span>₹{money(v(x))}</span>
                </div>
              ))}
              <div className="ep-field">
                <span className="ep-field__label">Months left in the year</span>
                <span>{v(tx.monthsLeft)}</span>
              </div>
            </div>
          ) : (
            <p>₹{money(v(tx.monthlyTds))} this month.</p>
          )}
          {tx.panAbsent ? (
            <p className="ep-field__help">No PAN: at least 20 % of the taxable income.</p>
          ) : null}
        </FoldCard>
      ) : null}
      {d.loans.length ? (
        <FoldCard
          id="rc-loans"
          title="Loans"
          hint={d.loans.map((l) => `${l.loanType} ₹${money(l.emi)}`).join(', ')}
        >
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rc-loans">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Loan</th>
                  <th scope="col">Owed (₹)</th>
                  <th scope="col">Interest (₹)</th>
                  <th scope="col">Instalment (₹)</th>
                  <th scope="col">Left (₹)</th>
                </tr>
              </thead>
              <tbody>
                {d.loans.map((l) => (
                  <tr key={l.loanId}>
                    <td>
                      <a href={`/payroll/inputs/loans/${l.loanId}`}>{l.loanType}</a>
                    </td>
                    <td>{money(l.opening)}</td>
                    <td>{money(l.interest)}</td>
                    <td>{money(l.emi)}</td>
                    <td>{money(l.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FoldCard>
      ) : null}
      <FoldCard
        id="rc-trace"
        title="Where each amount came from"
        hint="The structure rows, pay-head versions, rates and settings used; what was left out and why"
      >
        <ul className="ep-field__help">
          {t.rates && Object.keys(t.rates).length ? (
            <li>
              Rates:{' '}
              {Object.entries(t.rates)
                .map(([k, x]) => `${k} ${x.value}`)
                .join(', ')}
            </li>
          ) : null}
          {t.structure ? <li>Structure rows: {Object.keys(t.structure).join(', ')}</li> : null}
          {t.versions ? (
            <li>Pay-head versions in force: {Object.keys(t.versions).join(', ')}</li>
          ) : null}
          {t.attributes && Object.keys(t.attributes).length ? (
            <li>
              Formula attributes:{' '}
              {Object.entries(t.attributes)
                .map(([k, x]) => `${k} = ${String(x)}`)
                .join(', ')}
            </li>
          ) : null}
          {t.eps ? <li>{t.eps}</li> : null}
          {t.esi ? (
            <li>
              ESI {t.esi.covered ? 'covered' : 'not covered'} for the period, decided{' '}
              {t.esi.decided}
            </li>
          ) : null}
          {t.ptSlab ? (
            <li>
              Profession tax slab: {t.ptSlab.gender} from ₹
              {money(String(Number(t.ptSlab.from) / 100))}
              {t.ptSlab.to ? ` to ₹${money(String(Number(t.ptSlab.to) / 100))}` : ' and above'}
            </li>
          ) : null}
          {t.topUp ? (
            <li>
              Top-up: PF wage already used this month ₹
              {money(String(Number(t.topUp.pfWageUsed) / 100))}
            </li>
          ) : null}
          {(t.skipped ?? []).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </FoldCard>
    </>
  );
}
