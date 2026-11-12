import { Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { TickAll } from '@/components/TickAll';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  dmy,
  type ConfigKind,
  type ConfigList,
  type HeadListRow,
  type PayrollCan,
  type StructureDrafts,
} from '@/lib/payroll';
import { approvePayrollConfig, structureDrafts } from '@/lib/payroll-actions';

const KIND_LABEL: Record<ConfigKind, string> = {
  rates: 'Rate',
  pf: 'PF',
  esi: 'ESI',
  pt: 'Profession tax',
  lwf: 'LWF',
  ot: 'Overtime rate',
};
const KINDS = Object.keys(KIND_LABEL) as ConfigKind[];
/** a draft's main value, in a few words */
const what = (kind: ConfigKind, r: ConfigList['rows'][number]) =>
  kind === 'rates'
    ? `${String(r.rateCode)} = ${String(r.rateValue)}`
    : kind === 'pt' || kind === 'lwf'
      ? `${String(r.stateCode)}${r.wageFrom ? ` from ₹${String(r.wageFrom)}` : ''}`
      : kind === 'ot'
        ? String(r.employeeType)
        : '';

/** Drafts to approve: every payroll draft waiting for a checker who did not make it. */
export default async function PayrollApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let structures: StructureDrafts;
  let configs: ConfigList[];
  let heads: { heads: HeadListRow[]; can: PayrollCan };
  try {
    [structures, heads, ...configs] = await Promise.all([
      apiFetch<StructureDrafts>('/payroll/structures/drafts'),
      apiFetch<{ heads: HeadListRow[]; can: PayrollCan }>('/payroll/heads'),
      ...KINDS.map((k) => apiFetch<ConfigList>(`/payroll/config/${k}?status=draft`)),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = structures.can;
  const rateDrafts = configs.flatMap((c) => c.rows.map((r) => ({ kind: c.kind, r })));
  const headDrafts = heads.heads.filter((h) => h.drafts > 0);
  const versionCount = headDrafts.reduce((n, h) => n + h.drafts, 0);
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
        <KpiTile label="Rates and rules" value={String(rateDrafts.length)} />
        <KpiTile label="Pay-head versions" value={String(versionCount)} />
        <KpiTile label="Staff with structure drafts" value={String(structures.rows.length)} />
      </div>
      <section className="ep-card" aria-labelledby="ap-st">
        <h2 id="ap-st" className="ep-card__title">
          Salary structures
        </h2>
        {structures.rows.length ? (
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
                  {structures.rows.map((r) => (
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
                <button type="submit" name="do" value="approve" className="ep-btn ep-btn--primary">
                  Approve the ticked
                </button>
              ) : null}
              {can.manage ? (
                <button type="submit" name="do" value="delete" className="ep-btn ep-btn--ghost">
                  Delete the ticked drafts
                </button>
              ) : null}
              <span className="ep-field__help">
                Each employee is approved whole or not at all; your own drafts need another checker.
              </span>
            </p>
          </form>
        ) : (
          <p>No structure drafts wait.</p>
        )}
      </section>
      <section className="ep-card" aria-labelledby="ap-rates" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ap-rates" className="ep-card__title">
          Rates and statutory rules
        </h2>
        {rateDrafts.length ? (
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
                {rateDrafts.map(({ kind, r }) => (
                  <tr key={`${kind}-${r.id}`}>
                    <td>
                      <a href={`/payroll/setup/rates?tab=${kind}&status=draft`}>
                        {KIND_LABEL[kind]}
                      </a>
                    </td>
                    <td>{what(kind, r)}</td>
                    <td>{dmy(r.effectiveFrom)}</td>
                    <td>
                      {r.createdByName ?? ''}
                      {r.mine ? ' (you)' : ''}
                    </td>
                    <td>{r.changeReason ?? ''}</td>
                    <td>
                      {can.approve ? (
                        <form
                          action={approvePayrollConfig.bind(
                            null,
                            kind,
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
          <p>No rate drafts wait.</p>
        )}
      </section>
      <section className="ep-card" aria-labelledby="ap-heads" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ap-heads" className="ep-card__title">
          Pay-head versions
        </h2>
        {headDrafts.length ? (
          <ul className="ep-setup-links">
            {headDrafts.map((h) => (
              <li key={h.id}>
                <a href={`/payroll/setup/heads/${h.id}`}>
                  <code>{h.code}</code> {h.name}
                </a>{' '}
                — {h.drafts} draft version(s): open the head to see the formula and its tests, then
                approve.
              </li>
            ))}
          </ul>
        ) : (
          <p>No pay-head drafts wait.</p>
        )}
      </section>
    </>
  );
}
