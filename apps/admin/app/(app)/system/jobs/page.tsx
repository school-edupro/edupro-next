import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { retryJob } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { OutboxRow, Page } from '@/lib/types';

type Search = { ok?: string; error?: string; detail?: string; status?: string; queue?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('platform.jobs.manage');
  const q = new URLSearchParams({ size: '200' });
  if (sp.status) q.set('status', sp.status);
  if (sp.queue) q.set('queue', sp.queue);
  const jobs = await apiFetch<Page<OutboxRow>>(`/platform/jobs/outbox?${q.toString()}`);
  return (
    <>
      <PageHeader
        kicker="System"
        title="Background jobs"
        description="Jobs leave the transactional outbox for the worker queues. Failed rows stay here as the dead-letter list until retried."
      />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="status"
            name="status"
            label="Status"
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'failed', label: 'Dead letter (failed)' },
              { value: 'pending', label: 'Pending' },
              { value: 'published', label: 'Published' },
            ]}
          />
          <SelectField
            id="queue"
            name="queue"
            label="Queue"
            defaultValue={sp.queue ?? ''}
            options={[
              { value: '', label: 'All' },
              ...['notifications', 'exports', 'maintenance', 'rfid', 'reconciliation'].map((x) => ({
                value: x,
                label: x,
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<OutboxRow>
          caption="Outbox"
          density="dense"
          columns={[
            {
              key: 'created',
              header: 'Created',
              render: (j) => new Date(j.createdAt).toLocaleString('en-IN'),
            },
            { key: 'queue', header: 'Queue', render: (j) => j.queue },
            { key: 'kind', header: 'Kind', render: (j) => <code>{j.kind ?? ''}</code> },
            {
              key: 'status',
              header: 'Status',
              render: (j) => (
                <Badge
                  tone={
                    j.status === 'failed' ? 'danger' : j.status === 'published' ? 'success' : 'info'
                  }
                >
                  {j.status}
                </Badge>
              ),
            },
            { key: 'attempts', header: 'Attempts', numeric: true, render: (j) => j.attempts },
            { key: 'error', header: 'Last error', render: (j) => j.lastError ?? '' },
            {
              key: 'actions',
              header: '',
              render: (j) =>
                canManage && j.status === 'failed' ? (
                  <form action={retryJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Retry
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={jobs.data}
          rowKey={(j) => j.id}
          emptyTitle="No jobs match"
        />
      </Card>
    </>
  );
}
