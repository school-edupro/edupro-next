import type { ReactNode } from 'react';
import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon, type IconName } from '@/components/nav-icons';
import { DialogButton } from '@/components/leave/DialogButton';
import { when } from '@/components/leave/LeaveCells';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { DownloadMenu, Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type LeaveFormType, type LeaveRegister, type RegisterRow } from '@/lib/leave';
import { applyLeave, cancelLeave, overrideLeave, trimLeave } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** the figure cards, as the old screen: each filters the list to its leave */
const CARDS: Array<{
  key: keyof LeaveRegister['figures'];
  label: string;
  icon: IconName;
  tip: string;
}> = [
  { key: 'total', label: 'Total Leaves', icon: 'list', tip: 'Every leave this leave year' },
  { key: 'pending', label: 'Pending', icon: 'clock', tip: 'Waiting at the first level' },
  {
    key: 'l1',
    label: 'L1 Approved',
    icon: 'check',
    tip: 'Approved at level 1, waiting at level 2',
  },
  {
    key: 'l2',
    label: 'L2 Approved',
    icon: 'check',
    tip: 'Approved at level 2, waiting at level 3',
  },
  { key: 'approved', label: 'Approved', icon: 'checkCircle', tip: 'Approved at the final level' },
  { key: 'rejected', label: 'Rejected', icon: 'xCircle', tip: 'Not approved' },
  { key: 'cancelled', label: 'Cancelled', icon: 'ban', tip: 'Cancelled after approval' },
  { key: 'lop', label: 'LWP', icon: 'wallet', tip: 'Loss of pay (leave without pay)' },
  { key: 'withdrawn', label: 'Withdrawn', icon: 'undo', tip: 'Withdrawn by the employee' },
];
const stageClass = (s: string) =>
  s === 'Pending'
    ? ''
    : s === 'L1 Approved'
      ? 'ep-stage--l1'
      : s === 'L2 Approved'
        ? 'ep-stage--l2'
        : s === 'LWP' || s === 'Rejected'
          ? 'ep-stage--no'
          : s === 'Withdrawn' || s === 'Cancelled'
            ? 'ep-stage--off'
            : 'ep-stage--ok';
const FINAL: Record<string, [string, string]> = {
  pending: ['Pending', ''],
  approved: ['Approved', 'ep-stage--ok'],
  rejected: ['Rejected', 'ep-stage--no'],
  withdrawn: ['Withdrawn', 'ep-stage--off'],
  cancelled: ['Cancelled', 'ep-stage--off'],
};
const headClass = (head: string) => {
  const lv = /LEVEL (\d+)/.exec(head)?.[1];
  if (lv) return `ep-approver__head--${String(Math.min(3, Number(lv)))}`;
  return head === 'APPROVED'
    ? 'ep-approver__head--ok'
    : head === 'REJECTED'
      ? 'ep-approver__head--no'
      : 'ep-approver__head--off';
};
/** the leave year a day is in: 1 April to 31 March */
const leaveYear = (day: string) => {
  const y = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0);
  return { from: `${String(y)}-04-01`, to: `${String(y + 1)}-03-31` };
};

