import { Breadcrumbs, Button, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApprovalLevelsEditor } from '@/components/recruitment/ApprovalLevelsEditor';
import { apiFetch, getMe } from '@/lib/api';
import { DOC_LABEL, inr, type DepartmentApprovals, type PurchaseDoc } from '@/lib/purchase';
import { saveDepartmentLevels, saveDepartmentRules } from '@/lib/purchase-actions';
import type { ApprovalSetup } from '@/lib/recruitment';

const DOCS: PurchaseDoc[] = ['indent', 'requisition', 'order', 'inspection'];
const INTRO: Record<PurchaseDoc, string> = {
  indent:
    'A PI the department raises goes through these levels in order. A level nobody holds is skipped; a level held by the person who raised it passes to the next level (nobody approves their own).',
  requisition:
    'A PR for this department goes through these levels (a PR combining departments uses the purchase office department’s, set in Settings).',
  order:
    'A PO for this department goes through these levels. Its maker never approves it: their level passes to the next.',
  inspection:
    'Goods and services received against this department’s POs are inspected and accepted at these levels. When none is set, the department’s HOD inspects (the school admin when there is no HOD). Whoever received it never inspects it; POs above the committee limit are inspected by the purchase committee instead.',
};

/**
 * Who approves (docs/design/83, part 1): per department, up to three levels for its PIs, PRs, POs and
 * the inspection of what is received (doc 84, part 7) —
 * named employees, everyone with a designation, or the department's HOD — and the department's bypass
 * rules (a PI under its limit, or all on rate contract, skips the PR; part 2).
 */
export default async function PurchaseApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('purchase.master.view')) notFound();
  const canManage = me.permissions.includes('purchase.settings.manage');
  const a = await apiFetch<DepartmentApprovals>('/purchase/approvals');
  const dep = a.departments.find((d) => d.id === sp.department) ?? null;
  const setupFor = (doc: PurchaseDoc): ApprovalSetup => ({
    levels: (dep?.levels[doc] ?? []).map((l) => ({
      name: l.name,
      by: l.by,
      employeeIds: l.employeeIds,
      designation: l.designation,
      roleCode: null,
      slaHours: l.slaHours,
      need: l.need ?? 'any',
    })),
    staff: a.staff,
    designations: a.designations,
    departments: dep
      ? [
          {
            name: dep.name,
            hod: dep.hod
              ? { code: dep.hod.code, name: dep.hod.name, signsIn: dep.hod.signsIn }
              : null,
          },
        ]
      : [],
    roles: [],
    waiting: 0,
    can: { manage: canManage },
  });
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Who approves' }]} />
      <PageHeader
        kicker="Purchase"
        title="Who approves"
        description="Each department’s approval levels for its Purchase Indents, Requisitions and Orders (up to three each), and its bypass rules. The amount is shown first to every approver."
      />
      <Notice params={sp} />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Departments">
        <table className="ep-table" data-density="dense">
          <caption className="ep-sr-only">Departments and their approval levels</caption>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">HOD</th>
              <th scope="col" className="is-numeric">
                PI levels
              </th>
              <th scope="col" className="is-numeric">
                PR levels
              </th>
              <th scope="col" className="is-numeric">
                PO levels
              </th>
              <th scope="col" className="is-numeric">
                Inspection levels
              </th>
              <th scope="col">Skips the PR</th>
            </tr>
          </thead>
          <tbody>
            {a.departments.map((d) => (
              <tr key={d.id} aria-current={d.id === dep?.id ? 'true' : undefined}>
                <td>
                  <a href={`/purchase/approvals?department=${d.id}`}>{d.name}</a>
                </td>
                <td>{d.hod ? d.hod.name : '—'}</td>
                {DOCS.map((doc) => (
                  <td key={doc} className="is-numeric">
                    {d.levels[doc].length || (doc === 'inspection' ? 'HOD' : '—')}
                  </td>
                ))}
                <td>
                  {[
                    d.rules.bypassLimit ? `under ${inr(d.rules.bypassLimit)}` : null,
                    d.rules.rateContractBypass ? 'all on rate contract' : null,
                  ]
                    .filter(Boolean)
                    .join('; ') || 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        method="get"
        action="/purchase/approvals"
        className="ep-grid__toolbar"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="pa-dep">
          <span className="ep-field__label">Department</span>
          <select id="pa-dep" name="department" className="ep-select" defaultValue={dep?.id ?? ''}>
            <option value="">Pick a department</option>
            {a.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Open
        </Button>
      </form>
      {dep ? (
        <>
          <section
            className="ep-card"
            aria-labelledby="pa-rules"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h2 id="pa-rules" className="ep-card__title">
              {dep.name}: when a PI skips the PR
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              The PR is then made and approved by the system with the rule written on it. Small PIs
              of the same category within the split window (Settings) are added together first.
            </p>
            <form action={saveDepartmentRules} className="ep-grid__toolbar">
              <input type="hidden" name="departmentId" value={dep.id} />
              <label className="ep-field" htmlFor="pa-limit">
                <span className="ep-field__label">A PI under (₹; 0 = never)</span>
                <input
                  id="pa-limit"
                  name="bypassLimit"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={String(dep.rules.bypassLimit)}
                  disabled={!canManage}
                />
              </label>
              <label className="ep-check" htmlFor="pa-rc">
                <input
                  id="pa-rc"
                  name="rateContractBypass"
                  className="ep-check__input"
                  type="checkbox"
                  defaultChecked={dep.rules.rateContractBypass}
                  disabled={!canManage}
                />
                <span className="ep-check__box" />
                Every line on a rate contract
              </label>
              {canManage ? (
                <Button type="submit" variant="secondary" size="sm">
                  Save the rules
                </Button>
              ) : null}
            </form>
          </section>
          {DOCS.map((doc) => (
            <div key={doc} style={{ marginTop: 'var(--sp-4)' }}>
              <ApprovalLevelsEditor
                setup={setupFor(doc)}
                save={saveDepartmentLevels.bind(null, dep.id, doc)}
                title={
                  doc === 'inspection'
                    ? `${dep.name}: who inspects goods and services received`
                    : `${dep.name}: who approves a ${DOC_LABEL[doc]}`
                }
                intro={INTRO[doc]}
                hodLabel={`HOD of ${dep.name}`}
                hodHelp={`The HOD set on ${dep.name} approves.`}
                waitingNoun={['document', 'documents']}
                idPrefix={`pa-${doc}`}
                maxLevels={3}
                allowAll
              />
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}
