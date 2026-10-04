import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import { addDays, today, when, type AppointmentDashboard } from '@/lib/appointments';
import {
  KIND_LABEL,
  gateOut,
  lateBack,
  whoOfPass,
  type GatePass,
  type PassCounts,
} from '@/lib/gate-passes';

interface PassDashboard {
  counts: PassCounts;
  overdue: number;
  studentsToday: number;
  staffToday: number;
  rejectedToday: number;
  itemsDue: number;
  outNow: GatePass[];
}
interface VisitorCounts {
  counts: { inside: number; waiting: number; today: number; peopleInside: number };
}
interface Point {
  key: string;
  appointments: number;
  pupil: number;
  staff: number;
  visitors: number;
}
interface PassMonth {
  month: string;
  audience: 'student' | 'staff';
  asked: number;
  approved: number;
  rejected: number;
  waiting: number;
  wentOut: number;
  cameBack: number;
  lateBack: number;
  approveHours: number | null;
  outMinutes: number | null;
}
interface Overview {
  see: { appointments: boolean; passes: boolean; visitors: boolean };
  range: { from: string; to: string } | null;
  months: Point[];
  days: Point[];
  passMonths: PassMonth[];
  pending: {
    passByLevel: Array<{
      audience: string;
      label: string;
      waiting: number;
      oldestHours: number;
      dueToday: number;
    }>;
    passByGroup: Array<{ audience: string; group: string; waiting: number; oldestHours: number }>;
    appointmentByHost: Array<{ host: string; waiting: number; oldestHours: number }>;
  } | null;
}
type Kpi = [title: string, n: number, help: string, href: string];
type Series = 'appointments' | 'pupil' | 'staff' | 'visitors';

