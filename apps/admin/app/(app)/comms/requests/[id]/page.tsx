import { Badge, Breadcrumbs, Button, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { MessagePreview, type PreviewItem } from '@/components/comms/MessagePreview';
import { Notice } from '@/components/Notice';
import { cancelRequest } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { CHANNEL_LABEL, SEND_TO_LABEL, type Channel, type SendTo } from '@/lib/comms';
import type { MessageRequest } from '@/lib/types';

type RequestV2 = MessageRequest & {
  channels?: Array<{ channel: Channel; templateId: string; templateName: string | null }>;
  bodyFormat?: 'text' | 'html';
  subject?: string | null;
  sendTo?: SendTo;
  uploadCount?: number;
  attachments?: Array<{ fileId: string; name: string | null; contentType: string; size: number }>;
  needsApproval?: boolean;
  deliveryByChannel?: Record<string, Record<string, number>>;
  recipients?: Array<
    NonNullable<MessageRequest['recipients']>[number] & {
      channel?: string | null;
      readAt?: string | null;
    }
  >;
};

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, m, me, r, preview] = await Promise.all([
    getTranslations('pages.comms_requests'),
    getTranslations('comms'),
    getMe(),
    apiFetch<RequestV2>(`/comms/requests/${id}`),
    apiFetch<{ preview: PreviewItem[] }>(`/comms/requests/${id}/preview`)
      .then((x) => x.preview)
      .catch(() => [] as PreviewItem[]),
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
        description={`${m(`audiences.${r.audience}`)}${r.targetLabels.length ? `: ${r.targetLabels.join(', ')}` : ''}${r.uploadCount ? ` (${String(r.uploadCount)} rows)` : ''} · ${(r.channels ?? [{ channel: r.channel as Channel }]).map((c) => CHANNEL_LABEL[c.channel] ?? c.channel).join(' + ')} · ${m(`categories.${r.category}`)}${r.sendTo && r.sendTo !== 'primary' ? ` · to ${SEND_TO_LABEL[r.sendTo].toLowerCase()}` : ''}`}
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
          {preview.length ? (
            <MessagePreview items={preview} />
          ) : r.bodyFormat === 'html' ? (
            <iframe className="ep-tpl__frame" title="Message" sandbox="" srcDoc={r.body} />
          ) : (
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
          )}
          <p className="ep-field__help">
            {m('template')}:{' '}
            {(r.channels ?? []).length
              ? r
                  .channels!.map(
                    (c) => `${CHANNEL_LABEL[c.channel]}: ${c.templateName ?? c.templateId}`,
                  )
                  .join(' · ')
              : r.templateCode}
          </p>
          {r.attachments?.length ? (
            <div className="ep-filecell">
              <span className="ep-field__help">Attachments</span>
              {r.attachments.map((a, i) => (
                <FileLinks
                  key={a.fileId}
                  href={`/api/files/${a.fileId}/download`}
                  label={a.name ?? `attachment ${String(i + 1)}`}
                />
              ))}
            </div>
          ) : null}
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
            {Object.entries(r.deliveryByChannel ?? { [r.channel]: r.delivery }).flatMap(
              ([ch, states]) =>
                Object.entries(states).map(([k, v]) => (
                  <Badge
                    key={`${ch}-${k}`}
                    tone={k === 'delivered' ? 'success' : k === 'failed' ? 'danger' : 'info'}
                  >
                    {CHANNEL_LABEL[ch as Channel] ?? ch}: {v} {m(`deliveryStates.${k}`)}
                  </Badge>
                )),
            )}
          </div>
        </Card>
        <Card title={m('recipients')}>
          <DataTable<NonNullable<RequestV2['recipients']>[number]>
            caption={m('recipients')}
            density="dense"
            columns={[
              { key: 'name', header: m('recipient'), render: (x) => x.name ?? '—' },
              {
                key: 'channel',
                header: 'Channel',
                render: (x) =>
                  x.channel ? (CHANNEL_LABEL[x.channel as Channel] ?? x.channel) : '',
              },
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
                      {x.readAt ? <Badge tone="success">read</Badge> : null}
                      {x.lastError ? <span className="ep-field__help"> {x.lastError}</span> : null}
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
