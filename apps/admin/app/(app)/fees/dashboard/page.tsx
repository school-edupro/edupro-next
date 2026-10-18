import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import {
  BarChart,
  DonutChart,
  LineChart,
  ProgressRows,
  type ChartTone,
} from '@/components/charts/Charts';
import { Icon } from '@/components/nav-icons';
import {
  ProjectionPanel,
  type ProjectionBy,
  type ProjectionPeriod,
} from '@/components/fees/ProjectionPanel';
import { apiFetch } from '@/lib/api';

type Ledger = 'all' | 'school' | 'hostel' | 'misc';
interface Split {
  ledger: string;
  collectedToday: number;
  collectedMonth: number;
  collectedYear: number;
  receiptsToday: number;
  demand: number;
  dueTillDate: number;
  paidOfDue: number;
  outstanding: number;
  overdue: number;
  defaulters: number;
}
interface FeeDashboard {
  year: { id: string; code: string };
  by: ProjectionBy;
  periods: ProjectionPeriod[];
  asOf: string;
  totals: Omit<Split, 'ledger'>;
  split: Split[];
  byClass: Array<{ name: string; due: number; paid: number; overdue: number }>;
  ageing: Array<{
    bucket: string;
    amount: number;
    students: number;
    byLedger: Array<{ ledger: string; amount: number }>;
  }>;
  modes: Array<{ mode: string; month: number; year: number; receipts: number }>;
  instruments: {
    chequesWaiting: number;
    chequesWaitingAmount: number;
    bounced: number;
    bouncedAmount: number;
    cashToDeposit: number;
    cashReceipts: number;
  };
  daily: Array<{ date: string; amount: number }>;
  monthly: Array<{ month: string; amount: number; lastYear: number }>;
  defaulters: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    section: string | null;
    mobile: string | null;
    balance: number;
    days: number;
    ledgers: string[];
  }>;
  refunds: { paid: number; paidCount: number; waiting: number; waitingCount: number };
  concessions: { discounts: number; waivers: number; waiversCount: number; waitingCount: number };
  online: {
    byGateway: Array<{ provider: string; status: string; count: number; amount: number }>;
    unsettled: { count: number; amount: number };
  };
  cashiers: Array<{
    userId: string | null;
    name: string;
    amount: number;
    cash: number;
    receipts: number;
  }>;
}

