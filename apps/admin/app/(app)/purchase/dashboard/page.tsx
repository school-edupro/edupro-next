import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts/Charts';
import { apiFetch, getMe } from '@/lib/api';
import { inr, type PurchaseDashboard } from '@/lib/purchase';

const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const lakh = (n: number) =>
  n >= 100000
    ? `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh`
    : inr(n);

/**
 * The purchase dashboard (docs/design/83, part 5): the figures first (each opens the list it counts),
 * then the oldest approvals waiting, the largest orders of the year and those over the alert amount,
 * then small charts of spend by department and by month. Spend is placed orders (approved, sent,
 * closed) by PO date, this financial year.
 */
export default async function PurchaseDashboardPage() {
  const me = await getMe();
  if (!me.permissions.includes('purchase.report.view')) notFound();
  const d = await apiFetch<PurchaseDashboard>('/purchase/dashboard');
  const f = d.figures;
  const reports = (q: Record<string, string>) =>
    `/purchase/reports?${new URLSearchParams(q).toString()}`;
  const num = (n: number, href: string) => (
    <a className="ep-cdash__num" href={href}>
      {n.toLocaleString('en-IN')}
    </a>
  );
  return (
    <div className="ep-dash-compact">
      <PageHeader
        kicker="Purchase"
        title="Purchase dashboard"
        description={`This financial year from ${dmy(d.fyFrom)}. Spend counts orders placed with vendors (approved, sent or closed).`}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/purchase/reports">
            Reports
          </a>
        }
      />
      <h2 className="ep-sr-only">Figures</h2>
      <div className="ep-dash-kpis">
        <KpiTile
          label="Open indents"
          value={num(f.openIndents, '/purchase/indents')}
          hint="waiting for approval, a PR or a PO"
        />
        <KpiTile
          label="Waiting for approval"
          value={num(f.pending, reports({ report: 'pending' }))}
          hint={
            f.emergencyWaiting
              ? `${String(f.emergencyWaiting)} emergency to ratify`
              : 'indents, PRs and POs'
          }
        />
        <KpiTile
          label="To requisition"
          value={num(f.toRequisition, '/purchase/to-requisition')}
          hint="approved indents"
        />
        <KpiTile
          label="To order"
          value={num(f.toOrder, '/purchase/to-order')}
          hint="lines without a PO"
        />
        <KpiTile
          label="Orders this month"
          value={num(
            f.ordersThisMonth,
            reports({ report: 'po_register', from: d.monthFrom, to: d.today, status: 'placed' }),
          )}
          hint={inr(f.ordersThisMonthValue)}
        />
        <KpiTile
          label="Ordered this year"
          value={
            <a className="ep-cdash__num" href={reports({ report: 'department_spend' })}>
              {lakh(f.ordersThisYearValue)}
            </a>
          }
          hint="placed orders"
        />
        <KpiTile
          label="To receive"
          value={num(f.toReceive, '/purchase/to-receive')}
          hint="orders with something still to come"
        />
        <KpiTile
          label="Late deliveries"
          value={num(
            f.lateOrders,
            reports({ report: 'pending_deliveries', status: 'late', from: '2000-04-01' }),
          )}
          hint="orders past their delivery date"
        />
        <KpiTile
          label="Waiting for inspection"
          value={num(f.inspecting, '/purchase/receipts?tab=inspecting')}
          hint={
            f.deemedAccepted
              ? `${String(f.deemedAccepted)} past 15 days (deemed accepted)`
              : 'goods and services received'
          }
        />
        <KpiTile
          label="Accepted this month"
          value={
            <a
              className="ep-cdash__num"
              href={reports({
                report: 'grn_register',
                from: d.monthFrom,
                to: d.today,
                status: 'accepted',
              })}
            >
              {lakh(f.acceptedThisMonthValue)}
            </a>
          }
          hint="goods and services received"
        />
        <KpiTile
          label="Stock value"
          value={
            <a className="ep-cdash__num" href="/purchase/stock">
              {lakh(f.stockValue)}
            </a>
          }
          hint="in every store, at the average"
        />
        <KpiTile
          label="Below reorder level"
          value={num(f.belowReorder, '/purchase/reorder')}
          hint="items in a store"
        />
      </div>

      <div className="ep-chart__grid2">
        <Card title="Oldest approvals waiting">
          {d.oldestPending.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Oldest approvals waiting"
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">With</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.oldestPending.map((p) => (
                    <tr key={`${p.kind}-${p.label}`}>
                      <td>
                        {p.href ? <a href={p.href}>{p.label}</a> : p.label}
                        <span className="ep-mr-col__desc">
                          {p.kind}
                          {p.department ? ` · ${p.department}` : ''} · {inr(p.amount)}
                        </span>
                      </td>
                      <td>
                        {p.level}: {p.waitingWith}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.days}
                        {p.overdue ? (
                          <>
                            {' '}
                            <Badge tone="danger">Over SLA</Badge>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">Nothing is waiting for approval.</p>
          )}
        </Card>
        <Card title="Largest orders this year">
          {d.largest.length ? (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Largest orders this year"
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Vendor</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.largest.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <a href={`/purchase/orders/${o.id}`}>{o.label}</a>
                        <span className="ep-mr-col__desc">
                          {dmy(o.date)}
                          {o.department ? ` · ${o.department}` : ''}
                        </span>
                      </td>
                      <td>{o.vendor}</td>
                      <td style={{ textAlign: 'right' }}>{inr(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">No order placed this year yet.</p>
          )}
        </Card>
      </div>

      {d.largePoAlert !== null ? (
        <Card title={`Orders of ${inr(d.largePoAlert)} or more this year`}>
          {d.overAlert.length ? (
            <ul className="ep-purch-checks">
              {d.overAlert.map((o) => (
                <li key={o.id}>
                  <a href={`/purchase/orders/${o.id}`}>{o.label}</a> · {o.vendor} · {dmy(o.date)} ·{' '}
                  <strong>{inr(o.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">None.</p>
          )}
        </Card>
      ) : null}

      <div className="ep-chart__grid2">
        <Card title="Spend by department">
          {d.byDepartment.length ? (
            <BarChart
              title="Placed orders this year by department"
              series={[{ label: 'Ordered (₹)', tone: 'navy' }]}
              data={d.byDepartment.map((x) => ({ label: x.department, values: [x.total] }))}
            />
          ) : (
            <p className="ep-field__help">No order placed this year yet.</p>
          )}
        </Card>
        <Card title="Spend by month">
          {d.byMonth.some((x) => x.total) ? (
            <BarChart
              title="Placed orders this year by month"
              series={[{ label: 'Ordered (₹)', tone: 'cyan' }]}
              data={d.byMonth.map((x) => ({ label: x.label, values: [x.total] }))}
            />
          ) : (
            <p className="ep-field__help">No order placed this year yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
