import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { LEAVE_STATUS, dmy, leaveDates, type LeaveFormType, type LeaveRegister } from '@/lib/leave';
import { applyLeave } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BUCKETS = [
  ['pending', 'Waiting (first level)'],
  ['l1', 'At level 2'],
  ['l2', 'At level 3'],
  ['approved', 'Approved'],
  ['rejected', 'Not approved'],
  ['cancelled', 'Cancelled'],
  ['withdrawn', 'Withdrawn'],
  ['lop', 'Loss of pay'],
] as const;

/**
 * The leave register (docs/design/85, phase B; the earlier "Approve / Reject Leave"): figures for the
 * financial year (each opens its leave), the filters, every leave a page at a time with who it waits
 * with or who decided it, Excel and PDF; the office's entry of leave for an employee; the balances.
 */
export default async function LeaveRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.office.manage')) notFound();
  const size = pageSizeOf(sp.size);
  const keep = new URLSearchParams();
  for (const k of ['leaveTypeId', 'employeeId'] as const)
    if (sp[k] && ID.test(sp[k]!)) keep.set(k, sp[k]!);
  for (const k of ['from', 'to'] as const) if (sp[k] && DAY.test(sp[k]!)) keep.set(k, sp[k]!);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.source && /^(self|on_behalf|system)$/.test(sp.source)) keep.set('source', sp.source);
  if (sp.bucket && BUCKETS.some(([k]) => k === sp.bucket)) keep.set('bucket', sp.bucket);
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(keep);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: LeaveRegister;
  let formTypes: LeaveFormType[] = [];
  try {
    d = await apiFetch<LeaveRegister>(`/leave/register?${qs.toString()}`);
    formTypes = await apiFetch<{
      data: Array<{
        id: string;
        code: string;
        name: string;
        keeps_balance: string;
        half_day: string;
        loss_of_pay: string;
        document_needed: string;
        max_days: string | null;
        auto_approve: string;
        status: string;
      }>;
    }>('/masters/staff_leave_types/rows?size=200')
      .then((r) =>
        r.data
          .filter((t) => t.status === 'active')
          .map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            keepsBalance: t.keeps_balance === 'true' && t.loss_of_pay !== 'true',
            halfDay: t.half_day === 'true' || t.loss_of_pay === 'true',
            documentNeeded: t.document_needed === 'true',
            maxDays: t.max_days === null ? null : Number(t.max_days),
            approvedAtOnce: true,
          })),
      )
      .catch(() => []);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const link = (page: number) => {
    const p = new URLSearchParams(keep);
    p.set('size', size);
    if (page > 1) p.set('page', String(page));
    return `/leave/register?${p.toString()}`;
  };
  const bucketLink = (b: string) => {
    const p = new URLSearchParams(keep);
    if (keep.get('bucket') === b) p.delete('bucket');
    else p.set('bucket', b);
    return `/leave/register?${p.toString()}`;
  };
  const file = (format: 'xlsx' | 'pdf') => {
    const p = new URLSearchParams(keep);
    p.set('format', format);
    return `/api/leave/register-file?${p.toString()}`;
  };
  const sel = (
    name: string,
    label: string,
    opts: Array<{ id: string; name: string }>,
    all: string,
  ) => (
    <label className="ep-field" htmlFor={`lg-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select id={`lg-${name}`} name={name} className="ep-select" defaultValue={sp[name] ?? ''}>
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  const f = d.figures;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave register' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave register"
        description={`Every leave of the staff: who it waits with, who decided it. The figures count the financial year ${f.fy} (${String(f.total)} leave applications); click one to see its leave.`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/balances">
              Balances
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="#lg-enter">
              Enter leave for an employee
            </a>
          </div>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        {BUCKETS.map(([k, label]) => (
          <KpiTile
            key={k}
            label={label}
            value={String(f[k])}
            hint={<a href={bucketLink(k)}>{keep.get('bucket') === k ? 'show all' : 'show them'}</a>}
          />
        ))}
      </div>
      <form
        method="get"
        action="/leave/register"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        {keep.get('bucket') ? (
          <input type="hidden" name="bucket" value={keep.get('bucket')!} />
        ) : null}
        {sel('leaveTypeId', 'Leave type', d.lists.types, 'All types')}
        {sel('employeeId', 'Employee', d.lists.employees, 'All staff')}
        {sel(
          'department',
          'Department',
          d.lists.departments.map((x) => ({ id: x, name: x })),
          'All departments',
        )}
        <label className="ep-field" htmlFor="lg-from">
          <span className="ep-field__label">From</span>
          <input
            id="lg-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={sp.from ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor="lg-to">
          <span className="ep-field__label">To</span>
          <input id="lg-to" name="to" type="date" className="ep-input" defaultValue={sp.to ?? ''} />
        </label>
        <label className="ep-field" htmlFor="lg-source">
          <span className="ep-field__label">Applied by</span>
          <select id="lg-source" name="source" className="ep-select" defaultValue={sp.source ?? ''}>
            <option value="">Anyone</option>
            <option value="self">The employee</option>
            <option value="on_behalf">The office</option>
            <option value="system">The system (deductions)</option>
          </select>
        </label>
        <label className="ep-field" htmlFor="lg-q">
          <span className="ep-field__label">Search</span>
          <input
            id="lg-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Leave no., name, code"
          />
        </label>
        <PerPage id="lg-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
        {keep.toString() ? (
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/register">
            Clear
          </a>
        ) : null}
        <span className="ep-grid__spacer" />
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
          Excel
        </a>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
          PDF
        </a>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Leave">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Leave</th>
              <th scope="col">Employee</th>
              <th scope="col">Dates</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Days
              </th>
              <th scope="col">Status</th>
              <th scope="col">Waiting with / decided by</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/leave/requests/${r.id}`}>{r.number}</a>
                    <span className="ep-mr-col__desc">
                      {r.leaveType.code} · {r.sourceWords} · {dmy(r.appliedAt.slice(0, 10))}
                      {r.lopPartId ? ' · part loss of pay' : ''}
                      {r.edits ? ' · dates changed' : ''}
                    </span>
                  </td>
                  <td>
                    {r.employee.name}
                    <span className="ep-mr-col__desc">
                      {r.employee.code}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                    </span>
                  </td>
                  <td>
                    {leaveDates(r)}
                    <span className="ep-mr-col__desc">{r.reason.slice(0, 60)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.days}</td>
                  <td>
                    <Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>
                    {r.status === 'pending' && r.level && r.levels ? (
                      <span className="ep-mr-col__desc">
                        level {r.level} of {r.levels}
                      </span>
                    ) : null}
                    {r.cancelStatus === 'pending' ? (
                      <span className="ep-mr-col__desc">cancellation asked</span>
                    ) : null}
                  </td>
                  <td>{r.status === 'pending' ? (r.waitingWith ?? '—') : (r.decidedBy ?? '—')}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No leave in these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={d.page} size={d.size} total={d.total} href={link} noun="leave applications" />
      <section className="ep-card" aria-labelledby="lg-enter" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="lg-enter" className="ep-card__title">
          Enter leave for an employee
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Approved at once (the fewest days and the document are not asked; loss of pay may be
          entered). Leave already on those days is cancelled and replaced — only if this entry is
          made.
        </p>
        <LeaveApplyForm
          types={formTypes}
          employees={d.lists.employees}
          apply={applyLeave}
          idPrefix="lg-ob"
          submitLabel="Enter the leave"
        />
      </section>
    </>
  );
}
