import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApprovalsTabs } from '@/components/leave/ApprovalsTabs';
import { NewRuleDialog } from '@/components/leave/NewRuleDialog';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ApprovalRule, ApprovalRules } from '@/lib/leave';
import { moveApprovalRule } from '@/lib/leave-actions';

const LENGTHS = ['Up to 7 days', '8 to 30 days', 'More than 30 days'];

/**
 * Who approves → Group rules: the rules for many staff at once (all staff, departments, designations,
 * employee types), in the order they are checked, with the people at each level by name; move a rule up
 * or down; a new rule in a dialog. An employee's own approvers are on the first tab.
 */
export default async function GroupRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  let d: ApprovalRules;
  try {
    d = await apiFetch<ApprovalRules>('/leave/setup/approvals');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const group = d.rules.filter((r) => r.scope !== 'employee');
  const own = new Set(
    d.rules
      .filter((r) => r.scope === 'employee' && r.status === 'active')
      .flatMap((r) => r.scopeValues),
  );
  const can = d.can.manage;

  const people = (b: ApprovalRule['bands'][number]) =>
    b.who.length ? (
      <ul className="ep-approvers">
        {b.who.map((l, i) => (
          <li key={i}>
            <span className="ep-approvers__lv">L{i + 1}</span>{' '}
            {l.people.length ? (
              <>
                {l.people.join(', ')}
                {l.people.length > 1 ? (
                  <span className="ep-field__help">
                    {' '}
                    · {l.need === 'all' ? 'all must approve' : 'any one'}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="ep-field__help">{l.note ?? l.name}</span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <span className="ep-field__help">Next rule decides</span>
    );

  const table = (rules: ApprovalRule[], kind: 'leave' | 'regularisation') => {
    const live = rules.filter((r) => r.status === 'active');
    return (
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={kind === 'leave' ? 'Leave rules' : 'Correction rules'}
      >
        <table className="ep-table ep-table--dense ep-approvers__table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Rule</th>
              <th scope="col">For</th>
              {kind === 'leave' ? (
                LENGTHS.map((l) => (
                  <th scope="col" key={l}>
                    {l}
                  </th>
                ))
              ) : (
                <th scope="col">Approvers</th>
              )}
              {can ? <th scope="col">Move</th> : null}
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={kind === 'leave' ? 7 : 5} className="ep-field__help">
                  No rule yet.
                </td>
              </tr>
            ) : null}
            {rules.map((r) => {
              const at = live.findIndex((x) => x.id === r.id);
              return (
                <tr key={r.id} className={sp.moved === r.id ? 'ep-approvers__moved' : undefined}>
                  <td>{r.status === 'active' ? at + 1 : '—'}</td>
                  <td>
                    <a href={`/leave/setup/approvals/${r.id}`}>
                      <strong>{r.name}</strong>
                    </a>
                    {r.leaveType ? (
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        Only {r.leaveType.name}
                      </span>
                    ) : null}
                    {r.status === 'inactive' ? (
                      <>
                        {' '}
                        <Badge tone="neutral">Off</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>{r.scopeWords}</td>
                  {r.bands.map((b, i) => (
                    <td key={i}>{people(b)}</td>
                  ))}
                  {can ? (
                    <td>
                      {r.status === 'active' ? (
                        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                          <form action={moveApprovalRule.bind(null, r.id, 'up')}>
                            <button
                              type="submit"
                              className="ep-master__iconbtn"
                              disabled={at === 0}
                              aria-label={`Move ${r.name} up`}
                              title="Move up"
                            >
                              ↑
                            </button>
                          </form>
                          <form action={moveApprovalRule.bind(null, r.id, 'down')}>
                            <button
                              type="submit"
                              className="ep-master__iconbtn"
                              disabled={at === live.length - 1}
                              aria-label={`Move ${r.name} down`}
                              title="Move down"
                            >
                              ↓
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Who approves', href: '/leave/setup/approvals' },
          { label: 'Group rules' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Who approves"
        description="Rules for many staff at once: all staff, a department, a designation or an employee type."
        actions={
          can ? <NewRuleDialog scopes={d.scopes} staff={d.staff} types={d.types} /> : undefined
        }
      />
      <Notice params={sp} />
      <ApprovalsTabs current="rules" />
      <div className="ep-alert ep-alert--info" role="note" style={{ marginBottom: 'var(--sp-4)' }}>
        <div>
          <strong>How it works</strong>
          <ol style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
            <li>
              For each employee the list is checked from the top: the <strong>first rule</strong>{' '}
              that covers them decides. Their own approvers (Each employee → Set own) always come
              first.
            </li>
            <li>
              Short, medium and long leave can have different approvers, one after another: L1, then
              L2, then L3.
            </li>
            <li>
              If the same person is at a later level, that level is approved with them
              automatically.
            </li>
          </ol>
        </div>
      </div>
      {own.size ? (
        <p className="ep-field__help">
          {own.size} employee{own.size === 1 ? ' has' : 's have'} their own approvers:{' '}
          <a href="/leave/setup/approvals?own=1">see them on Each employee</a>.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="gr-leave">
        <h2 id="gr-leave" className="ep-card__title">
          Leave
        </h2>
        {table(
          group.filter((r) => r.kind === 'leave'),
          'leave',
        )}
      </section>
      <section className="ep-card" aria-labelledby="gr-reg" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="gr-reg" className="ep-card__title">
          Attendance corrections
        </h2>
        {table(
          group.filter((r) => r.kind === 'regularisation'),
          'regularisation',
        )}
      </section>
    </>
  );
}
