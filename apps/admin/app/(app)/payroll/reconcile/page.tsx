import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthName, monthParam, type StaffOption } from '@/lib/payroll-inputs';

interface Reconcile {
  ok: boolean;
  reason?: string;
  computed?: {
    paidDays: string;
    gross: string;
    deductions: string;
    net: string;
    pfWage: string;
    esiWage: string;
    pt: string;
    tax: string;
    lines: Array<{
      code: string;
      name: string;
      headType: string;
      amount: string;
      arrear: boolean;
      source: string;
    }>;
    warnings: string[];
    skipped: string[];
  };
  stored: {
    id: string;
    run_id: string;
    stage: string;
    gross: string;
    ded: string;
    net: string;
    paid: string;
    pf: string;
    esi: string;
    pt: string;
    it: string;
  } | null;
  lineDiff?: Array<{ line: string; now: string; paid: string | null; diff: string }>;
}

/**
 * Salary reconciliation (legacy Salary Reconciliation): one employee's month worked out again now, beside what was
 * paid — to find why a figure differs. It saves nothing.
 */
export default async function PayrollReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.approve')) notFound();
  const month = monthParam(sp.month);
  const employee = /^\d{1,18}$/.test(sp.employee ?? '') ? sp.employee! : null;
  let staff: StaffOption[];
  let d: Reconcile | null = null;
  try {
    staff = (await apiFetch<{ rows: StaffOption[] }>(`/payroll/inputs/staff?month=${month}`)).rows;
    if (employee)
      d = await apiFetch<Reconcile>(`/payroll/reconcile?employeeId=${employee}&month=${month}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const s = d?.stored;
  const c = d?.computed;
  const row = (label: string, now: string | undefined, paid: string | undefined) => {
    const diff =
      now !== undefined && paid !== undefined
        ? Math.round((Number(now) - Number(paid)) * 100) / 100
        : null;
    return (
      <tr key={label}>
        <th scope="row">{label}</th>
        <td>{now === undefined ? '' : money(now)}</td>
        <td>{paid === undefined ? '' : money(paid)}</td>
        <td>{diff ? <Badge tone="warning">{money(String(diff))}</Badge> : ''}</td>
      </tr>
    );
  };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Pay runs', href: '/payroll/runs' }, { label: 'Reconciliation' }]}
      />
      <PageHeader
        kicker="Payroll"
        title={`Salary reconciliation — ${monthName(month)}`}
        description="An employee’s month worked out again with today’s inputs, beside what the run paid, line by line. Nothing is saved."
      />
      <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="ep-field" htmlFor="rc-emp">
          <span className="ep-field__label">Employee</span>
          <select
            id="rc-emp"
            name="employee"
            className="ep-select"
            required
            defaultValue={employee ?? ''}
          >
            <option value="" disabled>
              Choose…
            </option>
            {staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="rc-month">
          <span className="ep-field__label">Month</span>
          <input
            id="rc-month"
            name="month"
            type="month"
            className="ep-input"
            required
            defaultValue={month}
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--primary">
          Work it out
        </button>
      </form>
      {d && !d.ok ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          <div>
            <strong>Could not be worked out now:</strong> {d.reason}
          </div>
        </div>
      ) : null}
      {c ? (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4">
            <KpiTile label="Net now" value={`₹${money(c.net)}`} />
            <KpiTile label="Net paid" value={s ? `₹${money(s.net)}` : 'Not paid'} />
            <KpiTile
              label="Difference"
              value={
                s
                  ? `₹${money(String(Math.round((Number(c.net) - Number(s.net)) * 100) / 100))}`
                  : '—'
              }
            />
            <KpiTile label="Lines that differ" value={String(d!.lineDiff?.length ?? 0)} />
          </div>
          <div className="ep-setup-sections">
            <section className="ep-card" aria-labelledby="rc-tot">
              <h2 id="rc-tot" className="ep-card__title">
                Totals
              </h2>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rc-tot">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="ep-sr-only">Figure</span>
                      </th>
                      <th scope="col">Now (₹)</th>
                      <th scope="col">Paid (₹)</th>
                      <th scope="col">Difference (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row('Gross', c.gross, s?.gross)}
                    {row('Deductions', c.deductions, s?.ded)}
                    {row('Net', c.net, s?.net)}
                    {row('PF wage', c.pfWage, s?.pf)}
                    {row('ESI wage', c.esiWage, s?.esi)}
                    {row('Profession tax', c.pt, s?.pt)}
                    {row('Income tax', c.tax, s?.it)}
                  </tbody>
                </table>
              </div>
              <p className="ep-field__help">
                {s
                  ? `Paid by a ${s.stage.toLowerCase()} run (paid days ${s.paid}); now ${c.paidDays} paid days.`
                  : 'No run has paid this month yet.'}
              </p>
            </section>
            <section className="ep-card" aria-labelledby="rc-lines">
              <h2 id="rc-lines" className="ep-card__title">
                Lines that differ
              </h2>
              {d!.lineDiff?.length ? (
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-labelledby="rc-lines"
                >
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Line</th>
                        <th scope="col">Now (₹)</th>
                        <th scope="col">Paid (₹)</th>
                        <th scope="col">Difference (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d!.lineDiff.map((x) => (
                        <tr key={x.line}>
                          <td>{x.line}</td>
                          <td>{money(x.now)}</td>
                          <td>{x.paid === null ? 'Not paid' : money(x.paid)}</td>
                          <td>{money(x.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Every line is the same as paid.</p>
              )}
            </section>
          </div>
          {c.warnings.length || c.skipped.length ? (
            <ul className="ep-field__help">
              {[...c.warnings, ...c.skipped].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  );
}
