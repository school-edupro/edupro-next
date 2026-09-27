import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { cancelMessage, sendMessage } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Membership, Message, Page, Template } from '@/lib/types';

const TONE: Record<Message['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'info',
  sending: 'warning',
  sent: 'success',
  delivered: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

type Search = { ok?: string; error?: string; detail?: string; status?: string; channel?: string };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations('pages.comms_messages');
  const sp = await searchParams;
  const me = await getMe();
  const canSend = me.permissions.includes('comms.message.send');
  const q = new URLSearchParams({ size: '200' });
  if (sp.status) q.set('status', sp.status);
  if (sp.channel) q.set('channel', sp.channel);
  const [messages, templates, members] = await Promise.all([
    apiFetch<Page<Message>>(`/comms/messages?${q.toString()}`),
    canSend
      ? apiFetch<{ data: Template[] }>('/comms/templates?status=active')
      : Promise.resolve({ data: [] as Template[] }),
    canSend && me.permissions.includes('access.assignment.view')
      ? apiFetch<Page<Membership>>('/access/memberships?size=200')
      : Promise.resolve({ data: [] as Membership[], page: { number: 1, size: 0, total: 0 } }),
  ]);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
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
              ...(['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled'] as const).map(
                (s) => ({ value: s, label: s }),
              ),
            ]}
          />
          <SelectField
            id="channel"
            name="channel"
            label="Channel"
            defaultValue={sp.channel ?? ''}
            options={[
              { value: '', label: 'All' },
              ...(['sms', 'whatsapp', 'email', 'push'] as const).map((c) => ({
                value: c,
                label: c,
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<Message>
          caption="Messages"
          density="dense"
          columns={[
            {
              key: 'when',
              header: 'Created',
              render: (m) => new Date(m.createdAt).toLocaleString('en-IN'),
            },
            { key: 'channel', header: 'Channel', render: (m) => m.channel },
            {
              key: 'to',
              header: 'Recipient',
              render: (m) => m.recipientName ?? m.recipientAddress,
            },
            { key: 'template', header: 'Template', render: (m) => m.templateCode ?? '' },
            {
              key: 'status',
              header: 'Status',
              render: (m) => <Badge tone={TONE[m.status]}>{m.status}</Badge>,
            },
            {
              key: 'provider',
              header: 'Provider',
              render: (m) =>
                m.provider
                  ? `${m.provider}${m.providerMessageId ? ` · ${m.providerMessageId}` : ''}`
                  : '',
            },
            { key: 'attempts', header: 'Attempts', numeric: true, render: (m) => m.attempts },
            { key: 'error', header: 'Last error', render: (m) => m.lastError ?? '' },
            {
              key: 'actions',
              header: '',
              render: (m) =>
                canSend && m.status === 'queued' ? (
                  <form action={cancelMessage}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Cancel
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={messages.data}
          rowKey={(m) => m.id}
          emptyTitle="No messages yet"
        />
      </Card>
      {canSend ? (
        <Card title="Send a message" style={{ marginTop: 'var(--sp-5)' }}>
          <form
            action={sendMessage}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--sp-4)',
              alignItems: 'end',
            }}
          >
            <SelectField
              id="templateId"
              name="templateId"
              label="Template"
              required
              options={templates.data.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.channel})`,
              }))}
            />
            {members.data.length > 0 ? (
              <SelectField
                id="recipientUserId"
                name="recipientUserId"
                label="Member"
                options={[
                  { value: '', label: 'Use the address below' },
                  ...members.data.map((m) => ({ value: m.userId, label: m.displayName })),
                ]}
              />
            ) : null}
            <InputField
              id="recipientAddress"
              name="recipientAddress"
              label="Mobile or email"
              placeholder="9876543210"
            />
            <InputField
              id="variables"
              name="variables"
              label="Variables (JSON)"
              placeholder='{"student_name":"Asha","amount":"₹1,200"}'
            />
            <div>
              <Button type="submit">Queue message</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
