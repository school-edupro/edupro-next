import { Card, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { apiFetch, getMe } from '@/lib/api';
import { dayLabel, type AppointmentDashboard } from '@/lib/appointments';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const SOURCES = [
  ['fromParent', 'parent', 'Parent app'],
  ['fromPublic', 'public', 'QR / outside'],
  ['fromDesk', 'front_desk', 'Front desk'],
] as const;

/**
 * The appointment dashboard: today at a glance, what is waiting, the next seven days, six months of
 * outcomes by where the booking came from, and the busiest desks and purposes.
 */
export default async function AppointmentDashboardPage() {
  const [me, d] = await Promise.all([
    getMe(),
    apiFetch<AppointmentDashboard>('/appointments/dashboard'),
  ]);
  const max = Math.max(1, ...d.months.map((m) => m.total));
  const weekMax = Math.max(1, ...d.week.map((w) => w.confirmed + w.waiting));
  const kpis: Array<[string, number, string, string]> = [
    [
      'Today',
      d.today.total,
      `${String(d.today.expected)} still expected · ${String(d.today.done)} done · ${String(d.today.noShow)} did not come`,
      '/engagement/appointments?state=today',
    ],
    [
      'Waiting',
      d.waiting,
      d.waitingLong ? `${String(d.waitingLong)} waiting over 4 hours` : 'requests to decide',
      '/engagement/appointments?state=open',
    ],
    [
      'Inside now',
      d.today.inside,
      'checked in, not out yet',
      '/engagement/appointments?state=checked_in',
    ],
  ];

  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="Dashboard"
        description="Today, what is waiting, the week ahead and the last six months."
      />
      <AppointmentNav current="/engagement/appointments/dashboard" permissions={me.permissions} />
      <div className="ep-cdash__kpis">
        {kpis.map(([title, n, help, href]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href}>
                {n.toLocaleString('en-IN')}
              </a>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <Card title="The next seven days" style={{ marginTop: 'var(--sp-4)' }}>
        <div
          className="ep-cdash__chart ep-cdash__chart--months"
          role="img"
          aria-label={`Appointments per day: ${d.week.map((w) => `${dayLabel(w.day)} ${String(w.confirmed)} confirmed, ${String(w.waiting)} waiting`).join('; ')}`}
        >
          {d.week.map((w) => (
            <div key={w.day} className="ep-cdash__day">
              <span className="ep-cdash__mval">{w.confirmed + w.waiting}</span>
              <div
                className="ep-cdash__stack"
                style={{
                  height: `${String(Math.max(3, (100 * (w.confirmed + w.waiting)) / weekMax))}%`,
                }}
              >
                {w.confirmed ? (
                  <span data-state="approved" style={{ flexGrow: w.confirmed }} />
                ) : null}
                {w.waiting ? <span data-state="requested" style={{ flexGrow: w.waiting }} /> : null}
              </div>
              <span className="ep-cdash__dlabel">{dayLabel(w.day)}</span>
            </div>
          ))}
        </div>
        <div className="ep-cdash__legend">
          <span>
            <i data-state="approved" aria-hidden="true" /> Confirmed
          </span>
          <span>
            <i data-state="requested" aria-hidden="true" /> Waiting
          </span>
        </div>
      </Card>
      <Card title="Booked per month, by where it came from" style={{ marginTop: 'var(--sp-4)' }}>
        <div
          className="ep-cdash__chart ep-cdash__chart--months"
          role="img"
          aria-label={`Appointments booked per month: ${d.months.map((m) => `${monthLabel(m.month)} ${String(m.total)}`).join(', ')}`}
        >
          {d.months.map((m) => (
            <div key={m.month} className="ep-cdash__day">
              <span className="ep-cdash__mval">{m.total}</span>
              <div
                className="ep-cdash__stack"
                style={{ height: `${String(Math.max(3, (100 * m.total) / max))}%` }}
              >
                {SOURCES.map(([key, src]) =>
                  m[key] ? <span key={src} data-src={src} style={{ flexGrow: m[key] }} /> : null,
                )}
              </div>
              <span className="ep-cdash__dlabel">{monthLabel(m.month)}</span>
            </div>
          ))}
        </div>
        <div className="ep-cdash__legend">
          {SOURCES.map(([, src, label]) => (
            <span key={src}>
              <i data-src={src} aria-hidden="true" /> {label}
            </span>
          ))}
        </div>
      </Card>
      <Card title="Month by month" style={{ marginTop: 'var(--sp-4)' }}>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Appointments month by month"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Appointments month by month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                {[
                  'Booked',
                  'Parent app',
                  'QR / outside',
                  'Front desk',
                  'Confirmed',
                  'Declined',
                  'Cancelled',
                  'Moved',
                  'Completed',
                  'Did not come',
                  'Avg hours to decide',
                ].map((x) => (
                  <th key={x} scope="col" className="ep-num">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...d.months].reverse().map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month)}</th>
                  {[
                    m.total,
                    m.fromParent,
                    m.fromPublic,
                    m.fromDesk,
                    m.confirmed,
                    m.rejected,
                    m.cancelled,
                    m.rescheduled,
                    m.completed,
                    m.noShow,
                    m.decideHours ?? '—',
                  ].map((v, i) => (
                    <td key={i} className="ep-num">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="ep-cdash__two" style={{ marginTop: 'var(--sp-4)' }}>
        <Card title="Busiest people and desks (6 months)">
          {d.hosts.length ? (
            <ul className="ep-cdash__list">
              {d.hosts.map((h) => (
                <li key={h.name}>
                  <span>{h.name}</span>
                  <span>
                    {h.total}
                    {h.noShow ? (
                      <span className="ep-field__help"> · {h.noShow} did not come</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No appointments yet.</p>
          )}
        </Card>
        <Card title="Most common purposes (6 months)">
          {d.purposes.length ? (
            <ul className="ep-cdash__list">
              {d.purposes.map((p) => (
                <li key={p.name}>
                  <span>{p.name}</span>
                  <span>{p.total}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No appointments yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
