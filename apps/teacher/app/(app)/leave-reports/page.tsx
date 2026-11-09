import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { bff } from '@/lib/bff';

interface Catalogue {
  reports: Array<{ code: string; name: string; group: string; filters: string[]; help: string }>;
  departments: string[];
  employees: Array<{ id: string; name: string; code: string }>;
  types: Array<{ id: string; code: string; name: string }>;
}

/**
 * The leave & attendance reports given to me (docs/design/85, phase D), in the staff app: pick one, its
 * period and filters, and save it as Excel or PDF (the office's MIS, with the letterhead and signatures).
 */
export default async function LeaveReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const sp = await searchParams;
  const cat = await bff.api.fetch<Catalogue>('/leave-reports/catalogue');
  if (!cat.reports.length) notFound();
  const def = cat.reports.find((r) => r.code === sp.report) ?? cat.reports[0]!;
  const has = (f: string) => def.filters.includes(f);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <PageHeader
        kicker="Leave"
        title="Leave & attendance reports"
        description="The reports the leave office gave you, as Excel or PDF."
      />
      <Card>
        <form method="get" action="/leave-reports" className="ep-form-section__body">
          <label className="ep-field" htmlFor="lr-r">
            <span className="ep-field__label">Report</span>
            <select id="lr-r" name="report" className="ep-select" defaultValue={def.code}>
              {cat.reports.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Choose
          </button>
        </form>
      </Card>
      <Card>
        <h2 className="ep-card__title">{def.name}</h2>
        <p className="ep-field__help">{def.help}</p>
        <form method="get" action="/api/leave-report" className="ep-form-section__body">
          <input type="hidden" name="report" value={def.code} />
          {has('day') || has('asOn') ? (
            <label className="ep-field" htmlFor="lr-day">
              <span className="ep-field__label">{has('asOn') ? 'As on' : 'Date'}</span>
              <input id="lr-day" name="day" type="date" className="ep-input" defaultValue={today} />
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
                  defaultValue={`${today.slice(0, 7)}-01`}
                />
              </label>
              <label className="ep-field" htmlFor="lr-to">
                <span className="ep-field__label">To</span>
                <input id="lr-to" name="to" type="date" className="ep-input" defaultValue={today} />
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
                defaultValue={today.slice(0, 7)}
              />
            </label>
          ) : null}
          {has('months') ? (
            <>
              <label className="ep-field" htmlFor="lr-fm">
                <span className="ep-field__label">From month</span>
                <input id="lr-fm" name="fromMonth" type="month" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="lr-tm">
                <span className="ep-field__label">To month</span>
                <input
                  id="lr-tm"
                  name="toMonth"
                  type="month"
                  className="ep-input"
                  defaultValue={today.slice(0, 7)}
                />
              </label>
            </>
          ) : null}
          {has('department') ? (
            <label className="ep-field" htmlFor="lr-d">
              <span className="ep-field__label">Department</span>
              <select id="lr-d" name="department" className="ep-select" defaultValue="">
                <option value="">All</option>
                {cat.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {has('employee') ? (
            <label className="ep-field" htmlFor="lr-e">
              <span className="ep-field__label">Employee</span>
              <select id="lr-e" name="employeeId" className="ep-select" defaultValue="">
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
              <select id="lr-t" name="typeId" className="ep-select" defaultValue="">
                <option value="">All</option>
                {cat.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="submit"
              name="format"
              value="xlsx"
              className="ep-btn ep-btn--primary ep-btn--sm"
            >
              Excel
            </button>
            <button
              type="submit"
              name="format"
              value="pdf"
              className="ep-btn ep-btn--secondary ep-btn--sm"
            >
              PDF
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
