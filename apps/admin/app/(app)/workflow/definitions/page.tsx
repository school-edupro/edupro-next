import { Badge, Button, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { installWorkflowDefaults } from '@/lib/actions';
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
    default:
      return `${label('approver_chain')} (${r.depth})`;
  }
};

/** S9-01: workflow definitions with their levels and resolvers. */
export default async function DefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, w, me, defs] = await Promise.all([
    getTranslations('pages.workflow_definitions'),
    getTranslations('workflow'),
    getMe(),
    apiFetch<{ data: WorkflowDefinition[] }>('/workflow/definitions').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('workflow.definition.manage');
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <form action={installWorkflowDefaults}>
              <Button type="submit" variant="secondary">
                {w('installDefaults')}
              </Button>
            </form>
          ) : null
        }
      />
      <Notice params={sp} />
      {defs.length === 0 ? <Card>{w('noDefinitions')}</Card> : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {defs.map((d) => (
          <Card
            key={d.id}
            title={`${d.name} · ${d.code}`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                <Badge tone="neutral">{d.entityType}</Badge>
                <Badge tone={d.open ? 'warning' : 'success'}>
                  {w('open')}: {d.open}
                </Badge>
                <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status}</Badge>
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
