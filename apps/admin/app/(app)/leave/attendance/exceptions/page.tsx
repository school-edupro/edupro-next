import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type AttendanceExceptions } from '@/lib/leave';
import { clearAttendanceMark } from '@/lib/leave-actions';

const KINDS = [
  ['late', 'Late marks'],
  ['missing', 'Missing punches'],
  ['regularisation', 'Corrections asked'],
] as const;
type Kind = (typeof KINDS)[number][0];
const STATUS: Record<
  Kind,
  Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }>
> = {
  late: {
    pending: { label: 'Counts this month', tone: 'warning' },
    used: { label: 'Charged as leave', tone: 'danger' },
    waived: { label: 'Waived', tone: 'neutral' },
    lapsed: { label: 'Lapsed', tone: 'neutral' },
  },
  missing: {
    pending: { label: 'Counts this month', tone: 'warning' },
    used: { label: 'Charged as leave', tone: 'danger' },
    retired: { label: 'Cleared', tone: 'neutral' },
    lapsed: { label: 'Lapsed', tone: 'neutral' },
  },
  regularisation: {
    pending: { label: 'Waiting', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Not approved', tone: 'danger' },
    withdrawn: { label: 'Withdrawn', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
};

/**
 * Late marks, missing punches and corrections asked in a month (docs/design/85, phase C): each with its
 * status (counting, charged as leave, waived, lapsed); the office waives a late mark or clears a missing
 * punch still counting, with the reason.
 */
export default async function AttendanceExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.office.manage')) notFound();
  const kind: Kind = KINDS.some(([k]) => k === sp.kind) ? (sp.kind as Kind) : 'late';
  const size = pageSizeOf(sp.size ?? '25');
  const keep = new URLSearchParams({ kind });
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) keep.set('month', sp.month);
  if (sp.status && /^[a-z]{3,12}$/.test(sp.status)) keep.set('status', sp.status);
  const qs = new URLSearchParams(keep);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: AttendanceExceptions;
  try {
    d = await apiFetch<AttendanceExceptions>(`/staff-attendance/exceptions?${qs.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const month = d.month.slice(0, 7);
  const link = (page: number) => {
    const p = new URLSearchParams(keep);
    p.set('size', size);
    if (page > 1) p.set('page', String(page));
    return `/leave/attendance/exceptions?${p.toString()}`;
  };
  const here = link(d.page);
  const words = STATUS[kind];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Attendance register', href: `/leave/attendance?month=${month}` },
          { label: 'Late marks and missing punches' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={`Late marks and missing punches · ${d.monthWords}`}
        description="Late marks and missing punches count through the month; at the month's end every set of them (as the leave settings say) becomes a day of leave, and what is left lapses. Waive one the employee had a reason for; it then stops counting."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Which list">
        {KINDS.map(([k, label]) => (
          <a
            key={k}
            className="ep-tabs__tab"
            href={`/leave/attendance/exceptions?kind=${k}&month=${month}`}
            aria-current={kind === k ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        {Object.entries(words)
          .slice(0, 4)
          .map(([s, w]) => {
            const n = (d.counts[s] ?? 0) + (s === 'withdrawn' ? (d.counts.cancelled ?? 0) : 0);
            return (
              <a
                key={s}
                className="ep-tile-link"
                href={`/leave/attendance/exceptions?kind=${kind}&month=${month}&status=${s}`}
                aria-current={sp.status === s ? 'true' : undefined}
                aria-label={`${w.label}: ${String(n)}. Show the list`}
              >
                <KpiTile
                  label={s === 'withdrawn' ? 'Withdrawn or cancelled' : w.label}
                  value={String(n)}
                />
              </a>
            );
          })}
      </div>
      <form
        method="get"
        action="/leave/attendance/exceptions"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <input type="hidden" name="kind" value={kind} />
        <label className="ep-field" htmlFor="ae-month">
          <span className="ep-field__label">Month</span>
          <input
            id="ae-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={month}
          />
        </label>
        <label className="ep-field" htmlFor="ae-status">
          <span className="ep-field__label">Status</span>
          <select id="ae-status" name="status" className="ep-select" defaultValue={sp.status ?? ''}>
            <option value="">Any</option>
            {Object.entries(words).map(([s, w]) => (
              <option key={s} value={s}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <PerPage id="ae-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={KINDS.find(([k]) => k === kind)![1]}
      >
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Employee</th>
              <th scope="col">What</th>
              <th scope="col">Status</th>
              {kind === 'regularisation' ? null : <th scope="col">Waive or clear</th>}
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/leave/attendance/day?emp=${r.employee_id}&day=${r.day}`}>
                      {dmy(r.day)}
                    </a>
                  </td>
                  <td>
                    {r.employee}
                    <span className="ep-mr-col__desc">{r.code}</span>
                  </td>
                  <td>
                    {r.detail}
                    {r.note ? <span className="ep-mr-col__desc">{r.note}</span> : null}
                  </td>
                  <td>
                    <Badge tone={words[r.status]?.tone ?? 'neutral'}>
                      {words[r.status]?.label ?? r.status}
                    </Badge>
                    {r.leave ? <span className="ep-mr-col__desc">as leave {r.leave}</span> : null}
                  </td>
                  {kind === 'regularisation' ? null : (
                    <td>
                      {r.status === 'pending' ? (
                        <form
                          action={clearAttendanceMark.bind(null, kind, r.id)}
                          style={{
                            display: 'flex',
                            gap: 'var(--sp-2)',
                            alignItems: 'flex-end',
                            flexWrap: 'wrap',
                          }}
                        >
                          <input type="hidden" name="back" value={here} />
                          <label className="ep-field" htmlFor={`ae-why-${r.id}`}>
                            <span className="ep-field__label">Why</span>
                            <input
                              id={`ae-why-${r.id}`}
                              name="reason"
                              className="ep-input"
                              required
                              minLength={3}
                              maxLength={300}
                            />
                          </label>
                          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                            {kind === 'late' ? 'Waive' : 'Clear'}
                          </button>
                        </form>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={kind === 'regularisation' ? 4 : 5}>Nothing in {d.monthWords}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={d.page} size={d.size} total={d.total} href={link} noun="rows" />
    </>
  );
}