const SERIES: Array<[Series, string]> = [
  ['appointments', 'Appointments'],
  ['pupil', 'Pupil gate passes'],
  ['staff', 'Staff gate passes'],
  ['visitors', 'Walk-in visitors'],
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
const total = (p: Point, on: Series[]) => on.reduce((n, s) => n + p[s], 0);
/** Waiting time in words: 40 min, 5 h, 3 days. */
const waited = (hours: number) =>
  hours < 1
    ? `${String(Math.max(1, Math.round(hours * 60)))} min`
    : hours < 48
      ? `${String(Math.round(hours))} h`
      : `${String(Math.round(hours / 24))} days`;

const Kpis = ({ items }: { items: Kpi[] }) => (
  <div className="ep-cdash__kpis">
    {items.map(([title, n, help, href]) => (
      <Card key={title} title={title}>
        <div className="ep-cdash__big">
          <a className="ep-cdash__num" href={href} aria-label={`${title}: ${String(n)}`}>
            {n.toLocaleString('en-IN')}
          </a>
        </div>
        <div className="ep-field__help">{help}</div>
      </Card>
    ))}
  </div>
);

/** A stacked bar chart of the four series, one bar per month or day. */
function Chart({
  points,
  on,
  label,
  months,
  name,
}: {
  points: Point[];
  on: Series[];
  label: (key: string) => string;
  months: boolean;
  name: string;
}) {
  const max = Math.max(1, ...points.map((p) => total(p, on)));
  // on a long range only some day labels fit
  const every = months ? 1 : Math.ceil(points.length / 16);
  return (
    <div
      className={months ? 'ep-cdash__chart ep-cdash__chart--months' : 'ep-cdash__chart'}
      role="img"
      aria-label={`${name}: ${points.map((p) => `${label(p.key)} ${String(total(p, on))}`).join(', ')}`}
    >
      {points.map((p, i) => {
        const t = total(p, on);
        return (
          <div
            key={p.key}
            className="ep-cdash__day"
            title={`${label(p.key)}: ${on.map((s) => `${SERIES.find((x) => x[0] === s)![1]} ${String(p[s])}`).join(', ')}`}
          >
            {months || t ? <span className="ep-cdash__mval">{t}</span> : null}
            <div
              className="ep-cdash__stack"
              style={{ height: `${String(t ? Math.max(3, (100 * t) / max) : 0)}%` }}
            >
              {on.map((s) =>
                p[s] ? <span key={s} data-fo={s} style={{ flexGrow: p[s] }} /> : null,
              )}
            </div>
            <span className="ep-cdash__dlabel">{i % every === 0 ? label(p.key) : ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One dashboard for the front office and the gate, on the lines of the helpdesk dashboard: today's
 * numbers, what waits for approval (by level and by department or class, with how long), the last six
 * months and a chosen range day by day for appointments, gate passes and walk-in visitors, and the gate
 * pass figures month by month. Each person sees the parts of their role.
 */
export default async function FrontOfficeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const may = (code: string) => me.permissions.includes(code);
  const from = DATE.test(sp.from ?? '') ? sp.from! : addDays(today(), -29);
  const to = DATE.test(sp.to ?? '') ? sp.to! : today();
  const [appts, passes, visitors, inbox, withMe, ov] = await Promise.all([
    may('engagement.appointment.view')
      ? apiFetch<AppointmentDashboard>('/appointments/dashboard').catch(() => null)
      : null,
    may('engagement.gate_pass.view')
      ? apiFetch<PassDashboard>('/gate-passes/dashboard').catch(() => null)
      : null,
    may('engagement.visitor.manage')
      ? apiFetch<VisitorCounts>('/visitors?state=inside&size=5').catch(() => null)
      : null,
    apiFetch<{ data: GatePass[] }>('/gate-passes/inbox').catch(() => ({ data: [] })),
    apiFetch<{ counts: { today: number; upcoming: number } }>(
      '/appointments/with-me?when=today&size=5',
    ).catch(() => ({ counts: { today: 0, upcoming: 0 } })),
    apiFetch<Overview>(`/front-office/dashboard?from=${from}&to=${to}`).catch(() => null),
  ]);
  const on = SERIES.map(([s]) => s).filter((s) =>
    s === 'appointments'
      ? ov?.see.appointments
      : s === 'visitors'
        ? ov?.see.visitors
        : ov?.see.passes,
  );
  const pendingPasses = ov?.pending?.passByLevel.reduce((n, x) => n + x.waiting, 0) ?? 0;
  const months = ov ? [...ov.months].reverse() : [];
  const kpis: Kpi[] = [
    [
      'Gate passes to approve',
      inbox.data.length,
      'waiting for your approval',
      '/engagement/gate-passes/approvals',
    ],
    [
      'Appointments with you today',
      withMe.counts.today,
      `${String(withMe.counts.upcoming)} still to come in all`,
      '/engagement/appointments/mine?when=today',
    ],
    ...(appts
      ? ([
          [
            'Appointments today',
            appts.today.total,
            `${String(appts.today.expected)} expected · ${String(appts.today.done)} done · ${String(appts.today.noShow)} did not come`,
            '/engagement/appointments?state=today',
          ],
          [
            'Appointment requests waiting',
            appts.waiting,
            appts.waitingLong
              ? `${String(appts.waitingLong)} waiting over 4 hours`
              : 'for the front desk to decide',
            '/engagement/appointments?state=open',
          ],
        ] as Kpi[])
      : []),
    ...(passes
      ? ([
          [
            'Gate passes waiting for approval',
            passes.counts.approval,
            'see who holds them below',
            '/engagement/gate-passes?stage=approval',
          ],
          [
            'To hand over',
            passes.counts.handover,
            'approved: the child is collected at the front desk',
            '/engagement/gate-passes?stage=handover',
          ],
          [
            'At the gate',
            passes.counts.gate,
            'handed over or approved, not yet out',
            '/engagement/gate-passes?stage=gate',
          ],
          [
            'Staff out, to come back',
            passes.counts.out,
            passes.overdue ? `${String(passes.overdue)} past the return time` : 'on an RGP',
            '/engagement/gate-passes?stage=out',
          ],
          [
            'Gate passes today',
            passes.counts.today,
            `${String(passes.studentsToday)} pupils · ${String(passes.staffToday)} staff · ${String(passes.rejectedToday)} not approved`,
            '/engagement/gate-passes?stage=today',
          ],
          [
            'Items not back',
            passes.itemsDue,
            'returnable equipment still outside',
            '/engagement/gate-passes?stage=all&audience=staff',
          ],
        ] as Kpi[])
      : []),
    ...(visitors
      ? ([
          [
            'Visitors inside now',
            visitors.counts.inside,
            `${String(visitors.counts.peopleInside)} people in the campus`,
            '/engagement/visitors?state=inside',
          ],
          [
            'Visitors waiting at the gate',
            visitors.counts.waiting,
            'registered on their own phone, not let in yet',
            '/engagement/visitors?state=waiting',
          ],
          [
            'Visitors today',
            visitors.counts.today,
            'walk-ins and appointment visitors',
            '/engagement/visitors?state=today',
          ],
        ] as Kpi[])
      : []),
  ];
  const legend = (
    <div className="ep-cdash__legend" style={{ flexWrap: 'wrap' }}>
      {SERIES.filter(([s]) => on.includes(s)).map(([s, label]) => (
        <span key={s}>
          <i data-fo={s} aria-hidden="true" /> {label}
        </span>
      ))}
    </div>
  );
  return (
    <>
      <PageHeader
        kicker="Front office and gate"
        title="Dashboard"
        description="Appointments, gate passes and visitors together: today, what waits for approval, the last six months and day by day. The numbers open the lists behind them."
        actions={
          appts ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/engagement/appointments/dashboard"
            >
              Appointment dashboard
            </a>
          ) : null
        }
      />
      <Kpis items={kpis} />
      {ov?.pending && (ov.see.passes || ov.see.appointments) ? (
        <Card
          title={`Waiting for approval · ${String(pendingPasses + ov.pending.appointmentByHost.reduce((n, x) => n + x.waiting, 0))}`}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <div className="ep-cdash__six">
            {ov.see.passes ? (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="By approval level"
              >
                <table className="ep-table ep-table--dense">
                  <caption>Gate passes by the level that holds them</caption>
                  <thead>
                    <tr>
                      <th scope="col">Waiting on</th>
                      <th scope="col">For</th>
                      <th scope="col" className="ep-num">
                        Passes
                      </th>
                      <th scope="col" className="ep-num">
                        For today or earlier
                      </th>
                      <th scope="col" className="ep-num">
                        Oldest waits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.pending.passByLevel.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Nothing waits for approval.</td>
                      </tr>
                    ) : null}
                    {ov.pending.passByLevel.map((x) => (
                      <tr key={`${x.audience}-${x.label}`}>
                        <th scope="row">{x.label}</th>
                        <td>{x.audience === 'student' ? 'Pupils' : 'Staff'}</td>
                        <td className="ep-num">
                          <a
                            className="ep-cdash__num"
                            href={`/engagement/gate-passes?stage=approval&audience=${x.audience}`}
                            aria-label={`${String(x.waiting)} ${x.audience === 'student' ? 'pupil' : 'staff'} passes waiting on ${x.label}`}
                          >
                            {x.waiting}
                          </a>
                        </td>
                        <td className="ep-num">{x.dueToday || '—'}</td>
                        <td className="ep-num">
                          {waited(x.oldestHours)}{' '}
                          {x.oldestHours >= 4 ? <Badge tone="danger">Slow</Badge> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {ov.see.passes ? (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="By department or class"
              >
                <table className="ep-table ep-table--dense">
                  <caption>Gate passes by department (staff) and class (pupils)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Department / class</th>
                      <th scope="col">For</th>
                      <th scope="col" className="ep-num">
                        Passes
                      </th>
                      <th scope="col" className="ep-num">
                        Oldest waits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.pending.passByGroup.length === 0 ? (
                      <tr>
                        <td colSpan={4}>Nothing waits for approval.</td>
                      </tr>
                    ) : null}
                    {ov.pending.passByGroup.map((x) => (
                      <tr key={`${x.audience}-${x.group}`}>
                        <th scope="row">{x.group}</th>
                        <td>{x.audience === 'student' ? 'Pupils' : 'Staff'}</td>
                        <td className="ep-num">{x.waiting}</td>
                        <td className="ep-num">{waited(x.oldestHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {ov.see.appointments ? (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Appointment requests by desk"
              >
                <table className="ep-table ep-table--dense">
                  <caption>Appointment requests by the desk or person asked for</caption>
                  <thead>
                    <tr>
                      <th scope="col">To meet</th>
                      <th scope="col" className="ep-num">
                        Requests
                      </th>
                      <th scope="col" className="ep-num">
                        Oldest waits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.pending.appointmentByHost.length === 0 ? (
                      <tr>
                        <td colSpan={3}>No request waits for the front desk.</td>
                      </tr>
                    ) : null}
                    {ov.pending.appointmentByHost.map((x) => (
                      <tr key={x.host}>
                        <th scope="row">{x.host}</th>
                        <td className="ep-num">
                          <a
                            className="ep-cdash__num"
                            href="/engagement/appointments?state=open"
                            aria-label={`${String(x.waiting)} appointment requests for ${x.host}`}
                          >
                            {x.waiting}
                          </a>
                        </td>
                        <td className="ep-num">
                          {waited(x.oldestHours)}{' '}
                          {x.oldestHours >= 4 ? <Badge tone="danger">Slow</Badge> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
      {ov && on.length ? (
        <>
          <Card
            title={`Last six months (${monthLabel(ov.months[0]!.key)} – ${monthLabel(ov.months[ov.months.length - 1]!.key)})`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <div className="ep-cdash__six">
              <div>
                <Chart points={ov.months} on={on} label={monthLabel} months name="Per month" />
                {legend}
              </div>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Month by month">
                <table className="ep-table ep-table--dense ep-cdash__mtable">
                  <caption className="ep-sr-only">Month by month, latest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      {SERIES.filter(([s]) => on.includes(s)).map(([s, label]) => (
                        <th key={s} scope="col" className="ep-num">
                          {label}
                        </th>
                      ))}
                      <th scope="col" className="ep-num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((p) => (
                      <tr key={p.key}>
                        <th scope="row">{monthLabel(p.key)}</th>
                        {on.map((s) => (
                          <td key={s} className="ep-num">
                            {p[s]}
                          </td>
                        ))}
                        <td className="ep-num">{total(p, on)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Six months</th>
                      {on.map((s) => (
                        <td key={s} className="ep-num">
                          {ov.months.reduce((n, p) => n + p[s], 0)}
                        </td>
                      ))}
                      <td className="ep-num">{ov.months.reduce((n, p) => n + total(p, on), 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Card>
          <Card
            title={`Day by day (${dayLabel(ov.range!.from)} – ${dayLabel(ov.range!.to)})`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <form method="get" className="ep-dlog__filters" style={{ marginBottom: 'var(--sp-3)' }}>
              <label className="ep-field" htmlFor="fo-from">
                <span className="ep-field__label">From</span>
                <input
                  id="fo-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={from}
                />
              </label>
              <label className="ep-field" htmlFor="fo-to">
                <span className="ep-field__label">To (up to 92 days)</span>
                <input id="fo-to" name="to" type="date" className="ep-input" defaultValue={to} />
              </label>
              <Button type="submit">Show</Button>
              <a className="ep-btn ep-btn--secondary" href="?">
                Last 30 days
              </a>
            </form>
            <Chart points={ov.days} on={on} label={dayLabel} months={false} name="Per day" />
            {legend}
            <details style={{ marginTop: 'var(--sp-3)' }}>
              <summary>The same numbers as a table</summary>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Day by day">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Day by day, latest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      {SERIES.filter(([s]) => on.includes(s)).map(([s, label]) => (
                        <th key={s} scope="col" className="ep-num">
                          {label}
                        </th>
                      ))}
                      <th scope="col" className="ep-num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...ov.days].reverse().map((p) => (
                      <tr key={p.key}>
                        <th scope="row">{dayLabel(p.key)}</th>
                        {on.map((s) => (
                          <td key={s} className="ep-num">
                            {p[s]}
                          </td>
                        ))}
                        <td className="ep-num">{total(p, on)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        </>
      ) : null}
      {ov?.see.passes ? (
        <Card title="Gate passes month by month" style={{ marginTop: 'var(--sp-4)' }}>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Gate passes by month"
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Gate passes month by month, pupils and staff</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">For</th>
                  <th scope="col" className="ep-num">
                    Asked
                  </th>
                  <th scope="col" className="ep-num">
                    Approved
                  </th>
                  <th scope="col" className="ep-num">
                    Not approved
                  </th>
                  <th scope="col" className="ep-num">
                    Still waiting
                  </th>
                  <th scope="col" className="ep-num">
                    Avg hours to approve
                  </th>
                  <th scope="col" className="ep-num">
                    Went out
                  </th>
                  <th scope="col" className="ep-num">
                    Came back (RGP)
                  </th>
                  <th scope="col" className="ep-num">
                    Back late
                  </th>
                  <th scope="col" className="ep-num">
                    Avg minutes outside
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.flatMap((m) =>
                  (['student', 'staff'] as const).map((aud, i) => {
                    const x = ov.passMonths.find((r) => r.month === m.key && r.audience === aud);
                    return (
                      <tr key={`${m.key}-${aud}`}>
                        {i === 0 ? (
                          <th scope="rowgroup" rowSpan={2}>
                            {monthLabel(m.key)}
                          </th>
                        ) : null}
                        <td>{aud === 'student' ? 'Pupils' : 'Staff'}</td>
                        <td className="ep-num">{x?.asked ?? 0}</td>
                        <td className="ep-num">{x?.approved ?? 0}</td>
                        <td className="ep-num">{x?.rejected ?? 0}</td>
                        <td className="ep-num">{x?.waiting ?? 0}</td>
                        <td className="ep-num">{x?.approveHours ?? '—'}</td>
                        <td className="ep-num">{x?.wentOut ?? 0}</td>
                        <td className="ep-num">{aud === 'staff' ? (x?.cameBack ?? 0) : '—'}</td>
                        <td className="ep-num">{aud === 'staff' ? (x?.lateBack ?? 0) : '—'}</td>
                        <td className="ep-num">{aud === 'staff' ? (x?.outMinutes ?? '—') : '—'}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {passes?.outNow.length ? (
        <Card title="Staff out now and due back" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Out now">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Staff out on a returnable pass</caption>
              <thead>
                <tr>
                  <th scope="col">Pass</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Gate out</th>
                  <th scope="col">Back by</th>
                  <th scope="col">Items not back</th>
                </tr>
              </thead>
              <tbody>
                {passes.outNow.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a href={`/engagement/gate-passes/${p.id}`}>{p.number}</a>
                      <div className="ep-field__help">{KIND_LABEL[p.kind]}</div>
                    </td>
                    <td>{whoOfPass(p)}</td>
                    <td>{gateOut(p)}</td>
                    <td>
                      {p.returnBy ? when(p.returnBy) : '—'}{' '}
                      {lateBack(p) ? <Badge tone="danger">Late</Badge> : null}
                    </td>
                    <td>{p.itemsDue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
