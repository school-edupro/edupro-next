import { ApiError } from '@edupro/bff';
import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';

interface Mine {
  employee: { id: string; code: string; name: string };
  fy: number | null;
  years: number[];
  rows: Array<{
    id: string;
    month: string;
    runType: string;
    grossEarned: string;
    totalDeductions: string;
    netPay: string;
    status: string;
  }>;
  ytd: { count: number; gross: string; deductions: string; net: string; tax: string; pt: string };
  passwordHint: string | null;
}

const money = (v: string) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );
const fyLabel = (y: number) => `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`;

/**
 * My payslips in the staff app (docs/design/86, phase B): the year's payslips of locked pay runs, each a
 * PDF locked with my password; the year so far; the password rule in words.
 */
export default async function MyPayslipsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const sp = await searchParams;
  let d: Mine | null = null;
  try {
    d = await bff.api.fetch<Mine>(
      `/payroll/me/payslips${/^\d{4}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : ''}`,
    );
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) throw e;
  }
  let letters: Array<{ id: string; letterNo: string; effectiveFrom: string; kind: string }> = [];
  if (d)
    try {
      letters = (await bff.api.fetch<{ rows: typeof letters }>('/payroll/me/letters')).rows;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  if (!d)
    return (
      <>
        <PageHeader kicker="My payroll" title="My payslips" />
        <Card>
          <p>Your sign-in is not linked to an employee record, so you have no payslips here.</p>
        </Card>
      </>
    );
  return (
    <>
      <PageHeader
        kicker="My payroll"
        title={`My payslips${d.fy ? ` · ${fyLabel(d.fy)}` : ''}`}
        description={
          d.passwordHint
            ? `Each payslip opens with a password: ${d.passwordHint}.`
            : 'Your payslips appear here once the month’s pay is locked.'
        }
      />
      {d.years.length > 1 ? (
        <nav aria-label="Financial year" className="ep-field__help">
          {d.years.map((y, i) => (
            <span key={y}>
              {i ? ' · ' : ''}
              {y === d.fy ? (
                <strong>{fyLabel(y)}</strong>
              ) : (
                <a href={`/my-payslips?fy=${String(y)}`}>{fyLabel(y)}</a>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="ep-dash-kpis">
        <KpiTile label="Payslips this year" value={String(d.ytd.count)} />
        <KpiTile label="Gross so far" value={`₹${money(d.ytd.gross)}`} />
        <KpiTile label="Income tax so far" value={`₹${money(d.ytd.tax)}`} />
        <KpiTile label="Net so far" value={`₹${money(d.ytd.net)}`} />
      </div>
      <Card>
        <h2 id="mp-list" className="ep-card__title">
          Payslips
        </h2>
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="mp-list">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Net (₹)</th>
                  <th scope="col">Gross (₹)</th>
                  <th scope="col">Deductions (₹)</th>
                  <th scope="col">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {monthName(r.month)}
                      {r.runType !== 'REGULAR' ? (
                        <>
                          {' '}
                          <Badge tone="info">
                            {r.runType === 'BONUS' ? 'Bonus' : 'Supplementary'}
                          </Badge>
                        </>
                      ) : null}
                      {r.status === 'HELD' ? (
                        <>
                          {' '}
                          <Badge tone="warning">Payment held</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <strong>{money(r.netPay)}</strong>
                    </td>
                    <td>{money(r.grossEarned)}</td>
                    <td>{money(r.totalDeductions)}</td>
                    <td>
                      <FileLinks
                        url={`/api/my-payslip?record=${r.id}`}
                        saveUrl={`/api/my-payslip?record=${r.id}&save=1`}
                        label={`the payslip of ${monthName(r.month)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No payslip yet this year.</p>
        )}
      </Card>
      <Card>
        <h2 className="ep-card__title">Letters and certificate</h2>
        {d.fy && d.rows.length ? (
          <p>
            Salary certificate {fyLabel(d.fy)}{' '}
            <FileLinks
              url={`/api/my-payroll-paper?kind=salcert&fy=${fyLabel(d.fy)}`}
              saveUrl={`/api/my-payroll-paper?kind=salcert&fy=${fyLabel(d.fy)}&save=1`}
              label={`my salary certificate of ${fyLabel(d.fy)}`}
            />
          </p>
        ) : null}
        {letters.length ? (
          <ul className="ep-list">
            {letters.map((l) => (
              <li key={l.id}>
                {l.kind === 'INCREMENT' ? 'Increment letter' : 'Pay revision letter'} {l.letterNo},
                from {l.effectiveFrom.split('-').reverse().join('-')}{' '}
                <FileLinks
                  url={`/api/my-payroll-paper?kind=letter&id=${l.id}`}
                  saveUrl={`/api/my-payroll-paper?kind=letter&id=${l.id}&save=1`}
                  label={`letter ${l.letterNo}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">No increment or pay revision letter yet.</p>
        )}
      </Card>
    </>
  );
}
