import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { WorkflowEditor, type WorkflowOptions } from '@/components/workflow/WorkflowEditor';
import {
  installWorkflowDefaults,
  saveWorkflowDefinition,
  setWorkflowDefinitionStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { WorkflowDefinition, WorkflowResolver } from '@/lib/types';

/** Requests whose approvers are chosen in the module's own set-up, not on this page. */
const ELSEWHERE = [
  {
    name: 'Gate pass',
    href: '/engagement/gate-passes/setup',
    permission: 'engagement.gate_pass_setup.manage',
    help: 'approval levels for pupil and staff passes: Gate passes → Set-up',
  },
  {
    name: 'Transport request',
    href: '/transport/setup',
    permission: 'transport.setup.manage',
    help: 'approval levels for new transport, change and withdrawal: Transport → Settings',
  },
  {
    name: 'Appointment',
    href: '/engagement/appointments/setup',
    permission: 'engagement.appointment_setup.manage',
    help: 'the front desk confirms, or bookings confirm by themselves: Appointments → Set-up',
  },
];

/**
 * Approval set-up: one card per kind of request, read as a chain (who creates it, then each approval
 * level). Editing ticks roles from the school's list; no codes are typed.
 */
export default async function WorkflowDefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    open?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('workflow.definition.manage');
  const [defs, options] = await Promise.all([
    apiFetch<{ data: WorkflowDefinition[] }>('/workflow/definitions').then((r) => r.data),
    apiFetch<WorkflowOptions>('/workflow/options').catch(
      () => ({ roles: [], designations: [], people: [] }) as WorkflowOptions,
    ),
  ]);
  const editing = canManage
    ? (defs.find((d) => (sp.edit ? d.id === sp.edit : sp.open ? d.code === sp.open : false)) ??
      null)
    : null;
  const role = (code: string) => options.roles.find((r) => r.code === code)?.name ?? code;
  const who = (r: WorkflowResolver): string =>
    r.kind === 'role'
      ? role(r.roleCode)
      : r.kind === 'any_of'
        ? [
            ...r.roleCodes.map(role),
            ...r.userIds.map((u) => options.people.find((p) => p.id === u)?.name ?? `person ${u}`),
          ].join(' or ')
        : r.kind === 'named_user'
          ? (options.people.find((p) => p.id === r.userId)?.name ?? `person ${r.userId}`)
          : r.kind === 'position'
            ? `designation “${r.designation}”`
            : 'the creator’s reporting officer';
  const elsewhere = ELSEWHERE.filter((e) => me.permissions.includes(e.permission));
  return (
    <>
      <PageHeader
        kicker="Approvals"
        title="Approval set-up"
        description="For each kind of request: who may create it, and who approves it at each level. Press Edit to change the roles or add a level."
        actions={
          canManage ? (
            <form action={installWorkflowDefaults}>
              <Button type="submit" variant="secondary" size="sm">
                Add the standard approvals that are missing
              </Button>
            </form>
          ) : null
        }
      />
      <Notice params={sp} />
      {editing ? (
        <Card title={`Edit: ${editing.name}`}>
          <WorkflowEditor def={editing} options={options} action={saveWorkflowDefinition} />
        </Card>
      ) : null}
      {defs.length === 0 ? (
        <Card>No approval is set up yet. Press “Add the standard approvals that are missing”.</Card>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}>
        {defs
          .filter((d) => d.id !== editing?.id)
          .map((d) => (
            <Card
              key={d.id}
              title={d.name}
              actions={
                <span
                  style={{
                    display: 'inline-flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>
                    {d.status === 'active' ? 'In use' : 'Switched off'}
                  </Badge>
                  {d.open > 0 ? <Badge tone="warning">{d.open} waiting</Badge> : null}
                  {canManage ? (
                    <>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/workflow/definitions?edit=${d.id}`}
                      >
                        Edit
                      </a>
                      <form action={setWorkflowDefinitionStatus}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={d.status === 'active' ? 'inactive' : 'active'}
                        />
                        <Button type="submit" variant="ghost" size="sm">
                          {d.status === 'active' ? 'Switch off' : 'Switch on'}
                        </Button>
                      </form>
                    </>
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
                  <strong>Applied</strong>
                </li>
              </ol>
            </Card>
          ))}
      </div>
      {elsewhere.length > 0 ? (
        <Card title="Set up on their own screens">
          <p className="ep-field__help">
            These requests are not approved from this page. Each has its own set-up, and that is the
            only place to change who approves it.
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {elsewhere.map((e) => (
              <li key={e.href}>
                <a href={e.href}>
                  <strong>{e.name}</strong>
                </a>{' '}
                · {e.help}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
