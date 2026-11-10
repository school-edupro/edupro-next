import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ScopePicker } from '@/components/leave/ScopePicker';
import { ApprovalLevelsEditor } from '@/components/recruitment/ApprovalLevelsEditor';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ApprovalRuleDetail, ApprovalRules } from '@/lib/leave';
import { saveApprovalBand, setApprovalRuleStatus, updateApprovalRule } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const LENGTH_TITLES = [
  'Short leave · up to 7 days',
  'Medium leave · 8 to 30 days',
  'Long leave · more than 30 days',
];

/**
 * One approval rule (docs/design/85, "Who approves"): who it is for and which leave type, then the
 * levels of each day band (up to 3; named staff, the reporting manager, the HOD, a designation or a
 * role); switch it off or on.
 */
export default async function LeaveApprovalRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ID.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  let d: ApprovalRuleDetail;
  let lists: ApprovalRules;
  try {
    [d, lists] = await Promise.all([
      apiFetch<ApprovalRuleDetail>(`/leave/setup/approvals/${id}`),
      apiFetch<ApprovalRules>('/leave/setup/approvals'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const r = d.rule;
  const reg = r.kind === 'regularisation';
  const what = reg ? 'attendance correction' : 'leave';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Who approves', href: '/leave/setup/approvals' },
          ...(r.scope === 'employee'
            ? []
            : [{ label: 'Group rules', href: '/leave/setup/approvals/rules' }]),
          { label: r.name },
        ]}
      />
      <PageHeader
        kicker={reg ? 'Who approves · attendance corrections' : 'Who approves · leave'}
        title={r.name}
        description={`For: ${r.scopeWords}${reg ? '' : ` · ${r.leaveType ? `only ${r.leaveType.name}` : 'any leave type'}`}`}
        actions={r.status === 'inactive' ? <Badge tone="neutral">Switched off</Badge> : undefined}
      />
      <Notice params={sp} />
      {d.can.manage ? (
        <section className="ep-card" aria-labelledby="lr-who">
          <h2 id="lr-who" className="ep-card__title">
            Name and who it is for
          </h2>
          <form action={updateApprovalRule.bind(null, r.id)} className="ep-form-section__body">
            <input type="hidden" name="kind" value={r.kind} />
            <label className="ep-field" htmlFor="lr-name">
              <span className="ep-field__label">Name</span>
              <input
                id="lr-name"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={100}
                defaultValue={r.name}
              />
            </label>
            <ScopePicker
              id="lr"
              scopes={lists.scopes}
              staff={lists.staff}
              initialScope={r.scope}
              initialValues={r.scopeValues}
            />
            {reg ? null : (
              <label className="ep-field" htmlFor="lr-type">
                <span className="ep-field__label">Leave type</span>
                <select
                  id="lr-type"
                  name="leaveTypeId"
                  className="ep-select"
                  defaultValue={r.leaveType?.id ?? ''}
                >
                  <option value="">Any type</option>
                  {lists.types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* the order is set on Group rules (↑ ↓); an own rule stays first */}
            <input type="hidden" name="priority" value={r.priority} />
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Save
              </button>
            </div>
          </form>
          <form
            action={setApprovalRuleStatus.bind(
              null,
              r.id,
              r.status === 'active' ? 'inactive' : 'active',
            )}
          >
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              {r.status === 'active' ? 'Switch this rule off' : 'Switch this rule on'}
            </button>
          </form>
        </section>
      ) : null}
      <div className="ep-alert ep-alert--info" role="note" style={{ margin: 'var(--sp-4) 0' }}>
        <div>
          <strong>Approvers</strong>
          <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
            <li>
              The {what} goes to L1, then L2, then L3 (up to 3 levels). Pick a person, a
              designation, the HOD, the reporting manager or a role.
            </li>
            <li>Several people at one level: any one of them approves, or all of them must.</li>
            <li>
              The same person at a later level: that level is approved with them automatically.
              Nobody at a level: it is skipped. Nobody approves their own {what}.
            </li>
          </ul>
        </div>
      </div>
      {d.bands.map((b) => (
        <div key={b.index} style={{ marginTop: 'var(--sp-4)' }}>
          <ApprovalLevelsEditor
            setup={{
              levels: b.levels,
              staff: d.staff,
              designations: d.designations,
              departments: d.departments,
              roles: d.roles,
              waiting: 0,
              can: d.can,
            }}
            save={saveApprovalBand.bind(null, r.id, b.index)}
            title={reg ? 'Approvers' : (LENGTH_TITLES[b.index] ?? b.label)}
            intro={
              reg
                ? 'Who approves an attendance correction.'
                : 'Leave of this length. No level here: the next rule in the list decides.'
            }
            hodLabel="HOD of the employee’s department"
            hodHelp="The HOD set on the employee’s department approves."
            waitingNoun={[what, `${what}s`]}
            allowManager
            allowRole
            allowAll
            maxLevels={3}
            idPrefix={`lb${String(b.index)}`}
          />
        </div>
      ))}
    </>
  );
}
