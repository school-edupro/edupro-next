import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideChangeRequest } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ChangeRequest, Page } from '@/lib/types';

export default async function ChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, me] = await Promise.all([
    getTranslations('pages.engagement_change_requests'),
    getTranslations('engagement'),
    getMe(),
  ]);
  const canDecide = me.permissions.includes('engagement.change_request.decide');
  const page = await apiFetch<Page<ChangeRequest>>(
    `/engagement/change-requests?size=100${sp.status ? `&status=${sp.status}` : ''}`,
  );
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label={e('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              { value: 'pending', label: 'pending' },
              { value: 'approved', label: 'approved' },
              { value: 'rejected', label: 'rejected' },
            ]}
          />
          <Button type="submit" variant="secondary">
            {e('status')}
          </Button>
        </form>
        <DataTable<ChangeRequest>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'when',
              header: e('opened'),
              render: (r) => new Date(r.createdAt).toLocaleDateString('en-IN'),
            },
            {
              key: 'student',
              header: e('student'),
              render: (r) => <a href={`/people/students/${r.studentId}`}>{r.studentName}</a>,
            },
            {
              key: 'entity',
              header: e('entity'),
              render: (r) =>
                `${e(`entities.${r.entity}`)}${r.entityName ? `: ${r.entityName}` : ''}`,
            },
            {
              key: 'changes',
              header: e('field'),
              render: (r) => (
                <ul style={{ margin: 0, paddingLeft: 'var(--sp-3)' }}>
                  {Object.entries(r.changes).map(([k, v]) => (
                    <li key={k}>
                      {r.fieldLabels?.[k] ?? <code>{k}</code>}: {String(v.from ?? '—')} →{' '}
                      <strong>{String(v.to)}</strong>
                    </li>
                  ))}
                </ul>
              ),
            },
            { key: 'reason', header: e('reason'), render: (r) => r.reason ?? '' },
            {
              key: 'status',
              header: e('status'),
              render: (r) =>
                r.status === 'pending' && canDecide ? (
                  <form
                    action={decideChangeRequest}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <InputField
                      id={`note-${r.id}`}
                      name="note"
                      label={e('decisionNote')}
                      maxLength={500}
                    />
                    <Button type="submit" name="approve" value="true" size="sm">
                      {e('approve')}
                    </Button>
                    <Button type="submit" name="approve" value="false" size="sm" variant="danger">
                      {e('reject')}
                    </Button>
                  </form>
                ) : (
                  <span title={r.decisionNote ?? ''}>
                    <Badge
                      tone={
                        r.status === 'approved'
                          ? 'success'
                          : r.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {r.status}
                    </Badge>{' '}
                    {r.decidedBy ? `· ${r.decidedBy}` : ''}
                  </span>
                ),
            },
          ]}
          rows={page.data}
          rowKey={(r) => r.id}
          emptyTitle={e('noChanges')}
        />
      </Card>
    </>
  );
}
