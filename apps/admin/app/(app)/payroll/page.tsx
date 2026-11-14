import { Breadcrumbs, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart, DonutChart, LineChart, type ChartTone } from '@/components/charts/Charts';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Figures {
  cost: string;
  gross: string;
  employer: string;
  net: string;
  staff: number;
  average: string;
  statutory: string;
  statutoryStaff: string;
  lopDays: string;
  lopAmount: string;
}
interface Home {
  months: Array<{ month: string; label: string; provisional: boolean }>;
  month: string | null;
  provisional: string | null;
  figures: Figures | null;
  previous: (Figures & { month: string }) | null;
  work: Array<{ k: string; n: number }>;
  due: Array<{ item: string; month: string; due_on: string }>;
  liability: { amount: string; due: number; staff: number } | null;
  charts: {
    trend: Array<{
      month: string;
      label: string;
      gross: string;
      net: string;
      employer: string;
      staff: number;
    }>;
    byDepartment: Array<{ k: string; staff: number; gross: string }>;
    earnings: Array<{ k: string; amount: string }>;
    deductions: Array<{ k: string; amount: string }>;
    bands: Array<{ k: string; staff: number }>;
  } | null;
  can: { approve: boolean; manage: boolean; admin: boolean; audit: boolean };
}

const whole = (v: string | number) => Math.round(Number(v)).toLocaleString('en-IN');
const lakh = (v: string | number) => Math.round((Number(v) / 100000) * 100) / 100;
const change = (now: string | number, before: string | number | undefined) => {
  const b = Number(before ?? 0);
  if (!b) return undefined;
  const pct = Math.round(((Number(now) - b) * 1000) / b) / 10;
  return {
    text: `${pct > 0 ? '+' : ''}${String(pct)} % on last month`,
    tone: pct > 0 ? ('warning' as const) : ('success' as const),
  };
};
const TONES: ChartTone[] = [
  'navy',
  'cyan',
  'success',
  'warning',
  'info',
  'danger',
  'muted',
  'navy',
];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const WORK: Record<string, [string, string]> = {
  review: ['run(s) to review and approve', '/payroll/runs'],
  lock: ['approved run(s) waiting for the lock', '/payroll/runs'],
  pay: ['locked run(s) to pay through the bank', '/payroll/runs'],
  settlements: ['leaver’s settlement(s) in hand', '/payroll/people?tab=settlements'],
  revisions: ['pay revision draft(s)', '/payroll/people?tab=revisions'],
  declarations: ['tax declaration(s) to verify', '/payroll/tax'],
  drafts: ['set-up draft(s) to approve', '/payroll/setup/approvals'],
  overdue: ['statutory filing(s) overdue', '/payroll/statutory?tab=calendar'],
  due: ['statutory filing(s) due in 15 days', '/payroll/statutory?tab=calendar'],
};

/**
 * The payroll home (docs/design/86, phase F): the month's six figures first, then the work waiting and the filings due,
 * then small charts. PROVISIONAL while a run of the month is approved but not locked; makers see it without the
 * confidential staff.
 */
