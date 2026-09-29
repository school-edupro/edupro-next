import { Badge, Button, Card, DataTable, FormRow, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  cancelWorkflowInstance,
  commentWorkflowInstance,
  reassignWorkflowStep,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { WorkflowEvent, WorkflowInstance, WorkflowStep } from '@/lib/types';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** Sprint 17: one approval — steps with due times, the history, notes, cancel and reassign. */
export default async function InstancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, w, e, me, inst, history] = await Promise.all([
    getTranslations('pages.workflow_instance'),
    getTranslations('workflow'),
    getTranslations('workflowEditor'),
    getMe(),
    apiFetch<WorkflowInstance>(`/workflow/instances/${id}`),
    apiFetch<{ data: WorkflowEvent[] }>(`/workflow/instances/${id}/history`).then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('workflow.definition.manage');
  const canCancel =
    inst.status === 'pending' &&
    (me.permissions.includes('workflow.instance.cancel') ||
      inst.requestedBy === me.user.displayName);
  const current = inst.steps.find((s) => s.status === 'pending' && s.level === inst.currentLevel);
  const tone = (s: WorkflowStep) =>
    s.status === 'approved'
      ? 'success'
      : s.status === 'rejected'
        ? 'danger'
        : s.overdue
          ? 'warning'
          : s.status === 'pending'
            ? 'info'
            : 'neutral';
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={inst.subject}
        description={`${inst.definitionName} · ${inst.entityType} #${inst.entityId} · ${w('requestedBy')} ${inst.requestedBy ?? '—'} · ${when(inst.requestedAt)}`}
        actions={
          <Badge
            tone={
              inst.status === 'approved'
                ? 'success'
                : inst.status === 'pending'
                  ? 'warning'
                  : inst.status === 'rejected'
                    ? 'danger'
                    : 'neutral'
            }
          >
            {inst.status}
          </Badge>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={e('steps')}>
          <DataTable<WorkflowStep>
            caption={e('steps')}
            density="dense"
            columns={[
              { key: 'l', header: w('level'), numeric: true, render: (s) => s.level },
              { key: 'n', header: w('step'), render: (s) => s.name },
              {
                key: 'a',
                header: e('assignees'),
                render: (s) => s.assignees.map((a) => a.name).join(', '),
              },
              {
                key: 'd',
                header: e('due'),
                render: (s) =>
                  s.dueAt ? (
                    <span>
                      {when(s.dueAt)}
                      {s.overdue ? (
                        <>
                          {' '}
                          <Badge tone="danger">{e('overdue')}</Badge>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    ''
                  ),
              },
              {
                key: 's',
                header: w('status'),
                render: (s) => <Badge tone={tone(s)}>{s.status}</Badge>,
              },
              {
                key: 'by',
                header: w('actedBy'),
                render: (s) =>
                  s.actedBy
                    ? `${s.actedBy} · ${when(s.actedAt)}${s.note ? ` · ${s.note}` : ''}`
                    : '',
              },
            ]}
            rows={inst.steps}
            rowKey={(s) => s.id}
            emptyTitle="—"
          />
          {canManage && current ? (
            <form action={reassignWorkflowStep} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="instanceId" value={inst.id} />
              <input type="hidden" name="stepId" value={current.id} />
              <FormRow columns={3}>
                <InputField id="userIds" name="userIds" label={e('userIds')} required />
                <InputField id="rnote" name="note" label={e('note')} maxLength={500} />
                <div style={{ alignSelf: 'end' }}>
                  <Button type="submit" variant="secondary">
                    {e('reassign')}
                  </Button>
                </div>
              </FormRow>
            </form>
          ) : null}
          {canCancel ? (
            <form action={cancelWorkflowInstance} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={inst.id} />
              <FormRow columns={2}>
                <InputField
                  id="reason"
                  name="reason"
                  label={e('cancelReason')}
                  required
                  minLength={3}
                  maxLength={500}
                />
                <div style={{ alignSelf: 'end' }}>
                  <Button type="submit" variant="secondary">
                    {e('cancel')}
                  </Button>
                </div>
              </FormRow>
            </form>
          ) : null}
        </Card>
        <Card title={e('history')}>
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {history.map((ev) => (
              <li
                key={ev.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr',
                  gap: 'var(--sp-3)',
                  borderBottom: '1px solid var(--border-default)',
                  paddingBottom: 'var(--sp-2)',
                }}
              >
                <span className="ep-field__help">{when(ev.occurredAt)}</span>
                <span>
                  <Badge
                    tone={
                      ev.kind === 'approved'
                        ? 'success'
                        : ev.kind === 'rejected' || ev.kind === 'cancelled'
                          ? 'danger'
                          : ev.kind === 'escalated' || ev.kind === 'reminded'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {e(`kinds.${ev.kind}`)}
                  </Badge>{' '}
                  {ev.actor ? <strong>{ev.actor}</strong> : null}{' '}
                  {ev.note ? <span>· {ev.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <form action={commentWorkflowInstance} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={inst.id} />
            <FormRow columns={2}>
              <InputField id="cnote" name="note" label={e('comment')} required maxLength={1000} />
              <div style={{ alignSelf: 'end' }}>
                <Button type="submit" variant="secondary">
                  {e('comment')}
                </Button>
              </div>
            </FormRow>
          </form>
        </Card>
      </div>
    </>
  );
}
