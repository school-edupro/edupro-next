import { Badge, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  FilterInput,
  FilterRow,
  Pager,
  RegisterBar,
  registerQuery,
} from '@/components/RegisterTools';
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

const STATUSES = ['pending_approval', 'approved', 'sending', 'sent', 'rejected', 'cancelled'];
const LABEL: Record<string, string> = {
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  sending: 'Sending',
  sent: 'Sent',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const AUDIENCES = [
  'everyone',
  'students',
  'employees',
  'class',
  'class_section',
  'route',
  'group',
  'individuals',
  'filter',
  'upload',
];

/** Message requests: filters, totals of what is filtered, pages, Excel and PDF. */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [t, m, nav] = await Promise.all([
    getTranslations('pages.comms_requests'),
    getTranslations('comms'),
    getTranslations('nav'),
  ]);
  const rq = registerQuery(sp, { status: STATUSES, kind: [], mode: [] });
  // two filters this register has of its own
  const channel = ['sms', 'whatsapp', 'email'].includes(sp.channel ?? '') ? sp.channel! : '';
  const audience = AUDIENCES.includes(sp.audience ?? '') ? sp.audience! : '';
  for (const u of [rq.filters, rq.list]) {
    u.delete('classId');
    if (channel) u.set('channel', channel);
    if (audience) u.set('audience', audience);
  }
  const page = await apiFetch<
    Page<MessageRequest> & {
      totals: {
        recipients: number;
        waiting: number;
        delivered: number;
        failed: number;
        queued: number;
      };
    }
  >(`/comms/requests?${rq.list.toString()}`);
  const size = Number(rq.size);
  const pages = Math.max(1, Math.ceil(page.page.total / size));
  const at = Math.min(page.page.number, pages);
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
        <FilterRow clearHref="/comms/requests">
          <SelectField
            id="status"
            name="status"
            label={m('status')}
            defaultValue={rq.values.status}
            options={[
              { value: '', label: 'All' },
              ...STATUSES.map((s) => ({ value: s, label: LABEL[s] ?? s })),
            ]}
          />
          <SelectField
            id="channel"
            name="channel"
            label={m('channel')}
            defaultValue={channel}
            options={[
              { value: '', label: 'Any channel' },
              { value: 'sms', label: 'SMS' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'email', label: 'Email' },
            ]}
          />
          <SelectField
            id="audience"
            name="audience"
            label={m('audience')}
            defaultValue={audience}
            options={[
              { value: '', label: 'Any audience' },
              ...AUDIENCES.map((a) => ({ value: a, label: m(`audiences.${a}`) })),
            ]}
          />
          <FilterInput id="from" label="Asked from" type="date" value={rq.values.from} />
          <FilterInput id="to" label="Asked to" type="date" value={rq.values.to} />
          <FilterInput id="q" label="Title or asked by" value={rq.values.q} />
          <SelectField
            id="size"
            name="size"
            label="Per page"
            defaultValue={rq.size}
            options={['25', '50', '100', '200'].map((n) => ({ value: n, label: n }))}
          />
        </FilterRow>
        <RegisterBar
          page={at}
          size={size}
          total={page.page.total}
          summary={`${String(page.totals.recipients)} messages · delivered ${String(page.totals.delivered)} · failed ${String(page.totals.failed)} · still waiting to go ${String(page.totals.queued)} · ${String(page.totals.waiting)} request${page.totals.waiting === 1 ? '' : 's'} waiting for approval`}
          fileHref={`/api/comms/requests-file?${rq.filters.toString()}`}
        />
        <p className="ep-field__help">
          “Sent” in the Status column means the request was handed over for delivery. The Delivery
          column shows what happened to its messages: queued (still waiting to go), delivered or
          failed.
        </p>
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
                `${r.requestedBy ?? ''} · ${new Date(r.requestedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })}`,
            },
          ]}
          rows={page.data}
          rowKey={(r) => r.id}
          emptyTitle={m('noRequests')}
        />
        <Pager page={at} pages={pages} hrefFor={(n) => `?${rq.here({ page: String(n) })}`} />
      </Card>
    </>
  );
}