export default async function PayrollHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  let d: Home;
  try {
    d = await apiFetch<Home>(
      `/payroll/home${/^\d{4}-\d{2}$/.test(sp.month ?? '') ? `?month=${sp.month!}` : ''}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const f = d.figures;
  const p = d.previous;
  const label = d.months.find((m) => m.month === d.month)?.label ?? '';
  const waiting = d.work.filter((w) => w.n > 0);
  return (
    <div className="ep-dash-compact">
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Payroll home' }]} />
      <PageHeader
        kicker="Payroll"
        title={label ? `Payroll · ${label}` : 'Payroll'}
        description="The month’s pay at a glance, the work waiting and the filings due."
      />
      {d.months.length > 1 ? (
        <nav aria-label="Month" className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
          {d.months.slice(0, 12).map((m, i) => (
            <span key={m.month}>
              {i ? ' · ' : ''}
              {m.month === d.month ? (
                <strong>{m.label}</strong>
              ) : (
                <a href={`/payroll?month=${m.month}`}>{m.label}</a>
              )}
              {m.provisional ? ' (provisional)' : ''}
            </span>
          ))}
        </nav>
      ) : null}
      {d.provisional ? (
        <p className="ep-alert ep-alert--warning" role="status">
          {d.provisional}
        </p>
      ) : null}
      {f ? (
        <div className="ep-dash-kpis">
          <KpiTile
            label="Cost to school"
            value={`₹${whole(f.cost)}`}
            hint={`Salary ₹${whole(f.gross)} + employer ₹${whole(f.employer)}`}
            delta={change(f.cost, p?.cost)}
          />
          <KpiTile label="Net paid" value={`₹${whole(f.net)}`} delta={change(f.net, p?.net)} />
          <KpiTile
            label="Staff paid"
            value={String(f.staff)}
            hint={
              p
                ? `${f.staff - p.staff >= 0 ? '+' : ''}${String(f.staff - p.staff)} on last month`
                : undefined
            }
          />
          <KpiTile
            label="Average cost"
            value={`₹${whole(f.average)}`}
            hint="Cost to school ÷ staff"
          />
          <KpiTile
            label="Statutory outgo"
            value={`₹${whole(f.statutory)}`}
            hint={`Staff ₹${whole(f.statutoryStaff)} + employer ₹${whole(f.employer)}`}
          />
          <KpiTile
            label="Loss of pay"
            value={`${String(Number(f.lopDays))} days`}
            hint={`₹${whole(f.lopAmount)} not paid`}
          />
        </div>
      ) : (
        <p className="ep-card">
          No pay run is approved yet: the figures fill in once a checker approves the first run.
        </p>
      )}
      <div className="ep-chart__grid2">
        <Card title="Work waiting">
          {waiting.length ? (
            <ul className="ep-list">
              {waiting.map((w) => (
                <li key={w.k}>
                  <a href={WORK[w.k]![1]}>
                    {w.n} {WORK[w.k]![0]}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nothing waits.</p>
          )}
        </Card>
        <Card title="Filings due">
          {d.due.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Filings due">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Filing</th>
                    <th scope="col">For</th>
                    <th scope="col">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {d.due.map((x) => (
                    <tr key={`${x.item}-${x.month}`}>
                      <td>{x.item}</td>
                      <td>{x.month}</td>
                      <td>{dmy(x.due_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">Nothing due in the next 15 days.</p>
          )}
          {d.liability ? (
            <p className="ep-field__help">
              Gratuity liability today: ₹{whole(d.liability.amount)} ({d.liability.due} of{' '}
              {d.liability.staff} staff due).{' '}
              <a href={`/payroll/reports?key=gratuity`}>The liability</a>
            </p>
          ) : null}
        </Card>
      </div>
      {d.charts && f ? (
        <div className="ep-chart__grid2">
          <Card title="Twelve months (₹ lakh)">
            <LineChart
              title="Gross and net pay, and the employer’s contributions, over twelve months, in lakh"
              labels={d.charts.trend.map((t) => t.label.slice(0, 3))}
              series={[
                { label: 'Gross', tone: 'navy', values: d.charts.trend.map((t) => lakh(t.gross)) },
                { label: 'Net', tone: 'cyan', values: d.charts.trend.map((t) => lakh(t.net)) },
                {
                  label: 'Employer',
                  tone: 'warning',
                  values: d.charts.trend.map((t) => lakh(t.employer)),
                },
              ]}
            />
          </Card>
          <Card title="Staff paid">
            <BarChart
              title="Staff paid in each of twelve months"
              series={[{ label: 'Staff', tone: 'navy' }]}
              data={d.charts.trend.map((t) => ({ label: t.label.slice(0, 3), values: [t.staff] }))}
            />
          </Card>
          <Card title={`Gross by department · ${label}`}>
            <BarChart
              title={`Gross pay by department, ${label}, in lakh`}
              series={[{ label: 'Gross (lakh)', tone: 'cyan' }]}
              data={d.charts.byDepartment.map((x) => ({ label: x.k, values: [lakh(x.gross)] }))}
            />
          </Card>
          <Card title="Salary bands">
            <BarChart
              title={`Staff by gross pay, ${label}`}
              series={[{ label: 'Staff', tone: 'success' }]}
              data={d.charts.bands.map((b) => ({ label: b.k, values: [b.staff] }))}
            />
          </Card>
          <Card title="What the pay is made of">
            <DonutChart
              title={`Earnings by pay head, ${label}`}
              parts={d.charts.earnings.map((x, i) => ({
                label: x.k,
                tone: TONES[i]!,
                value: Number(x.amount),
              }))}
              centre={`₹${String(lakh(f.gross))}L`}
              caption="Gross"
            />
          </Card>
          <Card title="What is taken out">
            <DonutChart
              title={`Deductions by pay head, ${label}`}
              parts={d.charts.deductions.map((x, i) => ({
                label: x.k,
                tone: TONES[i]!,
                value: Number(x.amount),
              }))}
              centre={`₹${String(lakh(Number(f.gross) - Number(f.net)))}L`}
              caption="Deducted"
            />
          </Card>
        </div>
      ) : null}
      <p className="ep-field__help">
        <a href="/payroll/reports">Reports</a>
        {d.can.audit ? (
          <>
            {' · '}
            <a href="/payroll/audit">Audit trail</a>
          </>
        ) : null}
      </p>
    </div>
  );
}
