import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { BusEvent, TransportRoute } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default async function BusPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; routeId?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, routes, res] = await Promise.all([
    getTranslations('pages.attendance_bus'),
    getTranslations('attendance'),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes')
      .then((r) => r.data)
      .catch(() => [] as TransportRoute[]),
    apiFetch<{
      date: string;
      routes: Array<{ route: string; boarded: number; alighted: number }>;
      data: BusEvent[];
    }>(`/attendance/bus?date=${date}${sp.routeId ? `&routeId=${sp.routeId}` : ''}`),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
        <SelectField
          id="routeId"
          name="routeId"
          label={a('route')}
          defaultValue={sp.routeId ?? ''}
          options={[
            { value: '', label: '—' },
            ...routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
          ]}
        />
        <Button type="submit" variant="secondary">
          {a('show')}
        </Button>
      </form>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {res.routes.map((r) => (
          <Badge key={r.route} tone="info">
            {r.route}: {r.boarded} {a('boarded').toLowerCase()} · {r.alighted}{' '}
            {a('alighted').toLowerCase()}
          </Badge>
        ))}
      </div>
      <Card>
        <DataTable<BusEvent>
          caption={`${a('busEvents')} · ${date}`}
          density="dense"
          columns={[
            {
              key: 'at',
              header: a('occurredAt'),
              render: (e) =>
                new Date(e.occurredAt).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
            },
            { key: 'route', header: a('route'), render: (e) => e.route ?? '—' },
            {
              key: 'student',
              header: a('student'),
              render: (e) =>
                e.studentId ? (
                  <a href={`/people/students/${e.studentId}`}>{e.student}</a>
                ) : (
                  <code>{e.tag}</code>
                ),
            },
            {
              key: 'outcome',
              header: a('outcome'),
              render: (e) => (
                <Badge
                  tone={
                    e.outcome === 'boarded'
                      ? 'success'
                      : e.outcome === 'alighted'
                        ? 'info'
                        : e.outcome === 'unknown_tag'
                          ? 'danger'
                          : 'neutral'
                  }
                >
                  {e.outcome}
                </Badge>
              ),
            },
            {
              key: 'pos',
              header: a('position'),
              render: (e) =>
                e.lat ? `${Number(e.lat).toFixed(4)}, ${Number(e.lng).toFixed(4)}` : '',
            },
            { key: 'alert', header: a('alerted'), render: (e) => (e.alertSentAt ? '✓' : '') },
          ]}
          rows={res.data}
          rowKey={(e) => e.id}
          emptyTitle={a('noBus')}
        />
      </Card>
    </>
  );
}
