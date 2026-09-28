import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { ackAlert } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { InsightAlert } from '@/lib/types';

/** Sprint 15 (AI track): anomaly alerts v1. */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    open?: string;
    days?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const open = sp.open !== 'false';
  const days = sp.days && /^\d+$/.test(sp.days) ? sp.days : '30';
  const [t, a, me, alerts] = await Promise.all([
    getTranslations('pages.insights_alerts'),
    getTranslations('alerts'),
    getMe(),
    apiFetch<{ data: InsightAlert[] }>(`/insights/alerts?open=${open}&days=${days}`).then(
      (x) => x.data,
    ),
  ]);
  const canAck = me.permissions.includes('insights.alert.ack');
  const kindLabel = (k: string) =>
    ['attendance.drop', 'fees.collection_dip', 'reader.silent'].includes(k) ? a(k) : k;
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card
        title={t('title')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="open"
              name="open"
              label={a('show')}
              defaultValue={open ? 'true' : 'false'}
              options={[
                { value: 'true', label: a('open') },
                { value: 'false', label: a('all') },
              ]}
            />
            <SelectField
              id="days"
              name="days"
              label={a('days')}
              defaultValue={days}
              options={['7', '30', '90'].map((d) => ({ value: d, label: d }))}
            />
            <Button type="submit" variant="secondary" size="sm">
              {a('show')}
            </Button>
          </form>
        }
      >
        <DataTable<InsightAlert>
          caption={`${t('title')} · ${alerts.length}`}
          density="dense"
          columns={[
            { key: 'on', header: a('detected'), render: (x) => x.detectedOn },
            {
              key: 'sev',
              header: a('severity'),
              render: (x) => (
                <Badge
                  tone={
                    x.severity === 'danger'
                      ? 'danger'
                      : x.severity === 'warning'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {a(x.severity)}
                </Badge>
              ),
            },
            { key: 'kind', header: a('kind'), render: (x) => kindLabel(x.kind) },
            {
              key: 'alert',
              header: a('alert'),
              render: (x) => (
                <>
                  <strong>{x.title}</strong>
                  <div className="ep-field__help">{x.message}</div>
                </>
              ),
            },
            {
              key: 'ack',
              header: '',
              render: (x) =>
                x.ackedAt ? (
                  <span className="ep-field__help">{a('acked', { by: x.ackedBy ?? '' })}</span>
                ) : canAck ? (
                  <form action={ackAlert}>
                    <input type="hidden" name="id" value={x.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      {a('ack')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={alerts}
          rowKey={(x) => x.id}
          emptyTitle={a('none')}
        />
      </Card>
    </>
  );
}
