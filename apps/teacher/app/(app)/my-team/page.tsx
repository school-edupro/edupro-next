import { Card, PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';

interface Team {
  month: string;
  monthWords: string;
  team?: number;
  types: string[];
  rows: Array<{
    employee: { id: string; name: string; code: string; department: string | null };
    cells: Array<{ day: string; code: string; late?: boolean; missing?: boolean }>;
    totals: Record<string, number>;
  }>;
}

/** My team's attendance in the staff app (docs/design/85): each person who reports to me, this month in figures. */
export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : '';
  const d = await bff.api.fetch<Team>(
    `/staff-attendance/team?size=100${month ? `&month=${month}` : ''}`,
  );
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <PageHeader
        kicker="Leave"
        title={`My team’s attendance · ${d.monthWords}`}
        description="The staff who report to you. Open a person to see their days."
      />
      <form method="get" action="/my-team" className="ep-grid__toolbar">
        <label className="ep-field" htmlFor="mt-month">
          <span className="ep-field__label">Month</span>
          <input
            id="mt-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={d.month.slice(0, 7)}
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      {!d.team ? (
        <Card>
          <p>Nobody reports to you this year.</p>
        </Card>
      ) : (
        d.rows.map((r) => {
          const now = r.cells.find((c) => c.day === today);
          const leave = d.types.reduce((n, t) => n + (r.totals[t] ?? 0), 0);
          return (
            <Card key={r.employee.id}>
              <p style={{ margin: 0 }}>
                <a href={`/my-team/${r.employee.id}${month ? `?month=${month}` : ''}`}>
                  <strong>{r.employee.name}</strong>
                </a>{' '}
                <span className="ep-field__help">
                  {r.employee.code}
                  {now?.code ? ` · today ${now.code}` : ''}
                </span>
              </p>
              <p className="ep-field__help" style={{ margin: 0 }}>
                Present {r.totals.P ?? 0} · Half day {r.totals.HD ?? 0} · Absent {r.totals.A ?? 0} ·
                Leave {leave} · Late {r.totals.late ?? 0} · Punch missing {r.totals.missing ?? 0}
              </p>
            </Card>
          );
        })
      )}
    </>
  );
}
