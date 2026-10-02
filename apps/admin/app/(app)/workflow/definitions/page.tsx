import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  installWorkflowDefaults,
  saveWorkflowDefinition,
  setWorkflowDefinitionStatus,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { WorkflowDefinition, WorkflowResolver } from '@/lib/types';

const describe = (r: WorkflowResolver, label: (k: string) => string) => {
  switch (r.kind) {
    case 'named_user':
      return `${label('named_user')} #${r.userId}`;
    case 'role':
      return `${label('role')}: ${r.roleCode}`;
    case 'position':
      return `${label('position')}: ${r.designation}`;
    case 'any_of':
      return `Any of: ${[...r.roleCodes, ...r.userIds.map((u) => `#${u}`)].join(', ')} (set in Communication settings)`;
    default:
      return `${label('approver_chain')} (${r.depth})`;
  }
};
const valueOf = (r: WorkflowResolver) =>
  r.kind === 'named_user'
    ? r.userId
    : r.kind === 'role'
      ? r.roleCode
      : r.kind === 'position'
        ? r.designation
        : r.kind === 'any_of'
          ? [...r.roleCodes, ...r.userIds].join(',')
          : String(r.depth);

/** S9-01: definitions; Sprint 17: the editor (levels, SLA, escalation) and activation. */
export default async function DefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, w, e, me, defs] = await Promise.all([
    getTranslations('pages.workflow_definitions'),
    getTranslations('workflow'),
    getTranslations('workflowEditor'),
    getMe(),
    apiFetch<{ data: WorkflowDefinition[] }>('/workflow/definitions').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('workflow.definition.manage');
  const editing = sp.edit ? (defs.find((d) => d.id === sp.edit) ?? null) : null;
  const showForm = canManage && (sp.new || editing);
  const kinds = ['role', 'position', 'named_user', 'approver_chain'].map((k) => ({
    value: k,
    label: w(`resolvers.${k}`),
  }));
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/workflow/definitions?new=1">
                ＋ {e('new')}
              </a>
              <form action={installWorkflowDefaults}>
                <Button type="submit" variant="secondary" size="sm">
                  {w('installDefaults')}
                </Button>
              </form>
            </span>
          ) : null
        }
      />
      <Notice params={sp} />
      {showForm ? (
        <Card
          title={editing ? `${e('edit')} · ${editing.name}` : e('new')}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <form action={saveWorkflowDefinition}>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <FormRow columns={3}>
              <InputField
                id="code"
                name="code"
                label={e('code')}
                required={!editing}
                defaultValue={editing?.code ?? ''}
                readOnly={Boolean(editing)}
                pattern="[a-z0-9_]{2,40}"
              />
              <InputField
                id="name"
                name="name"
                label={e('name')}
                required
                defaultValue={editing?.name ?? ''}
                maxLength={120}
              />
              <InputField
                id="entityType"
                name="entityType"
                label={e('entityType')}
                required={!editing}
                defaultValue={editing?.entityType ?? ''}
                readOnly={Boolean(editing)}
                pattern="[a-z_]{2,40}"
                help="application, lesson_plan, message_request, fee_profile_change, transport_request …"
              />
            </FormRow>
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const l = editing?.levels[n - 1];
              return (
                <fieldset
                  key={n}
                  className="ep-master__panel"
                  style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}
                >
                  <legend className="ep-kicker">{e('level', { n })}</legend>
                  <FormRow columns={4}>
                    <InputField
                      id={`l${n}n`}
                      name={`level${n}:name`}
                      label={e('stepName')}
                      defaultValue={l?.name ?? ''}
                      maxLength={80}
                    />
                    <SelectField
                      id={`l${n}k`}
                      name={`level${n}:kind`}
                      label={e('kind')}
                      defaultValue={l?.resolver.kind ?? 'role'}
                      options={kinds}
                    />
                    <InputField
                      id={`l${n}v`}
                      name={`level${n}:value`}
                      label={e('value')}
                      defaultValue={l ? valueOf(l.resolver) : ''}
                      maxLength={80}
                    />
                    <InputField
                      id={`l${n}s`}
                      name={`level${n}:sla`}
                      label={e('sla')}
                      type="number"
                      min={1}
                      max={720}
                      defaultValue={l?.slaHours ?? ''}
                    />
                    <InputField
                      id={`l${n}e`}
                      name={`level${n}:escalate`}
                      label={e('escalate')}
                      defaultValue={l?.escalateTo?.kind === 'role' ? l.escalateTo.roleCode : ''}
                      maxLength={40}
                    />
                  </FormRow>
                </fieldset>
              );
            })}
            <p className="ep-field__help">{e('help')}</p>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
              <a className="ep-btn ep-btn--ghost" href="/workflow/definitions">
                {w('cancel')}
              </a>
              <Button type="submit">{e('save')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {defs.length === 0 ? <Card>{w('noDefinitions')}</Card> : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {defs.map((d) => (
          <Card
            key={d.id}
            title={`${d.name} · ${d.code}`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <Badge tone="neutral">{d.entityType}</Badge>
                <Badge tone={d.open ? 'warning' : 'success'}>
                  {w('open')}: {d.open}
                </Badge>
                <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status}</Badge>
                {canManage ? (
                  <>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/workflow/definitions?edit=${d.id}`}
                    >
                      {e('edit')}
                    </a>
                    <form action={setWorkflowDefinitionStatus}>
                      <input type="hidden" name="id" value={d.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={d.status === 'active' ? 'inactive' : 'active'}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {d.status === 'active' ? e('deactivate') : e('activate')}
                      </Button>
                    </form>
                  </>
                ) : null}
              </span>
            }
          >
            <DataTable<WorkflowDefinition['levels'][number]>
              caption={w('levels')}
              density="dense"
              columns={[
                { key: 'level', header: w('level'), numeric: true, render: (l) => l.level },
                { key: 'name', header: w('step'), render: (l) => l.name },
                {
                  key: 'resolver',
                  header: w('resolver'),
                  render: (l) => describe(l.resolver, (k) => w(`resolvers.${k}`)),
                },
                { key: 'sla', header: w('sla'), numeric: true, render: (l) => l.slaHours ?? '' },
                {
                  key: 'esc',
                  header: e('escalate'),
                  render: (l) =>
                    l.escalateTo ? describe(l.escalateTo, (k) => w(`resolvers.${k}`)) : '',
                },
              ]}
              rows={d.levels}
              rowKey={(l) => String(l.level)}
              emptyTitle={w('levels')}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
