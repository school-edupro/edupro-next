import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { TimingForm } from '@/components/leave/TimingForm';
import { BulkTimingForm } from '@/components/leave/BulkTimingForm';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type TimingList, type Timings } from '@/lib/leave';
import { retireTiming } from '@/lib/leave-actions';

const ACTION: Record<string, string> = {
  HD: 'half day',
  A: 'absent',
  leave: 'half day of',
};
const SIZES = ['25', '50', '100', '500'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Row = TimingList['rows'][number];

/**
 * Department and special timings (docs/design/85, phase C): hours over the shift — a department's every
 * day, or one employee's for some dates (a special timing wins over the department's, which wins over the
 * shift). Two tabs, each filtered, a page at a time, as Excel or PDF; every timing added or changed in
 * its own dialog (the old module's layout), every box checked.
 */
export default async function TimingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'special' ? 'special' : 'department';
  const page = Math.max(1, Number(sp.page) || 1);
  const size = SIZES.includes(sp.size ?? '') ? Number(sp.size) : 50;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const department = (sp.department ?? '').trim().slice(0, 100);
  const from = tab === 'special' && DAY.test(sp.from ?? '') ? sp.from! : '';
  const to = tab === 'special' && DAY.test(sp.to ?? '') ? sp.to! : '';
  const filters = new URLSearchParams({ kind: tab });
  if (q) filters.set('q', q);
  if (department) filters.set('department', department);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  const editId = sp.edit && /^\d{1,18}$/.test(sp.edit) ? sp.edit : '';
  let d: Timings;
  let list: TimingList;
  try {
    [d, list] = await Promise.all([
      // the dialogs' lists: the department timings, and the one being edited
      apiFetch<Timings>(
        `/staff-attendance/timings?only=department${editId ? `&id=${editId}` : ''}`,
      ),
      apiFetch<TimingList>(
        `/staff-attendance/timings/list?${filters.toString()}&page=${String(page)}&size=${String(size)}`,
      ),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = d.can.manage;
  const editing = can ? (d.rows.find((r) => r.id === editId) ?? null) : null;
  const adding =
    can && !editing && (sp.add === 'department' || sp.add === 'special') ? sp.add : null;

  const keep = new URLSearchParams({ tab, size: String(size) });
  if (q) keep.set('q', q);
  if (department) keep.set('department', department);
  if (from) keep.set('from', from);
  if (to) keep.set('to', to);
  const pageUrl = (n: number) => `/leave/setup/timings?${keep.toString()}&page=${String(n)}`;
  const total = list.page.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  const filtered = Boolean(q || department || from || to);
  const fileUrl = (format: 'xlsx' | 'pdf') =>
    `/api/leave/timings-file?${filters.toString()}&format=${format}`;
  const rule = (over: number | null, action: string, type: string | null, early: boolean) =>
    over && action !== 'none'
      ? `${early ? 'Left early' : 'Late'} by more than ${String(over)} min → ${ACTION[action] ?? action}${action === 'leave' && type ? ` ${type}` : ''}`
      : null;
  const special = tab === 'special';
  const who = (r: Row) => (special ? (r.employee ?? '') : (r.department ?? ''));

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
        description="Hours over the shift: a department's own hours every day, or one employee's hours for some dates (a duty, a late bus)."
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
          covering that date → 2. a shift posted for that single date → 3. the department timing →
          4. the employee’s shift. After a change, work past days out again from the attendance
          register.
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
            Department timings ({list.counts.department})
          </a>
          <a
            role="tab"
            aria-selected={tab === 'special'}
            className="ep-tabs__tab"
            href="/leave/setup/timings?tab=special"
          >
            Special timings ({list.counts.special})
          </a>
        </div>
      </div>

      <section className="ep-card" aria-label={special ? 'Special timings' : 'Department timings'}>
        <form method="get" className="ep-master__filter" aria-label="Filter">
          <input type="hidden" name="tab" value={tab} />
          <label className="ep-field" htmlFor="tm-q">
            <span className="ep-field__label">Search</span>
            <input
              id="tm-q"
              name="q"
              type="search"
              className="ep-input"
              maxLength={80}
              defaultValue={q}
              placeholder={special ? 'Employee name, code or remark' : 'Department or remark'}
            />
          </label>
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
          {special ? (
            <>
              <label className="ep-field" htmlFor="tm-from">
                <span className="ep-field__label">Covering from</span>
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
          ) : null}
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
            Showing {first} to {last} of {total} {special ? 'special' : 'department'} timings
            {filtered ? ' (filtered)' : ''} · page {page} of {pages}
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
                <th scope="col">Working times</th>
                <th scope="col">Present / half day</th>
                <th scope="col">Late / early rule</th>
                <th scope="col">Remark</th>
                {can ? <th scope="col">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.rows.length ? (
                list.rows.map((r, i) => (
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
                    {can ? (
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`/leave/setup/timings?${keep.toString()}&page=${String(page)}&edit=${r.id}`}
                            aria-label={`Edit ${who(r)}`}
                          >
                            Edit
                          </a>
                          <ConfirmAction
                            action={retireTiming.bind(null, r.id)}
                            fields={{ id: r.id }}
                            label="Remove"
                            title="Remove this timing?"
                            confirmLabel="Remove"
                            confirmVariant="danger"
                          >
                            {special
                              ? 'The employee goes back to the department’s or the shift’s hours'
                              : 'The department goes back to the hours of its shift'}{' '}
                            from the next day worked out. Days already worked out stay as they are
                            until worked out again.
                          </ConfirmAction>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={can ? 7 : 6} className="ep-field__help">
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
