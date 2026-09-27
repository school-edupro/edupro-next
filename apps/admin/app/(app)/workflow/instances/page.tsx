import { Badge, Card, DataTable, PageHeader, SelectField, Button } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { Page, WorkflowInstance } from '@/lib/types';

const tone = (s: WorkflowInstance['status']) =>
  s === 'approved'
    ? 'success'
    : s === 'rejected'
      ? 'danger'
      : s === 'cancelled'
        ? 'neutral'
        : 'warning';

/** S9-01: every approval request with its levels; the page filters by status. */
export default async function InstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; entityType?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ size: '50' });
  if (sp.status) q.set('status', sp.status);
  if (sp.entityType) q.set('entityType', sp.entityType);
  const [t, w, page] = await Promise.all([
    getTranslations('pages.workflow_instances'),
    getTranslations('workflow'),
    apiFetch<Page<WorkflowInstance>>(`/workflow/instances?${q.toString()}`),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label={w('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              ...(['pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => ({
                value: s,
                label: w(`statuses.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {w('open')}
          </Button>
        </form>
        <DataTable<WorkflowInstance>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'subject',
              header: w('subject'),
              render: (i) =>
                i.entityType === 'application' ? (
                  <a href={`/admissions/applications/${i.entityId}`}>{i.subject}</a>
                ) : (
                  i.subject
                ),
            },
            { key: 'def', header: w('definition'), render: (i) => i.definitionName },
            {
              key: 'status',
              header: w('status'),
              render: (i) => <Badge tone={tone(i.status)}>{w(`statuses.${i.status}`)}</Badge>,
            },
            {
              key: 'level',
              header: w('currentLevel'),
              numeric: true,
              render: (i) => (i.status === 'pending' ? i.currentLevel : ''),
            },
            {
              key: 'steps',
              header: w('history'),
              render: (i) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {i.steps.map((s) => (
                    <Badge
                      key={s.id}
                      tone={
                        s.status === 'approved'
                          ? 'success'
                          : s.status === 'rejected'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      L{s.level} {w(`statuses.${s.status}`)}
                      {s.actedBy ? ` · ${s.actedBy}` : ''}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'requested',
              header: w('requestedAt'),
              render: (i) =>
                `${new Date(i.requestedAt).toLocaleDateString('en-IN')} · ${i.requestedBy ?? ''}`,
            },
          ]}
          rows={page.data}
          rowKey={(i) => i.id}
          emptyTitle={w('noInstances')}
        />
      </Card>
    </>
  );
}