/**
 * The leave register as the old Approve / Reject Leave (docs/design/85, "the register and balances as the
 * old screens"): nine figure cards for the leave year that filter the list, Records per page, Filter and
 * Download, then every leave — its stage and final status, the last action, the current approver — and
 * what the office does from the row: Approve / Reject while it waits (over every approver), Edit dates and
 * Cancel once approved. The list opens on this leave year.
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const fy = leaveYear(today);
  /** a date as given (empty for an open end) once it is in the address, else this leave year's */
  const given = (k: 'from' | 'to') => (k in sp ? (DAY.test(sp[k] ?? '') ? sp[k]! : '') : fy[k]);
  const keep = new URLSearchParams({ from: given('from'), to: given('to') });
  for (const k of ['leaveTypeId', 'employeeId'] as const)
    if (sp[k] && ID.test(sp[k]!)) keep.set(k, sp[k]!);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.source && /^(self|on_behalf|system)$/.test(sp.source)) keep.set('source', sp.source);
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  const bucket = CARDS.some((c) => c.key === sp.bucket && c.key !== 'total') ? sp.bucket! : '';
  const api = new URLSearchParams([...keep].filter(([, v]) => v !== ''));
  if (bucket) api.set('bucket', bucket);
  api.set('size', size);
  api.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: LeaveRegister;
  let formTypes: LeaveFormType[] = [];
  try {
    d = await apiFetch<LeaveRegister>(`/leave/register?${api.toString()}`);
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
  const href = (o: { page?: number; size?: string; bucket?: string; filter?: boolean }) => {
    const p = new URLSearchParams(keep);
    const b = o.bucket ?? bucket;
    if (b) p.set('bucket', b);
    const sz = o.size ?? size;
    if (sz !== '50') p.set('size', sz);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    if (o.filter) p.set('filter', '1');
    return `/leave/register?${p.toString()}`;
  };
  const back = href({ page: d.page });
  const filtered =
    keep.get('from') !== fy.from ||
    keep.get('to') !== fy.to ||
    ['leaveTypeId', 'employeeId', 'department', 'source', 'q'].some((k) => keep.has(k));
  const showFilter = sp.filter === '1' || filtered;
  const file = (format: 'xlsx' | 'pdf') => {
    const p = new URLSearchParams([...keep].filter(([, v]) => v !== ''));
    if (bucket) p.set('bucket', bucket);
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
      <select
        id={`lg-${name}`}
        name={name}
        className="ep-select"
        defaultValue={keep.get(name) ?? ''}
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
  const f = d.figures;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee leave & attendance', href: '/leave' },
          { label: 'Leave register' },
        ]}
      />
      <PageHeader
        kicker="Leave register"
        title="Approve / Reject Leave"
        description={`Every leave of the staff: its stage, who acted last and who it waits with. The figures count the leave year ${f.fy}; click one to see its leave.`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/balances">
              Leave balance
            </a>
            <DialogButton
              id="lg-ob"
              label="＋ Leave for an employee"
              title="Enter leave for an employee"
              className="ep-btn ep-btn--primary ep-btn--sm"
            >
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Approved at once (the fewest days and the document are not asked; loss of pay may be
                entered). Leave already on those days is cancelled and replaced — only if this entry
                is made.
              </p>
              <LeaveApplyForm
                types={formTypes}
                employees={d.lists.employees}
                apply={applyLeave}
                idPrefix="lg-ob"
                submitLabel="Enter the leave"
              />
            </DialogButton>
          </div>
        }
      />
      <Notice params={sp} />
      <ul className="ep-regkpis" aria-label={`Leave this leave year, ${f.fy}`}>
        {CARDS.map((c) => {
          const on = c.key === 'total' ? !bucket : bucket === c.key;
          return (
            <li key={c.key}>
              <a
                className="ep-regkpi"
                href={href({ bucket: c.key === 'total' || on ? '' : c.key })}
                aria-current={on ? 'true' : undefined}
                title={c.tip}
              >
                <span className="ep-regkpi__ic" aria-hidden="true">
                  <Icon name={c.icon} size={18} />
                </span>
                <span>
                  <span className="ep-regkpi__label">{c.label}</span>
                  <span className="ep-regkpi__num">{f[c.key]}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="ep-listbar">
        <SizeLinks size={d.size} sizeHref={(s) => href({ size: s })} noun="leave applications" />
        <div className="ep-listbar__end">
          <a
            className="ep-btn ep-btn--primary ep-btn--sm"
            href={showFilter && !filtered ? href({}) : href({ filter: true })}
          >
            {showFilter && !filtered ? 'Hide filter' : 'Filter'}
          </a>
          <DownloadMenu xlsx={file('xlsx')} pdf={file('pdf')} />
        </div>
      </div>
      {showFilter ? (
        <form
          method="get"
          action="/leave/register"
          className="ep-card ep-myleave__filter"
          aria-label="Filter"
        >
          <input type="hidden" name="filter" value="1" />
          {size !== '50' ? <input type="hidden" name="size" value={size} /> : null}
          {bucket ? <input type="hidden" name="bucket" value={bucket} /> : null}
          {sel('leaveTypeId', 'Leave Type', d.lists.types, 'All leave types')}
          {sel('employeeId', 'Employee', d.lists.employees, 'All employees')}
          {sel(
            'department',
            'Department',
            d.lists.departments.map((x) => ({ id: x, name: x })),
            'All departments',
          )}
          <label className="ep-field" htmlFor="lg-from">
            <span className="ep-field__label">From Date</span>
            <input
              id="lg-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={keep.get('from') ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="lg-to">
            <span className="ep-field__label">To Date</span>
            <input
              id="lg-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={keep.get('to') ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="lg-source">
            <span className="ep-field__label">Applied by</span>
            <select
              id="lg-source"
              name="source"
              className="ep-select"
              defaultValue={keep.get('source') ?? ''}
            >
              <option value="">Anyone</option>
              <option value="self">The employee</option>
              <option value="on_behalf">The office (on behalf)</option>
              <option value="system">The system (deductions)</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="lg-q">
            <span className="ep-field__label">Search</span>
            <input
              id="lg-q"
              name="q"
              className="ep-input"
              defaultValue={keep.get('q') ?? ''}
              placeholder="Leave ID, name, code"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Search
          </button>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/register">
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
        noun="leave"
      />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Leave register">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">S.No.</th>
              <th scope="col">Leave ID</th>
              <th scope="col">Employee Details</th>
              <th scope="col">Leave Type</th>
              <th scope="col">Applied Date</th>
              <th scope="col">From Date</th>
              <th scope="col">To Date</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Total Days
              </th>
              <th scope="col">Status</th>
              <th scope="col">Final Status</th>
              <th scope="col">Reason</th>
              <th scope="col">Last Action</th>
              <th scope="col">Last Action Date</th>
              <th scope="col">Current Approver</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{(d.page - 1) * d.size + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a href={`/leave/requests/${r.id}`}>#{r.number}</a>
                    {r.documentFileId ? (
                      <FileLinks
                        href={`/api/files/${r.documentFileId}/download`}
                        label={`the document of ${r.number}`}
                        viewOnly
                      />
                    ) : null}
                    {r.edits ? (
                      <span className="ep-mr-col__desc">
                        dates changed {r.edits} time{r.edits === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ minWidth: '11rem' }}>
                    <strong>{r.employee.name}</strong>
                    <span className="ep-mr-col__desc">
                      {r.employee.code}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                    </span>
                    {r.source === 'on_behalf' && r.appliedPerson ? (
                      <span className="ep-onbehalf">On behalf · {r.appliedPerson}</span>
                    ) : null}
                  </td>
                  <td style={{ minWidth: '10rem' }}>
                    {r.leaveType.code} — {r.leaveType.name}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.appliedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dmy(r.from)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {dmy(r.to)}
                    {r.halfDay ? (
                      <span className="ep-mr-col__desc">
                        {r.session === 'first' ? 'first half' : 'second half'}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.days.toFixed(1)}</td>
                  <td>
                    <span className={`ep-stage ${stageClass(r.stage)}`}>{r.stage}</span>
                  </td>
                  <td>
                    <span className={`ep-stage ${FINAL[r.status]?.[1] ?? ''}`}>
                      {FINAL[r.status]?.[0] ?? r.status}
                    </span>
                  </td>
                  <td style={{ minWidth: '12rem' }}>
                    {r.reason.length > 40 ? (
                      <details>
                        <summary>
                          {r.reason.slice(0, 40)}…{' '}
                          <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                            View More
                          </span>
                        </summary>
                        {r.reason}
                      </details>
                    ) : (
                      r.reason
                    )}
                  </td>
                  <td>
                    <strong style={{ whiteSpace: 'nowrap' }}>{r.lastAction.words}</strong>
                    {r.lastAction.by ? (
                      <span className="ep-mr-col__desc">{r.lastAction.by}</span>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.lastAction.at) || '—'}</td>
                  <td>
                    <span className={`ep-approver__head ${headClass(r.approver.head)}`}>
                      {r.approver.head}
                    </span>
                    {r.approver.people ? (
                      <span className="ep-mr-col__desc">{r.approver.people}</span>
                    ) : null}
                  </td>
                  <td>
                    <RowActions r={r} back={back} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={15}>No leave in these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pages
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p })}
        noun="leave"
      />
    </>
  );
}

/** An icon that opens its form: the hidden words name it for screen readers, the tooltip for the eye. */
function IconDialog({
  id,
  icon,
  words,
  title,
  children,
}: {
  id: string;
  icon: IconName;
  words: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogButton
      id={id}
      className="ep-iconbtn"
      tip={words}
      title={title}
      label={
        <>
          <Icon name={icon} size={20} />
          <span className="ep-sr-only">{words}</span>
        </>
      }
    >
      {children}
    </DialogButton>
  );
}

/**
 * What the office does from a row (as the old screen): while the leave waits, Approve or Reject over every
 * approver (with the reason, kept as the office's); once approved, Edit dates (trim the ends) and Cancel.
 */
function RowActions({ r, back }: { r: RegisterRow; back: string }) {
  if (!r.can.override && !r.can.trim && !r.can.cancel)
    return <span className="ep-mr-col__desc">—</span>;
  const why = (id: string, label = 'Reason') => (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <textarea
        id={id}
        name="reason"
        className="ep-input"
        rows={2}
        minLength={3}
        maxLength={400}
        required
      />
    </label>
  );
  return (
    <div className="ep-rowacts" style={{ flexWrap: 'nowrap' }}>
      {r.can.override ? (
        <>
          <IconDialog
            id={`lg-ap-${r.id}`}
            icon="checkCircle"
            words={`Approve ${r.number}`}
            title={`Approve ${r.number} (${r.employee.name})`}
          >
            <form action={overrideLeave.bind(null, r.id)} className="ep-form-section__body">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="outcome" value="approved" />
              <p className="ep-field__help">
                Approves it over every approver still to act ({r.approver.head.toLowerCase()}
                {r.approver.people ? `: ${r.approver.people}` : ''}). The reason is kept as the
                leave office’s; the employee is told.
              </p>
              {why(`lg-ap-${r.id}-why`)}
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Approve
              </button>
            </form>
          </IconDialog>
          <IconDialog
            id={`lg-rj-${r.id}`}
            icon="xCircle"
            words={`Reject ${r.number}`}
            title={`Reject ${r.number} (${r.employee.name})`}
          >
            <form action={overrideLeave.bind(null, r.id)} className="ep-form-section__body">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="outcome" value="rejected" />
              <p className="ep-field__help">
                Rejects it for every approver; the held days are given back and the employee is
                told, with the reason.
              </p>
              {why(`lg-rj-${r.id}-why`)}
              <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
                Reject
              </button>
            </form>
          </IconDialog>
        </>
      ) : null}
      {r.can.trim ? (
        <IconDialog
          id={`lg-ed-${r.id}`}
          icon="pencil"
          words={`Edit the dates of ${r.number}`}
          title={`Edit the dates of ${r.number}`}
        >
          <form action={trimLeave.bind(null, r.id)} className="ep-form-section__body">
            <input type="hidden" name="back" value={back} />
            <p className="ep-field__help">
              Trims the leave from either end ({dmy(r.from)} to {dmy(r.to)}); the days cut are given
              back and the attendance worked out again.
            </p>
            <div className="ep-form-row">
              <label className="ep-field" htmlFor={`lg-ed-${r.id}-from`}>
                <span className="ep-field__label">From Date</span>
                <input
                  id={`lg-ed-${r.id}-from`}
                  name="from"
                  type="date"
                  className="ep-input"
                  min={r.from}
                  max={r.to}
                  defaultValue={r.from}
                  required
                />
              </label>
              <label className="ep-field" htmlFor={`lg-ed-${r.id}-to`}>
                <span className="ep-field__label">To Date</span>
                <input
                  id={`lg-ed-${r.id}-to`}
                  name="to"
                  type="date"
                  className="ep-input"
                  min={r.from}
                  max={r.to}
                  defaultValue={r.to}
                  required
                />
              </label>
            </div>
            {why(`lg-ed-${r.id}-why`)}
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Change the dates
            </button>
          </form>
        </IconDialog>
      ) : null}
      {r.can.cancel ? (
        <IconDialog
          id={`lg-cx-${r.id}`}
          icon="ban"
          words={`Cancel ${r.number}`}
          title={`Cancel ${r.number} (${r.employee.name})`}
        >
          <form action={cancelLeave.bind(null, r.id)} className="ep-form-section__body">
            <input type="hidden" name="back" value={back} />
            <p className="ep-field__help">
              Cancels this approved leave: the days are given back, the attendance is worked out
              again and the employee is told.
            </p>
            {why(`lg-cx-${r.id}-why`)}
            <button type="submit" className="ep-btn ep-btn--danger ep-btn--sm">
              Cancel the leave
            </button>
          </form>
        </IconDialog>
      ) : null}
    </div>
  );
}
