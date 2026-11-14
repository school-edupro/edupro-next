import { Badge, KpiTile } from '@edupro/ui';
const money = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? ''
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

export interface Sheet {
  fy: string;
  month: string;
  done: boolean;
  error?: string;
  regime?: string;
  annual?: {
    computed: string | null;
    inUse: string | null;
    final: { annual: string; reason: string; spreadMonths: number | null } | null;
  } | null;
  sheet?: {
    gross: string | null;
    perquisites: string | null;
    prevSalary: string | null;
    exemptions: string | null;
    standardDeduction: string | null;
    pt: string | null;
    otherIncome: string | null;
    houseLoss: string | null;
    deductions: string | null;
    taxable: string | null;
    slabTax: string | null;
    rebate: string | null;
    surcharge: string | null;
    cess: string | null;
    total: string | null;
    panAbsent: boolean;
    ytdTds: string | null;
    monthsLeft: number;
    monthly: string | null;
    warnings: string[];
  } | null;
  working?: {
    hra: Record<string, string | null> | null;
    npsEr: Record<string, string | null> | null;
    deductions: Array<{
      code: string;
      declared: string | null;
      allowed: string | null;
      cut: string | null;
    }>;
  } | null;
  otherRegime?: { regime: string; total: string | null; monthly: string | null } | null;
  plan?: Array<{ month: string; state: string; amount: string | null }>;
}

const CUT: Record<string, string> = {
  cap: 'over its limit',
  group: 'over the shared limit',
  regime: 'not in this regime',
};
const regimeWord = (r?: string | null) => (r === 'OLD' ? 'old regime' : 'new regime');

/** The year's tax as the next run would work it out (nothing is stored by looking): figures, the sheet, the plan. */
export function TaxSheet({ d, labels }: { d: Sheet; labels?: Record<string, string> }) {
  if (d.error)
    return (
      <p className="ep-alert ep-alert--info" role="status">
        The year’s tax cannot be worked out yet: {d.error}
      </p>
    );
  const s = d.sheet;
  if (!s) return <p>No tax is worked out for this year.</p>;
  const line = (label: string, v: string | null | undefined, strong = false) =>
    v && Number(v) !== 0 ? (
      <tr>
        <th scope="row">{strong ? <strong>{label}</strong> : label}</th>
        <td>{strong ? <strong>{money(v)}</strong> : money(v)}</td>
      </tr>
    ) : null;
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label={`Tax for the year (${regimeWord(d.regime)})`}
          value={`₹${money(s.total)}`}
        />
        <KpiTile label="Deducted so far" value={`₹${money(s.ytdTds)}`} />
        <KpiTile
          label={d.done ? 'The year is paid' : `From ${monthName(d.month)}, a month`}
          value={d.done ? '—' : `₹${money(s.monthly)}`}
        />
        <KpiTile
          label={d.otherRegime ? `In the ${regimeWord(d.otherRegime.regime)}` : 'The other regime'}
          value={d.otherRegime ? `₹${money(d.otherRegime.total)}` : '—'}
        />
      </div>
      {d.annual?.final ? (
        <p className="ep-alert ep-alert--info" role="status">
          The school’s final figure is used: ₹{money(d.annual.final.annual)} (
          {d.annual.final.reason}
          {d.annual.final.spreadMonths
            ? `; collected by month ${String(d.annual.final.spreadMonths)} of the year`
            : ''}
          ).
          {d.annual.computed ? ` Worked out: ₹${money(d.annual.computed)}.` : ''}
        </p>
      ) : null}
      {s.panAbsent ? (
        <p className="ep-alert ep-alert--warning" role="status">
          No PAN on record: tax is at least 20 % of the taxable income.
        </p>
      ) : null}
      {s.warnings.length ? (
        <ul className="ep-field__help">
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <section className="ep-card" aria-labelledby="tx-sheet">
        <h2 id="tx-sheet" className="ep-card__title">
          The year’s working ({regimeWord(d.regime)})
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tx-sheet">
          <table className="ep-table ep-table--dense">
            <tbody>
              {line('Salary for the year (paid, this month, the months left)', s.gross, true)}
              {line('   of which perquisites and the employer’s NPS', s.perquisites)}
              {line('   of which the earlier employer’s salary', s.prevSalary)}
              {line('Less: HRA exempt', s.exemptions)}
              {line('Less: standard deduction', s.standardDeduction)}
              {line('Less: profession tax', s.pt)}
              {line('Add: other income', s.otherIncome)}
              {line('Less: a house’s loss (housing-loan interest)', s.houseLoss)}
              {line('Less: deductions', s.deductions)}
              {line('Taxable income', s.taxable, true)}
              {line('Tax on it', s.slabTax)}
              {line('Less: rebate', s.rebate)}
              {line('Surcharge', s.surcharge)}
              {line('Cess', s.cess)}
              {line('Tax for the year', s.total, true)}
            </tbody>
          </table>
        </div>
        {d.working?.hra ? (
          <p className="ep-field__help">
            HRA: received ₹{money(d.working.hra.received)}, rent ₹{money(d.working.hra.rent)}, basic
            and DA ₹{money(d.working.hra.salary)} — exempt ₹{money(d.working.hra.exempt)} (the least
            of the three legs).
          </p>
        ) : null}
        {d.working?.npsEr ? (
          <p className="ep-field__help">
            Employer’s NPS ₹{money(d.working.npsEr.annual)} is income; ₹
            {money(d.working.npsEr.allowed)} of it is deducted.
          </p>
        ) : null}
        {d.working?.deductions.length ? (
          <ul className="ep-field__help">
            {d.working.deductions.map((x) => (
              <li key={x.code}>
                {labels?.[x.code] ?? x.code}: claimed ₹{money(x.declared)}, counted ₹
                {money(x.allowed)}
                {x.cut ? ` (${CUT[x.cut] ?? x.cut})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {d.plan ? (
        <section className="ep-card" aria-labelledby="tx-plan" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="tx-plan" className="ep-card__title">
            Month by month
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tx-plan">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Tax (₹)</th>
                  <th scope="col">How</th>
                </tr>
              </thead>
              <tbody>
                {d.plan.map((p) => (
                  <tr key={p.month}>
                    <td>{monthName(p.month)}</td>
                    <td>{p.amount ? money(p.amount) : '—'}</td>
                    <td>
                      {p.state === 'deducted' ? (
                        <Badge tone="success">Deducted</Badge>
                      ) : p.state === 'typed' ? (
                        <Badge tone="info">Typed by payroll</Badge>
                      ) : p.state === 'planned' ? (
                        <Badge tone="neutral">Planned</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
