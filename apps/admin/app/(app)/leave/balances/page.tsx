import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { BalanceImport } from '@/components/leave/BalanceImport';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { LeaveBalances } from '@/lib/leave';
import { adjustBalance, runLeaveMonth } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;

/**
 * Leave balances (docs/design/85, phase B; the earlier Balance Master): the month's ledger of every
 * employee and leave type (opening, credited, held, corrections, what is left; closing and lapsed once
 * closed) with its trail, a correction with a reason, the opening balances from Excel, and the month's
 * close and credit run now.
 */
export default async function LeaveBalancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.office.manage')) notFound();
  const size = pageSizeOf(sp.size);
  const keep = new URLSearchParams();
  for (const k of ['employeeId', 'leaveTypeId'] as const)
    if (sp[k] && ID.test(sp[k]!)) keep.set(k, sp[k]!);
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) keep.set('month', sp.month);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(keep);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: LeaveBalances;
  try {
    d = await apiFetch<LeaveBalances>(`/leave/balances?${qs.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const link = (page: number) => {
    const p = new URLSearchParams(keep);
    p.set('size', size);
    if (page > 1) p.set('page', String(page));
    return `/leave/balances?${p.toString()}`;
  };
  const here = link(d.page);
  const sel = (
    name: string,
    label: string,
    opts: Array<{ id: string; name: string }>,
    all: string,
  ) => (
    <label className="ep-field" htmlFor={`lb-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select id={`lb-${name}`} name={name} className="ep-select" defaultValue={sp[name] ?? ''}>
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Leave register', href: '/leave/register' }, { label: 'Balances' }]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={`Leave balances · ${d.monthWords}`}
        description="What each employee has of each leave type this month: the opening (carried from last month), what was credited, held by leave raised this month, corrections, and what is left. Nothing lapses month to month: at the session end the balance is kept up to the carry-forward cap."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/leave/list-file?list=balances&format=xlsx&${keep.toString()}`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/leave/list-file?list=balances&format=pdf&${keep.toString()}`}
            >
              PDF
            </a>
          </div>
        }
      />
      <Notice params={sp} />
      <form
        method="get"
        action="/leave/balances"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <label className="ep-field" htmlFor="lb-month">
          <span className="ep-field__label">Month</span>
          <input
            id="lb-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={d.month.slice(0, 7)}
          />
        </label>
        {sel('employeeId', 'Employee', d.lists.employees, 'All staff')}
        {sel('leaveTypeId', 'Leave type', d.lists.types, 'All types')}
        {sel(
          'department',
          'Department',
          d.lists.departments.map((x) => ({ id: x, name: x })),
          'All departments',
        )}
        <label className="ep-field" htmlFor="lb-q">
          <span className="ep-field__label">Search</span>
          <input
            id="lb-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Name or code"
          />
        </label>
        <PerPage id="lb-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Balances">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Type</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Opening
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Credited
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Held
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Correction
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Left
              </th>
              <th scope="col">Month</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.employee.name}
                    <span className="ep-mr-col__desc">
                      {r.employee.code}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                    </span>
                  </td>
                  <td>
                    {r.leaveType.code}
                    <span className="ep-mr-col__desc">{r.policy ?? 'no policy'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.opening}</td>
                  <td style={{ textAlign: 'right' }}>{r.credited}</td>
                  <td style={{ textAlign: 'right' }}>{r.held}</td>
                  <td style={{ textAlign: 'right' }}>{r.correction}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{r.available}</strong>
                  </td>
                  <td>
                    {r.closed
                      ? `Closed at ${String(r.closing)}${r.lapsed ? `, ${String(r.lapsed)} lapsed` : ''}`
                      : 'Open'}
                    {r.trail.length ? (
                      <details>
                        <summary>Trail</summary>
                        <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
                          {r.trail.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No balances in these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={d.page} size={d.size} total={d.total} href={link} noun="balances" />
      <section className="ep-card" aria-labelledby="lb-adjust" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="lb-adjust" className="ep-card__title">
          Correct a balance (this month)
        </h2>
        <form action={adjustBalance} className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="hidden" name="back" value={here} />
          <label className="ep-field" htmlFor="lb-a-emp">
            <span className="ep-field__label">Employee</span>
            <select
              id="lb-a-emp"
              name="employeeId"
              className="ep-select"
              required
              defaultValue={sp.employeeId ?? ''}
            >
              <option value="">Pick the employee</option>
              {d.lists.employees.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="lb-a-type">
            <span className="ep-field__label">Leave type</span>
            <select
              id="lb-a-type"
              name="leaveTypeId"
              className="ep-select"
              required
              defaultValue={sp.leaveTypeId ?? ''}
            >
              <option value="">Pick the type</option>
              {d.lists.types.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="lb-a-days">
            <span className="ep-field__label">Days (minus to take off)</span>
            <input
              id="lb-a-days"
              name="days"
              type="number"
              step="0.5"
              min={-999}
              max={999}
              required
              className="ep-input"
            />
          </label>
          <label className="ep-field" htmlFor="lb-a-why">
            <span className="ep-field__label">Reason</span>
            <input
              id="lb-a-why"
              name="reason"
              required
              minLength={3}
              maxLength={200}
              className="ep-input"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Correct
          </button>
        </form>
      </section>
      <section className="ep-card" aria-labelledby="lb-import" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="lb-import" className="ep-card__title">
          Opening balances from Excel
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The sheet lists every employee and leave type with a balance; the figure you type becomes
          this month’s balance. Running the same sheet again changes nothing.
        </p>
        <BalanceImport />
      </section>
      <section className="ep-card" aria-labelledby="lb-run" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="lb-run" className="ep-card__title">
          Close and credit now
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Every night the system closes the months before this one, opens this month and credits the
          policies whose credit month it is. Run it now after changing a policy or the opening
          balances.
        </p>
        <form action={runLeaveMonth}>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Run now
          </button>
        </form>
      </section>
    </>
  );
}
