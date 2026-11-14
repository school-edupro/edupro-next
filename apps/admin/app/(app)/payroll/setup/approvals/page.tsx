import { Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { TickAll } from '@/components/TickAll';
import { SetupListBar } from '@/components/payroll/SetupListBar';
import { ApiError, getMe } from '@/lib/api';
import { dmy, type ConfigKind, type StructureDrafts } from '@/lib/payroll';
import { approvePayrollConfig, structureDrafts } from '@/lib/payroll-actions';
import { setupList, type SetupList, type SetupListNav } from '@/lib/payroll-lists';

/** Drafts to approve: every payroll draft waiting for a checker who did not make it. */
export default async function PayrollApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  type Draft = {
    kind: ConfigKind | 'head';
    kindLabel: string;
    id: string;
    what: string;
    from: string | null;
    by: string | null;
    mine: boolean;
    why: string | null;
    href: string;
  };
  let st: { list: SetupList<StructureDrafts['rows'][number]>; nav: SetupListNav };
  let sd: { list: SetupList<Draft>; nav: SetupListNav };
  try {
    [st, sd] = await Promise.all([
      setupList<StructureDrafts['rows'][number]>(
        'structure-drafts',
        '/payroll/setup/approvals',
        sp,
        { prefix: 'st' },
      ),
      setupList<Draft>('setup-drafts', '/payroll/setup/approvals', sp, { prefix: 'sd' }),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = {
    manage: me.permissions.includes('payroll.setup.manage'),
    approve: me.permissions.includes('payroll.setup.approve'),
  };
  const counts = (sd.list.extra ?? {}) as { rates?: number; versions?: number };
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Drafts to approve' },
        ]}
      />
      <PageHeader
        kicker="Payroll"
        title="Drafts to approve"
        description={
          can.approve
            ? 'Every payroll change waits here until a checker who did not make it approves it. Approving puts it in force from its date; the row it replaces ends the day before.'
            : 'Every payroll change waits here until a payroll checker approves it.'
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--3">
        <KpiTile label="Rates and rules" value={String(counts.rates ?? 0)} />
        <KpiTile label="Pay-head versions" value={String(counts.versions ?? 0)} />
        <KpiTile label="Staff with structure drafts" value={String(st.list.all)} />
      </div>
      <section className="ep-card" aria-labelledby="ap-st">
        <h2 id="ap-st" className="ep-card__title">
          Salary structures
        </h2>
        <SetupListBar list={st.list} nav={st.nav} id="ap-st">
          {st.list.rows.length ? (
            <form id="ap-st-form" action={structureDrafts}>
              <input type="hidden" name="back" value="/payroll/setup/approvals" />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ap-st">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">
                        <TickAll name="employeeIds" label="All" />
                      </th>
                      <th scope="col">Employee</th>
                      <th scope="col">Department</th>
                      <th scope="col">Amounts</th>
                      <th scope="col">From</th>
                      <th scope="col">Made by · on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.list.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <input
                            type="checkbox"
                            name="employeeIds"
                            value={r.id}
                            aria-label={`Tick ${r.name}`}
                          />
                        </td>
                        <td>
                          <a href={`/payroll/setup/structures/${r.id}`}>{r.name}</a>
                          <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                            {r.code}
                            {r.mine ? ' · made by you' : ''}
                          </span>
                        </td>
                        <td>{r.department ?? ''}</td>
                        <td>{r.lines}</td>
                        <td>{dmy(r.effectiveFrom)}</td>
                        <td>
                          {r.madeBy ?? ''} · {dmy(r.madeAt.slice(0, 10))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ep-grid__toolbar">
                {can.approve ? (
                  <button
                    type="submit"
                    name="do"
                    value="approve"
                    className="ep-btn ep-btn--primary"
                  >
                    Approve the ticked
                  </button>
                ) : null}
                {can.manage ? (
                  <button type="submit" name="do" value="delete" className="ep-btn ep-btn--ghost">
                    Delete the ticked drafts
                  </button>
                ) : null}
                <span className="ep-field__help">
                  Each employee is approved whole or not at all; your own drafts need another
                  checker.
                </span>
              </p>
            </form>
          ) : (
            <p>
              {st.list.all
                ? 'No structure draft matches the filters.'
                : 'No structure drafts wait.'}
            </p>
          )}
        </SetupListBar>
      </section>
      <section className="ep-card" aria-labelledby="ap-rates" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ap-rates" className="ep-card__title">
          Rates, statutory rules and pay-head versions
        </h2>
        <SetupListBar list={sd.list} nav={sd.nav} id="ap-sd">
          {sd.list.rows.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ap-rates">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">What</th>
                    <th scope="col">From</th>
                    <th scope="col">Made by</th>
                    <th scope="col">Why</th>
                    <th scope="col">
                      <span className="ep-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sd.list.rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td>
                        <a href={r.href}>{r.kindLabel}</a>
                      </td>
                      <td>{r.what}</td>
                      <td>{dmy(r.from)}</td>
                      <td>
                        {r.by ?? ''}
                        {r.mine ? ' (you)' : ''}
                      </td>
                      <td>{r.why ?? ''}</td>
                      <td>
                        {r.kind === 'head' ? (
                          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={r.href}>
                            Open the head
                          </a>
                        ) : can.approve ? (
                          <form
                            action={approvePayrollConfig.bind(
                              null,
                              r.kind,
                              r.id,
                              '/payroll/setup/approvals',
                            )}
                          >
                            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                              Approve
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {sd.list.all
                ? 'No draft matches the filters.'
                : 'No rate, rule or pay-head drafts wait.'}
            </p>
          )}
        </SetupListBar>
        <p className="ep-field__help">
          A pay-head version is approved on its head, where its formula and tests are.
        </p>
      </section>
    </>
  );
}
