import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { EXIT_STATUS, dmy, type ExitRow, type ExitStatus } from '@/lib/exits';

const ORDER: ExitStatus[] = ['pending', 'sent_back', 'approved', 'closed', 'rejected', 'withdrawn'];

/** Employee exits (docs/design/38): resignations from the staff app and exits the office recorded. */
export default async function ExitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.exit.view')) notFound();
  const canManage = me.permissions.includes('people.exit.manage');
  const status = ORDER.includes(sp.status as ExitStatus) ? (sp.status as ExitStatus) : '';
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (sp.q?.trim()) qs.set('q', sp.q.trim().slice(0, 80));
  const list = await apiFetch<{ data: ExitRow[]; counts: Partial<Record<ExitStatus, number>> }>(
    `/people/exits${qs.size ? `?${qs.toString()}` : ''}`,
  );
  const total = Object.values(list.counts).reduce((n, x) => n + (x ?? 0), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations' },
        ]}
      />
      <PageHeader
        kicker="Employee exit"
        title="Exits and resignations"
        description="Resignations asked for in the staff app and exits the office recorded, through the approval levels of each employee type."
        actions={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--secondary" href="/people/exits/setup">
              Set-up
            </a>
            {canManage ? (
              <a className="ep-btn ep-btn--primary" href="/people/exits/new">
                Record an exit
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <a className="ep-card ep-card--elevated ep-staff-kpi" href="?">
          <span className="ep-kpi__value">{total}</span>
          <span className="ep-kpi__label">All exits</span>
        </a>
        {ORDER.map((s) => (
          <a key={s} className="ep-card ep-card--elevated ep-staff-kpi" href={`?status=${s}`}>
            <span className="ep-kpi__value">{list.counts[s] ?? 0}</span>
            <span className="ep-kpi__label">{EXIT_STATUS[s].label}</span>
          </a>
        ))}
      </div>
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="ex-status" style={{ margin: 0 }}>
          <span className="ep-field__label">Status</span>
          <select id="ex-status" name="status" className="ep-select" defaultValue={status}>
            <option value="">All</option>
            {ORDER.map((s) => (
              <option key={s} value={s}>
                {EXIT_STATUS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="ex-q" style={{ margin: 0 }}>
          <span className="ep-field__label">Employee name or code</span>
          <input id="ex-q" name="q" type="search" className="ep-input" defaultValue={sp.q ?? ''} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Exits (scrolls sideways)"
      >
        <table className="ep-table">
          <caption className="ep-sr-only">Employee exits</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Exit</th>
              <th scope="col">Asked on</th>
              <th scope="col">Last working day</th>
              <th scope="col">Status</th>
              <th scope="col">Where it is</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((x) => (
              <tr key={x.id}>
                <td>
                  <a href={`/people/exits/${x.id}`}>
                    <strong>{x.employee.name}</strong>
                  </a>
                  <div className="ep-field__help">
                    {[x.employee.code, x.employee.typeName, x.employee.department]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td>
                  {x.exitType.name}
                  <div className="ep-field__help">
                    {x.bySelf ? 'Asked by the employee' : 'Recorded by the office'}
                  </div>
                </td>
                <td>{dmy(x.requestedOn)}</td>
                <td>
                  {dmy(x.acceptedLastDay ?? x.proposedLastDay)}
                  {x.shortfallDays ? (
                    <div className="ep-field__help">{x.shortfallDays} days short of notice</div>
                  ) : null}
                </td>
                <td>
                  <Badge tone={EXIT_STATUS[x.status].tone}>{EXIT_STATUS[x.status].label}</Badge>
                </td>
                <td>
                  {x.status === 'pending'
                    ? (x.waitingAt ?? 'With the approvers')
                    : x.status === 'sent_back'
                      ? (x.sentBackNote ?? 'Sent back')
                      : (x.decisionNote ?? '—')}
                </td>
              </tr>
            ))}
            {!list.data.length ? (
              <tr>
                <td colSpan={6}>{total ? 'No exit matches.' : 'No exit yet.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
