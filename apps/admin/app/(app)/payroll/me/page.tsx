import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthName } from '@/lib/payroll-inputs';

interface Mine {
  employee: { id: string; code: string; name: string };
  fy: number | null;
  years: number[];
  rows: Array<{
    id: string;
    month: string;
    runType: string;
    isTopUp: boolean;
    grossEarned: string;
    totalDeductions: string;
    netPay: string;
    status: string;
    tax: string;
  }>;
  ytd: { count: number; gross: string; deductions: string; net: string; tax: string; pt: string };
  passwordHint: string | null;
}

/** My payslips (every employee): the year's payslips of locked runs, the year so far, the password in words. */
export default async function MyPayslipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.own.view')) notFound();
  let d: Mine;
  let letters: Array<{ id: string; letterNo: string; effectiveFrom: string; kind: string }> = [];
  try {
    d = await apiFetch<Mine>(
      `/payroll/me/payslips${/^\d{4}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : ''}`,
    );
    letters = (await apiFetch<{ rows: typeof letters }>('/payroll/me/letters')).rows;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const fyLabel = (y: number) => `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'My payslips' }]} />
      <PageHeader
        kicker="My payroll"
        title={`My payslips${d.fy ? ` ${fyLabel(d.fy)}` : ''}`}
        description={
          d.passwordHint
            ? `Each payslip opens with a password: ${d.passwordHint}.`
            : 'Your payslips, once the month’s pay is locked.'
        }
      />
      {d.years.length > 1 ? (
        <nav
          aria-label="Financial year"
          className="ep-field__help"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {d.years.map((y, i) => (
            <span key={y}>
              {i ? ' · ' : ''}
              {y === d.fy ? (
                <strong>{fyLabel(y)}</strong>
              ) : (
                <a href={`/payroll/me?fy=${String(y)}`}>{fyLabel(y)}</a>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Payslips this year" value={String(d.ytd.count)} />
        <KpiTile label="Gross so far" value={`₹${money(d.ytd.gross)}`} />
        <KpiTile label="Income tax so far" value={`₹${money(d.ytd.tax)}`} />
        <KpiTile label="Net so far" value={`₹${money(d.ytd.net)}`} />
      </div>
      <section className="ep-card" aria-labelledby="mp-list">
        <h2 id="mp-list" className="ep-card__title">
          Payslips
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="mp-list">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Gross (₹)</th>
                <th scope="col">Deductions (₹)</th>
                <th scope="col">Net (₹)</th>
                <th scope="col">Payslip</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
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
                    <td>{money(r.grossEarned)}</td>
                    <td>{money(r.totalDeductions)}</td>
                    <td>
                      <strong>{money(r.netPay)}</strong>
                    </td>
                    <td>
                      <FileLinks
                        href={`/api/payroll/my-payslip?record=${r.id}`}
                        label={`the payslip of ${monthName(r.month)}`}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>No payslip yet this year.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ep-card" aria-labelledby="mp-papers">
        <h2 id="mp-papers" className="ep-card__title">
          Letters and certificate
        </h2>
        {d.fy && d.ytd.count ? (
          <div className="ep-grid__toolbar">
            <span>Salary certificate {fyLabel(d.fy)}</span>
            <FileLinks
              href={`/api/payroll/pay-file?kind=salcert&fy=${fyLabel(d.fy)}`}
              label={`my salary certificate of ${fyLabel(d.fy)}`}
            />
          </div>
        ) : null}
        {letters.length ? (
          <ul className="ep-list">
            {letters.map((l) => (
              <li key={l.id}>
                {l.kind === 'INCREMENT' ? 'Increment letter' : 'Pay revision letter'} {l.letterNo},
                from {l.effectiveFrom.split('-').reverse().join('-')}{' '}
                <FileLinks
                  href={`/api/payroll/pay-file?kind=letter&own=1&id=${l.id}`}
                  label={`letter ${l.letterNo}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">No increment or pay revision letter yet.</p>
        )}
      </section>
    </>
  );
}
