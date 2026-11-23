import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Reportees {
  all: boolean;
  reportees: Array<{ id: string; code: string; name: string; department: string | null }>;
}
interface PunchLog {
  mode: 'team' | 'employee' | 'department';
  words: string;
  figures: { n: number; people: number; days: number; waiting: number };
  rows: Array<{
    id: string;
    employee: { id: string; code: string; name: string };
    day: string;
    weekday: string;
    time: string;
    device: string | null;
    sourceWords: string;
    processed: boolean;
    marked: string | null;
  }>;
  total: number;
  page: number;
  size: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/**
 * My team in the staff app (docs/design/85): the staff who report to me — this month in figures (Month),
 * or their raw punches (Punches: all of them up to 31 days, or one person up to 92), as the machines and
 * uploads brought them in, with whether each was worked into the day and what the day was marked.
 */
export async function TeamPunches({ sp }: { sp: Record<string, string | undefined> }) {
  const tab = 'punches' as const;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const tabs = (
    <div className="ep-tabs">
      <div role="tablist" aria-label="My team" className="ep-tabs__list">
        <a role="tab" aria-selected={false} className="ep-tabs__tab" href="/my-team">
          Reporties Attendance
        </a>
        <a
          role="tab"
          aria-selected={tab === 'punches'}
          className="ep-tabs__tab"
          href="/my-team?tab=punches"
        >
          Punches
        </a>
      </div>
    </div>
  );

  {
    const from = sp.from && DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
    const to = sp.to && DAY.test(sp.to) ? sp.to : today;
    const who = sp.employeeId && ID.test(sp.employeeId) ? sp.employeeId : '';
    const page = Math.max(1, Number(sp.page) || 1);
    const mine = await bff.api.fetch<Reportees>('/staff-punches/team');
    let log: PunchLog | null = null;
    let error: string | null = null;
    if (mine.reportees.length)
      try {
        const q = new URLSearchParams({ from, to, size: '50', page: String(page) });
        if (who) q.set('employeeId', who);
        else q.set('team', '1');
        log = await bff.api.fetch<PunchLog>(`/staff-punches/log?${q.toString()}`);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        error = e.problem.detail ?? 'The punches could not be loaded.';
      }
    const pageHref = (p: number) => {
      const q = new URLSearchParams({ tab: 'punches', from, to });
      if (who) q.set('employeeId', who);
      if (p > 1) q.set('page', String(p));
      return `/my-team?${q.toString()}`;
    };
    const pages = log ? Math.max(1, Math.ceil(log.total / log.size)) : 1;
    return (
      <>
        <PageHeader
          kicker="Leave"
          title="My team’s punches"
          description="Every punch of the staff who report to you, as the machines and uploads brought them in."
        />
        {tabs}
        {!mine.reportees.length ? (
          <Card>
            <p>Nobody reports to you this year.</p>
          </Card>
        ) : (
          <>
            <form method="get" action="/my-team" className="ep-grid__toolbar">
              <input type="hidden" name="tab" value="punches" />
              <label className="ep-field" htmlFor="mp-who">
                <span className="ep-field__label">Who</span>
                <select id="mp-who" name="employeeId" className="ep-select" defaultValue={who}>
                  <option value="">All my team</option>
                  {mine.reportees.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="mp-from">
                <span className="ep-field__label">From</span>
                <input
                  id="mp-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={from}
                />
              </label>
              <label className="ep-field" htmlFor="mp-to">
                <span className="ep-field__label">To</span>
                <input id="mp-to" name="to" type="date" className="ep-input" defaultValue={to} />
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Show
              </button>
            </form>
            <p className="ep-field__help">
              All my team: up to 31 days at a time; one person: up to 92.
            </p>
            {error ? (
              <p className="ep-alert ep-alert--danger" role="alert">
                <span>{error}</span>
              </p>
            ) : null}
            {log ? (
              <>
                <p className="ep-field__help" role="status">
                  {log.words}: <strong>{log.figures.n}</strong> punches
                  {log.mode === 'team' ? ` by ${String(log.figures.people)} people` : ''} on{' '}
                  {log.figures.days} days
                  {log.figures.waiting
                    ? ` · ${String(log.figures.waiting)} not yet worked into their days`
                    : ''}
                  .
                </p>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Punches of my team"
                >
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Time</th>
                        {log.mode === 'team' ? <th scope="col">Who</th> : null}
                        <th scope="col">Device</th>
                        <th scope="col">Day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.rows.length ? (
                        log.rows.map((r) => (
                          <tr key={r.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {dmy(r.day)}
                              <span
                                className="ep-field__help"
                                style={{ display: 'block', margin: 0 }}
                              >
                                {r.weekday}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <strong>{r.time}</strong>
                              {!r.processed ? (
                                <span
                                  className="ep-field__help"
                                  style={{ display: 'block', margin: 0 }}
                                >
                                  waiting
                                </span>
                              ) : null}
                            </td>
                            {log.mode === 'team' ? (
                              <td>
                                {r.employee.name}
                                <span
                                  className="ep-field__help"
                                  style={{ display: 'block', margin: 0 }}
                                >
                                  {r.employee.code}
                                </span>
                              </td>
                            ) : null}
                            <td>
                              {r.device ?? '—'}
                              <span
                                className="ep-field__help"
                                style={{ display: 'block', margin: 0 }}
                              >
                                {r.sourceWords}
                              </span>
                            </td>
                            <td>{r.marked ?? '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={log.mode === 'team' ? 5 : 4}>No punches in these dates.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {pages > 1 ? (
                  <nav aria-label="Pages of punches" className="ep-grid__toolbar">
                    {log.page > 1 ? (
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={pageHref(log.page - 1)}
                      >
                        Previous
                      </a>
                    ) : null}
                    <span className="ep-field__help" style={{ margin: 0 }}>
                      Page {log.page} of {pages}
                    </span>
                    {log.page < pages ? (
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={pageHref(log.page + 1)}
                      >
                        Next
                      </a>
                    ) : null}
                  </nav>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </>
    );
  }
}
