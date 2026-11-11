import type { ReactNode } from 'react';
import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon } from '@/components/nav-icons';
import { BulkAttendance } from '@/components/leave/BulkAttendance';
import { CorrectionLog } from '@/components/leave/CorrectionLog';
import { CountPopover } from '@/components/leave/CountPopover';
import { DayQuickEdit } from '@/components/leave/DayQuickEdit';
import { DialogButton } from '@/components/leave/DialogButton';
import { LeaveApplyForm } from '@/components/leave/LeaveApplyForm';
import { DownloadMenu, Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type AttendanceRegisterPage, type LeaveFormType } from '@/lib/leave';
import { applyLeave, bulkDays, correctDay, lockMonth, runAttendance } from '@/lib/leave-actions';

const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const BASE = ['P', 'HD', 'A', 'WO', 'H', 'HOLD', 'LOP'];
/** the colour class of a day's code: the day kinds, else a leave's */
const codeClass = (code: string) => {
  const c = code.replace('½', '');
  return `ep-areg__code--${BASE.includes(c) ? c : 'LV'}`;
};
const STATUS_WORDS: Array<[string, string]> = [
  ['P', 'P — Present'],
  ['A', 'A — Absent'],
  ['HD', 'HD — Half day'],
  ['WO', 'WO — Weekly off'],
  ['H', 'H — Holiday'],
  ['HOLD', 'HOLD — Salary hold'],
];
/** what a count of the register is, in its panel */
const COUNT_WORDS: Record<string, string> = {
  P: 'Present',
  A: 'Absent',
  WO: 'Weekly off',
  H: 'Holiday',
  HD: 'Half day',
  HOLD: 'Salary hold',
  late: 'Late marks',
  missing: 'Missing punches',
};
/**
 * The days behind a count: the days of that code (a half-day leave is half present: "½"), the late or
 * missing-punch days; a loss-of-pay type's days show as LOP.
 */
const daysOf = (cells: AttendanceRegisterPage['rows'][number]['cells'], k: string): string[] => {
  const base = (c: string) => c.replace('½', '');
  const half = (c: { day: string; code: string }) => `${c.day}${c.code.endsWith('½') ? '½' : ''}`;
  if (k === 'late') return cells.filter((c) => c.late).map((c) => c.day);
  if (k === 'missing') return cells.filter((c) => c.missing).map((c) => c.day);
  if (k === 'P') return cells.filter((c) => c.code === 'P' || c.code.endsWith('½')).map(half);
  const own = cells.filter((c) => base(c.code) === k);
  return (
    own.length ? own : cells.filter((c) => base(c.code) === 'LOP' && !BASE.slice(0, 6).includes(k))
  ).map(half);
};
const MARKS: Array<[string, string, string]> = [
  ['L', 'ep-sq--L', 'Late Mark'],
  ['F', 'ep-sq--F', 'Missing Punch'],
  ['m', 'ep-sq--m', 'Manual Entry'],
  ['LOP', 'ep-sq--LOP', 'Loss of Pay'],
];

/**
 * The attendance register as the old Payroll / Attendance Register (docs/design/85, "the attendance register
 * as the old screen", in the Mobilise design): Filter and Download; one strip of tools — search, Attendance
 * Status, View, Corrections, Bulk Update, Apply Leave, Run now, the payroll lock, the legend; the marker key;
 * then a block per employee (STATUS, IN, OUT, HRS) a column a day with the month's counts. A day opens its
 * quick edit.
 */
