import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ChipPickerField } from '@/components/ChipPickerField';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthName, type StaffOption } from '@/lib/payroll-inputs';
import { STAGE_TONE, STAGE_WORD, TYPE_WORD, type RunList } from '@/lib/payroll-runs';
import { createRun } from '@/lib/payroll-runs-actions';

/** Pay runs (legacy Pay Run): a financial year's runs, newest first, and a new run. */
export default async function PayrollRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const fyQ = /^\d{4}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : '';
  let d: RunList;
  let staff: StaffOption[] = [];
  try {
    d = await apiFetch<RunList>(`/payroll/runs${fyQ}`);
    if (d.can.manage)
      staff = (
        await apiFetch<{ rows: StaffOption[] }>(`/payroll/inputs/staff?month=${d.thisMonth}`)
      ).rows;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const fyLabel = `${String(d.fy)}-${String((d.fy + 1) % 100).padStart(2, '0')}`;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Pay runs' }]} />
      <PageHeader
        kicker="Payroll"
        title={`Pay runs ${fyLabel}`}
        description="A month’s pay: a maker creates the run, checks and processes it; a checker who did not create it approves and locks it, which releases the payslips. One regular run a month; a supplementary or bonus run comes after it is locked."
      />
      <Notice params={sp} />
      <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <nav aria-label="Financial year" className="ep-field__help">
          <a href={`/payroll/runs?fy=${String(d.fy - 1)}`}>
            ← {String(d.fy - 1)}-{String(d.fy % 100).padStart(2, '0')}
          </a>
          {' · '}
          <a href={`/payroll/runs?fy=${String(d.fy + 1)}`}>
            {String(d.fy + 1)}-{String((d.fy + 2) % 100).padStart(2, '0')} →
          </a>
        </nav>
        <span className="ep-grid__spacer" />
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/payroll/inputs?month=${d.thisMonth}`}
        >
          Monthly inputs
        </a>
        {d.can.approve ? (
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/payroll/reconcile?month=${d.thisMonth}`}
          >
            Reconciliation
          </a>
        ) : null}
        {d.can.manage ? (
          <DialogButton id="pr-new" label="＋ New run" title="A new pay run">
            <form action={createRun} className="ep-form-section__body">
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="pr-month">
                  <span className="ep-field__label">Month</span>
                  <input
                    id="pr-month"
                    name="month"
                    type="month"
                    className="ep-input"
                    required
                    defaultValue={d.thisMonth}
                  />
                </label>
                <label className="ep-field" htmlFor="pr-type">
                  <span className="ep-field__label">Kind</span>
                  <select id="pr-type" name="runType" className="ep-select" defaultValue="REGULAR">
                    <option value="REGULAR">Regular: the month’s salary for everyone</option>
                    <option value="SUPPLEMENTARY">
                      Supplementary: named staff, after the regular run
                    </option>
                    <option value="BONUS">Bonus: pending bonus lines, after the regular run</option>
                  </select>
                </label>
              </div>
              <ChipPickerField
                name="employeeIds"
                label="Staff (a supplementary run)"
                options={staff.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
                help="Type a name or code. A regular or bonus run takes everyone."
              />
              <label className="ep-field" htmlFor="pr-remark">
                <span className="ep-field__label">Remark</span>
                <input id="pr-remark" name="remark" className="ep-input" maxLength={200} />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Create the run
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      <section className="ep-card" aria-labelledby="pr-list">
        <h2 id="pr-list" className="ep-card__title">
          Runs
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pr-list">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Kind</th>
                <th scope="col">Stage</th>
                <th scope="col">Staff</th>
                <th scope="col">Gross (₹)</th>
                <th scope="col">Deductions (₹)</th>
                <th scope="col">Net (₹)</th>
                <th scope="col">Created · approved by</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/payroll/runs/${r.id}`}>{monthName(r.month)}</a>
                    </td>
                    <td>
                      {TYPE_WORD[r.runType]}
                      {r.seq > 1 ? ` #${String(r.seq)}` : ''}
                    </td>
                    <td>
                      <Badge tone={STAGE_TONE[r.stage]}>{STAGE_WORD[r.stage]}</Badge>
                      {r.failedCount ? (
                        <>
                          {' '}
                          <Badge tone="danger">{`${String(r.failedCount)} failed`}</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{r.empCount}</td>
                    <td>{money(r.grossTotal)}</td>
                    <td>{money(r.deductionTotal)}</td>
                    <td>{money(r.netTotal)}</td>
                    <td>
                      {r.createdByName ?? ''}
                      {r.approvedByName ? ` · ${r.approvedByName}` : ''}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No runs in {fyLabel} yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
