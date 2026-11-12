import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon } from '@/components/nav-icons';
import { BalanceDetailDialog } from '@/components/leave/BalanceDetailDialog';
import { BalanceImport } from '@/components/leave/BalanceImport';
import { DialogButton } from '@/components/leave/DialogButton';
import { DownloadMenu, Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { LeaveBalances } from '@/lib/leave';
import { adjustBalance, runLeaveMonth } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const n2 = (v: number | null) => (v === null ? '0.00' : v.toFixed(2));
type Row = LeaveBalances['rows'][number];

/**
 * The balance ledger as the old Employee Leave Balance (docs/design/85, "the register and balances as the
 * old screens"): one row per employee × leave type × month, every month newest first (or the month
 * filtered) — opening, accrued, availed, correction, closing, lapsed, the total, Open or Closed — with the
 * row's Leave Details (the eye: the policy, the month's accrual worked out, the attendance behind it, the
 * movements), a correction of this (open) month, Add, Import, Download, and the month's run now.
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
  const href = (o: { page?: number; size?: string; filter?: boolean }) => {
    const p = new URLSearchParams(keep);
    const sz = o.size ?? size;
    if (sz !== '50') p.set('size', sz);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    if (o.filter) p.set('filter', '1');
    const s = p.toString();
    return `/leave/balances${s ? `?${s}` : ''}`;
  };
  const here = href({ page: d.page });
  const filtered = keep.toString() !== '';
  const showFilter = sp.filter === '1' || filtered;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/list-file?list=balances&format=${format}${keep.toString() ? `&${keep.toString()}` : ''}`;
  const thisMonth = `${MONTHS[Number(d.current.slice(5, 7)) - 1]!} ${d.current.slice(0, 4)}`;
  const sel = (
    name: string,
    label: string,
    opts: Array<{ id: string; name: string }>,
    all: string,
    idp = 'lb',
    value = keep.get(name) ?? '',
    required = false,
  ) => (
    <label className="ep-field" htmlFor={`${idp}-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`${idp}-${name}`}
        name={name}
        className="ep-select"
        defaultValue={value}
        required={required}
      >
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  /** a correction of this month: days added, or taken off with a minus, and the remark */
  const adjustForm = (idp: string, row?: Row) => (
    <form action={adjustBalance} className="ep-form-section__body">
      <input type="hidden" name="back" value={here} />
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Credits (or debits, with a minus) {thisMonth}’s balance as a correction; the ledger keeps
        who, when and why. Closed months cannot be changed.
      </p>
      {row ? (
        <>
          <input type="hidden" name="employeeId" value={row.employee.id} />
          <input type="hidden" name="leaveTypeId" value={row.leaveType.id} />
          <p style={{ margin: 0 }}>
            <strong>{row.employee.name}</strong> ({row.employee.code}) · {row.leaveType.code} —{' '}
            {row.leaveType.name} · now {n2(row.available)}
          </p>
        </>
      ) : (
        <div className="ep-form-row">
          {sel('employeeId', 'Employee', d.lists.employees, 'Select employee', idp, '', true)}
          {sel('leaveTypeId', 'Leave Type', d.lists.types, 'Select leave type', idp, '', true)}
        </div>
      )}
      <label className="ep-field" htmlFor={`${idp}-days`}>
        <span className="ep-field__label">Balance (days)</span>
        <input
          id={`${idp}-days`}
          name="days"
          type="number"
          step="0.5"
          min={-999}
          max={999}
          required
          className="ep-input"
          placeholder="e.g. 2 or -0.5"
        />
      </label>
      <label className="ep-field" htmlFor={`${idp}-why`}>
        <span className="ep-field__label">Remark</span>
        <textarea
          id={`${idp}-why`}
          name="reason"
          required
          minLength={3}
          maxLength={200}
          rows={2}
          className="ep-input"
        />
      </label>
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        Save
      </button>
    </form>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee leave & attendance', href: '/leave' },
          { label: 'Leave register', href: '/leave/register' },
          { label: 'Leave balance' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Employee Leave Balance"
        description={`Each employee’s balance of each leave type, month by month (${d.monthWords.toLowerCase()}). ${thisMonth} is open — it can be corrected; earlier months are closed. Nothing lapses month to month: at the session end the balance is kept up to the carry-forward cap.`}
        actions={
          <form action={runLeaveMonth}>
            <button
              type="submit"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              style={{ whiteSpace: 'nowrap' }}
              title="Close the months before this one, open this month and credit the policies due — as every night"
            >
              Run the month now
            </button>
          </form>
        }
      />
      <Notice params={sp} />
      <div className="ep-listbar">
        <SizeLinks size={d.size} sizeHref={(s) => href({ size: s })} noun="balances" />
        <div className="ep-listbar__end">
          <a
            className="ep-btn ep-btn--primary ep-btn--sm"
            href={showFilter && !filtered ? href({}) : href({ filter: true })}
          >
            {showFilter && !filtered ? 'Hide filter' : 'Filter'}
          </a>
          <DialogButton id="lb-add" label="＋ Add" title="Add leave balance">
            {adjustForm('lb-add')}
          </DialogButton>
          <DialogButton id="lb-import" label="Import" title="Opening balances from Excel">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              The sheet lists every employee and leave type with a balance; the figure you type
              becomes this month’s balance. Running the same sheet again changes nothing.
            </p>
            <BalanceImport />
          </DialogButton>
          <DownloadMenu xlsx={file('xlsx')} pdf={file('pdf')} />
        </div>
      </div>
      {showFilter ? (
        <form
          method="get"
          action="/leave/balances"
          className="ep-card ep-myleave__filter"
          aria-label="Filter"
        >
          <input type="hidden" name="filter" value="1" />
          {size !== '50' ? <input type="hidden" name="size" value={size} /> : null}
          {sel('employeeId', 'Employee', d.lists.employees, 'All employees')}
          {sel(
            'department',
            'Department',
            d.lists.departments.map((x) => ({ id: x, name: x })),
            'All departments',
          )}
          <label className="ep-field" htmlFor="lb-month">
            <span className="ep-field__label">Month</span>
            <input
              id="lb-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={keep.get('month') ?? ''}
            />
          </label>
          {sel('leaveTypeId', 'Leave Type', d.lists.types, 'All leave types')}
          <label className="ep-field" htmlFor="lb-q">
            <span className="ep-field__label">Search</span>
            <input
              id="lb-q"
              name="q"
              className="ep-input"
              defaultValue={keep.get('q') ?? ''}
              placeholder="Name or code"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Search
          </button>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/balances">
            Clear
          </a>
        </form>
      ) : null}
      <div className="ep-listbar" style={{ justifyContent: 'flex-end' }}>
        <Showing page={d.page} size={d.size} total={d.total} />
      </div>
      <Pages
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p })}
        noun="balances"
      />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Leave balances">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Sr.No</th>
              <th scope="col">Emp Id</th>
              <th scope="col">Emp Name</th>
              <th scope="col">Leave Type</th>
              <th scope="col">Month</th>
              <th scope="col">Year</th>
              {[
                'Open Bal',
                'Accrued',
                'Availed',
                'Correction',
                'Close Bal',
                'Lapsed',
                'Total Bal',
              ].map((h) => (
                <th key={h} scope="col" style={{ textAlign: 'right' }}>
                  {h}
                </th>
              ))}
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r, i) => (
                <tr key={`${r.id}-${r.month}`}>
                  <td>{(d.page - 1) * d.size + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <strong>{r.employee.code}</strong>
                  </td>
                  <td style={{ minWidth: '11rem' }}>
                    {r.employee.name}
                    <span className="ep-mr-col__desc">
                      {[r.employee.designation, r.employee.department].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td style={{ minWidth: '10rem' }}>
                    {r.leaveType.code} — {r.leaveType.name}
                  </td>
                  <td>{MONTHS[Number(r.month.slice(5, 7)) - 1]}</td>
                  <td>{r.month.slice(0, 4)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.opening)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.credited)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.held)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.correction)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.closing)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(r.lapsed)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong
                      style={{
                        color:
                          r.available < 0
                            ? 'var(--status-danger-text)'
                            : 'var(--status-success-text)',
                      }}
                    >
                      {n2(r.available)}
                    </strong>
                  </td>
                  <td>
                    <span className={`ep-stage ${r.closed ? 'ep-stage--off' : 'ep-stage--l2'}`}>
                      {r.closed ? 'Closed' : 'Open'}
                    </span>
                  </td>
                  <td>
                    <div className="ep-rowacts" style={{ flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="ep-iconbtn"
                        title="Leave details"
                        data-lbd={`${r.employee.id}|${r.leaveType.id}|${r.month.slice(0, 7)}`}
                      >
                        <Icon name="eye" size={20} />
                        <span className="ep-sr-only">
                          Leave details of {r.employee.name}, {r.leaveType.code},{' '}
                          {MONTHS[Number(r.month.slice(5, 7)) - 1]} {r.month.slice(0, 4)}
                        </span>
                      </button>
                      {r.current && !r.closed ? (
                        <DialogButton
                          id={`lb-e-${String(i)}`}
                          className="ep-iconbtn"
                          tip="Adjust"
                          title={`Adjust: ${r.employee.name} · ${r.leaveType.code}`}
                          label={
                            <>
                              <Icon name="pencil" size={20} />
                              <span className="ep-sr-only">
                                Adjust the balance of {r.employee.name}, {r.leaveType.code}
                              </span>
                            </>
                          }
                        >
                          {adjustForm(`lb-e-${String(i)}`, r)}
                        </DialogButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={15}>No balances in these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="ep-field__help">
        Total Bal = Open Bal + Accrued + Correction − Availed (Availed: the leave raised in the
        month, waiting or approved). A closed month keeps its Close Bal and what lapsed.
      </p>
      <Pages
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p })}
        noun="balances"
      />
      <BalanceDetailDialog />
    </>
  );
}
