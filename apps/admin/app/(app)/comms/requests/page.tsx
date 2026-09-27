import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import type { MessageRequest, Page } from '@/lib/types';

const requestTone = (s: MessageRequest['status']) =>
  s === 'sent'
    ? 'success'
    : s === 'rejected' || s === 'cancelled'
      ? 'danger'
      : s === 'pending_approval'
        ? 'warning'
        : 'info';

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const [t, m, nav] = await Promise.all([
    getTranslations('pages.comms_requests'),
    getTranslations('comms'),
    getTranslations('nav'),
  ]);
  const q = new URLSearchParams({ size: '100' });
  if (sp.status) q.set('status', sp.status);
  const page = await apiFetch<Page<MessageRequest>>(`/comms/requests?${q.toString()}`);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/comms/compose">
            {nav('compose')}
          </a>
        }
      />
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
            label={m('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              ...(['pending_approval', 'sent', 'rejected', 'cancelled'] as const).map((s) => ({
                value: s,
                label: m(`statuses.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {m('status')}
          </Button>
        </form>
        <DataTable<MessageRequest>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'title',
              header: m('title'),
              render: (r) => (
                <a href={`/comms/requests/${r.id}`}>
                  <strong>{r.title}</strong>
                </a>
              ),
            },
            {
              key: 'audience',
              header: m('audience'),
              render: (r) =>
                `${m(`audiences.${r.audience}`)}${r.targetLabels.length ? `: ${r.targetLabels.join(', ')}` : ''}`,
            },
            { key: 'channel', header: m('channel'), render: (r) => r.channel },
            {
              key: 'status',
              header: m('status'),
              render: (r) => (
                <Badge tone={requestTone(r.status)}>{m(`statuses.${r.status}`)}</Badge>
              ),
            },
            {
              key: 'recipients',
              header: m('recipients'),
              numeric: true,
              render: (r) => r.recipientsTotal,
            },
            {
              key: 'delivery',
              header: m('delivery'),
              render: (r) => (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {Object.entries(r.delivery).map(([k, v]) => (
                    <Badge
                      key={k}
                      tone={k === 'delivered' ? 'success' : k === 'failed' ? 'danger' : 'neutral'}
                    >
                      {v} {m(`deliveryStates.${k}`)}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'by',
              header: m('requestedBy'),
              render: (r) =>
                `${r.requestedBy ?? ''} · ${new Date(r.requestedAt).toLocaleDateString('en-IN')}`,
            },
          ]}
          rows={page.data}
          rowKey={(r) => r.id}
          emptyTitle={m('noRequests')}
        />
      </Card>
    </>
  );
}
