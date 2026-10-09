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
 * optional heads) and who approves it at each level. This is the only screen that edits it.
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
  const [defs, options] = canView
    ? await Promise.all([
        apiFetch<{ data: WorkflowDefinition[] }>('/workflow/definitions').then((r) => r.data),
        apiFetch<WorkflowOptions>('/workflow/options').catch(
          () => ({ roles: [], designations: [], people: [] }) as WorkflowOptions,
        ),
      ])
    : [[], { roles: [], designations: [], people: [] } as WorkflowOptions];
  const def = defs.find((d) => d.entityType === 'fee_profile_change') ?? null;
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
  return (
    <>
      <PageHeader
        kicker="Fee setup"
        title="Approval levels"
        description="A discount, fee group, hostel or optional head of a pupil changes only after approval. Choose who may ask for the change and who approves it at each level."
      />
      <FeeSetupNav current={HOME} />
      <Notice params={sp} />
      {!canView ? (
        <Card>
          You do not have the permission to see the approval levels. Ask the school admin.
        </Card>
      ) : !def ? (
        <Card title="Not set up yet">
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
        <>
          <Card
            title="How a fee change is approved now"
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <Badge tone={def.status === 'active' ? 'success' : 'neutral'}>
                  {def.status === 'active' ? 'In use' : 'Switched off'}
                </Badge>
                {def.open > 0 ? <Badge tone="warning">{def.open} waiting</Badge> : null}
                {canManage ? (
                  <form action={setWorkflowDefinitionStatus}>
                    <input type="hidden" name="id" value={def.id} />
                    <input type="hidden" name="returnTo" value={HOME} />
                    <input
                      type="hidden"
                      name="status"
                      value={def.status === 'active' ? 'inactive' : 'active'}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {def.status === 'active' ? 'Switch off' : 'Switch on'}
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
                <div className="ep-kicker">Created by</div>
                <strong>
                  {(def.creatorRoles ?? []).length > 0
                    ? def.creatorRoles.map(role).join(', ')
                    : 'Anyone with the permission'}
                </strong>
              </li>
              {def.levels.map((l) => (
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
                <strong>Fee change applied</strong>
              </li>
            </ol>
            {def.status !== 'active' ? (
              <p className="ep-field__help">
                While this is switched off, a fee change does not pass through these levels.
              </p>
            ) : null}
          </Card>
          {canManage ? (
            <Card title="Change the creators and levels">
              <WorkflowEditor
                def={def}
                options={options}
                action={saveWorkflowDefinition}
                backHref={HOME}
              />
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
