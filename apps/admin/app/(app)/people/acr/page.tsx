import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { ACR_STATUS, GROUP_LABEL, type AcrRow, type AcrSetup } from '@/lib/acr';
import { acrCloseCycle, acrStartCycle } from '@/lib/acr-actions';

const ORDER: AcrRow['status'][] = ['self', 'review', 'disclosed', 'represented', 'closed'];
const tone = (s: AcrRow['status']) =>
  s === 'closed'
    ? 'success'
    : s === 'represented'
      ? 'danger'
      : s === 'disclosed'
        ? 'warning'
        : 'info';

/** Employee ACR board (docs/design/32-employee-acr.md): a cycle's ACRs, where each stands, and who it waits on. */
export default async function AcrBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    cycle?: string;
    status?: string;
    group?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.acr.view')) notFound();
  const canManage = me.permissions.includes('people.acr.manage');
  const cycleParam = sp.cycle && /^\d{1,18}$/.test(sp.cycle) ? sp.cycle : '';
  const [setup, board] = await Promise.all([
    apiFetch<AcrSetup>('/people/acr/setup'),
    apiFetch<{ cycleId: string | null; rows: AcrRow[]; counts: Record<string, number> }>(
      `/people/acr/board${cycleParam ? `?cycle=${cycleParam}` : ''}`,
    ),
  ]);
  const cycle = setup.cycles.find((c) => c.id === board.cycleId) ?? null;
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = board.rows.filter(
    (r) =>
      (!sp.status || r.status === sp.status) &&
      (!sp.group || r.staffGroup === sp.group) &&
      (!q ||
        `${r.employee.name} ${r.employee.code} ${r.employee.department ?? ''} ${r.employee.designation ?? ''} ${r.level?.waitingOn.join(' ') ?? ''}`
          .toLowerCase()
          .includes(q)),
  );
  const total = board.rows.length;
  const noOne = board.rows.filter((r) => r.level && r.level.waitingOn.length === 0).length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Employee ACR' },
        ]}
      />
      <PageHeader
        kicker="Employee management"
        title="Employee ACR"
        description="Every employee’s annual confidential report for the year: where it stands and who it waits on."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/people/acr/setup">
            Set-up
          </a>
        }
      />
      <Notice params={sp} />
      {!setup.cycles.length ? (
        <div className="ep-card" style={{ padding: 'var(--sp-4)' }}>
          <p style={{ marginTop: 0 }}>No ACR cycle yet.</p>
          <a className="ep-btn ep-btn--primary" href="/people/acr/setup?tab=cycles">
            Add the first cycle
          </a>
        </div>
      ) : (
        <>
          <form
            method="get"
            className="ep-card ep-acr-filter"
            style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
          >
            <label className="ep-field" htmlFor="b-cycle" style={{ margin: 0 }}>
              <span className="ep-field__label">Cycle</span>
              <select
                id="b-cycle"
                name="cycle"
                className="ep-select"
                defaultValue={board.cycleId ?? ''}
              >
                {setup.cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.year})
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="b-status" style={{ margin: 0 }}>
              <span className="ep-field__label">Status</span>
              <select
                id="b-status"
                name="status"
                className="ep-select"
                defaultValue={sp.status ?? ''}
              >
                <option value="">All</option>
                {ORDER.map((s) => (
                  <option key={s} value={s}>
                    {ACR_STATUS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="b-group" style={{ margin: 0 }}>
              <span className="ep-field__label">Staff</span>
              <select id="b-group" name="group" className="ep-select" defaultValue={sp.group ?? ''}>
                <option value="">All</option>
                <option value="teaching">Teaching</option>
                <option value="non_teaching">Non-teaching</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="b-q" style={{ margin: 0 }}>
              <span className="ep-field__label">Name, code, department or reviewer</span>
              <input
                id="b-q"
                name="q"
                className="ep-input"
                type="search"
                defaultValue={sp.q ?? ''}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Show
            </button>
          </form>

          {cycle ? (
            <div
              className="ep-card"
              style={{
                padding: 'var(--sp-3)',
                marginBottom: 'var(--sp-4)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>
                <strong>{cycle.name}</strong> · self-appraisal {dmy(cycle.selfFrom)} –{' '}
                {dmy(cycle.selfTo)}
                {cycle.reviewBy ? ` · reviews by ${dmy(cycle.reviewBy)}` : ''} ·{' '}
                <Badge
                  tone={
                    cycle.status === 'open'
                      ? 'success'
                      : cycle.status === 'closed'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {cycle.status === 'draft'
                    ? 'Not started'
                    : cycle.status === 'open'
                      ? 'Open'
                      : 'Closed'}
                </Badge>
              </span>
              {canManage && cycle.status !== 'closed' ? (
                <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <ConfirmAction
                    action={acrStartCycle}
                    fields={{ cycleId: cycle.id }}
                    label={cycle.status === 'draft' ? 'Start the cycle' : 'Add new joiners'}
                    variant="primary"
                    title={
                      cycle.status === 'draft'
                        ? `Start ${cycle.name}?`
                        : 'Add ACRs for staff who have none?'
                    }
                    confirmLabel={cycle.status === 'draft' ? 'Start' : 'Add'}
                  >
                    An ACR is made for every active employee who has none, with the people of each
                    level from the set-up and the employee records.
                  </ConfirmAction>
                  {cycle.status === 'open' ? (
                    <ConfirmAction
                      action={acrCloseCycle}
                      fields={{ cycleId: cycle.id }}
                      label="Close the cycle"
                      variant="ghost"
                      title={`Close ${cycle.name}?`}
                      confirmLabel="Close"
                    >
                      The cycle is marked closed; ACRs still with the levels stay where they are.
                    </ConfirmAction>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="ep-dash-kpis">
            <div className="ep-card ep-card--elevated ep-staff-kpi">
              <span className="ep-kpi__value">{total}</span>
              <span className="ep-kpi__label">ACRs</span>
            </div>
            {ORDER.map((s) => (
              <a
                key={s}
                className="ep-card ep-card--elevated ep-staff-kpi"
                href={`?cycle=${board.cycleId ?? ''}&status=${s}`}
              >
                <span className="ep-kpi__value">{board.counts[s] ?? 0}</span>
                <span className="ep-kpi__label">{ACR_STATUS[s]}</span>
              </a>
            ))}
            {noOne ? (
              <div className="ep-card ep-card--elevated ep-staff-kpi">
                <span className="ep-kpi__value">{noOne}</span>
                <span className="ep-kpi__label">Waiting on nobody (set the people)</span>
              </div>
            ) : null}
          </div>

          {rows.length ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/people/acr/print?ids=${rows
                  .slice(0, 100)
                  .map((r) => r.id)
                  .join(',')}`}
                target="_blank"
                rel="noopener"
              >
                Print the {Math.min(rows.length, 100)} shown
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/acr-excel?${new URLSearchParams({
                  cycle: board.cycleId ?? '',
                  status: sp.status ?? '',
                  group: sp.group ?? '',
                  q: sp.q ?? '',
                }).toString()}`}
              >
                Excel
              </a>
            </div>
          ) : null}
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="ACRs (scrolls sideways)"
          >
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Staff</th>
                  <th scope="col">Status</th>
                  <th scope="col">Waiting on</th>
                  <th scope="col">Self %</th>
                  <th scope="col">Score %</th>
                  <th scope="col">Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/people/acr/${r.id}`}>
                        <strong>{r.employee.name}</strong>
                      </a>
                      <div className="ep-field__help">
                        {[r.employee.code, r.employee.designation, r.employee.department]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>{GROUP_LABEL[r.staffGroup]}</td>
                    <td>
                      <Badge tone={tone(r.status)}>{ACR_STATUS[r.status]}</Badge>
                    </td>
                    <td>
                      {r.status === 'self'
                        ? 'The employee'
                        : r.level
                          ? `${r.level.label ?? ''}: ${r.level.waitingOn.length ? r.level.waitingOn.join(', ') : 'nobody set'}`
                          : r.status === 'disclosed'
                            ? `The employee (until ${dmy(r.objectBy)})`
                            : r.status === 'represented'
                              ? 'The school (objection)'
                              : '—'}
                    </td>
                    <td>{r.selfPct ?? '—'}</td>
                    <td>{r.scorePct ?? '—'}</td>
                    <td>
                      {r.grade ?? '—'}
                      {r.adverse ? <span className="ep-field__help"> (adverse)</span> : null}
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7}>
                      {total ? 'No ACR matches.' : 'No ACRs yet: start the cycle.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '—';
