import { Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import type { LeaveReportCatalogue, LeaveReportResult } from '@/lib/leave';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const ID = /^\d{1,18}$/;
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const STATUS: Record<string, string> = {
  approved: 'Approved',
  pending: 'Waiting',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
  all: 'Any status',
};

/**
 * Staff leave & attendance reports (docs/design/85, phase D): the school's earlier MIS — daily, monthly,
 * yearly, exceptions and leave — picked, filtered, read here (up to 3,000 rows) and saved as Excel or PDF
 * with the letterhead and the Prepared / Checked / Principal boxes. Every report with the reports right;
 * a report given to a person on its own.
 */
export default async function LeaveReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const cat = await apiFetch<LeaveReportCatalogue>('/leave-reports/catalogue');
  if (!cat.reports.length) notFound();
  const def = cat.reports.find((r) => r.code === sp.report) ?? cat.reports[0]!;
  const f: Record<string, string> = {};
  const has = (x: string) => def.filters.includes(x as never);
  if ((has('day') || has('asOn')) && sp.day && DAY.test(sp.day)) f.day = sp.day;
  if (has('period')) {
    if (sp.from && DAY.test(sp.from)) f.from = sp.from;
    if (sp.to && DAY.test(sp.to)) f.to = sp.to;
  }
  if (has('month') && sp.month && MONTH.test(sp.month)) f.month = sp.month;
  if (has('months')) {
    if (sp.fromMonth && MONTH.test(sp.fromMonth)) f.fromMonth = sp.fromMonth;
    if (sp.toMonth && MONTH.test(sp.toMonth)) f.toMonth = sp.toMonth;
  }
  if (has('department') && sp.department && cat.departments.includes(sp.department))
    f.department = sp.department;
  if (
    has('employeeType') &&
    sp.employeeType &&
    cat.employeeTypes.some((t) => t.code === sp.employeeType)
  )
    f.employeeType = sp.employeeType;
  if (has('employee') && sp.employeeId && ID.test(sp.employeeId)) f.employeeId = sp.employeeId;
  if (has('type') && sp.typeId && ID.test(sp.typeId)) f.typeId = sp.typeId;
  if (has('status') && sp.status && sp.status in STATUS) f.status = sp.status;
  // a figure over the table picked: only its rows (the API ignores a key the report has not)
  if (sp.pick && /^[a-z_]{1,20}$/.test(sp.pick)) f.pick = sp.pick;
  let data: LeaveReportResult | null = null;
  let error: string | null = null;
  try {
    data = await apiFetch<LeaveReportResult>(
      `/leave-reports/reports/${def.code}?${new URLSearchParams(f).toString()}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    if (e instanceof ApiError)
      error =
        typeof e.problem.detail === 'string' ? e.problem.detail : 'The report could not be made.';
    else throw e;
  }
  /** this report with these filters, a figure picked (or none: everyone) */
  const pickHref = (key: string | null) => {
    const q = new URLSearchParams({ report: def.code, ...f });
    q.delete('pick');
    if (key) q.set('pick', key);
    return `/leave/reports?${q.toString()}`;
  };
  const picked = data?.kpis?.find((k) => k.key && k.key === data?.pick) ?? null;
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/leave/report?${new URLSearchParams({ report: def.code, ...f, format }).toString()}`;
  const groups = [...new Set(cat.reports.map((r) => r.group))];
  const heads = new Set(data?.headings ?? []);
  const strong = new Set(data?.strong ?? []);
  const linkCol = data && ['#', 'S. no.'].includes(data.columns[0]?.label ?? '') ? 1 : 0;
  const grouped = data?.columns.some((c) => c.group);
  const groupRuns: Array<{ label: string; span: number }> = [];
  if (data && grouped)
    for (const c of data.columns) {
      const last = groupRuns.at(-1);
      if (last && c.group && last.label === c.group) last.span += 1;
      else groupRuns.push({ label: c.group ?? '', span: 1 });
    }
  const show = (c: LeaveReportResult['columns'][number], v: string | number | null) =>
    v === null || v === ''
      ? ''
      : c.type === 'date' && DAY.test(String(v))
        ? dmy(String(v))
        : String(v);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          cat.all
            ? { label: 'Leave & attendance dashboard', href: '/leave/dashboard' }
            : { label: 'My leave', href: '/leave' },
          { label: 'Leave & attendance reports' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={def.name}
        description={def.help}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
            {cat.manage ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/setup/report-access">
                Who may open the reports
              </a>
            ) : null}
          </div>
        }
      />
      <form
        method="get"
        action="/leave/reports"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <label className="ep-field" htmlFor="lr-r">
          <span className="ep-field__label">Report</span>
          <select id="lr-r" name="report" className="ep-select" defaultValue={def.code}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {cat.reports
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {has('day') || has('asOn') ? (
          <label className="ep-field" htmlFor="lr-day">
            <span className="ep-field__label">{has('asOn') ? 'As on' : 'Date'}</span>
            <input
              id="lr-day"
              name="day"
              type="date"
              className="ep-input"
              defaultValue={f.day ?? data?.filters.day ?? ''}
            />
          </label>
        ) : null}
        {has('period') ? (
          <>
            <label className="ep-field" htmlFor="lr-from">
              <span className="ep-field__label">From</span>
              <input
                id="lr-from"
                name="from"
                type="date"
                className="ep-input"
                defaultValue={f.from ?? data?.filters.from ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="lr-to">
              <span className="ep-field__label">To</span>
              <input
                id="lr-to"
                name="to"
                type="date"
                className="ep-input"
                defaultValue={f.to ?? data?.filters.to ?? ''}
              />
            </label>
          </>
        ) : null}
        {has('month') ? (
          <label className="ep-field" htmlFor="lr-month">
            <span className="ep-field__label">Month</span>
            <input
              id="lr-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={f.month ?? data?.filters.month.slice(0, 7) ?? ''}
            />
          </label>
        ) : null}
        {has('months') ? (
          <>
            <label className="ep-field" htmlFor="lr-fm">
              <span className="ep-field__label">From month</span>
              <input
                id="lr-fm"
                name="fromMonth"
                type="month"
                className="ep-input"
                defaultValue={f.fromMonth ?? data?.filters.fromMonth.slice(0, 7) ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="lr-tm">
              <span className="ep-field__label">To month</span>
              <input
                id="lr-tm"
                name="toMonth"
                type="month"
                className="ep-input"
                defaultValue={f.toMonth ?? data?.filters.toMonth.slice(0, 7) ?? ''}
              />
            </label>
          </>
        ) : null}
        {has('department') ? (
          <label className="ep-field" htmlFor="lr-d">
            <span className="ep-field__label">Department</span>
            <select
              id="lr-d"
              name="department"
              className="ep-select"
              defaultValue={f.department ?? ''}
            >
              <option value="">All</option>
              {cat.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has('employeeType') && cat.employeeTypes.length ? (
          <label className="ep-field" htmlFor="lr-et">
            <span className="ep-field__label">Employee type</span>
            <select
              id="lr-et"
              name="employeeType"
              className="ep-select"
              defaultValue={f.employeeType ?? ''}
            >
              <option value="">All</option>
              {cat.employeeTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has('employee') ? (
          <label className="ep-field" htmlFor="lr-e">
            <span className="ep-field__label">Employee</span>
            <select
              id="lr-e"
              name="employeeId"
              className="ep-select"
              defaultValue={f.employeeId ?? ''}
            >
              <option value="">All</option>
              {cat.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has('type') ? (
          <label className="ep-field" htmlFor="lr-t">
            <span className="ep-field__label">Leave type</span>
            <select id="lr-t" name="typeId" className="ep-select" defaultValue={f.typeId ?? ''}>
              <option value="">All</option>
              {cat.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} · {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has('status') ? (
          <label className="ep-field" htmlFor="lr-s">
            <span className="ep-field__label">Status</span>
            <select
              id="lr-s"
              name="status"
              className="ep-select"
              defaultValue={f.status ?? 'approved'}
            >
              {Object.entries(STATUS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
          Show
        </button>
      </form>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <p className="ep-field__help" role="status">
            {data.words} · {data.total} {data.total === 1 ? 'row' : 'rows'}.{' '}
            {picked ? (
              <a href={pickHref(null)}>Show everyone</a>
            ) : (
              <>Staff in the “Not required” list are left out unless picked.</>
            )}
          </p>
          {data.kpis ? (
            <ul
              className="ep-dash-kpis ep-kpipick"
              aria-label="Figures: pick one to list only its staff"
            >
              {data.kpis.map((k) => {
                const tile = <KpiTile label={k.label} value={String(k.value)} />;
                // a figure lists only its staff; clicked again (or Staff) lists everyone; a 0 has nobody
                const on = !!k.key && k.key === data.pick;
                const link = on || (k.key ? Number(k.value) > 0 : !!data.pick);
                return (
                  <li key={k.label}>
                    {link ? (
                      <a
                        className="ep-kpipick__card"
                        href={on || !k.key ? pickHref(null) : pickHref(k.key!)}
                        aria-current={on ? 'true' : undefined}
                        title={
                          on || !k.key ? 'Show everyone' : `List only: ${k.label.toLowerCase()}`
                        }
                      >
                        {tile}
                      </a>
                    ) : (
                      tile
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {data.more ? (
            <p className="ep-alert ep-alert--info" role="status">
              The first 3,000 rows are shown: the Excel and PDF have them all (up to 20,000).
            </p>
          ) : null}
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={def.name}>
            <table className="ep-table ep-table--dense">
              <thead>
                {grouped ? (
                  <tr>
                    {groupRuns.map((g, i) => (
                      <th key={i} scope="colgroup" colSpan={g.span} style={{ textAlign: 'center' }}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                ) : null}
                <tr>
                  {data.columns.map((c, i) => (
                    <th
                      key={i}
                      scope="col"
                      style={{
                        textAlign: c.type === 'number' ? 'right' : c.center ? 'center' : undefined,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length ? (
                  data.rows.map((r, i) =>
                    heads.has(i) ? (
                      <tr key={i}>
                        <th
                          scope="colgroup"
                          colSpan={data.columns.length}
                          style={{ background: 'var(--surface-subtle)' }}
                        >
                          {r.find((v) => v !== null && v !== '')}
                        </th>
                      </tr>
                    ) : (
                      <tr key={i} style={strong.has(i) ? { fontWeight: 600 } : undefined}>
                        {data.columns.map((c, j) => (
                          <td
                            key={j}
                            style={{
                              textAlign:
                                c.type === 'number' ? 'right' : c.center ? 'center' : undefined,
                              whiteSpace:
                                c.type === 'date' ||
                                c.center ||
                                c.label === 'Employee' ||
                                c.label === 'Emp. code'
                                  ? 'nowrap'
                                  : undefined,
                            }}
                          >
                            {j === linkCol && data.links?.[i] && r[j] !== '' ? (
                              <a href={data.links[i]!}>{show(c, r[j] ?? null)}</a>
                            ) : (
                              <Fragment>{show(c, r[j] ?? null)}</Fragment>
                            )}
                          </td>
                        ))}
                      </tr>
                    ),
                  )
                ) : (
                  <tr>
                    <td colSpan={data.columns.length}>Nothing in these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.note ? <p className="ep-field__help">{data.note}</p> : null}
        </>
      ) : null}
    </>
  );
}
