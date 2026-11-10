import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { TimingForm } from '@/components/leave/TimingForm';
import { BulkTimingForm } from '@/components/leave/BulkTimingForm';
import { TimingLog } from '@/components/leave/TimingLog';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type TimingList, type TimingLogPage, type Timings } from '@/lib/leave';
import { retireTiming } from '@/lib/leave-actions';

const ACTION: Record<string, string> = {
  HD: 'half day',
  A: 'absent',
  leave: 'half day of',
};
const SIZES = ['25', '50', '100', '500'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Row = TimingList['rows'][number];
type Tab = 'department' | 'special' | 'log';

/**
 * Department and special timings (docs/design/85, phase C): hours over the shift — a department's, as
 * versions from a date (in force, scheduled ahead, past), or one employee's for some dates (a special
 * timing wins over the department's, which wins over the shift). Each tab filtered, a page at a time, as
 * Excel or PDF; the change log of every timing; each timing added or changed in its own dialog.
 */
export default async function TimingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'special' || sp.tab === 'log' ? sp.tab : 'department';
  const page = Math.max(1, Number(sp.page) || 1);
  const size = SIZES.includes(sp.size ?? '') ? Number(sp.size) : 50;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const department = (sp.department ?? '').trim().slice(0, 100);
  const from = tab !== 'department' && DAY.test(sp.from ?? '') ? sp.from! : '';
  const to = tab !== 'department' && DAY.test(sp.to ?? '') ? sp.to! : '';
  const when = sp.when === 'past' || sp.when === 'all' ? sp.when : 'now';
  const logKind = sp.kind === 'department' || sp.kind === 'special' ? sp.kind : '';
  const timingId = tab === 'log' && /^\d{1,18}$/.test(sp.timing ?? '') ? sp.timing! : '';
  const editId = sp.edit && /^\d{1,18}$/.test(sp.edit) ? sp.edit : '';

  const filters = new URLSearchParams();
  if (tab !== 'log') filters.set('kind', tab);
  else if (logKind) filters.set('kind', logKind);
  if (q) filters.set('q', q);
  if (department) filters.set('department', department);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  if (tab === 'department') filters.set('when', when);
  if (timingId) filters.set('timingId', timingId);

  let d: Timings;
  let list: TimingList | null = null;
  let log: TimingLogPage | null = null;
  let counts: TimingList['counts'];
  try {
    const paged = `${filters.toString()}&page=${String(page)}&size=${String(size)}`;
    const [dd, ll, lg] = await Promise.all([
      // the dialogs' lists: the department timings, and the one being edited
      apiFetch<Timings>(
        `/staff-attendance/timings?only=department${editId ? `&id=${editId}` : ''}`,
      ),
      apiFetch<TimingList>(
        tab === 'log'
          ? '/staff-attendance/timings/list?kind=department&size=25'
          : `/staff-attendance/timings/list?${paged}`,
      ),
      tab === 'log'
        ? apiFetch<TimingLogPage>(`/staff-attendance/timings/log?${paged}`)
        : Promise.resolve(null),
    ]);
    d = dd;
    list = tab === 'log' ? null : ll;
    counts = ll.counts;
    log = lg;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = d.can.manage;
  const editing = can ? (d.rows.find((r) => r.id === editId) ?? null) : null;
  const adding =
    can && !editing && (sp.add === 'department' || sp.add === 'special') ? sp.add : null;

  const keep = new URLSearchParams({ tab, size: String(size) });
  for (const [k, v] of filters.entries())
    if (k !== 'kind' || tab === 'log') keep.set(k === 'timingId' ? 'timing' : k, v);
  const here = `/leave/setup/timings?${keep.toString()}&page=${String(page)}`;
  const pageUrl = (n: number) => `/leave/setup/timings?${keep.toString()}&page=${String(n)}`;
  const total = (list ?? log)!.page.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  const filtered = Boolean(q || department || from || to || logKind || timingId || when !== 'now');
  const fileUrl = (format: 'xlsx' | 'pdf') =>
    tab === 'log'
      ? `/api/leave/timings-log-file?${filters.toString()}&format=${format}`
      : `/api/leave/timings-file?${filters.toString()}&format=${format}`;
  const rule = (over: number | null, action: string, type: string | null, early: boolean) =>
    over && action !== 'none'
      ? `${early ? 'Left early' : 'Late'} by more than ${String(over)} min → ${ACTION[action] ?? action}${action === 'leave' && type ? ` ${type}` : ''}`
      : null;
  const special = tab === 'special';
  const who = (r: Row) => (special ? (r.employee ?? '') : (r.department ?? ''));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const state = (r: Row) =>
    r.to_date && r.to_date < today
      ? ({ word: 'Past', tone: 'neutral' } as const)
      : r.from_date && r.from_date > today
        ? ({ word: 'Scheduled', tone: 'info' } as const)
        : ({ word: 'In force', tone: 'success' } as const);
  const history = (r: Row) =>
    special
      ? `/leave/setup/timings?tab=log&timing=${r.id}`
      : `/leave/setup/timings?tab=log&kind=department&department=${encodeURIComponent(r.department ?? '')}`;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Department and special timings' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Department and special timings"
        description="Hours over the shift: a department's own hours from a date (set ahead for a new term or winter), or some employees' hours for some dates (a duty, a late bus)."
        actions={
          can ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a className="ep-btn ep-btn--primary" href="/leave/setup/timings?add=department">
                ＋ Department timing
              </a>
              <a
                className="ep-btn ep-btn--secondary"
                href="/leave/setup/timings?tab=special&add=special"
              >
                ＋ Special timing
              </a>
              <a
                className="ep-btn ep-btn--secondary"
                href="/leave/setup/timings?tab=special&bulk=special"
              >
                Bulk edit special timings
              </a>
            </div>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <div className="ep-alert ep-alert--info" role="note" style={{ marginBottom: 'var(--sp-4)' }}>
        <span>
          <strong>Which hours a day is measured against, in order:</strong> 1. a special timing
          covering that date → 2. a shift posted for that single date → 3. the department timing in
          force on that date → 4. the employee’s shift. A change applies from the date you give: the
          days before keep their hours. A past date works those days out again (never in a month
          locked for payroll).
        </span>
      </div>

      <div className="ep-tabs">
        <div role="tablist" aria-label="Timings" className="ep-tabs__list">
          <a
            role="tab"
            aria-selected={tab === 'department'}
            className="ep-tabs__tab"
            href="/leave/setup/timings?tab=department"
          >
            Department timings ({counts.department})
          </a>
          <a
            role="tab"
            aria-selected={tab === 'special'}
            className="ep-tabs__tab"
            href="/leave/setup/timings?tab=special"
          >
            Special timings ({counts.special})
          </a>
          <a
            role="tab"
            aria-selected={tab === 'log'}
            className="ep-tabs__tab"
            href="/leave/setup/timings?tab=log"
          >
            Change log
          </a>
        </div>
      </div>

      <section
        className="ep-card"
        aria-label={
          tab === 'log' ? 'Change log' : special ? 'Special timings' : 'Department timings'
        }
      >
        <form method="get" className="ep-master__filter" aria-label="Filter">
          <input type="hidden" name="tab" value={tab} />
          {timingId ? <input type="hidden" name="timing" value={timingId} /> : null}
          <label className="ep-field" htmlFor="tm-q">
            <span className="ep-field__label">Search</span>
            <input
              id="tm-q"
              name="q"
              type="search"
              className="ep-input"
              maxLength={80}
              defaultValue={q}
              placeholder={
                tab === 'log'
                  ? 'Department, employee or who changed'
                  : special
                    ? 'Employee name, code or remark'
                    : 'Department or remark'
              }
            />
          </label>
          {tab === 'log' ? (
            <label className="ep-field" htmlFor="tm-kind">
              <span className="ep-field__label">Timing</span>
              <select id="tm-kind" name="kind" className="ep-select" defaultValue={logKind}>
                <option value="">Department and special</option>
                <option value="department">Department timings</option>
                <option value="special">Special timings</option>
              </select>
            </label>
          ) : null}
          <label className="ep-field" htmlFor="tm-dept">
            <span className="ep-field__label">Department</span>
            <select id="tm-dept" name="department" className="ep-select" defaultValue={department}>
              <option value="">All departments</option>
              {d.departments.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          {tab === 'department' ? (
            <label className="ep-field" htmlFor="tm-when">
              <span className="ep-field__label">Show</span>
              <select id="tm-when" name="when" className="ep-select" defaultValue={when}>
                <option value="now">In force and scheduled</option>
                <option value="past">Past</option>
                <option value="all">All</option>
              </select>
            </label>
          ) : (
            <>
              <label className="ep-field" htmlFor="tm-from">
                <span className="ep-field__label">
                  {tab === 'log' ? 'Changed from' : 'Covering from'}
                </span>
                <input
                  id="tm-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={from}
                />
              </label>
              <label className="ep-field" htmlFor="tm-to">
                <span className="ep-field__label">to</span>
                <input
                  id="tm-to"
                  name="to"
                  type="date"
                  className="ep-input"
                  defaultValue={to}
                  min={from || undefined}
                />
              </label>
            </>
          )}
          <label className="ep-field" htmlFor="tm-size">
            <span className="ep-field__label">Records per page</span>
            <select id="tm-size" name="size" className="ep-select" defaultValue={String(size)}>
              {SIZES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Apply
          </button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/leave/setup/timings?tab=${tab}`}>
              Clear
            </a>
          ) : null}
        </form>

        <div className="ep-master__toolbar">
          <div className="ep-master__count">
            Showing {first} to {last} of {total}{' '}
            {tab === 'log' ? 'changes' : special ? 'special timings' : 'department timings'}
            {filtered ? ' (filtered)' : ''} · page {page} of {pages}
            {timingId ? ' · one timing’s history' : ''}
          </div>
          <div className="ep-master__actions">
            {special && can ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href="/leave/setup/timings?tab=special&add=special&excel=1"
              >
                Add or change from Excel
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={fileUrl('xlsx')} download>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={fileUrl('pdf')} download>
              PDF
            </a>
          </div>
        </div>

        {tab === 'log' && log ? (
          <TimingLog log={log} first={first} />
        ) : list ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={special ? 'Special timings' : 'Department timings'}
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">
                {special ? 'Special timings' : 'Department timings'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">S.No</th>
                  <th scope="col">{special ? 'Employee and dates' : 'Department'}</th>
                  {special ? null : <th scope="col">Effective</th>}
                  <th scope="col">Working times</th>
                  <th scope="col">Present / half day</th>
                  <th scope="col">Late / early rule</th>
                  <th scope="col">Remark</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length ? (
                  list.rows.map((r, i) => {
                    const st = state(r);
                    return (
                      <tr key={r.id}>
                        <td>{first + i}</td>
                        <td>
                          <strong>{who(r)}</strong>
                          {special ? (
                            <span className="ep-mr-col__desc">
                              {dmy(r.from_date)} to {dmy(r.to_date)}
                              {r.employee_department ? ` · ${r.employee_department}` : ''}
                            </span>
                          ) : null}
                        </td>
                        {special ? null : (
                          <td>
                            <Badge tone={st.tone}>{st.word}</Badge>
                            <span className="ep-mr-col__desc">
                              {r.from_date ? `from ${dmy(r.from_date)}` : 'from the start'}
                              {r.to_date ? ` to ${dmy(r.to_date)}` : ''}
                            </span>
                          </td>
                        )}
                        <td>
                          {r.starts_at} – {r.ends_at}
                          <span className="ep-mr-col__desc">grace {r.grace_minutes} min</span>
                        </td>
                        <td>
                          P from {Number(r.present_hours)} h · HD from {Number(r.half_day_hours)} h
                        </td>
                        <td>
                          {[
                            rule(r.late_over_minutes, r.late_action, r.late_type, false),
                            rule(r.early_over_minutes, r.early_action, r.early_type, true),
                          ]
                            .filter(Boolean)
                            .join('; ') || <span className="ep-field__help">No rule</span>}
                        </td>
                        <td>{r.note ?? ''}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                            {can && st.word !== 'Past' ? (
                              <a
                                className="ep-btn ep-btn--secondary ep-btn--sm"
                                href={`${here}&edit=${r.id}`}
                                aria-label={`Edit ${who(r)}`}
                              >
                                {st.word === 'In force' && !special ? 'Change' : 'Edit'}
                              </a>
                            ) : null}
                            <a
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              href={history(r)}
                              aria-label={`History of ${who(r)}`}
                            >
                              History
                            </a>
                            {can && st.word !== 'Past' ? (
                              <ConfirmAction
                                action={retireTiming.bind(null, r.id)}
                                fields={{ id: r.id, back: here }}
                                label={st.word === 'Scheduled' ? 'Cancel' : 'End'}
                                title={
                                  st.word === 'Scheduled'
                                    ? 'Cancel this scheduled timing?'
                                    : 'End this timing?'
                                }
                                confirmLabel={st.word === 'Scheduled' ? 'Cancel it' : 'End it'}
                                confirmVariant="danger"
                              >
                                {st.word === 'Scheduled'
                                  ? 'It has not started: it is removed, and the change log keeps it.'
                                  : `It ends yesterday: the days up to then keep it; from today ${special ? 'the employee’s department timing or shift' : 'the department’s shift (or its next timing)'} applies.`}
                              </ConfirmAction>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={special ? 7 : 8} className="ep-field__help">
                      {filtered
                        ? 'No timing matches these filters.'
                        : special
                          ? 'No special timing.'
                          : 'No department timing: every department works the hours of its shift.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        <nav className="ep-master__pager" aria-label="Pagination">
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page - 1)}>
              ‹ Previous
            </a>
          ) : (
            <span />
          )}
          <span className="ep-field__help">
            {page} / {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page + 1)}>
              Next ›
            </a>
          ) : (
            <span />
          )}
        </nav>
      </section>
      {editing ? <TimingForm key={editing.id} kind={editing.kind} row={editing} d={d} /> : null}
      {adding ? (
        <TimingForm key={adding} kind={adding} row={null} d={d} excel={sp.excel === '1'} />
      ) : null}
      {can && !editing && !adding && sp.bulk === 'special' ? (
        <BulkTimingForm departments={d.departments} />
      ) : null}
    </>
  );
}
