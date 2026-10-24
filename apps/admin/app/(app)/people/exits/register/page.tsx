import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { apiFetch, getMe } from '@/lib/api';
import { dmy, type ExitRegisterRow, type ExitSetup } from '@/lib/exits';

const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const FNF: Record<string, string> = {
  draft: 'Being prepared',
  submitted: 'Waiting for approval',
  approved: 'Approved, to pay',
  paid: 'Settled',
};

/** The exit register (docs/design/38, part 7): who left or is leaving, with the settlement; Excel. */
export default async function ExitRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; exitType?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.exit.view')) notFound();
  const q = new URLSearchParams();
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q.set('from', sp.from);
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q.set('to', sp.to);
  if (sp.exitType && /^[a-z][a-z0-9_]{1,39}$/.test(sp.exitType)) q.set('exitType', sp.exitType);
  const [list, setup] = await Promise.all([
    apiFetch<{ data: ExitRegisterRow[] }>(
      `/people/exits/register${q.size ? `?${q.toString()}` : ''}`,
    ),
    apiFetch<ExitSetup>('/people/exits/setup'),
  ]);
  const left = list.data.filter((x) => x.status === 'closed').length;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations', href: '/people/exits' },
          { label: 'Exit register' },
        ]}
      />
      <PageHeader
        kicker="Employee exit"
        title="Exit register"
        description="Staff who left (closed) or are leaving (accepted), with the full and final settlement."
        actions={
          <a
            className="ep-btn ep-btn--secondary"
            href={`/api/exit-register${q.size ? `?${q.toString()}` : ''}`}
          >
            Download Excel
          </a>
        }
      />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{left}</span>
          <span className="ep-kpi__label">Left</span>
        </div>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{list.data.length - left}</span>
          <span className="ep-kpi__label">Leaving</span>
        </div>
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">
            {list.data.filter((x) => x.fnfStatus && x.fnfStatus !== 'paid').length}
          </span>
          <span className="ep-kpi__label">Settlements open</span>
        </div>
      </div>
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="er-from" style={{ margin: 0 }}>
          <span className="ep-field__label">Leaving from</span>
          <input
            id="er-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={sp.from ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor="er-to" style={{ margin: 0 }}>
          <span className="ep-field__label">to</span>
          <input id="er-to" name="to" type="date" className="ep-input" defaultValue={sp.to ?? ''} />
        </label>
        <label className="ep-field" htmlFor="er-type" style={{ margin: 0 }}>
          <span className="ep-field__label">Exit</span>
          <select
            id="er-type"
            name="exitType"
            className="ep-select"
            defaultValue={sp.exitType ?? ''}
          >
            <option value="">All</option>
            {setup.types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Exit register (scrolls sideways)"
      >
        <table className="ep-table">
          <caption className="ep-sr-only">Exit register</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Exit</th>
              <th scope="col">Last working day</th>
              <th scope="col">Status</th>
              <th scope="col">Full and final</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((x) => (
              <tr key={x.id}>
                <td>
                  <a href={`/people/exits/${x.id}`}>
                    <strong>{x.name}</strong>
                  </a>
                  <div className="ep-field__help">
                    {[x.code, x.designation, x.department].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  {x.exitType}
                  <div className="ep-field__help">asked {dmy(x.requestedOn)}</div>
                </td>
                <td>{dmy(x.leftOn ?? x.lastDay)}</td>
                <td>{x.status === 'closed' ? 'Left' : 'Leaving'}</td>
                <td>
                  {x.fnfStatus ? (
                    <>
                      {FNF[x.fnfStatus] ?? x.fnfStatus}
                      {x.net !== null ? (
                        <div className="ep-field__help">
                          {x.net >= 0 ? 'payable' : 'recoverable'} {rs(Math.abs(x.net))}
                          {x.paidOn ? ` · ${dmy(x.paidOn)}` : ''}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    'Not started'
                  )}
                </td>
              </tr>
            ))}
            {!list.data.length ? (
              <tr>
                <td colSpan={5}>Nobody in this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
