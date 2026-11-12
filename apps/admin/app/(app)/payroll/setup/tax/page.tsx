import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money, pct, type TaxYear } from '@/lib/payroll';
import { addTaxYear } from '@/lib/payroll-actions';

const REGIME = { NEW: 'New regime', OLD: 'Old regime' } as Record<string, string>;
const regime = (r: string) => REGIME[r] ?? r;

/** Income tax by financial year (legacy Tax Configuration): slabs, rebate, surcharge, cess and the printed labels. */
export default async function PayrollTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const fyQ = /^\d{4}-\d{2}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : '';
  let d: TaxYear;
  try {
    d = await apiFetch<TaxYear>(`/payroll/tax${fyQ}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const latest = d.years[0];
  const next = latest
    ? `${String(Number(latest.slice(0, 4)) + 1)}-${String((Number(latest.slice(0, 4)) + 2) % 100).padStart(2, '0')}`
    : '';
  const regimes = [...new Set(d.slabs.map((x) => x.regime))];
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Payroll set-up', href: '/payroll/setup' }, { label: 'Income tax' }]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title={`Income tax ${d.fy}`}
        description="The slabs, standard deduction, rebate, surcharge and cess the monthly tax projection reads, and the lines printed on the tax sheet, by financial year. A new year starts as a copy of the last; correct what the budget changed."
      />
      <Notice params={sp} />
      <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-grid__toolbar">
          <label className="ep-field" htmlFor="tx-fy">
            <span className="ep-field__label">Financial year</span>
            <select id="tx-fy" name="fy" className="ep-select" defaultValue={d.fy}>
              {(d.years.length ? d.years : [d.fy]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--ghost">
            Show
          </button>
        </form>
        <span className="ep-grid__spacer" />
        {d.can.admin && latest ? (
          <DialogButton id="tx-add" label="＋ Add a year" title="Add a financial year">
            <form action={addTaxYear} className="ep-form-section__body">
              <p className="ep-field__help">
                Copies every slab, limit, surcharge and label of the earlier year. Nothing changes
                for months already run.
              </p>
              <label className="ep-field" htmlFor="tx-new">
                <span className="ep-field__label">The new year</span>
                <input
                  id="tx-new"
                  name="fy"
                  className="ep-input"
                  required
                  pattern="\d{4}-\d{2}"
                  defaultValue={next}
                  placeholder="2027-28"
                />
              </label>
              <label className="ep-field" htmlFor="tx-from">
                <span className="ep-field__label">Copied from</span>
                <select id="tx-from" name="copyFrom" className="ep-select" defaultValue={latest}>
                  {d.years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Add the year
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {!d.slabs.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>No slabs for {d.fy}.</strong> A pay run in this year is blocked until a payroll
            admin adds it.
          </div>
        </div>
      ) : null}
      <div className="ep-setup-sections">
        {regimes.map((r) => {
          const cfg = d.config.find((c) => c.regime === r);
          return (
            <section key={r} className="ep-card" aria-labelledby={`tx-${r}`}>
              <h2 id={`tx-${r}`} className="ep-card__title">
                {regime(r)}
              </h2>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby={`tx-${r}`}>
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">The {regime(r).toLowerCase()} slabs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Taxable income from (₹)</th>
                      <th scope="col">up to (₹)</th>
                      <th scope="col">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.slabs
                      .filter((x) => x.regime === r)
                      .map((x) => (
                        <tr key={x.slabFrom}>
                          <td>{money(x.slabFrom)}</td>
                          <td>{x.slabTo ? money(x.slabTo) : 'and above'}</td>
                          <td>{pct(x.rate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {cfg ? (
                <ul className="ep-setup-links" style={{ marginTop: 'var(--sp-3)' }}>
                  <li>Standard deduction ₹{money(cfg.standardDeduction)}</li>
                  <li>
                    Rebate up to ₹{money(cfg.rebateMax)} when taxable income is at most ₹
                    {money(cfg.rebateIncomeLimit)}
                    {cfg.marginalRelief ? ', with marginal relief just above it' : ''}
                  </li>
                  <li>
                    Cess {pct(cfg.cessRate)}; without a PAN at least {pct(cfg.panAbsentRate)}
                  </li>
                  <li>
                    Surcharge:{' '}
                    {d.surcharges
                      .filter((x) => x.regime === r)
                      .map((x) => `${pct(x.rate)} above ₹${money(x.incomeFrom)}`)
                      .join('; ') || 'none'}
                  </li>
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
      {d.labels.length ? (
        <section
          className="ep-card"
          aria-labelledby="tx-labels"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="tx-labels" className="ep-card__title">
            Lines on the tax sheet
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The deductions and exemptions staff declare and the printed lines of the tax
            computation, with the cap the projection uses.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tx-labels">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Label</th>
                  <th scope="col">Regime</th>
                  <th scope="col">Cap (₹)</th>
                  <th scope="col">Staff declare it</th>
                </tr>
              </thead>
              <tbody>
                {d.labels.map((l) => (
                  <tr key={l.lineCode}>
                    <td>
                      <code>{l.lineCode}</code>
                    </td>
                    <td>{l.label}</td>
                    <td>{l.appliesTo === 'BOTH' ? 'Both' : regime(l.appliesTo)}</td>
                    <td>{l.capAmount ? money(l.capAmount) : ''}</td>
                    <td>{l.declarable ? <Badge tone="info">Declared</Badge> : ''}</td>
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
