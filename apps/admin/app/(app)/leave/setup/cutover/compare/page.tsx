import { Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type CutoverCompare } from '@/lib/leave';

const fmt = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * The parallel month side by side (docs/design/85, phase E): each employee-day whose code differs between
 * the old module and EduPro, and each balance that differs — read again every night of the parallel month.
 */
export default async function CutoverComparePage() {
  let d: CutoverCompare;
  try {
    d = await apiFetch<CutoverCompare>('/staff-cutover/compare');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 409)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Moving from the old module', href: '/leave/setup/cutover' },
          { label: 'Compare the parallel month' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={`Compare · ${d.month}`}
        description={`The days ${dmy(d.from)} to ${dmy(d.to)} and this month’s balances, the old module beside EduPro. A difference is expected where the two count differently on purpose (credits quarterly here, a day not worked out yet); look into the rest before the switch.`}
      />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Days compared" value={d.days.compared.toLocaleString('en-IN')} />
        <KpiTile label="Days that differ" value={String(d.days.differ)} />
        <KpiTile label="Balances compared" value={d.balances.compared.toLocaleString('en-IN')} />
        <KpiTile label="Balances that differ" value={String(d.balances.differ)} />
      </div>
      <section className="ep-card" aria-labelledby="cmp-b">
        <h2 id="cmp-b" className="ep-card__title">
          Balances that differ
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="cmp-b">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Leave type</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Old: available
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  EduPro: available
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Old: credited this month
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  EduPro: credited this month
                </th>
              </tr>
            </thead>
            <tbody>
              {d.balances.rows.length ? (
                d.balances.rows.map((r) => (
                  <tr key={`${r.code}-${r.type}`}>
                    <td>
                      {r.name}
                      <span className="ep-mr-col__desc">{r.code}</span>
                    </td>
                    <td>{r.type}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.old)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.new)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.old_credit)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.new_credit)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>Every balance matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ep-card" aria-labelledby="cmp-d" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="cmp-d" className="ep-card__title">
          Days that differ
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="cmp-d">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Date</th>
                <th scope="col">Old</th>
                <th scope="col">Old in – out</th>
                <th scope="col">EduPro</th>
                <th scope="col">EduPro in – out</th>
              </tr>
            </thead>
            <tbody>
              {d.days.rows.length ? (
                d.days.rows.map((r) => (
                  <tr key={`${r.emp}-${r.day}`}>
                    <td>
                      {r.name}
                      <span className="ep-mr-col__desc">{r.code}</span>
                    </td>
                    <td>
                      <a href={`/leave/attendance/day?emp=${r.emp}&day=${r.day}`}>{dmy(r.day)}</a>
                    </td>
                    <td>{r.old ?? '—'}</td>
                    <td>{[r.old_in, r.old_out].filter(Boolean).join(' – ') || '—'}</td>
                    <td>{r.new ?? 'Not worked out'}</td>
                    <td>{[r.new_in, r.new_out].filter(Boolean).join(' – ') || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>Every day matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
