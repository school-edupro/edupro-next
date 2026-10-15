import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { apiFetch, getMe } from '@/lib/api';

interface HostelToday {
  id: string;
  name: string;
  beds: number;
  boarders: number;
  away: number;
  overdue: number;
  sessions: number;
  rollsTaken: number;
  absentToday: number;
  visitorsWaiting: number;
  visitsToday: number;
  meals: number;
  mealsMarked: number;
  visitorsToApprove: number;
  openComplaints: number;
  complaintsOverdue: number;
}
interface Trend {
  day: string;
  absences: number;
  lateReturns: number;
  leaves: number;
  visits: number;
  complaintsRaised: number;
  mealsSkipped: number;
  incidents: number;
}
interface Fee {
  id: string;
  name: string;
  demand: string;
  paid: string;
  dueNow: string;
}
interface Dashboard {
  days: number;
  hostels: HostelToday[];
  trends: Trend[];
  fee: Fee[];
}

const sum = (rows: HostelToday[], k: keyof HostelToday) =>
  rows.reduce((a, r) => a + Number(r[k]), 0);
const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const SERIES: Array<[keyof Trend, string]> = [
  ['absences', 'Absent at roll-call'],
  ['lateReturns', 'Late back from leave'],
  ['leaves', 'Went out on leave'],
  ['visits', 'Visits'],
  ['complaintsRaised', 'Complaints raised'],
  ['mealsSkipped', 'Meals skipped'],
  ['incidents', 'Incidents'],
];

/** The hostel at a glance: today per hostel, the last days, and the hostel fee of the session. */
export default async function HostelDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const d = await apiFetch<Dashboard>(`/hostel/dashboard?days=${String(days)}`);
  const beds = sum(d.hostels, 'beds');
  const boarders = sum(d.hostels, 'boarders');
  const fee = d.fee.reduce(
    (a, f) => ({
      demand: a.demand + Number(f.demand),
      paid: a.paid + Number(f.paid),
      due: a.due + Number(f.dueNow),
    }),
    { demand: 0, paid: 0, due: 0 },
  );
  const peak = Object.fromEntries(
    SERIES.map(([k]) => [k, Math.max(1, ...d.trends.map((t) => Number(t[k])))]),
  );
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Dashboard"
        description="Today in each hostel, what happened over the last days, and the hostel fee of the session for the boarders."
      />
      <HostelNav current="/hostel/dashboard" permissions={me.permissions} />
      <div className="ep-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <KpiTile
          label="Boarders"
          value={`${String(boarders)} / ${String(beds)}`}
          hint={beds ? `${String(Math.round((boarders / beds) * 100))}% full` : undefined}
        />
        <KpiTile
          label="Away now"
          value={String(sum(d.hostels, 'away'))}
          hint={`${String(sum(d.hostels, 'overdue'))} overdue`}
        />
        <KpiTile label="Absent at roll-call today" value={String(sum(d.hostels, 'absentToday'))} />
        <KpiTile label="Visitors waiting" value={String(sum(d.hostels, 'visitorsWaiting'))} />
        <KpiTile
          label="Open complaints"
          value={String(sum(d.hostels, 'openComplaints'))}
          hint={`${String(sum(d.hostels, 'complaintsOverdue'))} late`}
        />
        <KpiTile
          label="Hostel fee due now"
          value={money(fee.due)}
          hint={
            fee.demand
              ? `${String(Math.round((fee.paid / fee.demand) * 100))}% of the session paid`
              : undefined
          }
        />
      </div>

      <Card title="Today, hostel by hostel" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Hostel</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Boarders / beds
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Away (overdue)
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Roll-calls taken
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Absent
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Meals marked
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Visits (waiting)
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Visitors to approve
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Complaints (late)
                </th>
              </tr>
            </thead>
            <tbody>
              {d.hostels.map((h) => (
                <tr key={h.id}>
                  <th scope="row">{h.name}</th>
                  <td style={{ textAlign: 'right' }}>
                    {h.boarders} / {h.beds}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {h.away} ({h.overdue})
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {h.rollsTaken} / {h.sessions}
                  </td>
                  <td style={{ textAlign: 'right' }}>{h.absentToday}</td>
                  <td style={{ textAlign: 'right' }}>
                    {h.mealsMarked} / {h.meals}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {h.visitsToday} ({h.visitorsWaiting})
                  </td>
                  <td style={{ textAlign: 'right' }}>{h.visitorsToApprove}</td>
                  <td style={{ textAlign: 'right' }}>
                    {h.openComplaints} ({h.complaintsOverdue})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`The last ${String(days)} days`}
        actions={
          <nav className="ep-tabs-links" aria-label="Days" style={{ margin: 0 }}>
            {[7, 30, 90].map((n) => (
              <a
                key={n}
                href={`/hostel/dashboard?days=${String(n)}`}
                aria-current={n === days ? 'page' : undefined}
              >
                {n} days
              </a>
            ))}
          </nav>
        }
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <div className="hs-trends">
          {SERIES.map(([k, label]) => {
            const total = d.trends.reduce((a, t) => a + Number(t[k]), 0);
            return (
              <section key={k} className="hs-trend" aria-label={`${label}: ${String(total)}`}>
                <header className="hs-room__head">
                  <strong>{label}</strong>
                  <span className="ep-field__help">{total}</span>
                </header>
                <div className="hs-trend__bars" aria-hidden="true">
                  {d.trends.map((t) => (
                    <span
                      key={t.day}
                      className="hs-trend__bar"
                      title={`${t.day}: ${String(t[k])}`}
                      style={{ height: `${String(Math.round((Number(t[k]) / peak[k]!) * 100))}%` }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Card>

      <Card title="Hostel fee of the session (boarders today)">
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Hostel</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Session fee
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Paid
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Due now
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Collected
                </th>
              </tr>
            </thead>
            <tbody>
              {d.fee.map((f) => (
                <tr key={f.id}>
                  <th scope="row">{f.name}</th>
                  <td style={{ textAlign: 'right' }}>{money(Number(f.demand))}</td>
                  <td style={{ textAlign: 'right' }}>{money(Number(f.paid))}</td>
                  <td style={{ textAlign: 'right' }}>{money(Number(f.dueNow))}</td>
                  <td style={{ textAlign: 'right' }}>
                    {Number(f.demand)
                      ? `${String(Math.round((Number(f.paid) / Number(f.demand)) * 100))}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
