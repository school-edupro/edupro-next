import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BarChart, LineChart } from '@/components/charts/Charts';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type DashStatus, type LeaveDashboard } from '@/lib/leave';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: Record<string, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
};
const SHOW: Array<{ key: DashStatus | 'late'; label: string }> = [
  { key: 'notin', label: 'Not in' },
  { key: 'in', label: 'In' },
  { key: 'leave', label: 'On leave' },
  { key: 'late', label: 'Late' },
  { key: 'off', label: 'Off' },
];
const STATUS: Record<
  DashStatus,
  { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' }
> = {
  in: { label: 'In', tone: 'success' },
  leave: { label: 'On leave', tone: 'info' },
  notin: { label: 'Not in', tone: 'danger' },
  off: { label: 'Off', tone: 'neutral' },
};
const KIND: Record<string, string> = {
  leave: 'Leave',
  cancellation: 'Cancellation',
  correction: 'Correction',
};
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const RIGHT = { textAlign: 'right' } as const;

/** A figure that opens what it counts. */
function Figure({
  label,
  value,
  of,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  of?: string;
  hint?: ReactNode;
  href: string;
  tone?: 'danger';
}) {
  return (
    <a className="ep-card ep-card--elevated ep-sdash__fig" href={href} data-tone={tone}>
      <span className="ep-kpi">
        <span className="ep-kpi__value">
          {value}
          {of ? <small> {of}</small> : null}
        </span>
        <span className="ep-kpi__label">{label}</span>
        {hint ? <span className="ep-sdash__hint">{hint}</span> : null}
      </span>
    </a>
  );
}

/**
 * The staff leave & attendance dashboard (docs/design/85; rebuilt 14 Nov 2026 after a benchmark of HR and school
 * systems — Keka's today's attendance with drill-down, greytHR's who-is-in and leave calendar, the school ERPs'
 * substitution on absence). A day, a department and a staff type; six figures that open their lists; the day at a
 * glance; what needs attention and where to act; who is out that day and the next seven days with the periods to
 * cover; the people by status; departments by presence, lowest first; what waits longest; then two small charts.
 */
export default async function LeaveDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (
    !me.permissions.includes('leave.report.view') &&
    !me.permissions.includes('leave.office.manage')
  )
    notFound();
  const keep = new URLSearchParams();
  if (sp.day && DAY.test(sp.day)) keep.set('day', sp.day);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.type && sp.type in TYPES) keep.set('type', sp.type);
  let d: LeaveDashboard;
  try {
    d = await apiFetch<LeaveDashboard>(`/leave-reports/dashboard?${keep.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const show = SHOW.find((x) => x.key === sp.show)?.key ?? 'notin';
  const out = sp.out === 'week' ? 'week' : 'day';
  /** this page with the filters kept and the given changes */
  const href = (change: Record<string, string>, anchor = '') => {
    const u = new URLSearchParams(keep);
    if (sp.show && change.show === undefined) u.set('show', show);
    if (sp.out && change.out === undefined) u.set('out', out);
    for (const [k, v] of Object.entries(change)) u.set(k, v);
    return `/leave/dashboard?${u.toString()}${anchor}`;
  };
  const f = d.figures;
  const att = f.attendance;
  const delta =
    att.month !== null && att.lastMonth !== null
      ? Math.round((att.month - att.lastMonth) * 10) / 10
      : null;
  const presence = f.due ? Math.round((f.in / f.due) * 1000) / 10 : null;
  const notInLabel = d.isToday ? 'Not in yet' : 'Not in';
  const shown = d.people.filter((p) => (show === 'late' ? p.late > 0 : p.status === show));
  const counts: Record<string, number> = {
    notin: f.notIn,
    in: f.in,
    leave: d.glance.leave,
    late: f.late,
    off: f.off,
  };
  const away = d.people.filter((p) => p.leave);
  const total = d.people.length || 1;
  const glanceParts: Array<{ key: DashStatus; label: string; n: number }> = [
    { key: 'in', label: 'In', n: d.glance.in },
    { key: 'leave', label: 'On leave', n: d.glance.leave },
    { key: 'notin', label: notInLabel, n: d.glance.notIn },
    { key: 'off', label: 'Weekly off or holiday', n: d.glance.off },
  ];
  const filtered = !!(d.filters.department || d.filters.type);
  const dom = (s: string) => s.slice(8, 10);
  const days = [
    ...new Set([
      ...d.trend.lastMonth.map((x) => dom(x.day)),
      ...d.trend.thisMonth.map((x) => dom(x.day)),
    ]),
  ].sort();
  const at = (xs: Array<{ day: string; percent: number | null }>, k: string) =>
    xs.find((x) => dom(x.day) === k)?.percent ?? null;

  return (
    <div className="ep-dash-compact">
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance dashboard' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave & attendance dashboard"
        description={`${d.dayWords}${d.isToday ? ' (today)' : ''} · ${plural(f.staff, 'member')} of staff${
          filtered ? ' in the filter' : ''
        }. Staff in the "Not required" list are left out.`}
        actions={
          <>
            {d.can.office ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/attendance">
                Attendance register
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/reports">
              Reports
            </a>
          </>
        }
      />

      <form className="ep-filter-band" method="get" aria-label="Day and filters">
        <label className="ep-field" htmlFor="sd-day">
          <span className="ep-field__label">Day</span>
          <input
            id="sd-day"
            name="day"
            type="date"
            className="ep-input"
            defaultValue={d.day}
            max={d.today}
          />
        </label>
        <label className="ep-field" htmlFor="sd-dept">
          <span className="ep-field__label">Department</span>
          <select
            id="sd-dept"
            name="department"
            className="ep-select"
            defaultValue={d.filters.department ?? ''}
          >
            <option value="">All departments</option>
            {d.options.departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="sd-type">
          <span className="ep-field__label">Staff type</span>
          <select
            id="sd-type"
            name="type"
            className="ep-select"
            defaultValue={d.filters.type ?? ''}
          >
            <option value="">All staff</option>
            {d.options.types.map((x) => (
              <option key={x} value={x}>
                {TYPES[x] ?? x}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ep-btn ep-btn--primary">
          Show
        </button>
        {!d.isToday || filtered ? (
          <a className="ep-btn ep-btn--secondary" href="/leave/dashboard">
            Today, everyone
          </a>
        ) : null}
      </form>

      <div className="ep-dash-kpis">
        <Figure
          label={d.isToday ? 'In today' : 'In'}
          value={String(f.in)}
          of={`of ${String(f.due)}`}
          hint={presence === null ? 'nobody due in' : `${String(presence)}% of those due in`}
          href={href({ show: 'in' }, '#people')}
        />
        <Figure
          label="On leave"
          value={String(f.onLeave)}
          hint={
            d.cover.due
              ? `${plural(d.cover.due, 'period')} to cover, ${String(d.cover.covered)} covered`
              : 'approved leave'
          }
          href={href({ show: 'leave' }, '#people')}
        />
        <Figure
          label={notInLabel}
          value={String(f.notIn)}
          hint="a working day: no punch, no leave"
          href={href({ show: 'notin' }, '#people')}
          tone={f.notIn ? 'danger' : undefined}
        />
        <Figure
          label="Late"
          value={String(f.late)}
          hint={d.isToday ? 'so far today' : 'that day'}
          href={href({ show: 'late' }, '#people')}
        />
        <Figure
          label="Waiting for approval"
          value={String(f.waiting)}
          hint={
            f.oldestDays === null
              ? 'nothing waits'
              : `the oldest waits ${plural(f.oldestDays, 'day')}`
          }
          href="#attention"
          tone={(f.oldestDays ?? 0) >= 3 ? 'danger' : undefined}
        />
        <Figure
          label={`Attendance · ${d.monthWords}`}
          value={att.month === null ? '—' : `${String(att.month)}%`}
          hint={
            att.month === null
              ? 'no day of the month is over yet'
              : delta === null
                ? `to ${dmy(att.to ?? d.day)}`
                : `${delta >= 0 ? '▲' : '▼'} ${String(Math.abs(delta))} points on ${d.lastMonthWords}’s same days`
          }
          href="#trend"
        />
      </div>

      <section className="ep-sdash__glance" aria-labelledby="sd-glance">
        <h2 id="sd-glance" className="ep-sr-only">
          The day at a glance
        </h2>
        <div
          className="ep-sdash__bar"
          role="img"
          aria-label={glanceParts.map((p) => `${p.label} ${String(p.n)}`).join(', ')}
        >
          {glanceParts.map((p) =>
            p.n ? (
              <span
                key={p.key}
                data-s={p.key}
                style={{ width: `${String((p.n / total) * 100)}%` }}
              />
            ) : null,
          )}
        </div>
        <ul className="ep-sdash__legend">
          {glanceParts.map((p) => (
            <li key={p.key}>
              <a href={href({ show: p.key }, '#people')}>
                <span className="ep-sdash__sw" data-s={p.key} aria-hidden="true" />
                {p.label} <strong>{p.n}</strong>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="ep-sdash__two">
        <Card title="Needs attention" id="attention">
          {d.attention.length ? (
            <ul className="ep-sdash__attn">
              {d.attention.map((a) => (
                <li key={a.key} data-tone={a.tone}>
                  <span className="ep-sdash__n">{a.key === 'lock' ? '!' : a.count}</span>
                  <span className="ep-sdash__what">
                    {a.label}
                    {a.detail ? <span>{a.detail}</span> : null}
                  </span>
                  {a.href ? (
                    <a className="ep-btn ep-btn--ghost ep-btn--sm" href={a.href}>
                      Open<span className="ep-sr-only">: {a.label}</span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nothing needs attention.</p>
          )}
        </Card>

        <Card title="Who's out" id="out">
          <nav className="ep-tabs-links ep-sdash__tabs" aria-label="Who's out: the day or the week">
            <a
              href={href({ out: 'day' }, '#out')}
              aria-current={out === 'day' ? 'page' : undefined}
            >
              {d.isToday ? 'Today' : dmy(d.day)} ({away.length})
            </a>
            <a
              href={href({ out: 'week' }, '#out')}
              aria-current={out === 'week' ? 'page' : undefined}
            >
              Next 7 days ({d.nextDays.reduce((n, x) => n + x.people.length, 0)})
            </a>
          </nav>
          <div className="ep-sdash__scroll">
            {out === 'day' ? (
              away.length ? (
                <ul className="ep-sdash__out">
                  {away.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong> <span className="ep-field__help">{p.code}</span>
                      {p.leave?.requestId ? (
                        <a href={`/leave/requests/${p.leave.requestId}`}>
                          <Badge tone="info">
                            {p.leave.type}
                            {p.leave.half ? ' ½' : ''}
                          </Badge>
                        </a>
                      ) : (
                        <Badge tone="info">{p.leave?.type ?? 'Leave'}</Badge>
                      )}
                      {p.periods && p.periods.covered < p.periods.due ? (
                        <Badge tone="danger">
                          {plural(p.periods.due - p.periods.covered, 'period')} to cover
                        </Badge>
                      ) : null}
                      <span className="ep-sdash__hint">
                        {p.department}
                        {p.leave?.half && p.leave.session ? ` · ${p.leave.session} half` : ''}
                        {p.periods
                          ? ` · ${String(p.periods.covered)} of ${plural(p.periods.due, 'period')} covered`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">Nobody is on leave{d.isToday ? ' today' : ''}.</p>
              )
            ) : (
              d.nextDays.map((x) => (
                <div key={x.day}>
                  <h4 className="ep-sdash__daywords">
                    {x.words} · {x.people.length}
                  </h4>
                  {x.people.length ? (
                    <ul className="ep-sdash__out">
                      {x.people.map((p) => (
                        <li key={`${x.day}-${p.id}-${p.requestId}`}>
                          <strong>{p.name}</strong> <span className="ep-field__help">{p.code}</span>
                          <a href={`/leave/requests/${p.requestId}`}>
                            <Badge tone={p.waiting ? 'warning' : 'info'}>
                              {p.type}
                              {p.half ? ' ½' : ''}
                              {p.waiting ? ' · waiting' : ''}
                            </Badge>
                          </a>
                          <span className="ep-sdash__hint">{p.department}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ep-field__help">Nobody.</p>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card title={`People · ${d.isToday ? 'today' : dmy(d.day)}`} id="people">
        <nav className="ep-tabs-links ep-sdash__tabs" aria-label="People by status">
          {SHOW.map((x) => (
            <a
              key={x.key}
              href={href({ show: x.key }, '#people')}
              aria-current={show === x.key ? 'page' : undefined}
            >
              {x.key === 'notin' ? notInLabel : x.label} ({counts[x.key] ?? 0})
            </a>
          ))}
        </nav>
        {shown.length ? (
          <div
            className="ep-table-wrap ep-sdash__scroll"
            tabIndex={0}
            role="region"
            aria-labelledby="sd-people-cap"
          >
            <table className="ep-table ep-table--dense">
              <caption id="sd-people-cap" className="ep-sr-only">
                People: {SHOW.find((x) => x.key === show)?.label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Department</th>
                  <th scope="col" className="ep-sdash__opt">
                    Staff type
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">In at</th>
                  <th scope="col" className="ep-sdash__opt">
                    Late
                  </th>
                  <th scope="col" className="ep-sdash__opt">
                    Leave
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <a href={`/leave/attendance/day?emp=${p.id}&day=${d.day}`}>{p.name}</a>{' '}
                      <span className="ep-field__help">{p.code}</span>
                    </th>
                    <td>{p.department}</td>
                    <td className="ep-sdash__opt">{TYPES[p.staffType] ?? p.staffType}</td>
                    <td>
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    </td>
                    <td>{p.inAt ?? '—'}</td>
                    <td className="ep-sdash__opt">{p.late ? `${String(p.late)} min` : '—'}</td>
                    <td className="ep-sdash__opt">
                      {p.leave ? `${p.leave.type}${p.leave.half ? ' ½' : ''}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">
            {show === 'notin'
              ? `Everyone due is in or accounted for${d.isToday ? ' so far' : ''}.`
              : 'Nobody.'}
          </p>
        )}
      </Card>

      <Card title="Departments · lowest presence first">
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="sd-dept-cap">
          <table className="ep-table ep-table--dense">
            <caption id="sd-dept-cap" className="ep-sr-only">
              Departments by presence, lowest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Presence</th>
                <th scope="col" className="ep-sdash__opt" style={RIGHT}>
                  Staff
                </th>
                <th scope="col" className="ep-sdash__opt" style={RIGHT}>
                  In
                </th>
                <th scope="col" style={RIGHT}>
                  On leave
                </th>
                <th scope="col" style={RIGHT}>
                  {notInLabel}
                </th>
                <th scope="col" className="ep-sdash__opt" style={RIGHT}>
                  Late
                </th>
                <th scope="col" className="ep-sdash__opt" style={RIGHT}>
                  Off
                </th>
              </tr>
            </thead>
            <tbody>
              {d.departments.length ? (
                d.departments.map((r) => {
                  const u = new URLSearchParams(keep);
                  u.set('department', r.department);
                  return (
                    <tr key={r.department}>
                      <th scope="row">
                        <a href={`/leave/dashboard?${u.toString()}`}>{r.department}</a>
                      </th>
                      <td>
                        {r.presence === null ? (
                          <span className="ep-field__help">nobody due</span>
                        ) : (
                          <span className="ep-meter">
                            <span
                              className="ep-meter__bar"
                              data-full={r.presence >= 100 ? 'true' : undefined}
                            >
                              <span style={{ width: `${String(Math.min(100, r.presence))}%` }} />
                            </span>
                            <span className="ep-meter__text">
                              {r.presence}% · {r.in} of {r.due}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="ep-sdash__opt" style={RIGHT}>
                        {r.staff}
                      </td>
                      <td className="ep-sdash__opt" style={RIGHT}>
                        {r.in}
                      </td>
                      <td style={RIGHT}>{r.leave}</td>
                      <td style={RIGHT}>{r.notIn}</td>
                      <td className="ep-sdash__opt" style={RIGHT}>
                        {r.late}
                      </td>
                      <td className="ep-sdash__opt" style={RIGHT}>
                        {r.off}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8}>No staff in the filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Waiting longest">
        {d.waiting.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="sd-wait-cap">
            <table className="ep-table ep-table--dense">
              <caption id="sd-wait-cap" className="ep-sr-only">
                What waits longest for a decision
              </caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Employee</th>
                  <th scope="col" className="ep-sdash__opt">
                    Department
                  </th>
                  <th scope="col">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {d.waiting.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>
                      <Badge tone="neutral">{KIND[r.kind] ?? r.kind}</Badge>{' '}
                      <a href={r.href}>{r.label}</a>
                    </td>
                    <td>
                      {r.name} <span className="ep-field__help">{r.code}</span>
                    </td>
                    <td className="ep-sdash__opt">{r.department}</td>
                    <td>
                      {r.days >= 3 ? (
                        <Badge tone="danger">{plural(r.days, 'day')}</Badge>
                      ) : (
                        plural(r.days, 'day')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">Nothing waits.</p>
        )}
      </Card>

      <div className="ep-chart__grid2" id="trend">
        <Card title={`Attendance by day · ${d.monthWords} and ${d.lastMonthWords}`}>
          {days.length ? (
            <LineChart
              title={`Attendance % by day of the month, ${d.monthWords} against ${d.lastMonthWords}`}
              labels={days}
              max={100}
              suffix="%"
              series={[
                {
                  label: d.monthWords,
                  tone: 'navy',
                  values: days.map((k) => at(d.trend.thisMonth, k)),
                },
                {
                  label: d.lastMonthWords,
                  tone: 'muted',
                  values: days.map((k) => at(d.trend.lastMonth, k)),
                },
              ]}
            />
          ) : (
            <p className="ep-field__help">No working day worked out in these months yet.</p>
          )}
        </Card>
        <Card title="Leave taken this year by type">
          {d.byType.length ? (
            <BarChart
              title={`Approved leave days from ${dmy(d.fyFrom)} by type`}
              series={[{ label: 'Days', tone: 'cyan' }]}
              data={d.byType.map((x) => ({ label: x.code, values: [x.days] }))}
              valueLabel={(v) => String(v[0])}
            />
          ) : (
            <p className="ep-field__help">No leave taken this year yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
