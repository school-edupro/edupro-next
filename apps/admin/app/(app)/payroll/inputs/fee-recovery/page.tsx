import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { TickAll } from '@/components/TickAll';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, money } from '@/lib/payroll';
import { monthName, monthParam, type StaffOption, type Wards } from '@/lib/payroll-inputs';
import { linkWard, stageFeeRecovery, unlinkWard } from '@/lib/payroll-inputs-actions';

/**
 * Fee recovery (legacy Fee ward recovery): a staff member's children — found by the guardian's mobile being the
 * staff member's, linked by a checker — and their fee dues, picked to be deducted from a month's salary. The fee
 * receipt is posted in Fees when that month's run is locked.
 */
export default async function PayrollFeeRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const month = monthParam(sp.month);
  const employee = /^\d{1,18}$/.test(sp.employee ?? '') ? sp.employee! : null;
  let staff: StaffOption[];
  let d: Wards | null = null;
  try {
    staff = (await apiFetch<{ rows: StaffOption[] }>(`/payroll/inputs/staff?month=${month}`)).rows;
    if (employee) d = await apiFetch<Wards>(`/payroll/inputs/wards?employeeId=${employee}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const name = (id: string) => d?.linked.find((w) => w.studentId === id)?.name ?? '';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Monthly inputs', href: `/payroll/inputs?month=${month}&tab=adhoc` },
          { label: 'Fee recovery' },
        ]}
      />
      <PageHeader
        kicker="Payroll · one-off deductions"
        title={`Fee recovery — ${monthName(month)}`}
        description="A staff member’s children’s school fees deducted from salary. The dues picked become deductions of this month; when the month’s run is locked, a fee receipt is posted in Fees as “Salary deduction”."
      />
      <Notice params={sp} />
      <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <input type="hidden" name="month" value={month} />
        <label className="ep-field" htmlFor="fr-emp">
          <span className="ep-field__label">Staff member</span>
          <select
            id="fr-emp"
            name="employee"
            className="ep-select"
            defaultValue={employee ?? ''}
            required
          >
            <option value="" disabled>
              Choose…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ep-btn ep-btn--ghost">
          Show
        </button>
      </form>
      {d ? (
        <>
          <section className="ep-card" aria-labelledby="fr-kids">
            <h2 id="fr-kids" className="ep-card__title">
              Children of {d.employee.name}
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Found by a guardian having the staff member’s mobile or sign-in. A payroll checker
              links them before their fees can be deducted.
            </p>
            <ul className="ep-setup-links">
              {d.linked.map((w) => (
                <li key={w.id}>
                  {w.name} ({w.admissionNo}){' '}
                  <Badge tone={w.active ? 'success' : 'neutral'}>
                    {w.active ? 'Linked' : 'Unlinked'}
                  </Badge>
                  {d!.can.approve && w.active ? (
                    <form
                      action={unlinkWard.bind(null, month, d!.employee.id, w.id)}
                      style={{ display: 'inline' }}
                    >
                      {' '}
                      <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                        Unlink
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
              {d.found.map((w) => (
                <li key={w.studentId}>
                  {w.name} ({w.admissionNo}) <Badge tone="info">Found by mobile</Badge>
                  {d!.can.approve ? (
                    <form
                      action={linkWard.bind(null, month, d!.employee.id, w.studentId)}
                      style={{ display: 'inline' }}
                    >
                      {' '}
                      <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                        Link
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
              {!d.linked.length && !d.found.length ? (
                <li>No child found for this staff member.</li>
              ) : null}
            </ul>
          </section>
          <section
            className="ep-card"
            aria-labelledby="fr-dues"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h2 id="fr-dues" className="ep-card__title">
              Fees due
            </h2>
            {d.dues.length ? (
              <form action={stageFeeRecovery.bind(null, month, d.employee.id)}>
                <input type="hidden" name="payHeadId" value={d.wardFeeHeadId ?? ''} />
                <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="fr-dues">
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">
                          <TickAll name="due" label="All" />
                        </th>
                        <th scope="col">Child</th>
                        <th scope="col">Due on</th>
                        <th scope="col">Fees</th>
                        <th scope="col">Outstanding (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.dues.map((x) => (
                        <tr key={`${x.studentId}-${x.dueOn}`}>
                          <td>
                            {x.staged ? (
                              <Badge tone="success">Deducted</Badge>
                            ) : (
                              <input
                                type="checkbox"
                                name="due"
                                value={`${x.studentId}|${x.dueOn}`}
                                aria-label={`Deduct the fees due ${dmy(x.dueOn)}`}
                              />
                            )}
                          </td>
                          <td>{name(x.studentId)}</td>
                          <td>{dmy(x.dueOn)}</td>
                          <td>{x.heads}</td>
                          <td>{money(x.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.can.manage ? (
                  d.wardFeeHeadId ? (
                    <p>
                      <button type="submit" className="ep-btn ep-btn--primary">
                        Deduct the ticked from {monthName(month)}’s salary
                      </button>
                    </p>
                  ) : (
                    <p className="ep-field__help">
                      There is no WARDFEE deduction head in use: add it in Pay heads first.
                    </p>
                  )
                ) : null}
              </form>
            ) : (
              <p>No fees are due for the linked children.</p>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
