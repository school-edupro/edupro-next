import { Alert, Badge, Card, PageHeader } from '@edupro/ui';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { dayLabel as dateLabel, monthLabel, rupees, type Replacement } from '@/lib/transport-desk';

interface Dashboard {
  kpis: {
    riders: number;
    pickOnly: number;
    dropOnly: number;
    both: number;
    pending: number;
    routes: number;
    vehicles: number;
    seats: number;
    billed: number;
    upcoming: number;
    ending: number;
  };
  routes: Array<{
    id: string;
    code: string;
    name: string;
    vehicle: string | null;
    driver: string | null;
    seats: number | null;
    stops: number;
    pick: number;
    drop: number;
  }>;
  months: Array<{
    key: string;
    joins: number;
    changes: number;
    leaves: number;
    riders: number;
    billed: number;
  }>;
  days: Array<{ key: string; parent: number; office: number }>;
  pending: Array<{ label: string; source: string; waiting: number; oldestHours: number }>;
  stops: Array<{ name: string; route: string; count: number }>;
  slabs: Array<{ name: string; count: number; amount: number }>;
  classes: Array<{ name: string; count: number }>;
  fleet: Array<{ name: string; what: string; on: string }>;
}
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
const shortMonth = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const waited = (h: number) =>
  h >= 48 ? `${String(Math.round(h / 24))} days` : `${String(Math.round(h))} h`;