export default async function AttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.office.manage')) notFound();
  const size = pageSizeOf(sp.size ?? '25');
  const view = sp.view === 'status' ? 'status' : 'full';
  const keep = new URLSearchParams();
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) keep.set('month', sp.month);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  if (sp.status && /^[A-Za-z0-9_]{1,20}$/.test(sp.status)) keep.set('status', sp.status);
  if (sp.all === '1') keep.set('all', '1');
  const qs = new URLSearchParams(keep);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: AttendanceRegisterPage;
  let formTypes: LeaveFormType[] = [];
  try {
    d = await apiFetch<AttendanceRegisterPage>(`/staff-attendance/register?${qs.toString()}`);
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
  const month = d.month.slice(0, 7);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const locked = !!d.lock?.locked;
  const href = (o: { page?: number; size?: string; filter?: boolean; all?: boolean }) => {
    const p = new URLSearchParams(keep);
    if (view === 'status') p.set('view', 'status');
    const sz = o.size ?? size;
    if (sz !== '25') p.set('size', sz);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    if (o.filter) p.set('filter', '1');
    if (o.all) p.set('all', '1');
    const s = p.toString();
    return `/leave/attendance${s ? `?${s}` : ''}`;
  };
  const here = href({ page: d.page });
  const filtered = keep.has('month') || keep.has('department') || keep.has('all');
  const showFilter = sp.filter === '1' || filtered;
  const report = (format: 'xlsx' | 'pdf') =>
    `/api/leave/report?${new URLSearchParams({
      report: 'monthly_register',
      format,
      month,
      ...(sp.department ? { department: sp.department } : {}),
    }).toString()}`;
  const hidden = (names: string[]) =>
    names.map((n) =>
      keep.get(n) ? <input key={n} type="hidden" name={n} value={keep.get(n)!} /> : null,
    );
  const sums = ['P', 'A', 'WO', 'H', 'HD', ...d.types, 'HOLD'];
  const monthStart = d.month.slice(0, 10);
  const monthEnd = d.dates[d.dates.length - 1] ?? monthStart;
  const legend = (
    <div className="ep-form-section__body">
      <div>
        <h4 className="ep-field__label">Status codes</h4>
        <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
          <li>P Present · A Absent · WO Weekly off · H Holiday · HD Half day · HOLD Salary hold</li>
          <li>
            The leave’s code — {d.types.join(', ')} — with ½ for half a day (counted 0.5, the other
            half present)
          </li>
          <li>
            LOP Loss of pay · · not worked out yet (a past day the nightly run has not reached)
          </li>
        </ul>
      </div>
      <div>
        <h4 className="ep-field__label">Markers on a day</h4>
        <ul className="ep-armeta__key" style={{ flexDirection: 'column', gap: 'var(--sp-1)' }}>
          {MARKS.map(([k, cls, words]) => (
            <li key={k}>
              <span className={`ep-sq ${cls}`} aria-hidden="true" />
              {k} — {words}
              {k === 'F' ? ' (a forgotten punch, usually OUT)' : ''}
              {k === 'm' ? ' (set or corrected by hand)' : ''}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="ep-field__label">The month’s counts</h4>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {sums.join(', ')}: days of each kind (half days count 0.5). L late marks, F forgotten
          punches, Pay the payable days (the days not absent, on loss of pay or held; past days not
          worked out count until they are).
        </p>
      </div>
    </div>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee leave & attendance', href: '/leave' },
          { label: 'Attendance register' },
        ]}
      />
      <PageHeader
        kicker="Payroll / Attendance register"
        title={`Attendance Register · ${d.monthWords}`}
        description={`Every employee's day, worked out from the biometric punches: the status, IN, OUT and hours, with the month's counts. Click a day to correct it. ${String(d.total)} employees.`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href={showFilter && !filtered ? href({}) : href({ filter: true })}
            >
              {showFilter && !filtered ? 'Hide filter' : 'Filter'}
            </a>
            <DownloadMenu
              items={[
                { label: 'Register (Excel)', href: report('xlsx') },
                { label: 'Register (PDF, A3)', href: report('pdf') },
                {
                  label: 'Payroll feed (Excel)',
                  href: `/api/leave/attendance-file?month=${month}${sp.department ? `&department=${encodeURIComponent(sp.department)}` : ''}`,
                },
              ]}
            />
          </div>
        }
      />
      <Notice params={sp} />
      {showFilter ? (
        <form
          method="get"
          action="/leave/attendance"
          className="ep-card ep-myleave__filter"
          aria-label="Filter"
        >
          <input type="hidden" name="filter" value="1" />
          {hidden(['q', 'status'])}
          {view === 'status' ? <input type="hidden" name="view" value="status" /> : null}
          <label className="ep-field" htmlFor="ar-month">
            <span className="ep-field__label">Month</span>
            <input
              id="ar-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={month}
            />
          </label>
          <label className="ep-field" htmlFor="ar-dept">
            <span className="ep-field__label">Department</span>
            <select
              id="ar-dept"
              name="department"
              className="ep-select"
              defaultValue={sp.department ?? ''}
            >
              <option value="">All departments</option>
              {d.departments.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-check" htmlFor="ar-all">
            <input id="ar-all" type="checkbox" name="all" value="1" defaultChecked={d.all} />
            <span>Show all staff ({d.excluded} not required in the reports)</span>
          </label>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Search
          </button>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/attendance">
            Reset
          </a>
        </form>
      ) : null}
      <div className="ep-arbar">
        <form
          method="get"
          action="/leave/attendance"
          className="ep-arbar"
          style={{ margin: 0, padding: 0, border: 0 }}
        >
          {hidden(['month', 'department', 'all'])}
          {size !== '25' ? <input type="hidden" name="size" value={size} /> : null}
          <label className="ep-field" htmlFor="ar-q">
            <span className="ep-field__label">Search</span>
            <input
              id="ar-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={sp.q ?? ''}
              placeholder="Search employee ID or name"
            />
          </label>
          <label className="ep-field" htmlFor="ar-status">
            <span className="ep-field__label">Attendance Status</span>
            <select
              id="ar-status"
              name="status"
              className="ep-select"
              defaultValue={keep.get('status') ?? ''}
            >
              <option value="">All</option>
              {STATUS_WORDS.map(([k, w]) => (
                <option key={k} value={k}>
                  {w}
                </option>
              ))}
              {d.types.map((t) => (
                <option key={t} value={t}>
                  {t} — leave
                </option>
              ))}
              <option value="late">L — Late mark</option>
              <option value="missing">F — Missing punch</option>
              <option value="manual">m — Manual entry</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="ar-view">
            <span className="ep-field__label">View</span>
            <select id="ar-view" name="view" className="ep-select" defaultValue={view}>
              <option value="full">Status, IN, OUT, hours</option>
              <option value="status">Status only</option>
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Show
          </button>
        </form>
        <span className="ep-arbar__spacer" />
        <DialogButton
          id="ar-log"
          label="Corrections"
          title={`Attendance Corrections — ${d.monthWords}`}
          icon={<Icon name="refresh" size={20} />}
          className="ep-btn ep-btn--secondary ep-btn--sm"
        >
          <CorrectionLog month={month} />
        </DialogButton>
        <DialogButton
          id="ar-bulk"
          label="Bulk Update"
          title="Bulk Attendance Update"
          icon={<Icon name="upload" size={20} />}
          className="ep-btn ep-btn--secondary ep-btn--sm"
        >
          <BulkAttendance
            employees={d.employees}
            departments={d.departments}
            back={here}
            today={today}
            from={monthStart}
            to={monthEnd}
            bulk={bulkDays}
          />
        </DialogButton>
        <DialogButton
          id="ar-apply"
          label="Apply Leave"
          title="Apply leave for an employee"
          className="ep-btn ep-btn--secondary ep-btn--sm"
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Entered by the office: approved at once (the fewest days and the document are not asked;
            loss of pay may be entered). Leave already on those days is replaced.
          </p>
          <LeaveApplyForm
            types={formTypes}
            employees={d.employees.map((e) => ({ id: e.id, name: `${e.name} (${e.code})` }))}
            apply={applyLeave}
            idPrefix="ar-ob"
            submitLabel="Apply the leave"
          />
        </DialogButton>
        <DialogButton
          id="ar-run"
          label="Run now"
          title="Run now"
          className="ep-btn ep-btn--secondary ep-btn--sm"
        >
          <RunNow here={here} />
        </DialogButton>
        <LockPill d={d} here={here} month={month} locked={locked} />
        <DialogButton
          id="ar-legend"
          label={
            <span className="ep-lockpill">
              <Icon name="help" size={16} /> Legend
            </span>
          }
          title="What the colours and codes in the grid mean"
          className="ep-btn ep-btn--ghost ep-btn--sm"
        >
          {legend}
        </DialogButton>
      </div>
      <div className="ep-armeta">
        <ul className="ep-armeta__key" aria-label="Markers">
          {MARKS.map(([k, cls, words]) => (
            <li key={k}>
              <span className={`ep-sq ${cls}`} aria-hidden="true" />
              {words}
            </li>
          ))}
        </ul>
        <Showing page={d.page} size={d.size} total={d.total} />
      </div>
      {!d.all && d.excluded ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          {d.excluded} staff not required in the reports (test, vendor or management accounts) are
          left out — <a href={href({ all: true })}>show all staff</a>. Their days still count for
          payroll.
        </p>
      ) : null}
      <div className="ep-listbar">
        <SizeLinks size={d.size} sizeHref={(s) => href({ size: s })} noun="employees" />
        <Pages
          page={d.page}
          size={d.size}
          total={d.total}
          href={(p) => href({ page: p })}
          noun="employees"
        />
      </div>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Attendance register">
        <table className="ep-table ep-table--dense ep-areg">
          <thead>
            <tr>
              <th scope="col" className="ep-areg__emp">
                Employee
              </th>
              {view === 'full' ? (
                <th scope="col">
                  <span className="ep-sr-only">Line</span>
                </th>
              ) : null}
              {d.dates.map((x) => (
                <th key={x} scope="col">
                  {Number(x.slice(8, 10))}
                  <span className="ep-mr-col__desc">
                    {WEEKDAY[new Date(`${x}T00:00:00Z`).getUTCDay()]}
                  </span>
                </th>
              ))}
              {[...sums, 'L', 'F', 'Pay'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.flatMap((r) => {
                const emp = (
                  <th scope="row" className="ep-areg__emp" rowSpan={view === 'full' ? 4 : 1}>
                    <strong>{r.employee.code}</strong>
                    <span style={{ display: 'block' }}>{r.employee.name}</span>
                    <span className="ep-mr-col__desc">{r.employee.department ?? '—'}</span>
                  </th>
                );
                const totals = [...sums, 'late', 'missing'].map((k) => {
                  const v = r.totals[k] ?? 0;
                  const label = COUNT_WORDS[k] ?? `${k} leave`;
                  return (
                    <td key={k} rowSpan={view === 'full' ? 4 : 1}>
                      {v ? (
                        <button
                          type="button"
                          className={`ep-areg__cnt${k === 'A' || k === 'missing' ? ' ep-areg__cnt--bad' : k === 'late' ? ' ep-areg__cnt--warn' : ''}`}
                          data-cnt=""
                          data-emp={r.employee.id}
                          data-name={r.employee.name}
                          data-label={label}
                          data-count={String(v)}
                          data-days={daysOf(r.cells, k).join(',')}
                          data-month={month}
                          aria-label={`${r.employee.name}: ${label} ${String(v)} — show the days`}
                        >
                          {v}
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                  );
                });
                const pay = (
                  <td rowSpan={view === 'full' ? 4 : 1}>
                    <strong>{r.payable}</strong>
                    {r.unmarked ? (
                      <span className="ep-mr-col__desc">{r.unmarked} not marked</span>
                    ) : null}
                  </td>
                );
                const status = r.cells.map((c) => {
                  const off = c.code === 'WO' || c.code === 'H';
                  const mark: ReactNode = (
                    <>
                      {c.late ? <sup className="ep-mk ep-mk--L">L</sup> : null}
                      {c.missing ? <sup className="ep-mk ep-mk--F">F</sup> : null}
                      {c.manual ? <sup className="ep-mk ep-mk--m">m</sup> : null}
                    </>
                  );
                  const label = `${r.employee.name}, ${dmy(c.day)}: ${c.title || c.code || 'nothing yet'}`;
                  const editable = !locked && c.day <= today && c.type !== 'LV';
                  return (
                    <td
                      key={c.day}
                      className={off ? 'ep-areg__off' : undefined}
                      title={c.title || undefined}
                    >
                      {!c.code ? null : editable ? (
                        <button
                          type="button"
                          className={`ep-areg__cell ${codeClass(c.code)}`}
                          data-qe=""
                          data-emp={r.employee.id}
                          data-name={r.employee.name}
                          data-day={c.day}
                          data-type={c.type ?? ''}
                          data-code={c.code === '·' ? '' : c.code}
                          data-in={c.in ?? ''}
                          data-out={c.out ?? ''}
                          aria-label={`Edit ${label}`}
                        >
                          {c.code}
                          {mark}
                        </button>
                      ) : (
                        <a
                          className={`ep-areg__cell ${codeClass(c.code)}`}
                          href={`/leave/attendance/day?emp=${r.employee.id}&day=${c.day}`}
                          aria-label={label}
                        >
                          {c.code}
                          {mark}
                        </a>
                      )}
                    </td>
                  );
                });
                if (view === 'status')
                  return [
                    <tr key={r.employee.id} className="ep-areg__first">
                      {emp}
                      {status}
                      {totals}
                      {pay}
                    </tr>,
                  ];
                const line = (k: 'in' | 'out' | 'hrs', words: string) => (
                  <tr key={`${r.employee.id}-${k}`}>
                    <td className="ep-areg__lbl">{words}</td>
                    {r.cells.map((c) => (
                      <td
                        key={c.day}
                        className={`ep-areg__time${c.code === 'WO' || c.code === 'H' ? ' ep-areg__off' : ''}`}
                      >
                        {k === 'hrs' ? (c.hrs ? c.hrs.toFixed(2) : '') : (c[k] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
                return [
                  <tr key={r.employee.id} className="ep-areg__first">
                    {emp}
                    <td className="ep-areg__lbl">STATUS</td>
                    {status}
                    {totals}
                    {pay}
                  </tr>,
                  line('in', 'IN'),
                  line('out', 'OUT'),
                  line('hrs', 'HRS'),
                ];
              })
            ) : (
              <tr>
                <td colSpan={d.dates.length + sums.length + 5}>No staff in these filters.</td>
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
        noun="employees"
      />
      <DayQuickEdit action={correctDay} back={here} />
      <CountPopover />
    </>
  );
}

/** The jobs the system runs by itself (punches every 15 minutes, the rest every night), run now. */
function RunNow({ here }: { here: string }) {
  return (
    <div className="ep-form-section__body">
      <p className="ep-field__help" style={{ margin: 0 }}>
        The system reads punches every 15 minutes and does the rest every night. Run a step now
        after a change.
      </p>
      {(
        [
          ['sync', 'Read the new punches'],
          [
            'nightly',
            'The nightly run (weekly offs, holidays, absent, late marks, missing punches, loss of pay)',
          ],
        ] as const
      ).map(([what, label]) => (
        <form key={what} action={runAttendance}>
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="what" value={what} />
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            {label}
          </button>
        </form>
      ))}
      <form action={runAttendance} className="ep-myleave__filter" style={{ margin: 0 }}>
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="what" value="recompute" />
        <label className="ep-field" htmlFor="ar-rf">
          <span className="ep-field__label">From</span>
          <input id="ar-rf" name="from" type="date" className="ep-input" />
        </label>
        <label className="ep-field" htmlFor="ar-rt">
          <span className="ep-field__label">To</span>
          <input id="ar-rt" name="to" type="date" className="ep-input" />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Work these days out again
        </button>
      </form>
      <form action={runAttendance} className="ep-myleave__filter" style={{ margin: 0 }}>
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="what" value="deduct" />
        <label className="ep-field" htmlFor="ar-dm">
          <span className="ep-field__label">Month</span>
          <input id="ar-dm" name="month" type="month" className="ep-input" />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Deduct its late marks and missing punches
        </button>
      </form>
    </div>
  );
}

/**
 * The payroll lock as the old register's Open / Locked button: locking first shows what is still open
 * (missing punches, staff with no department); unlocking asks why.
 */
function LockPill({
  d,
  here,
  month,
  locked,
}: {
  d: AttendanceRegisterPage;
  here: string;
  month: string;
  locked: boolean;
}) {
  if (!locked && !d.mayLock)
    return (
      <span
        className="ep-btn ep-btn--secondary ep-btn--sm ep-lockpill"
        title="A month is locked once it is over"
        aria-label={`${d.monthWords} is open (a month is locked once it is over)`}
      >
        <Icon name="unlock" size={16} /> Open
      </span>
    );
  return (
    <DialogButton
      id="ar-lock"
      label={
        <span className="ep-lockpill">
          <Icon name={locked ? 'lock' : 'unlock'} size={16} /> {locked ? 'Locked' : 'Open'}
        </span>
      }
      title={locked ? `Unlock ${d.monthWords}` : `Lock ${d.monthWords} for payroll`}
      className="ep-btn ep-btn--secondary ep-btn--sm"
      tip={locked ? `${d.monthWords} is locked for payroll` : `${d.monthWords} is open`}
    >
      {locked ? (
        <form action={lockMonth.bind(null, false)} className="ep-form-section__body">
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="month" value={month} />
          <p className="ep-field__help" style={{ margin: 0 }}>
            Locked{d.lock?.by ? ` by ${d.lock.by}` : ''}: nothing in {d.monthWords} changes (leave,
            corrections, punches) until it is unlocked.
          </p>
          <label className="ep-field" htmlFor="ar-why">
            <span className="ep-field__label">Why unlock</span>
            <textarea
              id="ar-why"
              name="reason"
              className="ep-input"
              rows={2}
              required
              minLength={3}
              maxLength={300}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Unlock {d.monthWords}
          </button>
        </form>
      ) : (
        <form action={lockMonth.bind(null, true)} className="ep-form-section__body">
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="month" value={month} />
          {d.checks.missingTotal ? (
            <div className="ep-alert ep-alert--warning" role="status">
              <span>
                {d.checks.missingTotal} missing punch{d.checks.missingTotal === 1 ? '' : 'es'} (F)
                in {d.monthWords} {d.checks.missingTotal === 1 ? 'is' : 'are'} still open — locking
                turns what nobody explains into leave or loss of pay:{' '}
                {d.checks.missing
                  .slice(0, 12)
                  .map((m) => `${m.code} ${dmy(m.day)}`)
                  .join(', ')}
                {d.checks.missingTotal > 12 ? '…' : ''}
              </span>
            </div>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No missing punch is open in {d.monthWords}.
            </p>
          )}
          {d.checks.noDepartment.length ? (
            <div className="ep-alert ep-alert--warning" role="status">
              <span>
                {d.checks.noDepartment.length} staff have no department (they cannot be filtered or
                reported by department):{' '}
                {d.checks.noDepartment
                  .slice(0, 12)
                  .map((e) => e.code)
                  .join(', ')}
                {d.checks.noDepartment.length > 12 ? '…' : ''}
              </span>
            </div>
          ) : null}
          {d.lock?.unlockReason ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Unlocked before: {d.lock.unlockReason}.
            </p>
          ) : null}
          <p className="ep-field__help" style={{ margin: 0 }}>
            Locking turns the absent days with no leave and no correction asked into loss of pay,
            then stops every change in the month (leave, corrections, punches).
          </p>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Lock {d.monthWords}
          </button>
        </form>
      )}
    </DialogButton>
  );
}
