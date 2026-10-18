import { Badge, Card } from '@edupro/ui';
import { BarChart } from '@/components/charts/Charts';

export type ProjectionBy = 'quarter' | 'month' | 'term';
export interface ProjectionPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
  current: boolean;
  past: boolean;
  projection: number;
  realised: number;
  received: number;
  balance: number;
  /** transport only: the bus list (monthly fare x months riding), riders, riders not billed */
  expected?: number;
  riders?: number;
  unbilled?: number;
}

const BY: Array<[ProjectionBy, string]> = [
  ['quarter', 'Quarterly'],
  ['month', 'Monthly'],
  ['term', 'By fee term'],
];
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const short = (label: string) => label.replace(/^(Q\d|Term \d).*$/, '$1');

/**
 * Projection vs collection by period (docs/design/29-fee-and-consent-dashboards.md): the demand due in
 * each quarter / month / fee term, how much of it is paid (realised, whenever paid), and the money that
 * came in during the period (cash-flow). Transport adds the bus list against what was billed.
 */
export function ProjectionPanel({
  title,
  periods,
  by,
  hrefFor,
  transport = false,
}: {
  title: string;
  periods: ProjectionPeriod[];
  by: ProjectionBy;
  hrefFor: (by: ProjectionBy) => string;
  transport?: boolean;
}) {
  const total = periods.reduce(
    (a, p) => ({
      projection: a.projection + p.projection,
      realised: a.realised + p.realised,
      received: a.received + p.received,
      balance: a.balance + p.balance,
      expected: a.expected + (p.expected ?? 0),
    }),
    { projection: 0, realised: 0, received: 0, balance: 0, expected: 0 },
  );
  // so far: the periods begun (the current one included)
  const sofar = periods.filter((p) => p.past || p.current);
  const dueSoFar = sofar.reduce((n, p) => n + p.projection, 0);
  const paidSoFar = sofar.reduce((n, p) => n + p.realised, 0);

  return (
    <Card title={title} style={{ marginBottom: 'var(--sp-4)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-3)',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <nav className="ep-tabs-links" aria-label="Cut the year by">
          {BY.map(([k, label]) => (
            <a key={k} href={hrefFor(k)} aria-current={by === k ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <span className="ep-field__help">
          So far: {rupees(paidSoFar)} of {rupees(dueSoFar)} realised ({pct(paidSoFar, dueSoFar)}%)
        </span>
      </div>
      <BarChart
        title={`${title}: projection, realised and received in each period`}
        series={[
          { label: 'Projection (due)', tone: 'muted' },
          { label: 'Realised (paid of it)', tone: 'success' },
          { label: 'Received in the period', tone: 'cyan' },
          ...(transport ? [{ label: 'Bus list', tone: 'warning' as const }] : []),
        ]}
        data={periods.map((p) => ({
          label: by === 'month' ? p.label : short(p.label),
          values: [p.projection, p.realised, p.received, ...(transport ? [p.expected ?? 0] : [])],
        }))}
      />
      <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-3)' }}>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">{title} by period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Projection (due)</th>
              <th scope="col">Realised</th>
              <th scope="col">Realised %</th>
              {transport ? null : <th scope="col">Balance</th>}
              <th scope="col">Received in period</th>
              {transport ? (
                <>
                  <th scope="col">Bus list</th>
                  <th scope="col">Bus list not billed</th>
                  <th scope="col">Riders</th>
                  <th scope="col">Riding, not billed</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const r = pct(p.realised, p.projection);
              return (
                <tr key={p.key}>
                  <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                    {p.label} {p.current ? <Badge tone="info">Now</Badge> : null}
                  </th>
                  <td>{rupees(p.projection)}</td>
                  <td>{rupees(p.realised)}</td>
                  <td>
                    {p.projection > 0 && (p.past || p.current) ? (
                      <Badge tone={r >= 90 ? 'success' : r >= 70 ? 'warning' : 'danger'}>
                        {r}%
                      </Badge>
                    ) : p.projection > 0 ? (
                      `${r}%`
                    ) : (
                      '—'
                    )}
                  </td>
                  {transport ? null : <td>{rupees(p.balance)}</td>}
                  <td>{p.past || p.current ? rupees(p.received) : '—'}</td>
                  {transport ? (
                    <>
                      <td>{rupees(p.expected ?? 0)}</td>
                      <td>
                        {(p.expected ?? 0) > p.projection ? (
                          <span style={{ color: 'var(--status-warning-text)' }}>
                            {rupees((p.expected ?? 0) - p.projection)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{p.riders ?? 0}</td>
                      <td>
                        {p.unbilled ? (
                          <Badge tone="warning">{p.unbilled}</Badge>
                        ) : p.past || p.current ? (
                          '0'
                        ) : (
                          '—'
                        )}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
            <tr>
              <th scope="row">Year</th>
              <td>{rupees(total.projection)}</td>
              <td>{rupees(total.realised)}</td>
              <td>{pct(total.realised, total.projection)}%</td>
              {transport ? null : <td>{rupees(total.balance)}</td>}
              <td>{rupees(total.received)}</td>
              {transport ? (
                <>
                  <td>{rupees(total.expected)}</td>
                  <td>{rupees(Math.max(0, total.expected - total.projection))}</td>
                  <td colSpan={2} />
                </>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ep-field__help" style={{ margin: 'var(--sp-3) 0 0' }}>
        Projection is the fee due in the period after discounts. Realised is how much of it is paid,
        whenever paid. Received is the money that came in during the period, whatever it paid for.
        {transport
          ? ' Bus list is the monthly fare of the pupils on the bus list for the months they ride; riding, not billed counts pupils on the bus with no transport fee due in that period.'
          : ''}
      </p>
    </Card>
  );
}
