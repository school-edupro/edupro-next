import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthParam, type LoanDetail } from '@/lib/payroll-inputs';
import { loanStatus } from '@/lib/payroll-inputs-actions';

/** A loan or advance: its terms, what is still owed and the instalments to come; hold, resume, foreclose. */
export default async function PayrollLoanPage({
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
  const month = monthParam(sp.month);
  let d: LoanDetail;
  try {
    d = await apiFetch<LoanDetail>(`/payroll/inputs/loans/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const l = d.loan;
  const statusForm = (
    to: 'ACTIVE' | 'HOLD' | 'CLOSED',
    label: string,
    text: string,
    tone = 'ep-btn ep-btn--secondary',
  ) => (
    <DialogButton id={`ls-${to}`} label={label} title={label} className={tone}>
      <form action={loanStatus.bind(null, id)} className="ep-form-section__body">
        <input type="hidden" name="status" value={to} />
        <p className="ep-field__help">{text}</p>
        <label className="ep-field" htmlFor={`ls-why-${to}`}>
          <span className="ep-field__label">Reason</span>
          <input
            id={`ls-why-${to}`}
            name="reason"
            className="ep-input"
            required
            minLength={3}
            maxLength={200}
          />
        </label>
        <p>
          <button type="submit" className="ep-btn ep-btn--primary">
            {label}
          </button>
        </p>
      </form>
    </DialogButton>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Monthly inputs', href: `/payroll/inputs?month=${month}&tab=loans` },
          { label: `${l.loanType} · ${l.code}` },
        ]}
      />
      <PageHeader
        kicker={`${l.loanType} · from ${l.startMonth}`}
        title={`${l.name} (${l.code})`}
        description={
          l.interestMethod === 'NONE'
            ? 'No interest.'
            : `Interest ${l.interestRate} % a year, ${l.interestMethod === 'FLAT' ? 'flat on the amount' : 'on what is owed'}.`
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Amount" value={`₹${money(l.principal)}`} />
        <KpiTile label="Instalment" value={`₹${money(l.emi)}`} />
        <KpiTile label="Still owed" value={`₹${money(l.balance)}`} />
        <KpiTile label="Instalments left" value={String(d.remaining.length)} />
      </div>
      <section className="ep-card" aria-labelledby="lp-t">
        <div className="ep-grid__toolbar">
          <h2 id="lp-t" className="ep-card__title">
            The instalments to come{' '}
            <Badge
              tone={l.status === 'ACTIVE' ? 'success' : l.status === 'HOLD' ? 'warning' : 'neutral'}
            >
              {l.status === 'ACTIVE' ? 'Active' : l.status === 'HOLD' ? 'On hold' : 'Closed'}
            </Badge>
          </h2>
          <span className="ep-grid__spacer" />
          {d.can.manage && l.status === 'ACTIVE'
            ? statusForm(
                'HOLD',
                'Put on hold',
                'No instalment is deducted until it is active again.',
              )
            : null}
          {d.can.manage && l.status === 'HOLD'
            ? statusForm('ACTIVE', 'Resume', 'The next run deducts its instalment again.')
            : null}
          {d.can.approve && l.status !== 'CLOSED'
            ? statusForm(
                'CLOSED',
                'Foreclose',
                `It stops here: the ₹${money(l.balance)} still owed is no longer deducted. Settle it with a one-off deduction if it is to be recovered.`,
                'ep-btn ep-btn--danger',
              )
            : null}
        </div>
        {d.remaining.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="lp-t">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Owed (₹)</th>
                  <th scope="col">Interest (₹)</th>
                  <th scope="col">Instalment (₹)</th>
                  <th scope="col">Left after (₹)</th>
                </tr>
              </thead>
              <tbody>
                {d.remaining.map((m, i) => (
                  <tr key={String(i)}>
                    <td>{i + 1}</td>
                    <td>{money(m.opening)}</td>
                    <td>{money(m.interest)}</td>
                    <td>{money(m.emi)}</td>
                    <td>{money(m.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Nothing more is deducted.</p>
        )}
        {l.remarks ? (
          <p className="ep-field__help" style={{ whiteSpace: 'pre-line' }}>
            {l.remarks}
          </p>
        ) : null}
      </section>
    </>
  );
}
