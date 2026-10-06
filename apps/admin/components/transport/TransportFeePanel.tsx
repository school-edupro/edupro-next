import { Card } from '@edupro/ui';
import { BarChart, DonutChart, ProgressRows } from '@/components/charts/Charts';
import { apiFetch } from '@/lib/api';

type Cell = string | number | null;
interface Report {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, Cell>>;
  totals: Record<string, number> | null;
}
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const num = (v: Cell | undefined) => Number(v ?? 0);

/**
 * The transport fee on the transport dashboard: what the session should bring, what has come and what is
 * due; month by month, route by route, the students who owe the most and this month's collection. Each
 * block opens its report. Shown to those who may see the transport fee (an in-charge: their own routes).
 */
export async function TransportFeePanel() {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [projected, collected, students, receipts] = await Promise.all([
    apiFetch<Report>('/transport/reports/fee-months?measure=projected').catch(() => null),
    apiFetch<Report>('/transport/reports/fee-months?measure=collected').catch(() => null),
    apiFetch<Report>('/transport/reports/fee-students').catch(() => null),
    apiFetch<Report>(
      `/transport/reports/fee-collection?from=${today.slice(0, 8)}01&to=${today}`,
    ).catch(() => null),
  ]);
  if (!projected?.totals || !collected?.totals) return null;
  const t = projected.totals;
  const months = projected.columns.filter((c) => c.key.startsWith('m_'));
  const dueSoFar = months
    .filter((m) => m.key.slice(2) <= today.slice(0, 7))
    .reduce((n, m) => n + num(t[m.key]), 0);
  const pct = t.projected ? Math.round((num(t.collected) / num(t.projected)) * 100) : 0;
  const owing = (students?.rows ?? [])
    .filter((r) => num(r.balance) > 0)
    .sort((a, b) => num(b.balance) - num(a.balance));
  const kpis: Array<[string, string, string, string]> = [
    [
      'Projected for the session',
      money(num(t.projected)),
      `${String(num(t.pupils))} students billed`,
      '/transport/reports?r=fee-months',
    ],
    [
      'Collected',
      money(num(t.collected)),
      `${String(pct)}% of the session`,
      '/transport/reports?r=fee-months&measure=collected',
    ],
    [
      'Balance',
      money(num(t.balance)),
      `${money(Math.max(0, dueSoFar - num(t.collected)))} of it is due up to this month`,
      '/transport/reports?r=fee-months&measure=balance',
    ],
    [
      'Received this month',
      money(num(receipts?.totals?.amount)),
      `${String(receipts?.rows.length ?? 0)} receipt(s)`,
      `/transport/reports?r=fee-collection&from=${today.slice(0, 8)}01&to=${today}`,
    ],
  ];
  return (
    <section aria-label="Transport fee" style={{ marginTop: 'var(--sp-5)' }}>
      <h2 className="ep-cdash__h3">Transport fee</h2>
      <div className="ep-cdash__kpis">
        {kpis.map(([title, value, help, href]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href} aria-label={`${title}: ${value}`}>
                {value}
              </a>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <div className="ep-chart__grid2" style={{ marginTop: 'var(--sp-4)' }}>
        <Card
          title="Month by month"
          actions={
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/transport/reports?r=fee-months"
            >
              Report
            </a>
          }
        >
          <BarChart
            title="Transport fee projected and collected for each month of the session"
            series={[
              { label: 'Projected', tone: 'navy' },
              { label: 'Collected', tone: 'success' },
            ]}
            data={months.map((m) => ({
              label: m.label.split(' ')[0] ?? m.label,
              values: [num(t[m.key]), num(collected.totals![m.key])],
            }))}
          />
        </Card>
        <Card title="Collected against projected">
          <DonutChart
            title="Transport fee of the session"
            centre={`${String(pct)}%`}
            caption="collected"
            parts={[
              { label: 'Collected', tone: 'success', value: Math.round(num(t.collected)) },
              { label: 'Balance', tone: 'danger', value: Math.round(num(t.balance)) },
            ]}
          />
        </Card>
      </div>
      <div className="ep-chart__grid2">
        <Card
          title="Route by route"
          actions={
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/transport/reports?r=fee-months&measure=balance"
            >
              Report
            </a>
          }
        >
          <ProgressRows
            label="Collected against projected, by route"
            rows={projected.rows.map((r) => ({
              name: `${String(r.route)} · ${String(num(r.pupils))}`,
              value: num(r.collected),
              of: num(r.projected),
              tone: 'success' as const,
              text: `${money(num(r.collected))} of ${money(num(r.projected))}`,
            }))}
          />
        </Card>
        <Card
          title={`Students with a balance · ${String(owing.length)}`}
          actions={
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/transport/reports?r=fee-students"
            >
              All students
            </a>
          }
        >
          {owing.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nobody owes transport fee.
            </p>
          ) : (
            <ProgressRows
              label="The largest balances"
              rows={owing.slice(0, 8).map((r) => ({
                name: `${String(r.student)}${r.section ? ` · ${String(r.section)}` : ''}`,
                href: `/transport/reports/fee/${String(r.student_id)}`,
                value: num(r.collected),
                of: num(r.projected),
                tone: 'warning' as const,
                text: `${money(num(r.balance))} due`,
              }))}
            />
          )}
        </Card>
      </div>
    </section>
  );
}