const LEDGERS: Array<[Ledger, string]> = [
  ['all', 'All'],
  ['school', 'School fee'],
  ['hostel', 'Hostel fee'],
  ['misc', 'Misc'],
];
const NAME: Record<string, string> = { school: 'School fee', hostel: 'Hostel fee', misc: 'Misc' };
const TONE: Record<string, ChartTone> = { school: 'navy', hostel: 'cyan', misc: 'warning' };
const MODE: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  online: 'Online',
  card: 'Card',
  cheque: 'Cheque',
  dd: 'DD',
  bank: 'Bank transfer',
};
const MODE_TONE: ChartTone[] = ['navy', 'cyan', 'success', 'warning', 'info', 'danger', 'muted'];
const AGE: Record<string, string> = {
  current: 'Not yet due',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days',
};
const GATEWAY_STATUS: Record<string, string> = {
  succeeded: 'Paid',
  failed: 'Failed',
  created: 'Started, not finished',
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
/** short Indian form for tight places: ₹18.5L, ₹2.1Cr */
const short = (n: number) =>
  n >= 1e7
    ? `₹${(n / 1e7).toFixed(1)}Cr`
    : n >= 1e5
      ? `₹${(n / 1e5).toFixed(1)}L`
      : n >= 1e3
        ? `₹${(n / 1e3).toFixed(1)}k`
        : rupees(n);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/**
 * The fee dashboard (docs/design/29-fee-and-consent-dashboards.md): school, hostel and misc fees
 * together or one at a time, for the academic year chosen in the header, live from the ledgers.
 */
export default async function FeeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ledger?: string; by?: string }>;
}) {
  const sp = await searchParams;
  const ledger: Ledger = LEDGERS.some(([k]) => k === sp.ledger) ? (sp.ledger as Ledger) : 'all';
  const by: ProjectionBy = ['month', 'term'].includes(sp.by ?? '')
    ? (sp.by as ProjectionBy)
    : 'quarter';
  const d = await apiFetch<FeeDashboard>(`/fees/dashboard?ledger=${ledger}&by=${by}`);
  // the page's own address with the ledger and the cut of the year kept
  const href = (patch: { ledger?: Ledger; by?: ProjectionBy }) => {
    const q = new URLSearchParams();
    const l = patch.ledger ?? ledger;
    const b = patch.by ?? by;
    if (l !== 'all') q.set('ledger', l);
    if (b !== 'quarter') q.set('by', b);
    return `/fees/dashboard${q.size ? `?${q.toString()}` : ''}`;
  };
  const t = d.totals;
  const rate = pct(t.paidOfDue, t.dueTillDate);
  const ledgersShown = d.split.map((x) => x.ledger);
  const modeYear = d.modes.reduce((n, m) => n + m.year, 0);
  const gateways = [...new Set(d.online.byGateway.map((x) => x.provider))];
  const asOf = new Date(`${d.asOf}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="ep-dash-compact">
      <PageHeader
        kicker="Fees"
        title="Fee dashboard"
        description={`Academic year ${d.year.code}, as of ${asOf}. Live from the ledgers: a receipt counts unless reversed or bounced.`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/fees/reports"
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="chart" size={16} /> Fee reports
          </a>
        }
      />
      <nav className="ep-tabs-links" aria-label="Ledger" style={{ marginBottom: 'var(--sp-4)' }}>
        {LEDGERS.map(([k, label]) => (
          <a key={k} href={href({ ledger: k })} aria-current={ledger === k ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>

      <h2 className="ep-sr-only">Collected and due</h2>
      <div className="ep-dash-kpis">
        <KpiTile
          label="Collected today"
          value={rupees(t.collectedToday)}
          hint={`${t.receiptsToday} receipts`}
        />
        <KpiTile label="This month" value={rupees(t.collectedMonth)} />
        <KpiTile label="This year" value={rupees(t.collectedYear)} />
        <KpiTile
          label="Due till today"
          value={rupees(t.dueTillDate)}
          hint={`of ${rupees(t.demand)} for the year`}
        />
        <KpiTile
          label="Collected of due"
          value={`${rate}%`}
          delta={{
            text: rate >= 90 ? 'On track' : rate >= 70 ? 'Watch' : 'Low',
            tone: rate >= 90 ? 'success' : rate >= 70 ? 'warning' : 'danger',
          }}
        />
        <KpiTile label="Overdue" value={rupees(t.overdue)} hint={`${t.defaulters} pupils`} />
      </div>

      <ProjectionPanel
        title={`Projection vs collection${ledger === 'all' ? '' : ` · ${NAME[ledger]}`}`}
        periods={d.periods}
        by={by}
        hrefFor={(b) => href({ by: b })}
      />

      {ledger === 'all' ? (
        <Card title="By ledger" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Collected and due by ledger</caption>
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Today</th>
                  <th scope="col">This month</th>
                  <th scope="col">This year</th>
                  <th scope="col">Due till today</th>
                  <th scope="col">Collected of due</th>
                  <th scope="col">Overdue</th>
                  <th scope="col">Pupils overdue</th>
                </tr>
              </thead>
              <tbody>
                {d.split.map((x) => (
                  <tr key={x.ledger}>
                    <th scope="row">
                      <a
                        href={`/fees/dashboard?ledger=${x.ledger}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {NAME[x.ledger]}
                      </a>
                    </th>
                    <td>{rupees(x.collectedToday)}</td>
                    <td>{rupees(x.collectedMonth)}</td>
                    <td>{rupees(x.collectedYear)}</td>
                    <td>{rupees(x.dueTillDate)}</td>
                    <td>{pct(x.paidOfDue, x.dueTillDate)}%</td>
                    <td>{rupees(x.overdue)}</td>
                    <td>{x.defaulters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <div className="ep-chart__grid2">
        <Card title="Collected of due, by class">
          {d.byClass.length ? (
            <ProgressRows
              label="Share of the fee due till today that is collected, by class"
              rows={d.byClass.map((x) => {
                const r = pct(x.paid, x.due);
                return {
                  name: x.name,
                  value: x.paid,
                  of: x.due,
                  text: `${r}%`,
                  tone: r >= 90 ? 'success' : r >= 70 ? 'warning' : 'danger',
                };
              })}
            />
          ) : (
            <p className="ep-field__help">No fee due yet this year.</p>
          )}
        </Card>
        <Card title="Dues by age">
          <table className="ep-table ep-table--dense" style={{ marginBottom: 'var(--sp-3)' }}>
            <caption className="ep-sr-only">Unpaid fee by age</caption>
            <thead>
              <tr>
                <th scope="col">Age</th>
                <th scope="col">Unpaid</th>
                <th scope="col">Pupils</th>
              </tr>
            </thead>
            <tbody>
              {d.ageing.map((a) => (
                <tr key={a.bucket}>
                  <th scope="row">{AGE[a.bucket]}</th>
                  <td>{rupees(a.amount)}</td>
                  <td>{a.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <BarChart
            title="Unpaid fee by how long it has been due"
            stacked
            series={ledgersShown.map((l) => ({ label: NAME[l] ?? l, tone: TONE[l] ?? 'muted' }))}
            data={d.ageing.map((a) => ({
              label: AGE[a.bucket] ?? a.bucket,
              values: ledgersShown.map((l) => a.byLedger.find((x) => x.ledger === l)?.amount ?? 0),
            }))}
          />
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="How it was paid (this year)">
          {d.modes.length ? (
            <>
              <table className="ep-table ep-table--dense" style={{ marginBottom: 'var(--sp-3)' }}>
                <caption className="ep-sr-only">Collection by payment mode</caption>
                <thead>
                  <tr>
                    <th scope="col">Mode</th>
                    <th scope="col">This month</th>
                    <th scope="col">This year</th>
                    <th scope="col">Receipts</th>
                  </tr>
                </thead>
                <tbody>
                  {d.modes.map((m) => (
                    <tr key={m.mode}>
                      <th scope="row">{MODE[m.mode] ?? m.mode}</th>
                      <td>{rupees(m.month)}</td>
                      <td>{rupees(m.year)}</td>
                      <td>{m.receipts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <DonutChart
                title="Collection this year by payment mode"
                centre={short(modeYear)}
                caption="this year"
                parts={d.modes.map((m, i) => ({
                  label: MODE[m.mode] ?? m.mode,
                  tone: MODE_TONE[i % MODE_TONE.length]!,
                  value: m.year,
                }))}
              />
            </>
          ) : (
            <p className="ep-field__help">No receipts yet this year.</p>
          )}
        </Card>
        <Card title="Cheques and cash">
          <div className="ep-cf-stats" style={{ marginBottom: 'var(--sp-3)' }}>
            <KpiTile
              label="Cheques / DD to clear"
              value={rupees(d.instruments.chequesWaitingAmount)}
              hint={`${d.instruments.chequesWaiting} instruments`}
            />
            <KpiTile
              label="Bounced this year"
              value={rupees(d.instruments.bouncedAmount)}
              hint={`${d.instruments.bounced} instruments`}
            />
            <KpiTile
              label="Cash not yet deposited"
              value={rupees(d.instruments.cashToDeposit)}
              hint={`${d.instruments.cashReceipts} receipts without a slip`}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/deposit-slips">
              <Icon name="file" size={16} /> Deposit slips
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/bank">
              <Icon name="wallet" size={16} /> Bank statements
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/adjustments">
              <Icon name="refresh" size={16} /> Bounces and reversals
            </a>
          </div>
        </Card>
      </div>

      <div className="ep-chart__grid2">
        <Card title="This month, day by day">
          <BarChart
            title="Collection on each day of this month"
            series={[{ label: 'Collected', tone: 'navy' }]}
            data={d.daily.map((x) => ({ label: x.date.slice(8), values: [x.amount] }))}
          />
        </Card>
        <Card title="This year by month, against last year">
          <LineChart
            title="Collection per month this year and in the same month last year"
            labels={d.monthly.map((x) => x.month)}
            series={[
              { label: 'This year', tone: 'navy', values: d.monthly.map((x) => x.amount) },
              { label: 'Last year', tone: 'muted', values: d.monthly.map((x) => x.lastYear) },
            ]}
          />
        </Card>
      </div>

      <Card title="Who owes most" style={{ marginBottom: 'var(--sp-4)' }}>
        {d.defaulters.length ? (
          <>
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Pupils with the largest overdue fee</caption>
                <thead>
                  <tr>
                    <th scope="col">Pupil</th>
                    <th scope="col">Class</th>
                    <th scope="col">Parent mobile</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">Oldest</th>
                    <th scope="col">Ledgers</th>
                  </tr>
                </thead>
                <tbody>
                  {d.defaulters.map((x) => (
                    <tr key={x.studentId}>
                      <td>
                        <a
                          href={`/fees/ledger/${x.studentId}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {x.name}
                        </a>{' '}
                        <span className="ep-field__help">{x.admissionNo}</span>
                      </td>
                      <td>{x.section ?? '—'}</td>
                      <td>{x.mobile ?? '—'}</td>
                      <td>{rupees(x.balance)}</td>
                      <td>
                        <Badge tone={x.days > 90 ? 'danger' : x.days > 30 ? 'warning' : 'neutral'}>
                          {x.days} days
                        </Badge>
                      </td>
                      <td>{x.ledgers.map((l) => NAME[l] ?? l).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: 'var(--sp-3) 0 0' }}>
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/fees/reminders/new">
                <Icon name="send" size={16} /> Send a fee reminder
              </a>
            </p>
          </>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nobody owes an overdue fee.
          </p>
        )}
      </Card>

      <div className="ep-chart__grid2">
        <Card title="Refunds and concessions (this year)">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Refunds and concessions</caption>
            <tbody>
              <tr>
                <th scope="row">Refunds paid</th>
                <td>{rupees(d.refunds.paid)}</td>
                <td>{d.refunds.paidCount}</td>
              </tr>
              <tr>
                <th scope="row">Refunds waiting</th>
                <td>{rupees(d.refunds.waiting)}</td>
                <td>{d.refunds.waitingCount}</td>
              </tr>
              <tr>
                <th scope="row">Discounts in the demand</th>
                <td>{rupees(d.concessions.discounts)}</td>
                <td>—</td>
              </tr>
              <tr>
                <th scope="row">Waivers approved</th>
                <td>{rupees(d.concessions.waivers)}</td>
                <td>{d.concessions.waiversCount}</td>
              </tr>
              <tr>
                <th scope="row">Waivers waiting</th>
                <td>—</td>
                <td>{d.concessions.waitingCount}</td>
              </tr>
            </tbody>
          </table>
          <p
            style={{
              margin: 'var(--sp-3) 0 0',
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
            }}
          >
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/refunds">
              <Icon name="wallet" size={16} /> Refunds
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/fees/adjustments">
              <Icon name="check" size={16} /> Waivers
            </a>
          </p>
        </Card>
        <Card title="Online payments (this year)">
          {gateways.length ? (
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Online payments by gateway</caption>
              <thead>
                <tr>
                  <th scope="col">Gateway</th>
                  {Object.values(GATEWAY_STATUS).map((s) => (
                    <th key={s} scope="col">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gateways.map((g) => (
                  <tr key={g}>
                    <th scope="row">{g === 'mock' ? 'Test gateway' : g}</th>
                    {Object.keys(GATEWAY_STATUS).map((s) => {
                      const x = d.online.byGateway.find((y) => y.provider === g && y.status === s);
                      return <td key={s}>{x ? `${x.count} · ${rupees(x.amount)}` : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ep-field__help">No online payments this year.</p>
          )}
          <p className="ep-field__help" style={{ margin: 'var(--sp-3) 0 0' }}>
            Paid online, not yet matched to a gateway settlement: {d.online.unsettled.count} ·{' '}
            {rupees(d.online.unsettled.amount)}.{' '}
            <a href="/fees/settlements" style={{ textDecoration: 'underline' }}>
              Settlements
            </a>
          </p>
        </Card>
      </div>

      <Card title="Collected today, by counter">
        {d.cashiers.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Collected today by the person who took it</caption>
              <thead>
                <tr>
                  <th scope="col">Taken by</th>
                  <th scope="col">Receipts</th>
                  <th scope="col">Cash</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.cashiers.map((x) => (
                  <tr key={`${x.userId ?? 'none'}-${x.name}`}>
                    <th scope="row">{x.name}</th>
                    <td>{x.receipts}</td>
                    <td>{rupees(x.cash)}</td>
                    <td>{rupees(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No receipts today yet.
          </p>
        )}
      </Card>
    </div>
  );
}
