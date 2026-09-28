import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { decideTransportRequest } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportRequest } from '@/lib/types';

const tone = (s: TransportRequest['status']) =>
  s === 'approved'
    ? 'success'
    : s === 'rejected'
      ? 'danger'
      : s === 'pending'
        ? 'warning'
        : 'neutral';

/** Sprint 13: families' bus requests and the office's decisions. */
export default async function TransportRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const [t, tr, c, me, requests] = await Promise.all([
    getTranslations('pages.transport_requests'),
    getTranslations('transport'),
    getTranslations('common'),
    getMe(),
    apiFetch<{ data: TransportRequest[] }>(
      `/transport/requests${sp.status ? `?status=${sp.status}` : ''}`,
    ).then((r) => r.data),
  ]);
  const canDecide = me.permissions.includes('transport.request.decide');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={tr('requests')}>
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
            label={tr('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              ...(['pending', 'approved', 'rejected'] as const).map((s) => ({
                value: s,
                label: tr(`requestStatuses.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {c('filter')}
          </Button>
        </form>
        <DataTable<TransportRequest>
          caption={tr('requests')}
          density="dense"
          columns={[
            {
              key: 'when',
              header: tr('requestedAt'),
              render: (x) => new Date(x.requestedAt).toLocaleString('en-IN'),
            },
            {
              key: 'student',
              header: tr('students'),
              render: (x) =>
                `${x.studentName} · ${x.admissionNo}${x.section ? ` · ${x.section}` : ''}`,
            },
            {
              key: 'kind',
              header: tr('request'),
              render: (x) => <strong>{tr(`kinds.${x.kind}`)}</strong>,
            },
            {
              key: 'route',
              header: tr('name'),
              render: (x) =>
                x.routeCode
                  ? `${x.routeCode} ${x.routeName ?? ''}${x.stopName ? ` · ${x.stopName}` : ''}`
                  : '—',
            },
            {
              key: 'current',
              header: tr('current'),
              render: (x) =>
                x.current
                  ? `${x.current.routeCode}${x.current.stopName ? ` · ${x.current.stopName}` : ''}`
                  : '—',
            },
            { key: 'note', header: tr('requestNote'), render: (x) => x.note ?? '' },
            {
              key: 'status',
              header: tr('status'),
              render: (x) => (
                <span title={x.decisionNote ?? ''}>
                  <Badge tone={tone(x.status)}>{tr(`requestStatuses.${x.status}`)}</Badge>
                  {x.status === 'pending' && x.workflowInstanceId ? (
                    <small>
                      {' '}
                      · <a href="/workflow/inbox">{tr('inWorkflow')}</a>
                    </small>
                  ) : null}
                  {x.decidedBy ? <small> · {x.decidedBy}</small> : null}
                </span>
              ),
            },
            {
              key: 'decide',
              header: canDecide ? tr('decide') : '',
              render: (x) =>
                canDecide && x.status === 'pending' && !x.workflowInstanceId ? (
                  <form
                    action={decideTransportRequest}
                    style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: 220 }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <InputField
                      id={`note-${x.id}`}
                      name="note"
                      label={tr('note')}
                      maxLength={300}
                    />
                    <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      <Button type="submit" name="outcome" value="approved" size="sm">
                        {tr('approve')}
                      </Button>
                      <Button
                        type="submit"
                        name="outcome"
                        value="rejected"
                        variant="secondary"
                        size="sm"
                      >
                        {tr('reject')}
                      </Button>
                    </div>
                  </form>
                ) : null,
            },
          ]}
          rows={requests}
          rowKey={(x) => x.id}
          emptyTitle={tr('noRequests')}
        />
      </Card>
    </>
  );
}
