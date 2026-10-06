import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { BusRegisterTable, type BusRegister } from '@/components/BusRegisterTable';
import { bff } from '@/lib/bff';

interface MyRoute {
  routeId: string;
  code: string;
  name: string;
}
const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);

/**
 * The bus register for the teacher: choose a route mapped to you and the month; the morning and the
 * afternoon trip show side by side, and the same comes as Excel or PDF with the school's header.
 */
export default async function BusRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ route?: string; month?: string }>;
}) {
  const sp = await searchParams;
  let routes: MyRoute[] = [];
  try {
    const all = (await bff.api.fetch<{ data: MyRoute[] }>('/attendance/bus-roll/routes')).data;
    routes = all.filter((r, i) => all.findIndex((x) => x.routeId === r.routeId) === i);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const route = routes.find((r) => r.routeId === sp.route) ?? routes[0] ?? null;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : thisMonth();
  let reg: BusRegister | null = null;
  let loadError: string | null = null;
  if (route)
    try {
      reg = await bff.api.fetch<BusRegister>(
        `/attendance/bus-roll/register?routeId=${route.routeId}&trip=both&month=${month}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = error.problem.detail ?? error.problem.type;
      else throw error;
    }
  const file = (format: string) =>
    `/api/register?route=${route?.routeId ?? ''}&trip=both&month=${month}&format=${format}`;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        kicker="Bus attendance"
        title="Bus register"
        description="The month's register of a route, morning and afternoon together."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/bus-attendance">
            Mark attendance
          </a>
        }
      />
      {routes.length === 0 ? (
        <Card>No route is mapped to you for bus attendance.</Card>
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--sp-3)' }}>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <label className="ep-field" style={{ minWidth: 240 }}>
                <span className="ep-field__label">Route</span>
                <select className="ep-select" name="route" defaultValue={route?.routeId ?? ''}>
                  {routes.map((r) => (
                    <option key={r.routeId} value={r.routeId}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Month</span>
                <input
                  className="ep-input"
                  type="month"
                  name="month"
                  defaultValue={month}
                  max={thisMonth()}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                Show
              </button>
              {reg ? (
                <>
                  <a className="ep-btn ep-btn--secondary" href={file('xlsx')}>
                    Excel
                  </a>
                  <a className="ep-btn ep-btn--secondary" href={file('pdf')}>
                    PDF
                  </a>
                </>
              ) : null}
            </form>
          </Card>
          {loadError ? (
            <div className="ep-alert ep-alert--danger" role="alert">
              {loadError}
            </div>
          ) : reg ? (
            <Card
              title={`${reg.route} · ${new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}
            >
              {reg.days.length === 0 ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  No bus attendance is marked on this route in this month yet.
                </p>
              ) : (
                <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Bus register">
                  <BusRegisterTable reg={reg} />
                </div>
              )}
              <p className="ep-field__help">
                M morning (pick) · A afternoon (drop) · P on the bus · A not on the bus · LV leave ·
                GP gate pass · OT other arrangement · – not marked · blank: does not ride that trip
              </p>
            </Card>
          ) : null}
        </>
      )}
    </main>
  );
}
