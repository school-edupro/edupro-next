import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { apiFetch, getMe } from '@/lib/api';
import { addDays, today, when } from '@/lib/appointments';
import type { Medicine } from '@/lib/clinic';

interface Point {
  key: string;
  student: number;
  staff: number;
}
interface Dashboard {
  range: { from: string; to: string };
  today: {
    visits: number;
    inClinic: number;
    sentHome: number;
    referred: number;
    thisMonth: number;
  };
  months: Point[];
  days: Point[];
  diseases: Array<{ name: string; count: number }>;
  classes: Array<{ name: string; count: number; people: number }>;
  departments: Array<{ name: string; count: number; people: number }>;
  outcomes: Array<{ outcome: string; label: string; count: number }>;
  frequent: Array<{
    audience: string;
    id: string;
    name: string;
    code: string | null;
    detail: string | null;
    count: number;
    lastAt: string | null;
  }>;
  lowStock: Medicine[];
  expiring: Array<{
    medicine: string;
    batchNo: string | null;
    expiryOn: string;
    qtyLeft: number;
    unit: string;
    expired: boolean;
  }>;
  given: Array<{ medicine: string; unit: string; qty: number; visits: number }>;
  camps: Array<{
    id: string;
    name: string;
    startsOn: string;
    status: string;
    examined: number;
    published: number;
    attention: number;
    pupils: number;
  }>;
}
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