/** Stacked bars: each point has up to three parts, coloured by `tones`. */
function Chart({
  points,
  tones,
  names,
  months,
  name,
}: {
  points: Array<{ key: string; label: string; parts: number[] }>;
  tones: string[];
  names: string[];
  months: boolean;
  name: string;
}) {
  const total = (p: { parts: number[] }) => p.parts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...points.map(total));
  const every = months ? 1 : Math.ceil(points.length / 16);
  return (
    <div
      className={months ? 'ep-cdash__chart ep-cdash__chart--months' : 'ep-cdash__chart'}
      role="img"
      aria-label={`${name}: ${points.map((p) => `${p.label} ${String(total(p))}`).join(', ')}`}
    >
      {points.map((p, i) => {
        const t = total(p);
        return (
          <div
            key={p.key}
            className="ep-cdash__day"
            title={`${p.label}: ${p.parts.map((n, k) => `${names[k]!} ${String(n)}`).join(', ')}`}
          >
            {months || t ? <span className="ep-cdash__mval">{t}</span> : null}
            <div
              className="ep-cdash__stack"
              style={{ height: `${String(t ? Math.max(3, (100 * t) / max) : 0)}%` }}
            >
              {p.parts.map((n, k) =>
                n ? <span key={tones[k]} data-fo={tones[k]} style={{ flexGrow: n }} /> : null,
              )}
            </div>
            <span className="ep-cdash__dlabel">{i % every === 0 ? p.label : ' '}</span>
          </div>
        );
      })}
    </div>
  );
}
const Legend = ({ tones, names }: { tones: string[]; names: string[] }) => (
  <div className="ep-cdash__legend">
    {names.map((n, k) => (
      <span key={n}>
        <i data-fo={tones[k]} aria-hidden="true" /> {n}
      </span>
    ))}
  </div>
);
function Ranked({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ name: string; count: number; help?: string }>;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          {empty}
        </p>
      ) : (
        <ul className="ep-cdash__list">
          {rows.map((r) => (
            <li key={`${r.name}-${r.help ?? ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                <span>
                  {r.name}
                  {r.help ? <span className="ep-field__help"> · {r.help}</span> : null}
                </span>
                <strong>
                  {r.count} <span className="ep-sr-only">students</span>
                </strong>
              </div>
              <div className="ep-clinic__bar" aria-hidden="true">
                <span style={{ width: `${String(Math.max(3, (100 * r.count) / max))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const MOVES = ['appointments', 'pupil', 'visitors'];
const MOVE_NAMES = ['New transport', 'Changes', 'Withdrawals'];
const ASKED = ['pupil', 'staff'];
const ASKED_NAMES = ['Family (portal)', 'Transport office'];

/**
 * The transport dashboard: who rides now and how, what waits for approval and with whom, the last six
 * months (joins, changes, withdrawals, riders and the amount billed), requests day by day, how full each
 * route is, the busiest stoppages, slabs and classes, and the vehicle and driver papers running out.
 */
export default async function TransportDashboardPage() {
  const [me, d, replaced] = await Promise.all([
    getMe(),
    apiFetch<Dashboard>('/transport/desk/dashboard'),
    apiFetch<{ data: Replacement[] }>('/transport/replacements?tab=now')
      .then((r) => r.data)
      .catch(() => [] as Replacement[]),
  ]);
  const k = d.kpis;
  const full = k.seats ? Math.round((100 * k.riders) / k.seats) : null;
  const kpis: Array<[string, string, string, string]> = [
    [
      'Riding now',
      k.riders.toLocaleString('en-IN'),
      `${String(k.both)} pick and drop · ${String(k.pickOnly)} pick only · ${String(k.dropOnly)} drop only`,
      '/transport/history',
    ],
    [
      'Waiting for approval',
      k.pending.toLocaleString('en-IN'),
      'requests not yet decided',
      '/transport/requests?tab=pending',
    ],
    [
      'Seats used',
      full === null ? '—' : `${String(full)}%`,
      `${k.riders.toLocaleString('en-IN')} riders on ${k.seats.toLocaleString('en-IN')} seats · ${String(k.routes)} routes`,
      '/masters/transport?tab=transport_routes',
    ],
    [
      'Billed this month',
      rupees(k.billed),
      'transport fee of the pupils riding this month',
      '/transport/history',
    ],
    [
      'To start',
      k.upcoming.toLocaleString('en-IN'),
      'approved, starting in a later month',
      '/transport/history?when=upcoming',
    ],
    [
      'Ending this month',
      k.ending.toLocaleString('en-IN'),
      'withdrawals and changes taking effect next month',
      '/transport/history',
    ],
  ];
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Transport dashboard"
        description="Riders, requests and approvals, routes and seats, and the fleet’s papers."
        actions={
          me.permissions.includes('transport.request.apply') ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/transport/requests/new">
              Apply for a student
            </a>
          ) : null
        }
      />
      <TransportNav current="/transport" permissions={me.permissions} />
      {replaced.length ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="warning">
            Replacement bus today:{' '}
            {replaced
              .map(
                (x) =>
                  `${x.vehicle} → ${x.replacement}${x.routes ? ` (route ${x.routes})` : ''} till ${dateLabel(x.toDate)}`,
              )
              .join('; ')}
            .{' '}
            <a href="/transport/replacements" style={{ textDecoration: 'underline' }}>
              Open
            </a>
          </Alert>
        </div>
      ) : null}
      <div className="ep-cdash__kpis">
        {kpis.map(([title, n, help, href]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href} aria-label={`${title}: ${n}`}>
                {n}
              </a>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <Card title="Waiting for approval, by level" style={{ marginTop: 'var(--sp-4)' }}>
        {d.pending.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing waits for approval.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Pending by level">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Requests waiting, by approval level</caption>
              <thead>
                <tr>
                  <th scope="col">Waiting with</th>
                  <th scope="col">Request made by</th>
                  <th scope="col" className="ep-num">
                    Requests
                  </th>
                  <th scope="col">Oldest waits</th>
                </tr>
              </thead>
              <tbody>
                {d.pending.map((p) => (
                  <tr key={`${p.label}-${p.source}`}>
                    <th scope="row">{p.label}</th>
                    <td>{p.source === 'office' ? 'Transport office' : 'Family (portal)'}</td>
                    <td className="ep-num">
                      <a href="/transport/requests?tab=pending">{p.waiting}</a>
                    </td>
                    <td>
                      {waited(p.oldestHours)}{' '}
                      {p.oldestHours >= 48 ? <Badge tone="danger">Late</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card
        title={`Last six months (${shortMonth(d.months[0]!.key)} – ${shortMonth(d.months[d.months.length - 1]!.key)})`}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <div className="ep-cdash__six">
          <div>
            <Chart
              points={d.months.map((m) => ({
                key: m.key,
                label: shortMonth(m.key),
                parts: [m.joins, m.changes, m.leaves],
              }))}
              tones={MOVES}
              names={MOVE_NAMES}
              months
              name="Approved requests per month"
            />
            <Legend tones={MOVES} names={MOVE_NAMES} />
          </div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Month by month">
            <table className="ep-table ep-table--dense ep-cdash__mtable">
              <caption className="ep-sr-only">Transport month by month, latest first</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="ep-num">
                    New
                  </th>
                  <th scope="col" className="ep-num">
                    Changes
                  </th>
                  <th scope="col" className="ep-num">
                    Withdrawals
                  </th>
                  <th scope="col" className="ep-num">
                    Riders
                  </th>
                  <th scope="col" className="ep-num">
                    Billed
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...d.months].reverse().map((m) => (
                  <tr key={m.key}>
                    <th scope="row">{monthLabel(m.key)}</th>
                    <td className="ep-num">{m.joins}</td>
                    <td className="ep-num">{m.changes}</td>
                    <td className="ep-num">{m.leaves}</td>
                    <td className="ep-num">
                      <a href={`/transport/history?month=${m.key}`}>{m.riders}</a>
                    </td>
                    <td className="ep-num">{rupees(m.billed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="ep-field__help">
          Riders and the amount billed count the pupils with an approved transport period in that
          month.
        </p>
      </Card>
      <Card title="Requests day by day (last 30 days)" style={{ marginTop: 'var(--sp-4)' }}>
        <Chart
          points={d.days.map((x) => ({
            key: x.key,
            label: dayLabel(x.key),
            parts: [x.parent, x.office],
          }))}
          tones={ASKED}
          names={ASKED_NAMES}
          months={false}
          name="Requests per day"
        />
        <Legend tones={ASKED} names={ASKED_NAMES} />
      </Card>
      <Card title="Routes and seats" style={{ marginTop: 'var(--sp-4)' }}>
        {d.routes.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No route is set up yet.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Routes and seats">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">How full each route is</caption>
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Vehicle and driver</th>
                  <th scope="col" className="ep-num">
                    Stoppages
                  </th>
                  <th scope="col" className="ep-num">
                    Pick
                  </th>
                  <th scope="col" className="ep-num">
                    Drop
                  </th>
                  <th scope="col" className="ep-num">
                    Seats
                  </th>
                  <th scope="col">Full</th>
                </tr>
              </thead>
              <tbody>
                {d.routes.map((r) => {
                  const most = Math.max(r.pick, r.drop);
                  const pct = r.seats ? Math.round((100 * most) / r.seats) : null;
                  return (
                    <tr key={r.id}>
                      <th scope="row">
                        <a href={`/transport/routes/${r.id}`}>
                          {r.code} · {r.name}
                        </a>
                      </th>
                      <td>{[r.vehicle, r.driver].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="ep-num">{r.stops}</td>
                      <td className="ep-num">{r.pick}</td>
                      <td className="ep-num">{r.drop}</td>
                      <td className="ep-num">{r.seats ?? '—'}</td>
                      <td>
                        {pct === null ? (
                          '—'
                        ) : (
                          <>
                            {pct}%{' '}
                            {pct > 100 ? (
                              <Badge tone="danger">Over</Badge>
                            ) : pct >= 90 ? (
                              <Badge tone="warning">Nearly full</Badge>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="ep-cdash__two">
        <Ranked
          title="Busiest stoppages"
          rows={d.stops.map((s) => ({ name: s.name, count: s.count, help: s.route }))}
          empty="No pupil is mapped to a stoppage yet."
        />
        <Ranked
          title="Riders by slab (this month)"
          rows={d.slabs.map((s) => ({ name: s.name, count: s.count, help: rupees(s.amount) }))}
          empty="No approved transport period covers this month."
        />
        <Ranked
          title="Riders by class"
          rows={d.classes.map((s) => ({ name: s.name, count: s.count }))}
          empty="No pupil rides yet."
        />
        <Card
          title="Papers running out (30 days)"
          actions={
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/transport/papers">
              All papers
            </a>
          }
        >
          {d.fleet.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No insurance, fitness, permit or driving licence runs out in the next 30 days.
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.fleet.map((f) => (
                <li key={`${f.name}-${f.what}`}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                  >
                    <a href="/transport/papers" style={{ textDecoration: 'underline' }}>
                      {f.name}
                      <span className="ep-field__help"> · {f.what}</span>
                    </a>
                    <strong>{dayLabel(f.on)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
