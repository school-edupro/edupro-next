import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApplyTemplate } from '@/components/payroll/ApplyTemplate';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { CALC_LABEL, dmy, money, type StructureView } from '@/lib/payroll';
import { savePayrollStructure, structureDrafts } from '@/lib/payroll-actions';

/** An employee's salary structure: the amounts in force on a day, drafts waiting, and every dated amount. */
export default async function PayrollStructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { employeeId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(employeeId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf ?? '') ? `?asOf=${sp.asOf!}` : '';
  let d: StructureView;
  try {
    d = await apiFetch<StructureView>(`/payroll/structures/${employeeId}${asOf}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const e = d.employee;
  const here = `/payroll/setup/structures/${e.id}`;
  // the fixed heads are typed; formula, slab and system heads work themselves out in the run
  const typed = d.heads.filter(
    (h) => h.calcType === 'FIXED' || h.calcType === 'MANUAL' || h.liveAmount || h.draftAmount,
  );
  const worked = d.heads.filter((h) => !typed.includes(h));
  const drafts = d.heads.filter((h) => h.draftId);
  const fixedTotal = typed
    .filter((h) => h.headType === 'EARNING')
    .reduce((n, h) => n + Number(h.liveAmount ?? 0), 0);
  const fixedDed = typed
    .filter((h) => h.headType === 'DEDUCTION')
    .reduce((n, h) => n + Number(h.liveAmount ?? 0), 0);
  const draftFrom = drafts[0]?.draftFrom ?? null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Salary structures', href: '/payroll/setup/structures' },
          { label: e.code },
        ]}
      />
      <PageHeader
        kicker="Salary structure"
        title={`${e.name} (${e.code})`}
        description={[e.designation, e.department, e.staffType].filter(Boolean).join(' · ')}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label={`Fixed earnings on ${dmy(d.asOf)}`} value={`₹${money(fixedTotal)}`} />
        <KpiTile label="Fixed deductions" value={`₹${money(fixedDed)}`} />
        <KpiTile
          label="Heads with an amount"
          value={String(typed.filter((h) => h.liveAmount).length)}
        />
        <KpiTile
          label="Drafts waiting"
          value={drafts.length ? `${String(drafts.length)} from ${dmy(draftFrom)}` : 'None'}
        />
      </div>
      {drafts.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div className="ep-grid__toolbar">
            <span>
              <strong>Drafts wait for a checker:</strong> {drafts.length} amount(s) from{' '}
              {dmy(draftFrom)}, made by {drafts[0]?.draftBy ?? 'someone'}.
            </span>
            <span className="ep-grid__spacer" />
            <form action={structureDrafts} className="ep-grid__toolbar">
              <input type="hidden" name="employeeIds" value={e.id} />
              <input type="hidden" name="back" value={here} />
              {d.can.approve ? (
                <button
                  type="submit"
                  name="do"
                  value="approve"
                  className="ep-btn ep-btn--primary ep-btn--sm"
                >
                  Approve
                </button>
              ) : null}
              {d.can.manage ? (
                <button
                  type="submit"
                  name="do"
                  value="delete"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                >
                  Delete the drafts
                </button>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
      <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="ep-field" htmlFor="sv-asof">
          <span className="ep-field__label">Amounts in force on</span>
          <input id="sv-asof" name="asOf" type="date" className="ep-input" defaultValue={d.asOf} />
        </label>
        <button type="submit" className="ep-btn ep-btn--ghost">
          Show
        </button>
      </form>
      <form id="sv-form" action={savePayrollStructure.bind(null, e.id)}>
        <section className="ep-card" aria-labelledby="sv-heads">
          <div className="ep-grid__toolbar">
            <h2 id="sv-heads" className="ep-card__title">
              Amounts a month
            </h2>
            <span className="ep-grid__spacer" />
            {d.can.manage ? <ApplyTemplate formId="sv-form" templates={d.templates} /> : null}
          </div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="sv-heads">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Head</th>
                  <th scope="col">In force (₹)</th>
                  <th scope="col">Since</th>
                  <th scope="col">Draft (₹)</th>
                  {d.can.manage ? <th scope="col">New amount (₹)</th> : null}
                </tr>
              </thead>
              <tbody>
                {typed.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <code>{h.code}</code> {h.name}
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {h.headType === 'EARNING' ? 'Earning' : 'Deduction'}
                        {h.calcType ? ` · ${CALC_LABEL[h.calcType] ?? h.calcType}` : ''}
                      </span>
                    </td>
                    <td>{h.liveAmount ? money(h.liveAmount) : ''}</td>
                    <td>{h.liveFrom ? dmy(h.liveFrom) : ''}</td>
                    <td>
                      {h.draftAmount ? (
                        <Badge tone="warning">{`${money(h.draftAmount)} from ${dmy(h.draftFrom)}`}</Badge>
                      ) : (
                        ''
                      )}
                    </td>
                    {d.can.manage ? (
                      <td>
                        <input type="hidden" name="headId" value={h.id} />
                        <input
                          name={`amount_${h.id}`}
                          data-head={h.code}
                          aria-label={`New amount for ${h.name}`}
                          className="ep-input"
                          inputMode="decimal"
                          defaultValue=""
                          placeholder={h.liveAmount ?? ''}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.can.manage ? (
            <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
              <label className="ep-field" htmlFor="sv-from">
                <span className="ep-field__label">From</span>
                <input
                  id="sv-from"
                  name="effectiveFrom"
                  type="date"
                  className="ep-input"
                  required
                />
                <span className="ep-field__help">
                  The amounts before it end the day before, once approved
                </span>
              </label>
              <label className="ep-field" htmlFor="sv-why">
                <span className="ep-field__label">Why</span>
                <input
                  id="sv-why"
                  name="changeReason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={200}
                  placeholder="Annual increment"
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save as drafts
              </button>
            </div>
          ) : null}
          {d.can.manage ? (
            <p className="ep-field__help">
              Type only the amounts that change (0 stops a head). An empty box keeps the amount in
              force.
            </p>
          ) : null}
        </section>
      </form>
      {worked.length ? (
        <FoldCard
          id="sv-worked"
          title="Worked out in the run"
          hint={worked.map((h) => h.code).join(', ')}
        >
          <ul className="ep-setup-links">
            {worked.map((h) => (
              <li key={h.id}>
                <code>{h.code}</code> {h.name} —{' '}
                {CALC_LABEL[h.calcType ?? ''] ?? 'no version in force'}
                {h.formula ? (
                  <>
                    {' '}
                    <code className="ep-field__help">{h.formula}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
      <FoldCard
        id="sv-time"
        title="Timeline"
        hint={
          d.timeline.length
            ? `${String(d.timeline.length)} dated amount(s), the latest from ${dmy(d.timeline[0]?.effectiveFrom)}`
            : 'Every dated amount, with who made and approved it'
        }
      >
        {d.timeline.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="sv-time">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Head</th>
                  <th scope="col">Amount (₹)</th>
                  <th scope="col">Status</th>
                  <th scope="col">Why</th>
                  <th scope="col">Made · approved by</th>
                </tr>
              </thead>
              <tbody>
                {d.timeline.map((t) => (
                  <tr key={t.id}>
                    <td>{dmy(t.effectiveFrom)}</td>
                    <td>{t.effectiveTo ? dmy(t.effectiveTo) : 'Open'}</td>
                    <td>
                      <code>{t.code}</code> {t.name}
                    </td>
                    <td>{money(t.amount)}</td>
                    <td>
                      <Badge
                        tone={
                          t.status === 'draft'
                            ? 'warning'
                            : t.status === 'active'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {t.status === 'draft'
                          ? 'Draft'
                          : t.status === 'active'
                            ? 'Approved'
                            : 'Ended'}
                      </Badge>
                    </td>
                    <td>{t.changeReason ?? ''}</td>
                    <td>
                      {t.madeBy ?? ''}
                      {t.approvedBy ? ` · ${t.approvedBy}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No amounts yet.</p>
        )}
      </FoldCard>
    </>
  );
}