function Chart({
  points,
  label,
  months,
  name,
}: {
  points: Point[];
  label: (k: string) => string;
  months: boolean;
  name: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.student + p.staff));
  const every = months ? 1 : Math.ceil(points.length / 16);
  return (
    <div
      className={months ? 'ep-cdash__chart ep-cdash__chart--months' : 'ep-cdash__chart'}
      role="img"
      aria-label={`${name}: ${points.map((p) => `${label(p.key)} ${String(p.student + p.staff)}`).join(', ')}`}
    >
      {points.map((p, i) => {
        const t = p.student + p.staff;
        return (
          <div
            key={p.key}
            className="ep-cdash__day"
            title={`${label(p.key)}: pupils ${String(p.student)}, staff ${String(p.staff)}`}
          >
            {months || t ? <span className="ep-cdash__mval">{t}</span> : null}
            <div
              className="ep-cdash__stack"
              style={{ height: `${String(t ? Math.max(3, (100 * t) / max) : 0)}%` }}
            >
              {p.student ? <span data-fo="pupil" style={{ flexGrow: p.student }} /> : null}
              {p.staff ? <span data-fo="staff" style={{ flexGrow: p.staff }} /> : null}
            </div>
            <span className="ep-cdash__dlabel">{i % every === 0 ? label(p.key) : ' '}</span>
          </div>
        );
      })}
    </div>
  );
}
const Legend = () => (
  <div className="ep-cdash__legend">
    <span>
      <i data-fo="pupil" aria-hidden="true" /> Pupils
    </span>
    <span>
      <i data-fo="staff" aria-hidden="true" /> Staff
    </span>
  </div>
);
function Ranked({
  title,
  rows,
  empty,
  unit = 'visits',
}: {
  title: string;
  rows: Array<{ name: string; count: number; help?: string }>;
  empty: string;
  unit?: string;
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
            <li key={r.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                <span>
                  {r.name}
                  {r.help ? <span className="ep-field__help"> · {r.help}</span> : null}
                </span>
                <strong>
                  {r.count} <span className="ep-sr-only">{unit}</span>
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

/**
 * The clinic dashboard: today at a glance, the last six months and a chosen range day by day (pupils and
 * staff), what people come for, which classes and departments, how visits end, who comes often, the
 * medicine shelf (low stock, expiring, most given) and how far each health check-up has got.
 */
export default async function ClinicDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const from = DATE.test(sp.from ?? '') ? sp.from! : addDays(today(), -29);
  const to = DATE.test(sp.to ?? '') ? sp.to! : today();
  const [me, d] = await Promise.all([
    getMe(),
    apiFetch<Dashboard>(`/clinic/dashboard?from=${from}&to=${to}`),
  ]);
  const kpis: Array<[string, number, string, string]> = [
    [
      'Visits today',
      d.today.visits,
      `${String(d.today.thisMonth)} this month`,
      '/engagement/clinic/visits?tab=today',
    ],
    [
      'In the clinic now',
      d.today.inClinic,
      'came in today, time out not recorded',
      '/engagement/clinic/visits?tab=in_clinic',
    ],
    [
      'Sent home today',
      d.today.sentHome,
      'parents were told',
      '/engagement/clinic/visits?tab=today&outcome=sent_home',
    ],
    [
      'Referred today',
      d.today.referred,
      'to a doctor or hospital',
      '/engagement/clinic/visits?tab=today&outcome=referred',
    ],
    [
      'Medicines low',
      d.lowStock.length,
      'at or under the low-stock mark',
      '/engagement/clinic/stock',
    ],
    [
      'Batches expiring',
      d.expiring.length,
      `${String(d.expiring.filter((x) => x.expired).length)} already expired`,
      '/engagement/clinic/stock',
    ],
  ];
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Clinic dashboard"
        description="Visits of pupils and staff, what they come for, the medicine shelf and the health check-ups."
        actions={
          me.permissions.includes('engagement.clinic.manage') ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/clinic/visits/new">
              New visit
            </a>
          ) : null
        }
      />
      <ClinicNav current="/engagement/clinic" permissions={me.permissions} />
      <div className="ep-cdash__kpis">
        {kpis.map(([title, n, help, href]) => (
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
      <Card
        title={`Last six months (${monthLabel(d.months[0]!.key)} – ${monthLabel(d.months[d.months.length - 1]!.key)})`}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <div className="ep-cdash__six">
          <div>
            <Chart points={d.months} label={monthLabel} months name="Visits per month" />
            <Legend />
          </div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Month by month">
            <table className="ep-table ep-table--dense ep-cdash__mtable">
              <caption className="ep-sr-only">Clinic visits month by month, latest first</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="ep-num">
                    Pupils
                  </th>
                  <th scope="col" className="ep-num">
                    Staff
                  </th>
                  <th scope="col" className="ep-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...d.months].reverse().map((m) => (
                  <tr key={m.key}>
                    <th scope="row">{monthLabel(m.key)}</th>
                    <td className="ep-num">{m.student}</td>
                    <td className="ep-num">{m.staff}</td>
                    <td className="ep-num">{m.student + m.staff}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Six months</th>
                  <td className="ep-num">{d.months.reduce((n, m) => n + m.student, 0)}</td>
                  <td className="ep-num">{d.months.reduce((n, m) => n + m.staff, 0)}</td>
                  <td className="ep-num">
                    {d.months.reduce((n, m) => n + m.student + m.staff, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Card>
      <Card
        title={`Day by day (${dayLabel(d.range.from)} – ${dayLabel(d.range.to)})`}
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <form method="get" className="ep-dlog__filters" style={{ marginBottom: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="cd-from">
            <span className="ep-field__label">From</span>
            <input id="cd-from" name="from" type="date" className="ep-input" defaultValue={from} />
          </label>
          <label className="ep-field" htmlFor="cd-to">
            <span className="ep-field__label">To (up to a year)</span>
            <input id="cd-to" name="to" type="date" className="ep-input" defaultValue={to} />
          </label>
          <Button type="submit">Show</Button>
          <a className="ep-btn ep-btn--secondary" href="?">
            Last 30 days
          </a>
        </form>
        <Chart points={d.days} label={dayLabel} months={false} name="Visits per day" />
        <Legend />
        <p className="ep-field__help">
          The boxes below cover the same dates ({dayLabel(d.range.from)} – {dayLabel(d.range.to)}).
        </p>
      </Card>
      <div className="ep-cdash__two">
        <Ranked
          title="What they came for"
          rows={d.diseases}
          empty="No disease or complaint was chosen on the visits of these dates."
        />
        <Ranked
          title="How the visits ended"
          rows={d.outcomes.map((o) => ({ name: o.label, count: o.count }))}
          empty="No visits in these dates."
        />
        <Ranked
          title="Pupils by class"
          rows={d.classes.map((c) => ({
            name: c.name,
            count: c.count,
            help: `${String(c.people)} pupils`,
          }))}
          empty="No pupil visited in these dates."
        />
        <Ranked
          title="Staff by department"
          rows={d.departments.map((c) => ({
            name: c.name,
            count: c.count,
            help: `${String(c.people)} staff`,
          }))}
          empty="No member of staff visited in these dates."
        />
      </div>
      <div className="ep-cdash__two">
        <Card title="Came three times or more">
          {d.frequent.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nobody came three times in these dates.
            </p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Frequent visitors"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">People with three or more visits</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Class / department</th>
                    <th scope="col" className="ep-num">
                      Visits
                    </th>
                    <th scope="col">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {d.frequent.map((f) => (
                    <tr key={`${f.audience}-${f.id}`}>
                      <td>
                        <a
                          href={`/engagement/clinic/visits?tab=all&q=${encodeURIComponent(f.code ?? f.name)}`}
                        >
                          {f.name}
                        </a>
                        <div className="ep-field__help">{f.code}</div>
                      </td>
                      <td>{f.detail ?? '—'}</td>
                      <td className="ep-num">{f.count}</td>
                      <td>{f.lastAt ? when(f.lastAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Ranked
          title="Medicines given most"
          rows={d.given.map((g) => ({
            name: g.medicine,
            count: g.qty,
            help: `${g.unit} · ${String(g.visits)} visits`,
          }))}
          empty="No medicine was given in these dates."
          unit="given"
        />
      </div>
      <div className="ep-cdash__two">
        <Card title="Medicine shelf">
          {d.lowStock.length === 0 && d.expiring.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nothing is low and nothing expires soon.
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.lowStock.map((m) => (
                <li key={`l-${m.id}`}>
                  <Badge tone="warning">Low</Badge> {m.name}
                  {m.strength ? ` ${m.strength}` : ''}: {m.stock} {m.unit} left (mark {m.lowStockAt}
                  )
                </li>
              ))}
              {d.expiring.map((x, i) => (
                <li key={`e-${String(i)}`}>
                  <Badge tone={x.expired ? 'danger' : 'warning'}>
                    {x.expired ? 'Expired' : 'Expiring'}
                  </Badge>{' '}
                  {x.medicine}
                  {x.batchNo ? ` · batch ${x.batchNo}` : ''}: {x.qtyLeft} {x.unit}, {x.expiryOn}
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginBottom: 0 }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/clinic/stock">
              Open the stock
            </a>
          </p>
        </Card>
        <Card title="Health check-ups">
          {d.camps.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No health check-up has been started.
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Health check-ups">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">How far each health check-up has got</caption>
                <thead>
                  <tr>
                    <th scope="col">Check-up</th>
                    <th scope="col" className="ep-num">
                      Examined
                    </th>
                    <th scope="col" className="ep-num">
                      Published
                    </th>
                    <th scope="col" className="ep-num">
                      Need attention
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.camps.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <a href={`/engagement/clinic/checkups/${c.id}`}>{c.name}</a>
                        <div className="ep-field__help">{c.startsOn}</div>
                      </td>
                      <td className="ep-num">
                        {c.examined} of {c.pupils}
                        <div className="ep-field__help">
                          {c.pupils ? Math.round((100 * c.examined) / c.pupils) : 0}%
                        </div>
                      </td>
                      <td className="ep-num">{c.published}</td>
                      <td className="ep-num">{c.attention}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
