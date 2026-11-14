import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { TaxSheet, type Sheet } from '@/components/payroll/tax/TaxSheet';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { clearFinal, regimeFor, setFinal } from '@/lib/payroll-tax-actions';

/**
 * An employee's year of tax (docs/design/86, phase D): worked out live as the next run would (nothing stored by
 * looking), the other regime beside it, the months' plan; the school's final figure (a checker); the regime (the
 * payroll admin); the declaration form.
 */
export default async function EmployeeTaxPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { employeeId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(employeeId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const fy = /^\d{4}-\d{2}$/.test(sp.fy ?? '') ? sp.fy! : '';
  let d: Sheet;
  let who: { code: string; name: string } | undefined;
  try {
    d = await apiFetch<Sheet>(`/payroll/tax/employees/${employeeId}${fy ? `?fy=${fy}` : ''}`);
    who = (
      await apiFetch<{ rows: Array<{ id: string; code: string; name: string }> }>(
        `/payroll/inputs/staff?month=${d.month}`,
      )
    ).rows.find((r) => r.id === employeeId);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const checker = me.permissions.includes('payroll.run.approve');
  const admin = me.permissions.includes('payroll.settings.manage');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Income tax', href: `/payroll/tax?fy=${d.fy}` },
          { label: who ? `${who.name} (${who.code})` : 'Employee' },
        ]}
      />
      <PageHeader
        kicker={`Income tax · ${d.fy}`}
        title={who ? who.name : 'The year’s tax'}
        description="The year as the next pay run would work it out. Nothing is stored by looking."
      />
      <Notice params={sp} />
      <TaxSheet d={d} />
      <section className="ep-card" aria-labelledby="et-do" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="et-do" className="ep-card__title">
          The school’s figure and the regime
        </h2>
        <div className="ep-grid__toolbar">
          {checker ? (
            <DialogButton
              id="et-final"
              label="Set the year’s tax"
              title="The school’s final figure for the year"
            >
              <form
                action={setFinal.bind(null, d.fy, employeeId)}
                className="ep-form-section__body"
              >
                <p className="ep-field__help">
                  It replaces the worked-out figure from the next run; a shortfall left at March is
                  the school’s to bear.
                </p>
                <label className="ep-field" htmlFor="et-annual">
                  <span className="ep-field__label">Tax for the year (₹)</span>
                  <input
                    id="et-annual"
                    name="annual"
                    className="ep-input"
                    required
                    inputMode="decimal"
                    pattern="[0-9,]+(\.[0-9]{1,2})?"
                  />
                </label>
                <label className="ep-field" htmlFor="et-spread">
                  <span className="ep-field__label">
                    Collected by month of the year (1 April … 12 March; blank: the months left)
                  </span>
                  <input
                    id="et-spread"
                    name="spreadMonths"
                    type="number"
                    min={1}
                    max={12}
                    className="ep-input"
                  />
                </label>
                <label className="ep-field" htmlFor="et-why">
                  <span className="ep-field__label">Why</span>
                  <input
                    id="et-why"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Set
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
          {checker && d.annual?.final ? (
            <form action={clearFinal.bind(null, d.fy, employeeId)}>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Back to the worked-out figure
              </button>
            </form>
          ) : null}
          {admin ? (
            <DialogButton
              id="et-regime"
              label="Set the regime"
              title="The employee’s regime"
              className="ep-btn ep-btn--secondary"
            >
              <form
                action={regimeFor.bind(null, d.fy, employeeId)}
                className="ep-form-section__body"
              >
                <label className="ep-field" htmlFor="et-reg">
                  <span className="ep-field__label">Regime</span>
                  <select
                    id="et-reg"
                    name="regime"
                    className="ep-select"
                    defaultValue={d.regime === 'OLD' ? 'NEW' : 'OLD'}
                  >
                    <option value="NEW">New regime</option>
                    <option value="OLD">Old regime</option>
                  </select>
                </label>
                <label className="ep-field" htmlFor="et-rr">
                  <span className="ep-field__label">Why (needed after the cut-off month)</span>
                  <input id="et-rr" name="reason" className="ep-input" maxLength={200} />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Set
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
          <span className="ep-field__help">The declaration form (PDF)</span>
          <FileLinks
            href={`/api/payroll/pay-file?kind=declform&fy=${d.fy}&id=${employeeId}`}
            label="the employee’s declaration form"
          />
        </div>
      </section>
    </>
  );
}
