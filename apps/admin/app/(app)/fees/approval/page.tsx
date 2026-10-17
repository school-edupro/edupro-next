import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { WorkflowEditor, type WorkflowOptions } from '@/components/workflow/WorkflowEditor';
import {
  installWorkflowDefaults,
  saveWorkflowDefinition,
  setWorkflowDefinitionStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { WorkflowDefinition, WorkflowResolver } from '@/lib/types';

const HOME = '/fees/approval';

/**
 * Fee setup → Approval levels: who may ask for a fee change of a pupil (discount, fee group, hostel,
 * optional heads) and who approves it at each level; and, apart, who may start a hostel withdrawal and
 * who approves it (docs/design/27-hostel-withdrawal.md). This is the only screen that edits them.
 */
export default async function FeeApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canView = me.permissions.includes('workflow.definition.view');
  const canManage = me.permissions.includes('workflow.definition.manage');
  // the hostel withdrawal's levels are made with the standard two the first time they are shown
  if (canView) await apiFetch('/hostel/withdrawal-approval').catch(() => null);
  const [defs, options] = canView
    ? await Promise.all([
        apiFetch<{ data: WorkflowDefinition[] }>('/workflow/definitions').then((r) => r.data),
        apiFetch<WorkflowOptions>('/workflow/options').catch(
          () => ({ roles: [], designations: [], people: [] }) as WorkflowOptions,
        ),
      ])
    : [[], { roles: [], designations: [], people: [] } as WorkflowOptions];
  const def = defs.find((d) => d.entityType === 'fee_profile_change') ?? null;
  const hostel = defs.find((d) => d.entityType === 'hostel_withdrawal') ?? null;
  const role = (code: string) => options.roles.find((r) => r.code === code)?.name ?? code;
  const person = (id: string) => options.people.find((p) => p.id === id)?.name ?? `person ${id}`;
  const who = (r: WorkflowResolver): string =>
    r.kind === 'role'
      ? role(r.roleCode)
      : r.kind === 'any_of'
        ? [...r.roleCodes.map(role), ...r.userIds.map(person)].join(' or ')
        : r.kind === 'named_user'
          ? person(r.userId)
          : r.kind === 'position'
            ? `designation “${r.designation}”`
            : 'the creator’s reporting officer';

  /** One process: who may ask, the levels in order, the result; switch off; the editor. */
  const flow = (
    d: WorkflowDefinition,
    text: { title: string; creators: string; result: string; off: string; edit: string },
  ) => (
    <>
      <Card
        title={text.title}
        style={{ marginBottom: 'var(--sp-4)' }}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>
              {d.status === 'active' ? 'In use' : 'Switched off'}
            </Badge>
            {d.open > 0 ? <Badge tone="warning">{d.open} waiting</Badge> : null}
            {canManage ? (
              <form action={setWorkflowDefinitionStatus}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="returnTo" value={HOME} />
                <input
                  type="hidden"
                  name="status"
                  value={d.status === 'active' ? 'inactive' : 'active'}
                />
                <Button type="submit" variant="ghost" size="sm">
                  {d.status === 'active' ? 'Switch off' : 'Switch on'}
                </Button>
              </form>
            ) : null}
          </span>
        }
      >
        <ol
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          <li className="ep-card" style={{ padding: 'var(--sp-3)' }}>
            <div className="ep-kicker">{text.creators}</div>
            <strong>
              {(d.creatorRoles ?? []).length > 0
                ? d.creatorRoles.map(role).join(', ')
                : 'Anyone with the permission'}
            </strong>
          </li>
          {d.levels.map((l) => (
            <li key={l.level} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
              <div className="ep-kicker">
                → Level {l.level}
                {l.slaHours ? ` · ${l.slaHours} h` : ''}
              </div>
              <strong>{l.name}</strong>
              <div>{who(l.resolver)}</div>
              {l.autoIfRequester ? (
                <div className="ep-field__help">
                  approved by itself if the creator is its approver
                </div>
              ) : null}
            </li>
          ))}
          <li className="ep-card" style={{ padding: 'var(--sp-3)' }}>
            <div className="ep-kicker">→ Result</div>
            <strong>{text.result}</strong>
          </li>
        </ol>
        {d.status !== 'active' ? <p className="ep-field__help">{text.off}</p> : null}
      </Card>
      {canManage ? (
        <Card title={text.edit} style={{ marginBottom: 'var(--sp-5)' }}>
          <WorkflowEditor
            def={d}
            options={options}
            action={saveWorkflowDefinition}
            backHref={HOME}
          />
        </Card>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        kicker="Fee setup"
        title="Approval levels"
        description="A discount, fee group, pay plan, hostel or optional head of a pupil changes only after approval. The same levels approve a fee waiver, a late-fee waiver, a receipt cancellation, a cheque bounce, a paid charge adjusted in fee, the transfer of a receipt to a brother or sister, an opening balance, a misc fee, every refund (a withdrawal's refund too) and the revoke of a school withdrawal. A hostel withdrawal has its own levels below. Choose who may ask and who approves at each level."
      />
      <FeeSetupNav current={HOME} />
      <Notice params={sp} />
      {!canView ? (
        <Card>
          You do not have the permission to see the approval levels. Ask the school admin.
        </Card>
      ) : (
        <>
          {!def ? (
            <Card title="Not set up yet" style={{ marginBottom: 'var(--sp-4)' }}>
              <p>
                No approval levels are set for fee changes, so a request does not pass through any
                level.
              </p>
              {canManage ? (
                <form action={installWorkflowDefaults}>
                  <input type="hidden" name="returnTo" value={HOME} />
                  <Button type="submit">Add the standard two-level approval</Button>
                </form>
              ) : null}
            </Card>
          ) : (
            flow(def, {
              title: 'How a fee change is approved now',
              creators: 'Created by',
              result: 'Fee change applied',
              off: 'While this is switched off, a fee change does not pass through these levels.',
              edit: 'Change the creators and levels',
            })
          )}
          <p className="ep-field__help">
            A request takes these levels when it is sent; one already waiting keeps the levels it
            started with. The clearance steps of a school withdrawal (fees, library, transport,
            warden, mess, class teacher, principal) are set in People → Withdrawals → Settings.
          </p>
          <h2
            id="hostel-withdrawal"
            style={{
              margin: 'var(--sp-5) 0 var(--sp-2)',
              fontFamily: 'var(--font-heading)',
              fontSize: 'var(--fs-h3)',
              color: 'var(--text-heading)',
            }}
          >
            Hostel withdrawal
          </h2>
          <p className="ep-field__help">
            A pupil leaving the hostel and staying in school (Hostel → Withdrawals). The roles named
            here may start one (the Hostel Clerk and the warden to begin with; a warden only for a
            pupil of their own hostel). Its revoke uses these levels too; a refund it raises uses
            the levels above. The last approver chooses whether hostel fee paid for later months is
            carried forward or refunded.
          </p>
          {hostel ? (
            flow(hostel, {
              title: 'How a hostel withdrawal is approved now',
              creators: 'Started by',
              result: 'Bed given up, hostel fee settled, damages and mess dues raised',
              off: 'While this is switched off, a hostel withdrawal does not pass through these levels: the hostel office completes it.',
              edit: 'Change who may start and the levels',
            })
          ) : (
            <Card>The hostel withdrawal levels could not be read.</Card>
          )}
        </>
      )}
    </>
  );
}
