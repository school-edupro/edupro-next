import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { cancelRequest } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { MessageRequest } from '@/lib/types';

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, m, me, r] = await Promise.all([
    getTranslations('pages.comms_requests'),
    getTranslations('comms'),
    getMe(),
    apiFetch<MessageRequest>(`/comms/requests/${id}`),
  ]);
  const tone =
    r.status === 'sent'
      ? 'success'
      : r.status === 'rejected' || r.status === 'cancelled'
        ? 'danger'
        : r.status === 'pending_approval'
          ? 'warning'
          : 'info';
  const canCancel =
    me.permissions.includes('comms.request.create') &&
    ['pending_approval', 'approved'].includes(r.status);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/comms/requests' },
          { label: t('title'), href: '/comms/requests' },
          { label: r.title },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={r.title}
        description={`${m(`audiences.${r.audience}`)}${r.targetLabels.length ? `: ${r.targetLabels.join(', ')}` : ''} · ${r.channel} · ${m(`categories.${r.category}`)}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={tone}>{m(`statuses.${r.status}`)}</Badge>
            {canCancel ? (
              <form action={cancelRequest}>
                <input type="hidden" name="id" value={r.id} />
                <Button type="submit" variant="danger">
                  {m('cancel')}
                </Button>
              </form>
            ) : null}
          </span>
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
        <Card title={m('body')}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
          <p className="ep-field__help">
            {m('template')}: <code>{r.templateCode}</code>
          </p>
          <p className="ep-field__help">
            {m('requestedBy')} {r.requestedBy ?? '—'} ·{' '}
            {new Date(r.requestedAt).toLocaleString('en-IN')}
            {r.decidedBy
              ? ` · ${m('decidedBy')} ${r.decidedBy} · ${new Date(r.decidedAt!).toLocaleString('en-IN')}`
              : ''}
            {r.decisionNote ? ` · ${m('decision')}: ${r.decisionNote}` : ''}
          </p>
          {r.status === 'pending_approval' ? (
            <p className="ep-field__help">{m('openInbox')}</p>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            <Badge tone="neutral">
              {m('recipients')}: {r.recipientsTotal}
            </Badge>
            <Badge tone={r.recipientsSkipped ? 'warning' : 'neutral'}>
              {m('skipped')}: {r.recipientsSkipped}
            </Badge>
            {Object.entries(r.delivery).map(([k, v]) => (
              <Badge
                key={k}
                tone={k === 'delivered' ? 'success' : k === 'failed' ? 'danger' : 'info'}
              >
                {v} {m(`deliveryStates.${k}`)}
              </Badge>
            ))}
          </div>
        </Card>
        <Card title={m('recipients')}>
          <DataTable<NonNullable<MessageRequest['recipients']>[number]>
            caption={m('recipients')}
            density="dense"
            columns={[
              { key: 'name', header: m('recipient'), render: (x) => x.name ?? '—' },
              { key: 'student', header: m('student'), render: (x) => x.student ?? '' },
              { key: 'address', header: m('address'), render: (x) => x.address ?? '' },
              {
                key: 'status',
                header: m('delivery'),
                render: (x) =>
                  x.skippedReason ? (
                    <Badge tone="warning">{m(`skippedReasons.${x.skippedReason}`)}</Badge>
                  ) : x.status ? (
                    <span title={x.lastError ?? ''}>
                      <Badge
                        tone={
                          x.status === 'delivered'
                            ? 'success'
                            : x.status === 'failed'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {m(`deliveryStates.${x.status}`)}
                      </Badge>
                    </span>
                  ) : (
                    ''
                  ),
              },
            ]}
            rows={r.recipients ?? []}
            rowKey={(x) => x.id}
            emptyTitle={m('recipients')}
          />
        </Card>
      </div>
    </>
  );
}
